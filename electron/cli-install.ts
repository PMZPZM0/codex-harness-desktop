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
import { spawn, execFile } from "node:child_process";
import path from "node:path";
import { CHINA_NPM_REGISTRY, bundledNode, bundledNpmCli, bundledPython, pythonPipReady, toolchainEnv, writeToolsRoot } from "./toolchain";
import { detectCliAgent, invalidateCliInstalledCache, normalizeCliBin, readCliAgents } from "./cli-agents";
import { parseInstallCommand, hasCliUpdate, withLatestPackage, normalizeVersion, basePackageName } from "../src/lib/cli-install.mjs";
import { broadcastHarnessEvent } from "./features/window-bus";

export type CliInstallOutcome = { ok: boolean; error?: string; detail?: string };

const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

/** 同一时刻只允许一个安装/卸载在跑（并发两条 npm 会互抢目录）。 */
const busyIds = new Set<string>();
/** ⛔ 全局只允许一个装卸/更新操作（npm / pip 共用同一个 prefix，并发两条会互抢目录）。 */
let globalOpId = "";
/** 正在跑的装卸子进程（11-06：面板「取消」要真杀，不是只改 UI）。 */
const activeChild = new Map<string, ReturnType<typeof spawn>>();
const cancelledIds = new Set<string>();

function emit(id: string, stage: "start" | "log" | "done" | "error", line?: string): void {
  broadcastHarnessEvent({ type: "cli-agent-install", id, stage, line, at: Date.now() } as any);
}

function runChild(file: string, args: string[], env: NodeJS.ProcessEnv, id: string, label: string): Promise<{ code: number; tail: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, env });
    activeChild.set(id, child);
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
    child.on("error", (error) => { clearTimeout(timer); activeChild.delete(id); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      activeChild.delete(id);
      /* ⛔ 11-07：这里以前会 `cancelledIds.delete(id)`，把取消标记吃掉 ⇒ 子进程已退出、
         复核（detectCliAgent）还在跑的那段窗口里按「取消」，主流程仍会 emit done / 返回 ok，
         用户看到「取消成功」后又「已安装」。标记统一由操作的 finally 清。 */
      if (cancelledIds.has(id)) { reject(new Error("已取消")); return; }
      resolve({ code: code ?? -1, tail: tail.trim() });
    });
  });
}

/** 子进程跑完到复核之间也能被取消：三处操作的 finally 之前统一查一次。 */
function throwIfCancelled(id: string): void {
  if (cancelledIds.has(id)) throw new Error("已取消");
}

async function npmGlobal(args: string[], id: string, label: string): Promise<void> {
  const node = bundledNode();
  if (!node) throw new Error(`缺少内置 Node，无法${label}`);
  const npmCli = bundledNpmCli();
  if (!npmCli) throw new Error(`内置 Node 缺少 npm（候选中无 npm-cli.js），无法${label}`);
  const prefix = path.join(writeToolsRoot(), "npm-global");
  const userRegistry = process.env.npm_config_registry || process.env.NPM_CONFIG_REGISTRY || "";
  /* 用户命令里自带 --registry（私有源）⇒ 命令行参数优先于 env，别再拿镜像 env 覆盖、也别谎报源。 */
  const customRegistry = args.some((arg) => arg === "--registry" || arg.startsWith("--registry="));
  const registries = customRegistry ? [""] : (userRegistry ? [userRegistry] : [CHINA_NPM_REGISTRY, ""]);
  let lastError: Error | null = null;
  for (const registry of registries) {
    if (cancelledIds.has(id)) throw new Error("已取消");
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
      if (String((error as Error)?.message ?? error).includes("已取消")) throw error;
      if (registries.indexOf(registry) < registries.length - 1) emit(id, "log", `从${via}${label}失败，换下一个源重试…`);
    }
  }
  throw lastError ?? new Error(`${label} 失败`);
}

/** pip 系固定用内置 Python（-m pip），装进应用自己的目录（PATH 上有 Scripts/bin）。 */
/** pip 国内镜像（11-06 用户实测「安装好慢」：默认 pypi.org 从国内拉 40MB 轮子要几分钟）。
 *  ⛔ 与 npm 侧同一策略：用户自己配了 PIP_INDEX_URL 就优先用；否则清华镜像优先、失败回落官方源。 */
const CHINA_PYPI_MIRROR = "https://pypi.tuna.tsinghua.edu.cn/simple";

