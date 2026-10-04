// 应用内置工具链：resources/tools/{node,pwsh}（scripts/install-runtimes.cjs 安装）。
// terminal.ts（终端面板）与 codex-server.ts（Codex 引擎子进程）共用：
// 子进程环境里优先命中内置 node/pwsh，应用自包含可移植。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
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
  const system = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const tools = toolsRoot();
  if (process.platform !== "win32") {
    const directories = [
      "node/bin", "pwsh", "npm-global/bin", "bin", "git/bin", "python/bin",
      "vscode-cli", "rg", "uv", "cmake/bin",
      // ⛔ mac 适配（09-16）：darwin 侧 install-runtimes 会把这些也装进 tools/，
      // PATH 不带上 = 装了引擎也看不见（ffmpeg/yt-dlp/7zz/cmake.app 包布局/conda）。
      "ffmpeg/bin", "yt-dlp", "sevenzip", "cmake/CMake.app/Contents/bin", "miniconda/bin",
      "jq", "ninja",
    ].map((directory) => path.join(tools, directory)).filter(fs.existsSync);
    return [...new Set([...directories, ...system, "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"])].join(path.delimiter);
  }
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
  return tools ? path.join(tools, "npm-global", "node_modules") : "";
}

// cloakbrowser ESM 入口的 file:// URL（供引擎脚本 import；空串表示未安装）。
export function cloakEntryUrl() {
  const root = npmGlobalRoot();
  const entry = root ? path.join(root, "cloakbrowser", "dist", "index.js") : "";
  try {
    return entry && fs.existsSync(entry) ? pathToFileURL(entry).href : "";
  } catch {
    return "";
  }
}

// 桌面自动化 MCP 的原生二进制（Rust exe，无需 node 即可运行）。
export function nuphusBinary() {
  const root = npmGlobalRoot();
  const platform = process.platform === "darwin" ? "osx" : process.platform;
  const name = `nuphus-mcp-${platform}-${process.arch}`;
  const bin = process.platform === "win32" ? "nuphus-mcp.exe" : "nuphus-mcp";
  const candidates = root
    ? [
      path.join(root, "@nuphus", "nuphus-mcp", "node_modules", "@nuphus", name, "bin", bin),
      path.join(root, "@nuphus", name, "bin", bin),
      path.join(root, name, "bin", bin),
      path.join(toolsRoot(), "nuphus", bin),
    ]
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
  const candidate = path.join(tools, "nuphus-call.mjs");
  try {
    return tools && fs.existsSync(candidate) ? candidate : "";
  } catch {
    return "";
  }
}

// Windows 原生控件清单通道的 server 脚本（harness-uia.mjs）。
// ⛔ 必须**两个文件都在**才算就绪：.mjs 只是 MCP 门面，真正的 UIA 调用在同目录的 desktop-uia.ps1；
//    只带一个的话服务器起得来、每个工具都报「找不到脚本」，比不注册更难排查。
export function harnessUiaServer() {
  const tools = toolsRoot();
  const server = path.join(tools, "harness-uia.mjs");
  const bridge = path.join(tools, "desktop-uia.ps1");
  try {
    return tools && fs.existsSync(server) && fs.existsSync(bridge) ? server : "";
  } catch {
    return "";
  }
}

/**
 * mac 的桌面自动化后端 `open-computer-use`（Codex 式电脑操作，走 Accessibility 拿控件清单）。
 * 返回它的 CLI 启动脚本路径（Node CJS，内部按自身目录解析 `dist/Open Computer Use.app/...`）；
 * 非 darwin 或包/主程序缺失 ⇒ 空串（不注册，而不是注册一个起不来的服务器）。
 * ⛔ 判就绪要**同时**看启动脚本与 .app：只装上半截时 MCP 起得来但每次调用都失败，最难排查。
 */
export function computerUseLauncher() {
  if (process.platform !== "darwin") return "";
  const root = npmGlobalRoot();
  if (!root) return "";
  const pkg = path.join(root, "open-computer-use");
  const launcher = path.join(pkg, "bin", "open-computer-use");
  const app = path.join(pkg, "dist", "Open Computer Use.app");
  try {
    return fs.existsSync(launcher) && fs.existsSync(app) ? launcher : "";
  } catch {
    return "";
  }
}

