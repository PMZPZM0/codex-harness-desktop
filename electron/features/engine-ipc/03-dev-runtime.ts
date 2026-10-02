/**
 * engine-ipc 的「dev-runtime」部分（09-22 从同目录 engine-ipc.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { app, dialog, ipcMain, safeStorage, shell } from "electron";
import { CHINA_NPM_REGISTRY, bundledNode, downloadEnv, npmGlobalRoot, pythonPipReady, toolchainEnv, toolsRoot } from "../../toolchain";
import { existsSync } from "node:fs";
import { DARWIN_HIDDEN, DARWIN_MARKERS, DARWIN_SPEC_TEXT, IS_MAC, PIP_PACKAGE_DIRS, devRuntimeSpecs, emitRuntimeProgress, pythonSiteDir, readDownloadSource, restartServerWhenIdle, runRuntimeInstaller, runtimeInstalled, runtimeInstaller, runtimeInstalls } from "../dev-runtimes";
import { bridgeDial, readCustomModel, responsesBridge, restrictedThreadRole } from "../../main";
import { codexHome, engineActiveTurnIds, mainWindow, server, threadCwd, threadRuntimeStore } from "../../runtime-refs";
import type { DevRuntimeId, DevRuntimeSpec } from "../dev-runtimes";
function specFor(id: DevRuntimeId, spec: DevRuntimeSpec): DevRuntimeSpec {
  if (!IS_MAC) return spec;
  const override = DARWIN_SPEC_TEXT[id];
  return override ? { ...spec, ...override } : spec;
}

function runtimeInstalledBySystem(id: DevRuntimeId): boolean {
  if (IS_MAC) {
    if (id === "git") return ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"].some((p) => existsSync(p));
    if (id === "openssl") return existsSync("/usr/bin/openssl");
    // ⛔ mac 适配（09-17 审计）：Docker Desktop for Mac 装完是 /Applications/Docker.app，
    //    CLI 落在 /usr/local/bin/docker（或 Apple Silicon 的 /opt/homebrew/bin/docker）。
    //    旧实现只探测 Windows 的 docker.exe，mac 用户装好 Docker 也一直显示「未安装」。
    if (id === "docker") {
      return ["/usr/local/bin/docker", "/opt/homebrew/bin/docker", "/Applications/Docker.app"].some((p) => existsSync(p));
    }
    return false;
  }
  // docker 是系统级安装：未在工具目录时也探测系统 PATH 上的 docker.exe（已装则视为完成）
  return id === "docker" ? !!(process.env.PATH ?? "").split(path.delimiter).some((dir) => dir && existsSync(path.join(dir.trim(), "docker.exe"))) : false;
}

export function runtimeList() {
  return (Object.entries(devRuntimeSpecs) as [DevRuntimeId, DevRuntimeSpec][])
    .filter(([id]) => !(IS_MAC && DARWIN_HIDDEN.has(id)))
    .map(([id, spec]) => ({
      id, ...specFor(id, spec),
      installed: runtimeInstalled(id, spec),
      installedBySystem: runtimeInstalledBySystem(id),
      installing: runtimeInstalls.has(id),
    }));
}

ipcMain.handle("runtime:list", () => runtimeList());

/** npm 包（nuphus / playwright-cli / cloakbrowser）的卸载落点：**包体目录 + 它自己的 shim**。
 *  ⛔⛔ 为什么不能按 marker 首段推导：marker 是 `npm-global\node_modules\@nuphus\nuphus-mcp\package.json`，
 *    首段推导会得到 `tools/npm-global` —— 那是几个 npm 能力的**共同家目录**，卸载一个会把其它一起删光。
 *  ⛔ 10-01 用户报「卸载不真」的根因：旧实现只删 `npm-global/<pkg>`（那是 **shim 文件**），
 *    真正的包体 `npm-global/node_modules/<pkg>` 原地不动 ⇒ 卡片显示「未安装」但包还在，
 *    再点安装又被 marker 判成已装 —— 卸载/安装两头都不可信。 */
const NPM_PACKAGE_ARTIFACTS: Partial<Record<DevRuntimeId, { dirs: string[]; shims: string[] }>> = {
  nuphus: { dirs: ["node_modules/@nuphus"], shims: ["nuphus-mcp", "nuphus-call"] },
  "playwright-cli": { dirs: ["node_modules/@playwright/cli"], shims: ["playwright-cli"] },
  cloakbrowser: { dirs: ["node_modules/cloakbrowser"], shims: ["cloakbrowser"] },
};