async function pipRun(args: string[], id: string, label: string): Promise<void> {
  const python = bundledPython();
  const ready = pythonPipReady(python);
  if (!ready.ok) throw new Error(ready.reason);
  const userIndex = process.env.PIP_INDEX_URL || process.env.pip_index_url || "";
  /* 用户命令里自己带了 -i / --index-url（私有源）⇒ 不要再用镜像覆盖它。 */
  /* 私有源既可能写成 `-i URL` 也可能写成 `--index-url=URL`；命中就不再追加镜像。 */
  const hasCustomIndex = args.some((arg) => arg === "-i" || arg === "--index-url" || arg.startsWith("--index-url="));
  const indexes = hasCustomIndex ? [""] : (userIndex ? [userIndex] : [CHINA_PYPI_MIRROR, ""]);
  let lastError: Error | null = null;
  for (const index of indexes) {
    if (cancelledIds.has(id)) throw new Error("已取消");
    const via = index ? (userIndex ? "用户配置的源" : "国内镜像") : "官方源";
    try {
      const extra = index ? ["-i", index] : [];
      emit(id, "log", `从${via}${label}…`);
      const { code, tail } = await runChild(python, ["-m", "pip", ...args, ...extra, "--retries", "2", "--timeout", "30", "--disable-pip-version-check"], toolchainEnv(), id, label);
      if (code !== 0) throw new Error(tail.slice(-1200) || `${label} 失败（退出码 ${code}）`);
      return;
    } catch (error) {
      lastError = error as Error;
      if (String((error as Error)?.message ?? error).includes("已取消")) throw error;
      if (indexes.indexOf(index) < indexes.length - 1) emit(id, "log", `从${via}${label}失败，换官方源重试…`);
    }
  }
  throw lastError ?? new Error(`${label} 失败`);
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
  if (globalOpId) return { ok: false, error: globalOpId === entry.id ? "这个 CLI 正在操作中，请等当前操作结束" : "另一个 CLI 正在安装 / 更新，请等它结束" };
  busyIds.add(entry.id);
  globalOpId = entry.id;
  cancelledIds.delete(entry.id);
  emit(entry.id, "start", `正在安装 ${entry.name}…`);
  try {
    if (spec.manager === "npm") await npmGlobal(["install", "--global", ...spec.options, ...spec.packages], entry.id, "安装");
    else await pipRun(["install", ...spec.options, ...spec.packages], entry.id, "安装");
    throwIfCancelled(entry.id);
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
    if (globalOpId === entry.id) globalOpId = "";
    cancelledIds.delete(entry.id);
  }
}

/** 配套卸载：与安装同一条命令形态解析（uninstall）。 */
export async function uninstallCliAgent(id: string): Promise<CliInstallOutcome> {
  const entry = await resolveEntry(id);
  if (!entry) return { ok: false, error: "找不到这个 CLI" };
  const spec = parseInstallCommand(entry.installCmd);
  if (!spec.manager) return { ok: false, error: `这个 CLI 不是经 npm / pip 装的，应用不会替你卸载 —— 按它自己的方式管理${spec.error ? `（${spec.error}）` : ""}` };
  if (busyIds.has(entry.id)) return { ok: false, error: "这个 CLI 正在操作中，请等当前操作结束" };
  if (globalOpId) return { ok: false, error: globalOpId === entry.id ? "这个 CLI 正在操作中，请等当前操作结束" : "另一个 CLI 正在安装 / 更新，请等它结束" };
  busyIds.add(entry.id);
  globalOpId = entry.id;
  cancelledIds.delete(entry.id);
  emit(entry.id, "start", `正在卸载 ${entry.name}…`);
  try {
    /* ⛔ 卸载只认裸包名：安装命令里的 `@latest` / pip 版本区间会让 npm/pip 直接报错
       （npm: ERMARGS "Remove arguments must only contain package names"）。 */
    const names = spec.packages.map(basePackageName).filter(Boolean);
    if (!names.length) return { ok: false, error: "这条安装命令里解析不出包名，无法自动卸载" };
    if (spec.manager === "npm") await npmGlobal(["uninstall", "--global", ...names], entry.id, "卸载");
    else await pipRun(["uninstall", "-y", ...names], entry.id, "卸载");
    throwIfCancelled(entry.id);
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
    if (globalOpId === entry.id) globalOpId = "";
    cancelledIds.delete(entry.id);
  }
}

/* ── 更新检查 / 一键更新 / 取消（11-06 用户令：「CLI 智能体加更新功能 + 安装进度条」）────────
   · 最新版本：npm 走 `npm view <pkg> version --json`，pip 走 `pip index versions`；
     结果缓存 10 分钟（面板每次打开都会查，不打爆 registry）。
   · 一键更新：npm = `npm install -g <pkg>@latest`；pip = `pip install --upgrade <pkg>`；
     装完与安装一样**真复核 PATH**（命令 exit 0 ≠ 装上了）。
   · 取消：面板「取消」→ 这里 kill 子进程（真停），不再切源重试。 */

