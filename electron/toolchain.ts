// 应用内置工具链：resources/tools/{node,pwsh}（scripts/install-runtimes.cjs 安装）。
// terminal.ts（终端面板）与 codex-server.ts（Codex 引擎子进程）共用：
// 子进程环境里优先命中内置 node/pwsh，应用自包含可移植。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
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

/** 用户按需下载的工具根（10-20）：必须放在 userData，不能放安装目录。
 *  ⛔ 覆盖安装会重建 resources/tools，旧实现把 Miniconda / MinGW / FFmpeg /
 *     markitdown 全写在那里 ⇒ 更新一次全没、用户被迫重下（用户实测）。
 *  惰性求值：app.getPath("userData") 不能在模块体取（main.ts 会 setPath）。 */
export function userToolsRoot() {
  try {
    return path.join(app.getPath("userData"), "tools");
  } catch {
    return "";
  }
}

/** 读取顺序：随包目录优先（node/pwsh 等内置件稳定），再用户下载目录（同名时内置优先）。 */
export function toolRootsRead(): string[] {
  return [...new Set([toolsRoot(), userToolsRoot()].filter(Boolean))];
}

/** 写入/安装目标：永远 userData；未初始化时退回随包目录（开发态）。 */
export function writeToolsRoot(): string {
  return userToolsRoot() || toolsRoot();
}

/** 在随包/用户两个根里找一个相对路径（用于 git/ffmpeg/python 等可能来自任一侧的工具）。 */
export function existingToolPath(...parts: string[]): string {
  for (const root of toolRootsRead()) {
    const candidate = path.join(root, ...parts);
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch { /* 不存在 */ }
  }
  return "";
}

/** ego lite 的 CLI。官方安装/首次引导后会注册到 PATH：
 *  · Windows：`%USERPROFILE%\.local\share\ego\active_version_dir\ego-browser.exe`
 *    （active_version_dir 是指向 `...\Citro Labs\ego lite\Application\<ver>` 的链接/junction）；
 *  · macOS：`~/.local/bin/ego-browser`；
 *  · 另外兼容 `EGO_BROWSER_PATH` 显式指定与 PATH 里的同名命令。
 *  ⛔ 不把整包 611MB 随应用内置（用户拍板：一键按需安装），这里只负责发现已装的那份。 */
export function egoBrowserPath(): string {
  const explicit = String(process.env.EGO_BROWSER_PATH ?? "").trim();
  const candidates = process.platform === "win32"
    ? [
      explicit,
      path.join(os.homedir(), ".local", "share", "ego", "active_version_dir", "ego-browser.exe"),
      path.join(os.homedir(), ".local", "bin", "ego-browser.exe"),
    ]
    : [
      explicit,
      path.join(os.homedir(), ".local", "bin", "ego-browser"),
      "/Applications/ego lite.app/Contents/MacOS/ego-browser",
    ];
  for (const candidate of candidates) {
    try { if (candidate && fs.existsSync(candidate)) return candidate; } catch { /* 继续探测 */ }
  }
  const names = process.platform === "win32" ? ["ego-browser.exe", "ego-browser.cmd"] : ["ego-browser"];
  for (const directory of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(directory, name);
      try { if (fs.existsSync(candidate)) return candidate; } catch { /* 继续探测 */ }
    }
  }
  return "";
}

/** ego lite 的 GUI 启动器（"打开 ego lite"按钮）；没找到就返回空串，由调用方退回下载页。 */
export function egoAppPath(): string {
  if (process.platform === "win32") {
    const cli = egoBrowserPath();
    if (cli) {
      try {
        // active_version_dir 是 junction/符号链接：先解析到真实版本目录，再上跳一层到 Application\ego.exe
        const real = fs.realpathSync(cli);
        const candidate = path.join(path.dirname(path.dirname(real)), "ego.exe");
        if (fs.existsSync(candidate)) return candidate;
      } catch { /* 继续 */ }
    }
    const installed = path.join(process.env.ProgramFiles || "C:\\Program Files", "Citro Labs", "ego lite", "Application", "ego.exe");
    try { if (fs.existsSync(installed)) return installed; } catch { /* 未装 */ }
    return "";
  }
  try { return fs.existsSync("/Applications/ego lite.app") ? "/Applications/ego lite.app" : ""; } catch { return ""; }
}