// 国内下载加速（09-16 打包瘦身配套）：浏览器内核不随包，按需下载时默认走国内镜像。
// ① Playwright 内核：npmmirror 的 binaries 镜像（淘宝系，国内直连快）；
// ② CloakBrowser 内核：官方只发 GitHub Releases，国内直连慢/不稳，走 gh 代理前缀
//    （代理只做路径前缀替换，归档与 SHA256SUMS 校验文件同源，完整性校验不受影响）。
// 用户自己设了同名变量时不覆盖；镜像下载失败时主进程会自动回落官方源重试。
export const CHINA_MIRROR_ENV: Record<string, string> = {
  PLAYWRIGHT_DOWNLOAD_HOST: "https://cdn.npmmirror.com/binaries/playwright",
  CLOAKBROWSER_DOWNLOAD_URL: "https://ghfast.top/https://github.com/CloakHQ/cloakbrowser/releases/download",
};

/**
 * npm 包按需安装用的国内镜像 registry（09-16：CloakBrowser 等 npm 包从包里剥离后按需下载）。
 * 用 registry.npmmirror.com（淘宝 npm 镜像）而不是 gh 代理：npm 元数据 + tarball 都在同源镜像上，
 * 一次解析就可拿到全部依赖，不用逐包拼 URL。用户自设 npm_config_registry 时不覆盖。
 */
export const CHINA_NPM_REGISTRY = "https://registry.npmmirror.com";

/** 内核下载用环境：toolchainEnv + 未被用户覆盖的国内镜像变量。 */
export function downloadEnv() {
  const env = toolchainEnv();
  for (const [key, value] of Object.entries(CHINA_MIRROR_ENV)) {
    if (!process.env[key]) env[key] = value;
  }
  return env;
}

