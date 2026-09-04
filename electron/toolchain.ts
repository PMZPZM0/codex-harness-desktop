// 应用内置工具链：resources/tools/{node,pwsh}（scripts/install-runtimes.cjs 安装）。
// terminal.ts（终端面板）与 codex-server.ts（Codex 引擎子进程）共用：
// 子进程环境里优先命中内置 node/pwsh，应用自包含可移植。
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export function toolsRoot() {
  try {
    // electron-builder 的 extraResources 会把工具放到 resources/tools；开发态仍从仓库读取。
    return app.isPackaged
      ? path.join(process.resourcesPath, "tools")
      : path.join(app.getAppPath(), "resources", "tools");
  } catch {
    return "";
  }
}

// 这台机器的开发工具（node/python 等）不在系统 PATH 上，把常见工具链目录并进去，
// 否则子进程里 git/node/python 全部"无法识别"。内置 node/pwsh 排最前，优先命中。
export function augmentedPath() {
  const bundled: string[] = [];
  const discovered: string[] = [];
  const system = (process.env.PATH ?? "").split(";").filter(Boolean);
  const tools = toolsRoot();
  if (tools) {
    // Codex app-server 是 GUI 子进程，直接拉起控制台版 pwsh.exe 会闪黑框。
    // pwsh-headless 是透明 GUI 桥（转发 stdio/退出码）；右侧终端仍通过 bundledPwsh
    // 直接使用真实 pwsh，不受这个 PATH 顺序影响。
    const headlessPwsh = path.join(tools, "pwsh-headless", "pwsh.exe");
    if (fs.existsSync(headlessPwsh)) bundled.push(path.dirname(headlessPwsh));
    bundled.push(`${tools}\\node`, `${tools}\\pwsh`, `${tools}\\npm-global`);
    // MinGit 的 cmd 只是入口，真正运行时还需要 mingw64/bin 与 usr/bin。
    for (const dir of [
      "git\\cmd", "git\\bin", "git\\mingw64\\bin", "git\\usr\\bin",
      "python", "python\\Scripts", "ffmpeg\\bin", "vscode-cli", "jq", "ninja", "sevenzip", "yt-dlp",
      "rg", "uv", "cmake\\bin", "miniconda", "miniconda\\Scripts", "miniconda\\condabin", "mingw\\mingw64\\bin",
    ]) {
      if (fs.existsSync(path.join(tools, dir))) bundled.push(path.join(tools, dir));
    }
  }
  const roots = ["D:\\Jarvis_Toolchain", "C:\\Program Files\\Git\\cmd", "C:\\Program Files\\Git\\bin", "C:\\Program Files\\nodejs", "C:\\Program Files\\PowerShell\\7"];
  for (const root of roots) {
    try {
      if (root.includes("Jarvis_Toolchain")) {
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) if (entry.isDirectory()) discovered.push(`${root}\\${entry.name}`);
      } else if (fs.existsSync(root)) discovered.push(root);
    } catch { /* 目录不存在 */ }
  }
  // 内置工具必须排在 WindowsApps 等系统占位符之前；按不区分大小写去重并保留首项。
  const seen = new Set<string>();
  return [...bundled, ...discovered, ...system].filter((entry) => {
    const key = entry.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(";");
}

// npm 全局包的 node_modules（nuphus-mcp / playwright-cli / cloakbrowser / playwright-core）。
// NODE_PATH 对 CommonJS require 生效；cloakbrowser 是 ESM-only（NODE_PATH 对 import 无效），
// 引擎侧用 CLOAKBROWSER_ENTRY 直连 dist/index.js 动态 import。
export function npmGlobalRoot() {
  const tools = toolsRoot();
  return tools ? `${tools}\\npm-global\\node_modules` : "";
}

// cloakbrowser ESM 入口的 file:// URL（供引擎脚本 import；空串表示未安装）。
export function cloakEntryUrl() {
  const root = npmGlobalRoot();
  const entry = root ? `${root}\\cloakbrowser\\dist\\index.js` : "";
  try {
    return entry && fs.existsSync(entry) ? `file:///${entry.replaceAll("\\", "/")}` : "";
  } catch {
    return "";
  }
}

// 桌面自动化 MCP 的原生二进制（Rust exe，无需 node 即可运行）。
export function nuphusBinary() {
  const root = npmGlobalRoot();
  const candidates = root
    ? [`${root}\\@nuphus\\nuphus-mcp\\node_modules\\@nuphus\\nuphus-mcp-win32-x64\\bin\\nuphus-mcp.exe`, `${root}\\nuphus-mcp-win32-x64\\bin\\nuphus-mcp.exe`]
    : [];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch { /* 不存在 */ }
  }
  return "";
}

