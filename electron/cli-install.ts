/**
 * CLI 智能体「一键安装 / 配套卸载」的执行端（10-30 用户令：
 * 「cli 智能体界面加一个一键安装功能，而不是光复制指令自己去安装，还要配套卸载功能」）。
 *
 * 执行口径（照抄开发工具页 runNpmInstall 的成熟做法）：
 *   · **npm**：内置 node + npm-cli.js，`--prefix` 固定到 `<userData>/tools/npm-global`
 *     —— 那个目录已在增强 PATH（augmentedPath）上 ⇒ 装完 `where` 立刻能检测到；
 *     registry 国内镜像优先、失败回落官方源。
 *   · **pip**：内置 Python `-m pip install`（装进应用自己的 python/Scripts，同样在 PATH 上）。
 *   · 命令形态由 `src/lib/cli-install.mjs` 的纯函数解析 —— 只认 npm / pip，
 *     别的形态一律拒绝（宁可拒绝，不硬猜；curl 脚本/brew 这种复制到终端自己跑）。
 *   · 装完**必须复核**（detectCliAgent 真查 PATH）：命令 exit 0 ≠ 装上了（markitdown 教训）。
 *
 * ⛔ 进度经 harness 事件 `cli-agent-install` 推给面板（stage: start/log/done/error）；
 *   装卸完成后广播 `cli-agents-changed` —— @ 列表与面板都靠它刷新（检测缓存一并失效）。
 * ⛔ 子进程一律参数数组、不开 shell（包名来自配置，仍按注入面处理）。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { CHINA_NPM_REGISTRY, bundledNode, bundledNpmCli, bundledPython, pythonPipReady, toolchainEnv, writeToolsRoot } from "./toolchain";
import { detectCliAgent, invalidateCliInstalledCache, normalizeCliBin, readCliAgents } from "./cli-agents";
import { parseInstallCommand } from "../src/lib/cli-install.mjs";
import { broadcastHarnessEvent } from "./features/window-bus";

export type CliInstallOutcome = { ok: boolean; error?: string; detail?: string };

const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

/** 同一时刻只允许一个安装/卸载在跑（并发两条 npm 会互抢目录）。 */
const busyIds = new Set<string>();

function emit(id: string, stage: "start" | "log" | "done" | "error", line?: string): void {
  broadcastHarnessEvent({ type: "cli-agent-install", id, stage, line, at: Date.now() } as any);
}

function runChild(file: string, args: string[], env: NodeJS.ProcessEnv, id: string, label: string): Promise<{ code: number; tail: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, env });
    let tail = "";
    const report = (chunk: unknown) => {
      const text = String(chunk ?? "");
      if (!text.trim()) return;
      tail = `${tail}\n${text}`.slice(-4000);
      emit(id, "log", text.trim().split(/\r?\n/).filter(Boolean).slice(-2).join("\n"));
    };
    child.stdout?.on("data", report);
    child.stderr?.on("data", report);
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* 已退出 */ }
      reject(new Error(`${label} 超时（10 分钟）——包太大时请复制命令到终端手动安装`));
    }, INSTALL_TIMEOUT_MS);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? -1, tail: tail.trim() }); });
  });
}

async function npmGlobal(args: string[], id: string, label: string): Promise<void> {
  const node = bundledNode();
  if (!node) throw new Error(`缺少内置 Node，无法${label}`);
  const npmCli = bundledNpmCli();
  if (!npmCli) throw new Error(`内置 Node 缺少 npm（候选中无 npm-cli.js），无法${label}`);
  const prefix = path.join(writeToolsRoot(), "npm-global");
  const userRegistry = process.env.npm_config_registry || process.env.NPM_CONFIG_REGISTRY || "";
  const registries = userRegistry ? [userRegistry] : [CHINA_NPM_REGISTRY, ""];
  let lastError: Error | null = null;
  for (const registry of registries) {
    const via = registry ? (userRegistry ? "用户配置的源" : "国内镜像") : "官方源";
    try {
      const env = { ...toolchainEnv() };
      if (registry) env.npm_config_registry = registry;
      emit(id, "log", `从${via}安装…`);
      const { code, tail } = await runChild(node, [npmCli, ...args, "--prefix", prefix, "--no-audit", "--no-fund", "--loglevel", "error"], env, id, label);
      if (code !== 0) throw new Error(tail.slice(-1200) || `${label} 失败（退出码 ${code}）`);
      return;
    } catch (error) {
      lastError = error as Error;
      if (registries.indexOf(registry) < registries.length - 1) emit(id, "log", `从${via}${label}失败，换下一个源重试…`);
    }
  }
  throw lastError ?? new Error(`${label} 失败`);
}