/** 卸载落点（**全部**要删的路径；调用方逐条做安全校验后再删）。 */
function runtimeUninstallTargets(id: DevRuntimeId, spec: DevRuntimeSpec): string[] {
  // 引擎侧安装：ponytail 在 codex-home/plugins/cache/ponytail
  if (id === "ponytail") return [path.join(codexHome, "plugins", "cache", "ponytail")];
  const pkg = NPM_PACKAGE_ARTIFACTS[id];
  if (pkg) {
    const global = npmGlobalRoot();
    return [...pkg.dirs.map((dir) => path.join(global, dir)), ...npmShimPaths(...pkg.shims)];
  }
  // ⛔ pip 包（markitdown / laya / phone-harness）：只能删**包目录本身**。按 marker 首段推导会得到
  //    `tools/python` —— 那是整个 Python 运行时（含 pip 与引擎依赖），卸载一个包会把 Python 一起删光。
  const pipDir = PIP_PACKAGE_DIRS[id];
  if (pipDir) {
    const site = pythonSiteDir(path.join(toolsRoot(), "python"));
    return [site ? path.join(site, pipDir) : path.join(toolsRoot(), pipDir)];
  }
  // 工具侧：安装根 = marker 路径的第一段（playwright-browsers -> pw-browsers / git -> git / …）
  return [path.join(toolsRoot(), spec.marker.split(/[\\/]/)[0])];
}

/** npm 包在 npm-global 根与 node_modules/.bin 下留的 shim（不是包体，删完包体要顺手清掉）。 */
function npmShimPaths(...pkgs: string[]): string[] {
  const globalDir = path.join(toolsRoot(), "npm-global");
  const out: string[] = [];
  for (const pkg of pkgs) {
    out.push(
      path.join(globalDir, pkg),
      // ⛔ mac 适配（09-17 审计）：POSIX 的 npm 全局 shim 落在 `<prefix>/bin/<pkg>`（不带后缀、
      //    symlink 到包内 bin），prepare-mac-tools 正是这么写的（npm-global/bin/nuphus-call）。
      //    旧清单只有 Windows 的 .cmd/.ps1 ⇒ mac 上卸载包后 shim 残留，PATH 里继续指向空目录。
      path.join(globalDir, "bin", pkg),
      path.join(globalDir, `${pkg}.cmd`),
      path.join(globalDir, `${pkg}.ps1`),
      path.join(globalDir, "node_modules", ".bin", pkg),
      path.join(globalDir, "node_modules", ".bin", `${pkg}.cmd`),
      path.join(globalDir, "node_modules", ".bin", `${pkg}.ps1`),
    );
  }
  return out;
}

ipcMain.handle("runtime:uninstall", async (_event, idValue: string) => {
  const id = idValue as DevRuntimeId;
  const spec = devRuntimeSpecs[id];
  if (!spec) throw new Error("未知开发工具");
  if (spec.builtIn) throw new Error("内置工具不可卸载");
  if (spec.kind === "guide") throw new Error("该工具是系统级安装，请到系统的「应用与功能」里卸载");
  // 随包内置能力（nuphus / playwright-cli / ponytail 插件），不是联网下载 —— 删了没有可靠的重取途径
  if (spec.bundled) throw new Error("该工具随应用内置，删除后只能从随包资源恢复，因此不支持卸载");
  // 随包内置资源（zip / 插件目录），不是联网下载 —— 删了没有可靠的重取途径，直接拒绝
  if (spec.noUninstall) throw new Error("该工具来自随包内置资源，删除后难以恢复，因此不支持卸载");
  const targets = runtimeUninstallTargets(id, spec);
  // 防御：marker 解析异常时 target 可能退化成某个根目录 —— 那会把**所有**工具/插件删光。
  // 要求每个 target 必须落在 toolsRoot 或 codexHome 之内（ponytail 走引擎侧 codexHome），
  // 且不等于这两者本身；宁可失败也不能误删全局。
  const allowedRoots = [toolsRoot(), codexHome].filter(Boolean).map((r) => path.resolve(r));
  for (const target of targets) {
    const resolvedTarget = path.resolve(target);
    const underAllowed = allowedRoots.some((r) => resolvedTarget.startsWith(r + path.sep));
    if (!resolvedTarget || allowedRoots.includes(resolvedTarget) || !underAllowed) {
      throw new Error("安装路径解析异常，已取消卸载");
    }
    // 一些 marker 是文件而不是目录（如 npm-global 下的 shim）—— 逐个删：先包体、再 shim
    await fs.rm(resolvedTarget, { recursive: true, force: true });
  }
// ponytail 卸载后要显式关掉 config.toml 里的注册段（否则引擎重启找不到已删的 cache）：
// 插件 key 是 **"ponytail@ponytail"**（见 ponytail-plugin.ts 的 MARKETPLACE_SECTION），
// 写成 "ponytail-plugin" 会静默无效。
// 注意：install 分支必须对应地把 enabled 置回 true —— 因为 seedConfigSections 是
// 「注册段已存在就幂等跳过」，不会把 false 翻回 true，漏了会导致重装后永久失效。
if (id === "ponytail") {
  await server.request("config/value/write", {
    filePath: path.join(codexHome, "config.toml"),
    keyPath: 'plugins."ponytail@ponytail".enabled',
    value: false,
    // ⛔ 引擎必填：缺了整条请求被判 Invalid request: missing field `mergeStrategy`，
    //    而这里是 .catch(() => undefined) 静默吞掉 —— 表现为「卸载了但 enabled 还是 true」。
    mergeStrategy: "replace",
  }).catch(() => undefined);
}
  return { ok: true, runtimes: runtimeList() };
});

