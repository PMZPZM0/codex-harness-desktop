/**
 * engine-ipc 的「dev-runtime」部分（09-22 从同目录 engine-ipc.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { app, dialog, ipcMain, safeStorage, shell } from "electron";
import { CHINA_NPM_REGISTRY, bundledNode, downloadEnv, npmGlobalRoot, toolchainEnv, toolsRoot } from "../../toolchain";
import { existsSync } from "node:fs";
import { DARWIN_HIDDEN, DARWIN_SPEC_TEXT, IS_MAC, devRuntimeSpecs, emitRuntimeProgress, pythonSiteDir, readDownloadSource, restartServerWhenIdle, runRuntimeInstaller, runtimeInstalled, runtimeInstaller, runtimeInstalls } from "../dev-runtimes";
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

/** 运行时卸载：删除安装根目录（不是单个 marker），状态回退为"未下载" */
function runtimeUninstallPath(id: DevRuntimeId, spec: DevRuntimeSpec): string {
  // 引擎侧安装：ponytail 在 codex-home/plugins/cache/ponytail
  if (id === "ponytail") return path.join(codexHome, "plugins", "cache", "ponytail");
  // ⛔ npm 包（cloakbrowser）：只能删**包体目录本身**。按 marker 首段推导会得到 npm-global ——
  //    那是 nuphus / playwright-cli 的共同家目录，卸载 CloakBrowser 会把两个内置能力一起删光。
  if (id === "cloakbrowser") return path.join(npmGlobalRoot(), "cloakbrowser");
  // ⛔ pip 包（markitdown）：只能删**包目录本身**。按 marker 首段推导会得到 `tools/python` ——
  //    那是整个 Python 运行时（含 pip 与引擎依赖），卸载一个文档转换会把 Python 一起删光。
  if (id === "markitdown") {
    const site = pythonSiteDir(path.join(toolsRoot(), "python"));
    return site ? path.join(site, "markitdown") : path.join(toolsRoot(), "markitdown");
  }
  // 工具侧：安装根 = marker 路径的第一段（playwright-browsers -> pw-browsers / git -> git / …）
  return path.join(toolsRoot(), spec.marker.split(/[\\/]/)[0]);
}

/** npm 包在 npm-global 根与 node_modules/.bin 下留的 shim（cloakbrowser / .cmd / .ps1） */
function npmShimPaths(pkg: string): string[] {
  const globalDir = path.join(toolsRoot(), "npm-global");
  return [
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
  ];
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
  const target = runtimeUninstallPath(id, spec);
  // 防御：marker 解析异常时 target 可能退化成某个根目录 —— 那会把**所有**工具/插件删光。
  // 要求 target 必须落在 toolsRoot 或 codexHome 之内（ponytail 走引擎侧 codexHome），
  // 且不等于这两者本身；宁可失败也不能误删全局。
  const allowedRoots = [toolsRoot(), codexHome].filter(Boolean).map((r) => path.resolve(r));
  const resolvedTarget = path.resolve(target);
  const underAllowed = allowedRoots.some((r) => resolvedTarget.startsWith(r + path.sep));
  if (!resolvedTarget || allowedRoots.includes(resolvedTarget) || !underAllowed) {
    throw new Error("安装路径解析异常，已取消卸载");
  }
  // 一些 marker 是文件而不是目录（如 npm-global/.../package.json）—— 删父目录的安装根即可
  await fs.rm(target, { recursive: true, force: true });
  // npm 包卸载后清掉残留 shim：不清的话卡片显示「未安装」，但 PATH 上还留着指向已删目录的
  // cloakbrowser.cmd，引擎调用会报模块找不到（比「没装」更难诊断）。
  if (id === "cloakbrowser") {
    await Promise.all(npmShimPaths("cloakbrowser").map((file) => fs.rm(file, { force: true }).catch(() => undefined)));
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