/** pip 系固定用内置 Python（-m pip），装进应用自己的目录（PATH 上有 Scripts/bin）。 */
async function pipRun(args: string[], id: string, label: string): Promise<void> {
  const python = bundledPython();
  const ready = pythonPipReady(python);
  if (!ready.ok) throw new Error(ready.reason);
  const { code, tail } = await runChild(python, ["-m", "pip", ...args, "--disable-pip-version-check"], toolchainEnv(), id, label);
  if (code !== 0) throw new Error(tail.slice(-1200) || `${label} 失败（退出码 ${code}）`);
}

async function resolveEntry(id: string): Promise<{ id: string; name: string; bin: string; installCmd: string } | null> {
  const items = await readCliAgents();
  const item = items.find((entry) => entry.id === String(id ?? ""));
  if (!item) return null;
  return { id: item.id, name: item.name, bin: item.bin, installCmd: item.installCmd };
}

/** 一键安装：解析 installCmd → 真跑 → 复核 PATH 上真的有了。 */
export async function installCliAgent(id: string): Promise<CliInstallOutcome> {
  const entry = await resolveEntry(id);
  if (!entry) return { ok: false, error: "找不到这个 CLI" };
  const spec = parseInstallCommand(entry.installCmd);
  if (!spec.manager) return { ok: false, error: spec.error };
  if (busyIds.has(entry.id)) return { ok: false, error: "这个 CLI 正在安装中，请等当前操作结束" };
  busyIds.add(entry.id);
  emit(entry.id, "start", `正在安装 ${entry.name}…`);
  try {
    if (spec.manager === "npm") await npmGlobal(["install", "--global", ...spec.packages], entry.id, "安装");
    else await pipRun(["install", ...spec.packages], entry.id, "安装");
    const check = await detectCliAgent({ bin: entry.bin });
    invalidateCliInstalledCache();
    if (!check.installed) {
      emit(entry.id, "error", "命令跑完了，但 PATH 上仍找不到它");
      return {
        ok: false,
        error: `「${entry.name}」安装命令执行成功，但复核未通过：PATH 上仍找不到 \`${entry.bin}\`。`
          + "这通常是安装到了别的位置 —— 请把上面的日志发出来排查；重复点「一键安装」不会自愈。",
      };
    }
    broadcastHarnessEvent({ type: "cli-agents-changed" } as any);
    emit(entry.id, "done", `已安装${check.version ? `（${check.version}）` : ""}`);
    return { ok: true, detail: `已安装 ${entry.name}${check.version ? ` · ${check.version}` : ""}` };
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    invalidateCliInstalledCache();
    emit(entry.id, "error", message.slice(0, 300));
    return { ok: false, error: message };
  } finally {
    busyIds.delete(entry.id);
  }
}

/** 配套卸载：与安装同一条命令形态解析（uninstall）。 */
export async function uninstallCliAgent(id: string): Promise<CliInstallOutcome> {
  const entry = await resolveEntry(id);
  if (!entry) return { ok: false, error: "找不到这个 CLI" };
  const spec = parseInstallCommand(entry.installCmd);
  if (!spec.manager) return { ok: false, error: `这个 CLI 不是经 npm / pip 装的，应用不会替你卸载 —— 按它自己的方式管理${spec.error ? `（${spec.error}）` : ""}` };
  if (busyIds.has(entry.id)) return { ok: false, error: "这个 CLI 正在操作中，请等当前操作结束" };
  busyIds.add(entry.id);
  emit(entry.id, "start", `正在卸载 ${entry.name}…`);
  try {
    if (spec.manager === "npm") await npmGlobal(["uninstall", "--global", ...spec.packages], entry.id, "卸载");
    else await pipRun(["uninstall", "-y", ...spec.packages], entry.id, "卸载");
    const check = await detectCliAgent({ bin: entry.bin });
    invalidateCliInstalledCache();
    broadcastHarnessEvent({ type: "cli-agents-changed" } as any);
    if (check.installed) {
      /* PATH 上还有另一份：多半是用户自己在系统 npm/python 里装的 —— 我们只动应用自己的目录，不越界。 */
      emit(entry.id, "done", "应用目录已卸载；系统里还有另一份");
      return {
        ok: true,
        detail: `已从应用的工具目录卸载 ${entry.name}；但 PATH 上还有另一份（可能是你自己在系统 npm/python 里装的），没有动它。`,
      };
    }
    emit(entry.id, "done", `已卸载 ${entry.name}`);
    return { ok: true, detail: `已卸载 ${entry.name}（\`${normalizeCliBin(entry.bin)}\` 不在 PATH 上了）` };
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    invalidateCliInstalledCache();
    emit(entry.id, "error", message.slice(0, 300));
    return { ok: false, error: message };
  } finally {
    busyIds.delete(entry.id);
  }
}