export type CliUpdateInfo = { id: string; current: string; latest: string; hasUpdate: boolean; error?: string };

const UPDATE_CACHE_MS = 10 * 60 * 1000;
const latestCache = new Map<string, { at: number; latest: string; error?: string }>();

function execFileText(file: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs = 20000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, env, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) { reject(new Error(String(stderr || error.message || error))); return; }
      resolve(String(stdout ?? "").trim());
    });
  });
}

/** 版本查询只带「源」相关选项：安装命令里的 --upgrade 之类与 npm view / pip index 无关，
 *  塞进去反而会让查询命令报错。⛔ pip 的 -i 是全局选项，必须排在子命令之前。 */
function sourceOptionsOf(options: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < options.length; i++) {
    const t = options[i];
    if (["-i", "--index-url", "--extra-index-url", "--registry"].includes(t)) {
      out.push(t);
      if (options[i + 1] && !options[i + 1].startsWith("-")) out.push(options[++i]);
    } else if (/^--(index-url|extra-index-url|registry)=/.test(t)) {
      out.push(t);
    }
  }
  return out;
}

/** 查某个包的最新版本（npm / pip）。失败返回 error，调用方跳过该条。 */
async function queryLatestVersion(manager: string, pkg: string, options: string[] = []): Promise<{ latest: string; error?: string }> {
  const srcOpts = sourceOptionsOf(options);
  try {
    if (manager === "npm") {
      const node = bundledNode();
      const npmCli = bundledNpmCli();
      if (!node || !npmCli) return { latest: "", error: "缺少内置 Node/npm，无法检查更新" };
      const userRegistry = process.env.npm_config_registry || process.env.NPM_CONFIG_REGISTRY || "";
      const customRegistry = srcOpts.some((a) => a === "--registry" || a.startsWith("--registry="));
      const registries = customRegistry ? [""] : (userRegistry ? [userRegistry] : [CHINA_NPM_REGISTRY, ""]);
      let lastError = "";
      for (const registry of registries) {
        try {
          const env = { ...toolchainEnv() };
          if (registry) env.npm_config_registry = registry;
          const raw = await execFileText(node, [npmCli, ...srcOpts, "view", pkg, "version", "--json"], env);
          const parsed: unknown = JSON.parse(raw);
          const latest = normalizeVersion(Array.isArray(parsed) ? parsed[parsed.length - 1] : parsed);
          if (latest) return { latest };
          lastError = "registry 没有返回版本号";
        } catch (error) {
          lastError = String((error as Error)?.message ?? error).slice(0, 200);
        }
      }
      return { latest: "", error: lastError || "检查更新失败" };
    }
    if (manager === "pip") {
      const python = bundledPython();
      const ready = pythonPipReady(python);
      if (!ready.ok) return { latest: "", error: ready.reason };
      const hasCustomIndex = srcOpts.some((a) => a === "-i" || a === "--index-url" || a.startsWith("--index-url="));
      const indexes = hasCustomIndex ? [""] : (process.env.PIP_INDEX_URL ? [process.env.PIP_INDEX_URL] : [CHINA_PYPI_MIRROR, ""]);
      let lastError = "";
      for (const index of indexes) {
        try {
          const extra = index ? ["-i", index] : [];
          const raw = await execFileText(python, ["-m", "pip", ...srcOpts, "index", "versions", pkg, ...extra, "--disable-pip-version-check"], toolchainEnv());
          const hit = raw.match(/^\S+\s+\(([^)]+)\)/m);
          const latest = normalizeVersion(hit?.[1] ?? "");
          if (latest) return { latest };
          lastError = "pip 没有返回版本号";
        } catch (error) {
          lastError = String((error as Error)?.message ?? error).slice(0, 200);
        }
      }
      return { latest: "", error: lastError || "检查更新失败" };
    }
    return { latest: "", error: "这个 CLI 不是经 npm / pip 装的，无法检查更新" };
  } catch (error) {
    return { latest: "", error: String((error as Error)?.message ?? error).slice(0, 200) };
  }
}