/** `ego-browser --version` 的前两行；未安装或命令失败返回空串（状态卡显示"未安装"）。 */
export function egoBrowserVersion(): string {
  const cli = egoBrowserPath();
  if (!cli) return "";
  try {
    // ⛔ ego-browser 的版本行输出到 stderr（实测 stdout 为空），必须两路一起取
    const result = spawnSync(cli, ["--version"], { encoding: "utf8", timeout: 8000, windowsHide: true });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    return output.split("\n").map((line) => line.trim()).filter(Boolean)[0] || "";
  } catch {
    return "";
  }
}

/** 手动/后台升级 ego lite（官方 updater：`ego-browser upgrade`）。可能下载数百 MB，最长等 5 分钟。 */
export function runEgoUpgrade(): Promise<{ ok: boolean; output: string }> {
  const cli = egoBrowserPath();
  if (!cli) return Promise.resolve({ ok: false, output: "ego lite 未安装" });
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    const finish = (result: { ok: boolean; output: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const child = spawn(cli, ["upgrade"], { windowsHide: true });
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* 已退出 */ }
      finish({ ok: false, output: "ego lite 升级超时（5 分钟）" });
    }, 5 * 60 * 1000);
    child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.once("error", (error) => finish({ ok: false, output: error.message }));
    child.once("exit", (code) => finish({ ok: code === 0, output: output.trim().slice(0, 4000) || `ego-browser upgrade 退出（${code}）` }));
  });
}