// Codex 子进程的完整环境：PATH + NODE_PATH，让引擎能直接使用已装自动化工具。
// 同时把 CloakBrowser/playwright 的缓存指向应用内置目录，打包后随应用走。
export function toolchainEnv() {
  const env: Record<string, string> = { ...process.env, PATH: augmentedPath(), NO_UPDATE_NOTIFIER: "1" };
  const nodePath = npmGlobalRoot();
  if (nodePath) env.NODE_PATH = nodePath;
  const tools = toolsRoot();
  if (tools) {
    // ⛔ mac 适配（09-17 审计）：这里原写死 `tools/pwsh/pwsh.exe`，darwin 侧随包的是 `tools/pwsh/pwsh`
    //    （无后缀）⇒ mac 上 CODEX_REAL_PWSH 永远不设置。改用 bundledPwsh() 统一平台解析。
    const realPwsh = bundledPwsh();
    if (realPwsh) env.CODEX_REAL_PWSH = realPwsh;
    env.CLOAKBROWSER_CACHE_DIR = path.join(tools, "cloak-cache");
    env.CLOAKBROWSER_AUTO_UPDATE = "false";
    env.PLAYWRIGHT_BROWSERS_PATH = path.join(tools, "pw-browsers");
    const python = bundledPython();
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

// CloakBrowser Chromium 内核缓存目录（resources/tools/cloak-cache；09-16 起内核不随包，按需下载到此目录）。
export function cloakCacheDir() {
  const tools = toolsRoot();
  return tools ? path.join(tools, "cloak-cache") : "";
}

// 内置 pwsh 完整路径；没有则返回空串
export function bundledPwsh() {
  const tools = toolsRoot();
  const candidate = path.join(tools, "pwsh", process.platform === "win32" ? "pwsh.exe" : "pwsh");
  try {
    return fs.existsSync(candidate) ? candidate : "";
  } catch {
    return "";
  }
}

// 内置 node 完整路径（主进程 spawn helper 脚本用）；没有则返回空串
export function bundledNode() {
  const tools = toolsRoot();
  const candidate = process.platform === "win32" ? path.join(tools, "node", "node.exe") : path.join(tools, "node", "bin", "node");
  try {
    return fs.existsSync(candidate) ? candidate : "";
  } catch {
    return "";
  }
}

/** 内置 MinGit 入口；没有安装时返回空串。 */
export function bundledGit() {
  const tools = toolsRoot();
  const candidates = process.platform === "win32"
    ? [path.join(tools, "git", "cmd", "git.exe"), path.join(tools, "git", "bin", "git.exe")]
    : [path.join(tools, "git", "bin", "git"), path.join(tools, "bin", "git")];
  for (const candidate of candidates) {
    try { if (tools && fs.existsSync(candidate)) return candidate; } catch { /* 不存在 */ }
  }
  return "";
}

/**
 * FFmpeg 可执行文件（09-29 抽成共享解析 —— 此前只有 im-gateways 里一份私有实现，
 * 视频合并要再用一次；两份必然漂移）。
 *
 * 三级回退：
 *   ① 随包 / 开发工具页装的 `tools/ffmpeg/bin/ffmpeg[.exe]`；
 *   ② 平铺布局 `tools/ffmpeg/ffmpeg[.exe]`（部分平台构建是单文件）；
 *   ③ 系统 PATH 里的裸名 `ffmpeg`（返回裸名，交给 spawn 解析）。
 * 找不到时返回空串 —— 由调用方给出**可操作**的报错（指引去开发工具页装），不要在这里抛。
 *
 * ⛔ mac 适配：darwin 侧 install-runtimes 放的是 `tools/ffmpeg/bin/ffmpeg`（evermeet 单文件构建，
 *    **不带 .exe**）；只找 `.exe` 会让 mac 永远落空（同款坑 09-17 在 im-gateways 踩过）。
 */
export function bundledFfmpeg() {
  const tools = toolsRoot();
  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const candidates = tools
    ? [path.join(tools, "ffmpeg", "bin", exe), path.join(tools, "ffmpeg", exe)]
    : [];
  for (const candidate of candidates) {
    try { if (fs.existsSync(candidate)) return candidate; } catch { /* 不存在，试下一个 */ }
  }
  return "";
}

/** FFmpeg 可执行路径：内置可用就用内置，否则回落裸名（交给 spawn 走 PATH）。 */
export function resolveFfmpegPath() {
  return bundledFfmpeg() || "ffmpeg";
}

/** 同目录下的 ffprobe（探测片段编码参数用）。找不到时返回空串 —— 调用方按「探测不了」保守处理。 */
export function bundledFfprobe() {
  const ffmpeg = bundledFfmpeg();
  if (!ffmpeg) return "";
  const exe = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
  const candidate = path.join(path.dirname(ffmpeg), exe);
  try { return fs.existsSync(candidate) ? candidate : ""; } catch { return ""; }
}

/** 媒体合成的依赖报错（统一文案：告诉用户**去哪儿**解决，而不是只说「ffmpeg 不可用」）。 */
export function ffmpegMissingMessage() {
  return "需要 FFmpeg 才能合并视频。请到「设置 → 开发工具 → FFmpeg」点安装（约 300MB，装一次即可），或自行安装后确保 ffmpeg 在 PATH 上。";
}

/** 内置 Python 解释器；没有安装时返回空串。 */
export function bundledPython() {
  const tools = toolsRoot();
  const candidate = process.platform === "win32" ? path.join(tools, "python", "python.exe") : path.join(tools, "python", "bin", "python3");
  try { return tools && fs.existsSync(candidate) ? candidate : ""; } catch { return ""; }
}

/**
 * 内置 Python 的 pip 体检（Laya / 手机控制等所有「python -m pip」入口的前置闸）。
 *
 * ⛔⛔ 10-01 用户机器实录：旧版 Python 工具是 embeddable 包（无 pip），点安装 Laya 时
 *   `python.exe -m pip install ...` 直接 `No module named pip` 然后 exit 1 —— 界面日志里
 *   只剩一行裸路径报错，用户无从下手。这里把原因翻成人话 + 给出唯一有效动作
 *   （开发工具页对 Python 点「下载」→ 安装脚本换装完整版）。
 * ⛔ 判定只看「pip 能不能跑」，不猜文件：体检失败一律 ok=false + 可展示的 reason。
 */
export function pythonPipReady(bin: string): { ok: boolean; reason: string } {
  if (!bin) return { ok: false, reason: "未找到内置 Python —— 请先到 设置 → 开发工具 安装「Python + Tkinter + pip」" };
  try {
    execFileSync(bin, ["-m", "pip", "--version"], { encoding: "utf8", timeout: 20_000, windowsHide: true });
    return { ok: true, reason: "" };
  } catch (error) {
    const text = `${(error as any)?.stderr ?? ""}${(error as any)?.stdout ?? ""}${String((error as any)?.message ?? error)}`;
    if (/No module named pip/i.test(text)) {
      return {
        ok: false,
        reason: "内置 Python 缺少 pip（旧版 Python 工具安装不完整，常见于早前版本装的 embeddable 运行时）。"
          + "修法：设置 → 开发工具 → 找到「Python + Tkinter + pip」点「下载」，会自动换装完整版（约 45MB，自带 pip 与 Tkinter），完成后再回来重试安装。",
      };
    }
    return { ok: false, reason: `内置 Python 的 pip 不可用：${text.split("\n").find((line) => line.trim())?.slice(0, 200) ?? "未知原因"}` };
  }
}

// CloakBrowser 常驻助手脚本（stdin 喂 URL，驱动指纹浏览器窗口）。
export function cloakOpenHelper() {
  const tools = toolsRoot();
  return tools ? path.join(tools, "cloak-open.mjs") : "";
}