/** 检查一批 CLI 的更新（只查已安装、且安装命令能识别成 npm/pip 的）。 */
export async function checkCliAgentUpdates(ids?: string[]): Promise<{ items: CliUpdateInfo[] }> {
  const all = await readCliAgents();
  const wanted = new Set((Array.isArray(ids) ? ids : []).map(String));
  const targets = all.filter((entry) => (!wanted.size || wanted.has(entry.id)) && entry.bin);
  const items: CliUpdateInfo[] = [];
  const now = Date.now();
  /* ⛔ 并行查（限 4 路）：面板打开就查一轮，串行 14 条 × 每次 1~20s 会让「可更新」标记
     迟到几十秒；4 路以内既快又不至于同时拉一堆 npm/pip 子进程。 */
  const queue = [...targets];
  const one = async (entry: (typeof targets)[number]): Promise<CliUpdateInfo | null> => {
    const spec = parseInstallCommand(entry.installCmd);
    if (!spec.manager) return null;
    const detected = await detectCliAgent({ bin: entry.bin });
    if (!detected.installed) return null;
    const pkg = basePackageName(spec.packages[0] ?? "");
    if (!pkg) return null;
    let cached = latestCache.get(entry.id);
    if (!cached || now - cached.at > UPDATE_CACHE_MS) {
      const res = await queryLatestVersion(spec.manager, pkg, spec.options);
      cached = { at: now, latest: res.latest, error: res.error };
      latestCache.set(entry.id, cached);
    }
    const current = normalizeVersion(detected.version ?? "");
    return {
      id: entry.id,
      current,
      latest: cached.latest,
      hasUpdate: hasCliUpdate(current, cached.latest),
      error: cached.error,
    };
  };
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const entry = queue.shift();
      if (!entry) return;
      const info = await one(entry);
      if (info) items.push(info);
    }
  });
  await Promise.all(workers);
  return { items };
}

/** 一键更新：复用安装链路（真跑、真复核），命令按包管理器换成 upgrade 形态。 */
export async function updateCliAgent(id: string): Promise<CliInstallOutcome> {
  const entry = await resolveEntry(id);
  if (!entry) return { ok: false, error: "找不到这个 CLI" };
  const spec = parseInstallCommand(entry.installCmd);
  if (!spec.manager) return { ok: false, error: spec.error };
  if (busyIds.has(entry.id)) return { ok: false, error: "这个 CLI 正在操作中，请等当前操作结束" };
  if (globalOpId) return { ok: false, error: globalOpId === entry.id ? "这个 CLI 正在操作中，请等当前操作结束" : "另一个 CLI 正在安装 / 更新，请等它结束" };
  busyIds.add(entry.id);
  globalOpId = entry.id;
  cancelledIds.delete(entry.id);
  emit(entry.id, "start", `正在更新 ${entry.name}…`);
  try {
    if (spec.manager === "npm") await npmGlobal(["install", "--global", ...spec.options, ...spec.packages.map(withLatestPackage)], entry.id, "更新");
    else await pipRun(["install", "--upgrade", ...spec.options, ...spec.packages], entry.id, "更新");
    throwIfCancelled(entry.id);
    const check = await detectCliAgent({ bin: entry.bin });
    invalidateCliInstalledCache();
    latestCache.delete(entry.id);
    if (!check.installed) {
      emit(entry.id, "error", "更新命令跑完了，但 PATH 上找不到它");
      return { ok: false, error: `「${entry.name}」更新命令执行成功，但复核未通过：PATH 上仍找不到 \`${entry.bin}\`。` };
    }
    broadcastHarnessEvent({ type: "cli-agents-changed" } as any);
    emit(entry.id, "done", `已更新${check.version ? `（${check.version}）` : ""}`);
    return { ok: true, detail: `已更新 ${entry.name}${check.version ? ` · ${check.version}` : ""}` };
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    invalidateCliInstalledCache();
    emit(entry.id, "error", message.includes("已取消") ? "已取消" : message.slice(0, 300));
    return { ok: false, error: message };
  } finally {
    busyIds.delete(entry.id);
    if (globalOpId === entry.id) globalOpId = "";
    cancelledIds.delete(entry.id);
  }
}

/** 取消正在进行的安装 / 更新 / 卸载：真杀子进程（不是只改 UI）。 */
export function cancelCliInstall(id: string): { ok: boolean; cancelled: boolean } {
  const key = String(id ?? "");
  if (!busyIds.has(key)) return { ok: true, cancelled: false };
  cancelledIds.add(key);
  const child = activeChild.get(key);
  if (child) { try { child.kill(); } catch { /* 已退出 */ } }
  /* 可能正处在两次源重试的间隙（没有子进程），标记已置 ⇒ 下一轮开始前 throw「已取消」。 */
  return { ok: true, cancelled: true };
}