// 这台机器的开发工具（node/python 等）不在系统 PATH 上，把常见工具链目录并进去，
// 否则子进程里 git/node/python 全部"无法识别"。内置 node/pwsh 排最前，优先命中。
export function augmentedPath() {
  const bundled: string[] = [];
  const discovered: string[] = [];
  const system = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const egoDir = (() => { const cli = egoBrowserPath(); return cli ? path.dirname(cli) : ""; })();
  if (egoDir) bundled.push(egoDir);
  const toolRoots = toolRootsRead();
  if (process.platform !== "win32") {
    const directories = toolRoots.flatMap((tools) => [
      "node/bin", "pwsh", "npm-global/bin", "bin", "git/bin", "python/bin",
      "vscode-cli", "rg", "uv", "cmake/bin",
      // ⛔ mac 适配（09-16）：darwin 侧 install-runtimes 会把这些也装进 tools/，
      // PATH 不带上 = 装了引擎也看不见（ffmpeg/yt-dlp/7zz/cmake.app 包布局/conda）。
      "ffmpeg/bin", "yt-dlp", "sevenzip", "cmake/CMake.app/Contents/bin", "miniconda/bin",
      "jq", "ninja",
    ].map((directory) => path.join(tools, directory))).filter(fs.existsSync);
    return [...new Set([...(egoDir ? [egoDir] : []), ...directories, ...system, "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"])].join(path.delimiter);
  }
  for (const tools of toolRoots) {
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

// npm 全局包的 node_modules（nuphus-mcp / rea-agents 等）。
export function npmGlobalRoot() {
  const roots = [userToolsRoot(), toolsRoot()].filter(Boolean);
  for (const tools of roots) {
    const winLayout = path.join(tools, "npm-global", "node_modules");
    const posixLayout = path.join(tools, "npm-global", "lib", "node_modules");
    const [first, second] = process.platform === "win32" ? [winLayout, posixLayout] : [posixLayout, winLayout];
    try {
      if (fs.existsSync(first)) return first;
      if (fs.existsSync(second)) return second;
    } catch { /* 探测失败试下一个根 */ }
  }
  // 安装前：按平台默认布局返回 **userData** 的预期落位（不能返回安装目录）。
  const writeRoot = writeToolsRoot();
  return writeRoot
    ? path.join(writeRoot, "npm-global", process.platform === "win32" ? "node_modules" : path.join("lib", "node_modules"))
    : "";
}

/** npm 全局包的**全部候选落位**（按平台优先级排序，第一个 = `npmGlobalRoot()`）。
 *  ⛔⛔ 10-07 用户实测「卸载不更新状态，一直显示已安装」：判定侧（runtimeInstalled）
 *   已经改成**双落位都查**（mac 上随包件在 node_modules、运行期装的在 lib/node_modules），
 *   但卸载侧只删 `npmGlobalRoot()` 返回的**那一个** ⇒ 装在另一个落位的包**删不掉**，
 *   界面永远显示「已安装」。
 *   ⇒ 落位清单必须是**单一真相源**：这里给出全部候选，卸载逐个删（不存在的 fs.rm 是 no-op）。
 *   ⛔ 别再在别处手拼 `npm-global/node_modules` 或 `npm-global/lib/node_modules` —— 那正是本 bug 的成因。 */
export function npmGlobalRootCandidates(userOnly = false): string[] {
  const roots = userOnly ? [userToolsRoot()] : [userToolsRoot(), toolsRoot()];
  return roots.filter(Boolean).flatMap((tools) => {
    const winLayout = path.join(tools, "npm-global", "node_modules");
    const posixLayout = path.join(tools, "npm-global", "lib", "node_modules");
    return process.platform === "win32" ? [winLayout, posixLayout] : [posixLayout, winLayout];
  });
}

/** 在 userData / 随包两个 npm-global 布局里找某个包内文件（userData 优先）。
 *  ⛔ 不能只看 `npmGlobalRoot()`：它只返回第一个“存在 node_modules 的根”；
 *  用户装了包后 userData 有了 npm-global，随包的 nuphus 仍需被找到。 */
export function npmPackagePath(...parts: string[]): string {
  for (const root of npmGlobalRootCandidates()) {
    const candidate = path.join(root, ...parts);
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch { /* 不存在 */ }
  }
  return "";
}

// 桌面自动化 MCP 的原生二进制（Rust exe，无需 node 即可运行）。
export function nuphusBinary() {
  const platform = process.platform === "darwin" ? "osx" : process.platform;
  const name = `nuphus-mcp-${platform}-${process.arch}`;
  const bin = process.platform === "win32" ? "nuphus-mcp.exe" : "nuphus-mcp";
  const candidates = [
    npmPackagePath("@nuphus", "nuphus-mcp", "node_modules", "@nuphus", name, "bin", bin),
    npmPackagePath("@nuphus", name, "bin", bin),
    npmPackagePath(name, "bin", bin),
    existingToolPath("nuphus", bin),
  ];
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
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
  const launcher = npmPackagePath("open-computer-use", "bin", "open-computer-use");
  if (!launcher) return "";
  const app = path.join(path.dirname(path.dirname(launcher)), "dist", "Open Computer Use.app");
  try {
    return fs.existsSync(launcher) && fs.existsSync(app) ? launcher : "";
  } catch {
    return "";
  }
}

/**
 * REA 逆向分析（10-13 内置专家配套）：`rea-agents`（npm，MIT）装在 tools/npm-global，
 * 返回它的 MCP 启动脚本路径（`rea.mjs mcp`）。包缺失 ⇒ 空串（不注册，而不是注册一个起不来的服务器）。
 * ⛔ command 不能写裸 `rea`：装进安装包后 PATH 里没有它（nuphus / computer-use 同款坑）。
 */
export function reaServerScript() {
  return npmPackagePath("rea-agents", "scripts", "rea.mjs");
}

/**
 * npm 包按需安装用的国内镜像 registry（nuphus / rea 等按需更新的包）。
 * 用 registry.npmmirror.com（淘宝 npm 镜像）而不是 gh 代理：npm 元数据 + tarball 都在同源镜像上，
 * 一次解析就可拿到全部依赖，不用逐包拼 URL。用户自设 npm_config_registry 时不覆盖。
 */
export const CHINA_NPM_REGISTRY = "https://registry.npmmirror.com";

// Codex 子进程的完整环境：PATH + NODE_PATH，让引擎能直接使用已装自动化工具。
export function toolchainEnv() {
  const env: Record<string, string> = { ...process.env, PATH: augmentedPath(), NO_UPDATE_NOTIFIER: "1" };
  const nodePath = npmGlobalRootCandidates().filter(Boolean).join(path.delimiter);
  if (nodePath) env.NODE_PATH = nodePath;
  /* 10-20：按需工具缓存必须落 userData，否则覆盖安装后要重下。 */
  const tools = writeToolsRoot();
  if (tools) {
    // ⛔ mac 适配（09-17 审计）：这里原写死 `tools/pwsh/pwsh.exe`，darwin 侧随包的是 `tools/pwsh/pwsh`
    //    （无后缀）⇒ mac 上 CODEX_REAL_PWSH 永远不设置。改用 bundledPwsh() 统一平台解析。
    const realPwsh = bundledPwsh();
    if (realPwsh) env.CODEX_REAL_PWSH = realPwsh;
    const python = bundledPython();
    if (fs.existsSync(python)) {
      env.PYTHON = python;
      env.PYTHONHOME = process.platform === "win32" ? path.dirname(python) : path.dirname(path.dirname(python));
      env.PYTHON_EXECUTABLE = python;
      env.npm_config_python = python;
    }
  }
  const egoCli = egoBrowserPath();
  if (egoCli) env.EGO_BROWSER_PATH = egoCli;
  const nuphusBin = nuphusBinary();
  if (nuphusBin) env.NUPHUS_BIN = nuphusBin;
  return env;
}

/**
 * 把增强 PATH **写回本进程**（启动时调一次）。
 *
 * ⛔⛔ 为什么需要（10-30 全链路审计）：mac 的 GUI 进程 PATH 只有 `/usr/bin:/bin:/usr/sbin:/sbin`。
 *   引擎 / 终端 / 一部分工具调用显式传了 `toolchainEnv()` 或 `augmentedPath()`，但**继承环境**的
 *   子进程（飞书 CLI 的 node shebang、连接器与 MCP 的 `npx`、手机控制的 python、openfilm 的探针…）
 *   拿到的仍是最小 PATH ⇒「装好了却跑不起来 / 找不到 npx」，且不报错、只在 mac 上复现。
 *   ⇒ 在启动编排最开始写一次，后续所有 `{...process.env}` 都自带增强 PATH。
 *
 * ⛔ 只做一次：`augmentedPath()` 每次都从当前 `process.env.PATH` 重新拼，重复调用会把条目叠加。
 * ⛔ 必须在 app ready 之后调（augmentedPath 依赖 app.getPath），所以放 bootApp 开头而不是模块顶层。
 */
let processPathApplied = false;
export function applyProcessPath(): void {
  if (processPathApplied) return;
  processPathApplied = true;
  try {
    process.env.PATH = augmentedPath();
  } catch { /* 取不到就保持原样：后续显式传 toolchainEnv 的调用点仍是对的 */ }
}

// 内置 pwsh 完整路径；没有则返回空串
export function bundledPwsh() {
  return existingToolPath("pwsh", process.platform === "win32" ? "pwsh.exe" : "pwsh");
}

// 内置 node 完整路径（主进程 spawn helper 脚本用）；没有则返回空串
export function bundledNode() {
  return existingToolPath(...(process.platform === "win32" ? ["node", "node.exe"] : ["node", "bin", "node"]));
}

/** 内置 npm 的入口脚本（npm-cli.js 完整路径）；没有则返回空串。
 *
 *  ⛔⛔ 10-07 mac 适配实测缺口：两个平台的**随包 Node 是两种解包布局**（与上面 bundledGit 同型，必须按候选探测）：
 *    · Windows：`prepare-windows-tools.cjs` 解官方 **zip** ⇒ npm 在 `node/node_modules/npm/`
 *    · macOS  ：`prepare-mac-tools.cjs` 解官方 **tar.gz** ⇒ npm 在 `node/lib/node_modules/npm/`
 *      （见该脚本 `const npm = path.join(tools, "node/lib/node_modules/npm/bin/npm-cli.js")`；
 *        mac 侧 `build/copy-mac-tools.cjs` 是整目录 `fs.cp`，不做任何布局归一化。）
 *  ⇒ 此前 runtime-ipc.ts / kb-embed-backend.ts **各自**写死了 Windows 那一条 ⇒ mac 上
 *     「开发工具」装包与知识库语义后端安装一律抛「内置 Node 缺少 npm」，功能等于被阉割。
 *     本函数是唯一真相源，两处消费方都改走它（别再复制字面量）。 */
export function bundledNpmCli() {
  const candidates = [
    ["node", "node_modules", "npm", "bin", "npm-cli.js"], // Windows（官方 zip 布局）
    ["node", "lib", "node_modules", "npm", "bin", "npm-cli.js"], // macOS / Linux（官方 tar.gz 布局）
  ];
  for (const rel of candidates) {
    const found = existingToolPath(...rel);
    if (found) return found;
  }
  return "";
}

/** 内置 MinGit 入口；没有安装时返回空串。 */
export function bundledGit() {
  const candidates = process.platform === "win32"
    ? [["git", "cmd", "git.exe"], ["git", "bin", "git.exe"]]
    : [["git", "bin", "git"], ["bin", "git"]];
  for (const rel of candidates) {
    const found = existingToolPath(...rel);
    if (found) return found;
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
  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  for (const rel of [["ffmpeg", "bin", exe], ["ffmpeg", exe]]) {
    const found = existingToolPath(...rel);
    if (found) return found;
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
  return existingToolPath(...(process.platform === "win32" ? ["python", "python.exe"] : ["python", "bin", "python3"]));
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