// nuphus-call 桥（resources/tools/nuphus-call.mjs）：按需调用 nuphus 工具的命令行入口。
// 引擎以命令行方式用时才拉起 nuphus，35 个工具 schema 不进上下文，回复速度不受影响。
export function nuphusCallHelper() {
  const tools = toolsRoot();
  const candidate = `${tools}\\nuphus-call.mjs`;
  try {
    return tools && fs.existsSync(candidate) ? candidate : "";
  } catch {
    return "";
  }
}

// Codex 子进程的完整环境：PATH + NODE_PATH，让引擎能直接使用已装自动化工具。
// 同时把 CloakBrowser/playwright 的缓存指向应用内置目录，打包后随应用走。
export function toolchainEnv() {
  const env: Record<string, string> = { ...process.env, PATH: augmentedPath() };
  const nodePath = npmGlobalRoot();
  if (nodePath) env.NODE_PATH = nodePath;
  const tools = toolsRoot();
  if (tools) {
    const realPwsh = path.join(tools, "pwsh", "pwsh.exe");
    if (fs.existsSync(realPwsh)) env.CODEX_REAL_PWSH = realPwsh;
    env.CLOAKBROWSER_CACHE_DIR = `${tools}\\cloak-cache`;
    env.CLOAKBROWSER_AUTO_UPDATE = "0";
    env.PLAYWRIGHT_BROWSERS_PATH = `${tools}\\pw-browsers`;
    const python = path.join(tools, "python", "python.exe");
    if (fs.existsSync(python)) {
      env.PYTHON = python;
      env.PYTHONHOME = path.join(tools, "python");
      env.PYTHON_EXECUTABLE = python;
      env.npm_config_python = python;
    }
  }
  const cloakEntry = cloakEntryUrl();
  if (cloakEntry) env.CLOAKBROWSER_ENTRY = cloakEntry;
  const nuphusBin = nuphusBinary();
  if (nuphusBin) env.NUPHUS_BIN = nuphusBin;
  return env;
}

// CloakBrowser Chromium 内核缓存目录（resources/tools/cloak-cache，随应用打包）。
export function cloakCacheDir() {
  const tools = toolsRoot();
  return tools ? `${tools}\\cloak-cache` : "";
}

// 内置 pwsh 完整路径；没有则返回空串
export function bundledPwsh() {
  const tools = toolsRoot();
  const candidate = `${tools}\\pwsh\\pwsh.exe`;
  try {
    return fs.existsSync(candidate) ? candidate : "";
  } catch {
    return "";
  }
}

// 内置 node 完整路径（主进程 spawn helper 脚本用）；没有则返回空串
export function bundledNode() {
  const tools = toolsRoot();
  const candidate = `${tools}\\node\\node.exe`;
  try {
    return fs.existsSync(candidate) ? candidate : "";
  } catch {
    return "";
  }
}

/** 内置 MinGit 入口；没有安装时返回空串。 */
export function bundledGit() {
  const tools = toolsRoot();
  const candidates = [path.join(tools, "git", "cmd", "git.exe"), path.join(tools, "git", "bin", "git.exe")];
  for (const candidate of candidates) {
    try { if (tools && fs.existsSync(candidate)) return candidate; } catch { /* 不存在 */ }
  }
  return "";
}

/** 内置 Python 解释器；没有安装时返回空串。 */
export function bundledPython() {
  const tools = toolsRoot();
  const candidate = path.join(tools, "python", "python.exe");
  try { return tools && fs.existsSync(candidate) ? candidate : ""; } catch { return ""; }
}

// CloakBrowser 常驻助手脚本（stdin 喂 URL，驱动指纹浏览器窗口）。
export function cloakOpenHelper() {
  const tools = toolsRoot();
  return tools ? `${tools}\\cloak-open.mjs` : "";
}