/**
 * 工具自检（10-02 用户：「工具给老子一个检查，有一个报错，下载按不了」）。
 *
 * 卡片上的「已安装」只证明**文件在**，不证明**能跑** —— 用户要的是后者。
 * 本函数对每个开发工具：① 用与卡片同一份 `runtimeInstalled` 判装没装；
 * ② 装了就**真跑一次**（可执行类跑版本命令；Python 额外查 pip 能不能用）。
 *
 * ⛔ 单项失败绝不抛出：一个工具探不通不能让整页自检崩掉（那正是用户最烦的「检查也坏了」）。
 * ⛔ 探测必须带超时（8s）——工具卡住不能把设置页拖死。
 * ⛔ hidden 项（Laya / 手机控制）也要查：它们不出卡片，但用户照样会问「装了没、能不能用」。
 */
export type DevRuntimeHealth = {
  id: string;
  name: string;
  /** 文件在不在（与卡片同一份判定）。 */
  installed: boolean;
  /** 装了的能不能真跑起来。 */
  ok: boolean;
  /** 给人看的一行结论（版本串 / 失败原因）。 */
  detail: string;
};

/** 自检时让工具自报版本的参数（只列**可执行文件型**；其余只验存在性）。 */
const HEALTH_ARGS: Partial<Record<DevRuntimeId, string[]>> = {
  node: ["-v"],
  python: ["--version"],
  git: ["--version"],
  rg: ["--version"],
  uv: ["--version"],
  jq: ["--version"],
  ninja: ["--version"],
  // 7-Zip 无参即打印版本横幅
  sevenzip: [],
  "yt-dlp": ["--version"],
  cmake: ["--version"],
  ffmpeg: ["-version"],
  "platform-tools": ["version"],
  pwsh: ["-NoLogo", "-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"],
  "vscode-cli": ["--version"],
  conda: ["--version"],
  mingw: ["--version"],
};

/** 跑一次命令拿首行输出；**任何异常都收敛成一行文字**，不抛。 */
function probeTool(file: string, args: string[]): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      resolve({ ok, detail });
    };
    if (!existsSync(file)) return done(false, "已安装但找不到可执行文件（目录可能被手动删过，点「修复安装」）");
    try {
      const child = spawn(file, args, { windowsHide: true, env: toolchainEnv(), timeout: 8000 });
      let out = "";
      const grab = (chunk: unknown) => { out += String(chunk); };
      child.stdout?.on("data", grab);
      child.stderr?.on("data", grab);
      child.on("error", (error) => done(false, `无法启动：${String((error as Error).message || error).slice(0, 140)}`));
      child.on("close", (code) => {
        const first = out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] ?? "";
        if (code === 0) done(true, first.slice(0, 120) || "可运行");
        else done(false, `退出码 ${code}${first ? `：${first.slice(0, 100)}` : ""}`);
      });
    } catch (error) {
      done(false, String(error).slice(0, 140));
    }
  });
}

/** 可执行文件的落点：Windows 用 spec.marker，mac 走 DARWIN_MARKERS 覆盖。 */
function healthExecPath(id: DevRuntimeId, spec: DevRuntimeSpec): string {
  const rel = IS_MAC ? (DARWIN_MARKERS[id] ?? spec.marker) : spec.marker;
  return path.join(toolsRoot(), rel);
}

export async function devRuntimeHealth(): Promise<DevRuntimeHealth[]> {
  const specs = devRuntimeSpecs;
  const rows: DevRuntimeHealth[] = [];
  for (const [rawId, spec] of Object.entries(specs) as [DevRuntimeId, DevRuntimeSpec][]) {
    // 系统级安装项（Docker / OpenSSL，点按钮去官网）不参与自检 —— 我们没装它、也无从探测
    if (spec.kind === "guide") continue;
    const installed = runtimeInstalled(rawId, spec);
    if (!installed) {
      rows.push({ id: rawId, name: spec.name, installed: false, ok: false, detail: "未安装" });
      continue;
    }
    const args = HEALTH_ARGS[rawId];
    if (!args) {
      rows.push({ id: rawId, name: spec.name, installed: true, ok: true, detail: "已安装（无需可执行探测）" });
      continue;
    }
    const file = healthExecPath(rawId, spec);
    const probe = await probeTool(file, args);
    let ok = probe.ok;
    let detail = probe.detail;
    // Python 是最容易「在但不好用」的一个：装得上全看 pip（历史踩过 embeddable 版无 pip）。
    if (rawId === "python" && probe.ok) {
      const pip = pythonPipReady(file);
      if (!pip.ok) { ok = false; detail = pip.reason; }
      else detail = `${detail}｜pip 可用`;
    }
    rows.push({ id: rawId, name: spec.name, installed: true, ok, detail });
  }
  return rows;
}

ipcMain.handle("runtime:health", () => devRuntimeHealth());
