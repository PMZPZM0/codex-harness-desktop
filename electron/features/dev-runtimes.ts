/**
 * dev-runtimes（09-21 架构改造：从 electron/main.ts 组合根按域拆出，纯搬迁）
 *
 * 搬出符号：DevRuntimeId / DevRuntimeSpec（类型）、devRuntimeSpecs、runtimeInstalls、IS_MAC、
 *          DARWIN_MARKERS / DARWIN_HIDDEN / DARWIN_SPEC_TEXT、markerRel、pythonSiteDir、
 *          runtimeInstalled、runtimeInstaller、readDownloadSource、emitRuntimeProgress、
 *          runRuntimeInstaller、restartServerWhenIdle、tools 目录监视、autoInstallGitIfNeeded（含 git 自愈）。
 *
 * 代码与原地逐字一致（仅顶部 import + 文件头注释 + 末尾 export 清单）。
 * 跨域符号经 `import … from "../main"` 取用 —— **活绑定**（TS→CJS 编译成 `main_1.X` 属性访问）。
 * ⛔ 本文件模块加载期只有一处顶层副作用：tools 目录监视（watchFs）。它只调 ../toolchain 的
 *    toolsRoot() 与 ../window-bus 的 watchFs，sendToWindow 在去抖回调里延迟调用
 *    ⇒ 不读 main 的任何值，被 main.ts 顶部 import 时不存在「读到未初始化常量」的时序问题。
 */
import path from "node:path";
import { existsSync, readdirSync, watch as watchFs } from "node:fs";
import { spawn } from "node:child_process";
import { app } from "electron";
import { readAppSettings, type AppSettings } from "../app-settings";
import { toolsRoot } from "../toolchain";
import { sendToWindow } from "./window-bus";
import { codexHome, engineActiveTurnIds, server } from "../runtime-refs";
// 自动化工具链状态：nuphus-mcp（桌面）/ playwright-cli（浏览器）/ cloakbrowser（指纹浏览器）。
// 静态检测安装目录与缓存，不 spawn 进程，打开设置页即时返回。

type DevRuntimeId = "python" | "node" | "pwsh" | "git" | "ffmpeg" | "vscode-cli" | "nuphus" | "playwright-cli" | "cloakbrowser" | "jq" | "ninja" | "sevenzip" | "yt-dlp" | "rg" | "uv" | "cmake" | "playwright-browsers" | "cloak-browsers" | "ponytail" | "conda" | "docker" | "mingw" | "openssl" | "markitdown";
// bundled：随包内置（zip / 预解压目录是来源，不是联网下载）。界面显示「内置」徽标；
// 缺失时允许「修复安装」（从随包 zip 重新解压），但不允许卸载（删了没有可靠重取途径）。
type DevRuntimeSpec = { name: string; description: string; size: string; marker: string; builtIn?: boolean; bundled?: boolean; kind?: "download" | "browsers" | "guide" | "plugin"; noUninstall?: boolean };
// 09-16 打包瘦身：凡是有国内加速下载源的运行时一律不随包（Windows 包从 ~3.2GB 原始降到 ~1.9GB），
// 由「开发工具」页按需下载（install-runtimes.cjs：npmmirror/gh-proxy 镜像优先，失败回落官方源）。
// 例外（用户明确要求内置）：
//   · node —— 安装器引导运行时（install-runtimes 本身靠内置 node 跑），没有它其余都装不了；
//   · vscode-cli —— 体积小、无国内镜像；
//   · nuphus / playwright-cli —— 桌面与浏览器自动化的两条默认通道，只发在 npm 上、
//     国内没有独立的"加速直链"（详见下方 bundled 注释与 package.json 的 filter）。
// ⛔ CloakBrowser 不在此列：09-16 起剥离出包，按需下载（开发工具页 → npm 国内镜像）。
const devRuntimeSpecs: Record<DevRuntimeId, DevRuntimeSpec> = {
  python: { name: "Python + Tkinter + pip", description: "Python 项目、数据处理、GUI 脚本和 Python MCP（含 Tkinter、requests/httpx/flask/fastapi/playwright）；npmmirror 镜像下载 + 清华 pip 源", size: "约 40 MB + 依赖", marker: "python\\python.exe" },
  node: { name: "Node.js + npm", description: "JavaScript / TypeScript 项目和 npm 工具（安装器引导运行时，随应用内置）", size: "约 101 MB", marker: "node\\node.exe", builtIn: true },
  pwsh: { name: "PowerShell 7", description: "现代 PowerShell 脚本与跨平台命令；gh 加速下载", size: "约 282 MB", marker: "pwsh\\pwsh.exe" },
  git: { name: "Git", description: "Diff、分支、提交、历史和仓库操作；引擎执行 shell 命令依赖它，建议装机后首先安装；npmmirror 镜像下载", size: "约 90 MB", marker: "git\\cmd\\git.exe" },
  ffmpeg: { name: "FFmpeg", description: "音视频转码、抽帧、探测与媒体处理", size: "约 307 MB", marker: "ffmpeg\\bin\\ffmpeg.exe" },
  "vscode-cli": { name: "VS Code CLI", description: "通过 code 命令打开文件与工作区", size: "约 28 MB", marker: "vscode-cli\\code.exe", builtIn: true },
  // noUninstall：来源是**随包内置资源**（zip / 插件目录）而不是联网下载 —— 删掉后没有
// 可靠的重取途径（压缩包本体随应用分发、不单独缓存），用户误删很难找回，因此不支持卸载。
  // 09-16 用户「自动化工具拆开，拆详细一点」：原来一张「桌面与浏览器自动化」大卡（把三个 npm 包
  // 混在一起、装没装只能看一个 marker）拆成逐条能力卡，每条各自可查状态、可单独恢复。
  // 同时按用户「这三个内置，CloakBrowser 不用内置，按需下载就行」定下分工：
  //   nuphus / playwright-cli —— 随包预解压内置（bundled，开箱即用；缺了可从随包 zip 修复）；
  //   cloakbrowser —— 从包里剥离，走 npm 国内镜像按需下载（默认浏览器用内置视图 / playwright-cli）。
  nuphus: { name: "Nuphus 桌面自动化", description: "35 个桌面自动化工具（屏幕截取、窗口控制、键鼠输入、剪贴板、OCR 感知），经 nuphus-call 按需调用，不占模型上下文；随包内置，开箱即用", size: "随包 30 MB", marker: "npm-global\\node_modules\\@nuphus\\nuphus-mcp\\package.json", bundled: true, noUninstall: true },
  "playwright-cli": { name: "Playwright 浏览器自动化", description: "命令行浏览器自动化 CLI（open / snapshot / click / type / screenshot），浏览器内核单独按需下载；随包内置，开箱即用", size: "随包 18 MB", marker: "npm-global\\node_modules\\@playwright\\cli\\package.json", bundled: true, noUninstall: true },
  cloakbrowser: { name: "CloakBrowser 指纹浏览器", description: "反检测指纹浏览器 npm 包（过 Cloudflare Turnstile / reCAPTCHA / FingerprintJS），默认不用、需要时再装；npm 国内镜像下载，失败自动回落官方源", size: "约 4 MB", marker: "npm-global\\node_modules\\cloakbrowser\\package.json" },
  jq: { name: "jq", description: "命令行查询、筛选和转换 JSON；gh 加速下载", size: "约 1 MB", marker: "jq\\jq.exe" },
  ninja: { name: "Ninja", description: "高速构建工具，常与 CMake 配合；gh 加速下载", size: "约 1 MB", marker: "ninja\\ninja.exe" },
  sevenzip: { name: "7-Zip CLI", description: "解压和创建 7z、zip、tar 等归档；gh 加速下载", size: "约 1 MB", marker: "sevenzip\\7z.exe" },
  "yt-dlp": { name: "yt-dlp", description: "下载和分析在线视频与音频资源", size: "约 20 MB", marker: "yt-dlp\\yt-dlp.exe" },
  rg: { name: "ripgrep (rg)", description: "极速代码搜索，Codex 检索代码库的主力工具；gh 加速下载", size: "约 5 MB", marker: "rg\\rg.exe" },
  uv: { name: "uv", description: "极速 Python 包管理器（pip/venv 替代）；gh 加速下载", size: "约 12 MB", marker: "uv\\uv.exe" },
  cmake: { name: "CMake", description: "C/C++ 构建系统生成器（配合 Ninja）；gh 加速下载", size: "约 45 MB", marker: "cmake\\bin\\cmake.exe" },
  "playwright-browsers": { name: "Playwright 浏览器内核", description: "Chromium 等浏览器内核，浏览器自动化 CLI 首次运行所需；按需下载（国内镜像优先，失败自动回落官方源）", size: "约 170 MB", marker: "pw-browsers", kind: "browsers" },
  "cloak-browsers": { name: "Cloak 指纹浏览器内核", description: "反检测 Chromium 内核（Cloudflare/reCAPTCHA 站点用），CloakBrowser 运行所需；按需下载（国内镜像优先，失败自动回落官方源）", size: "约 200 MB", marker: "cloak-cache" },
  conda: { name: "Miniconda", description: "Python 环境管理器（conda 命令，科学计算/环境隔离）", size: "约 100 MB", marker: "miniconda\\Scripts\\conda.exe", kind: "download" },
  docker: { name: "Docker Desktop", description: "容器运行时，需要系统级安装（管理员权限 + 重启 + 登录）", size: "约 500 MB", marker: "docker\\docker.exe", kind: "guide" },
  mingw: { name: "MinGW-w64 (gcc/g++/make)", description: "C/C++ 编译器工具链，含 gcc、g++、make、gdb", size: "约 267 MB", marker: "mingw\\mingw64\\bin\\g++.exe", kind: "download" },
  openssl: { name: "OpenSSL", description: "加密/证书命令行工具（openssl 命令），系统级安装", size: "约 25 MB", marker: "openssl\\openssl.exe", kind: "guide" },
  ponytail: { name: "ponytail 写代码模式插件", description: "Codex 写代码模式（会话钩子 + 6 个技能），随包启动时自动种入，开箱即用", size: "随包 2 MB", marker: "ponytail-plugin", kind: "plugin", bundled: true, noUninstall: true },
  // 文档转换（09-21 用户定稿：「这个 markitdown 有国内镜像源嘛，有的话，就不内置了，按需下载，
  //  codex 自己也可以下载」）⇒ **按需下载，不内置**：有清华 PyPI 镜像，装一次约 4~5 分钟，
  //  没必要让**每个**用户默认付约 120 MB。
  //  两个入口：① 本卡片（点一次就装，不会顺手重装 Python）② Codex 自己 pip 装（技能里给了镜像命令）。
  //  ⛔ 别把它并进 install-runtimes 的默认 pip 清单 —— 预检【83】有负向断言盯着。
  //  marker 仅作占位：真实判定走 runtimeInstalled 的 markitdown 分支（pip 包路径含 Python 版本号，写不死）。
  //  ⚠️ 已知取舍（09-21 代码审查确认）：卸载只删 markitdown 包目录（0.4 MB），依赖会留下 ——
  //     这是 pip 包的固有特点；卸载的语义是「移除这个能力」而不是「释放全部空间」。
  markitdown: { name: "文档转换（markitdown）", description: "让 Codex 能读 PDF / Word / Excel / PowerPoint 附件：先把文档转成 Markdown 再交给模型（Microsoft markitdown，MIT 许可）。默认不装，需要时点这里装一次（约 120 MB，走清华 pip 镜像）；也可以让 Codex 自己装", size: "约 120 MB", marker: "markitdown" },
};
const runtimeInstalls = new Map<DevRuntimeId, Promise<void>>();

// ⛔ mac 适配（09-16）：上面 specs 的 marker 全按 Windows 布局写（反斜杠 + .exe）。
// darwin 的目录布局不同（node/bin/node、python/bin/python3、pwsh/pwsh、CMake.app 包…），
// 这里集中覆盖；未列出的按「分隔符替换」兜底（npm-global 这类本身就是 posix 兼容布局）。
const IS_MAC = process.platform === "darwin";
const DARWIN_MARKERS: Partial<Record<DevRuntimeId, string>> = {
  python: "python/bin/python3",
  node: "node/bin/node",
  pwsh: "pwsh/pwsh",
  git: "git/bin/git",
  ffmpeg: "ffmpeg/bin/ffmpeg",
  "vscode-cli": "vscode-cli/code",
  jq: "jq/jq",
  ninja: "ninja/ninja",
  sevenzip: "sevenzip/7zz",
  "yt-dlp": "yt-dlp/yt-dlp",
  rg: "rg/rg",
  uv: "uv/uv",
  cmake: "cmake/CMake.app/Contents/bin/cmake",
  conda: "miniconda/bin/conda",
  docker: "docker/docker",
};
// darwin 上无意义 / 系统自带的工具：不显示安装卡（mingw 是 Windows 编译器；mac 用系统 clang）
const DARWIN_HIDDEN = new Set<DevRuntimeId>(["mingw"]);
/** ⛔ mac 适配（09-17 审计）：上面 specs 的**文案**是按 Windows 侧写的，mac 上照搬会误导
 *  （例如让用户「装 Git 约 90 MB」，而 darwin 根本不下载 git —— 用的是系统自带那份）。
 *  这里只覆盖 mac 上说法确实会错的那几条，未列出的沿用原文（体积本就是量级提示）。 */
const DARWIN_SPEC_TEXT: Partial<Record<DevRuntimeId, { name?: string; description?: string; size?: string }>> = {
  git: {
    description: "Diff、分支、提交、历史和仓库操作；引擎执行 shell 命令依赖它。macOS 使用系统自带的 git（随 Xcode 命令行工具提供），无需下载；点安装会调起系统的命令行工具安装程序",
    size: "系统自带",
  },
  openssl: { description: "加密/证书命令行工具（openssl 命令）；macOS 系统自带（LibreSSL），无需安装", size: "系统自带" },
  docker: { description: "容器运行时，需要系统级安装：下载并打开 Docker Desktop.dmg，装完首次启动需要授权", size: "约 600 MB" },
  ffmpeg: { description: "音视频转码、抽帧、探测与媒体处理（macOS 单文件构建，装在 tools/ffmpeg/bin）", size: "约 78 MB" },
  conda: { description: "Python 环境管理器（conda 命令，科学计算/环境隔离）；macOS 走官方 shell 安装器静默装到 tools/miniconda", size: "约 130 MB" },
};

/** marker 的平台展开（装没装判定的唯一入口，别再各自 path.join(spec.marker)）。 */
function markerRel(id: DevRuntimeId, spec: DevRuntimeSpec): string {
  if (!IS_MAC) return spec.marker;
  return DARWIN_MARKERS[id] ?? spec.marker.replace(/\\/g, "/");
}

/** spec 的平台展开（文案与体积；marker 走 markerRel）。 */

/** 系统级已装探测（不落 tools 目录也算装好）：win 只认 docker 在 PATH；darwin 认系统自带件。 */

/** Python 的 site-packages 目录（Windows 是 `Lib/site-packages`，mac 是 `lib/pythonX.Y/site-packages`）。
 *  ⛔ 与 `scripts/install-runtimes.cjs` 的 pythonSitePackages 是**同一套规则**（两处各写一份是因为
 *  一边是主进程 TS、一边是纯 Node 安装脚本，不共享模块）—— 改这里务必同步那边。
 *  ⛔ mac 的目录名含 Python 版本号，绝不能写死 3.13：上游换小版本就判定失效（会反复重装/显示未装）。 */
function pythonSiteDir(pythonDir: string): string | null {
  const win = path.join(pythonDir, "Lib", "site-packages");
  if (existsSync(win)) return win;
  const lib = path.join(pythonDir, "lib");
  if (existsSync(lib)) {
    const hit = readdirSync(lib).filter((name) => /^python\d+\.\d+$/.test(name)).sort().pop();
    if (hit) return path.join(lib, hit, "site-packages");
  }
  return null;
}

/** 「装没装」的唯一判定（runtimeList 与「修复安装」幂等早退共用，别各写一份）：
 *  ponytail 装在引擎侧 codex-home/plugins/cache，不走 tools 目录 marker；
 *  其余按 tools 目录里的 marker 文件判断。 */
function runtimeInstalled(id: DevRuntimeId, spec: DevRuntimeSpec): boolean {
  if (id === "ponytail") return existsSync(path.join(codexHome, "plugins", "cache", "ponytail"));
  const root = toolsRoot();
  if (!root) return false;
  // pip 包（markitdown）装在 Python 的 site-packages 里，路径含版本号 ⇒ 不走 marker。
  //  判定「包目录在不在」：目录在就等于 import 拿得到（比查 dist-info 更抗 pip 元数据差异）。
  if (id === "markitdown") {
    const site = pythonSiteDir(path.join(root, "python"));
    // ⛔ 用 `site !== null` 而不是 `Boolean(site)`：后者不构成类型守卫，TS 不会收窄掉 null
    //    （`Boolean(site) && …path.join(site…` 会报 TS2345，构建直接失败）。
    return site !== null && existsSync(path.join(site, "markitdown"));
  }
  return existsSync(path.join(root, markerRel(id, spec)));
}


/**
 * ⛔ 这里曾经有过一个「自动化工具包在线回落地址」（GitHub Release 的 automation-tools.zip），
 * 已于 09-12 删除：那个 release 资产**根本不存在**（实测 v0.0.13 只有两个 mac zip），
 * 回落只会让用户看到「下载失败」，还把真正的问题（安装包没带 zip）藏起来。
 * 现在「包里必须有 zip」由打包链路硬保证（scripts/before-pack.cjs 硬失败）。
 * 注意：本段注释刻意不写出那个常量的字面名——preflight【8】会全文搜它，注释也会命中。
 */

function runtimeInstaller(name: string) {
  const packaged = app.isPackaged ? path.join(toolsRoot(), name) : "";
  if (packaged && existsSync(packaged)) return packaged;
  // 打包态兜底：mac 包此前漏拷安装脚本（copy-mac-tools 已修），缺了就回落到 asar 外的源码目录
  const fallback = path.join(app.getAppPath(), "scripts", name);
  if (existsSync(fallback)) return fallback;
  return packaged || fallback;
}

/** 开发工具下载源（09-20 用户：「下载太慢了，所有工具下载加下载源选择」）。
 *  每次安装现读 app-settings.downloadSource —— 用户在「开发工具」页切完源，下一次下载立即生效，无需重启。
 *  合法值见 AppSettings.downloadSource；非法值一律回落 auto（镜像优先、逐通道回落）。 */
async function readDownloadSource(): Promise<NonNullable<AppSettings["downloadSource"]>> {
  const source = (await readAppSettings(app.getPath("userData"))).downloadSource;
  return source === "mirror" || source === "ghproxy" || source === "ghfast" || source === "direct" || source === "proxy" ? source : "auto";
}

/** 安装进度的结构化上报（09-19 用户要求「不要弹窗，全部进度条展示，方便新手」）。
 *  安装脚本把进度写成 `@@PROGRESS <0-100>` / `@@STAGE <阶段名>` 这样的行——
 *  它们**不进消息区**，只驱动进度条；其余行原样作为消息（用户能看到在做什么）。 */
function emitRuntimeProgress(id: string, chunk: string | Buffer, prefix = "") {
  const text = String(chunk);
  for (const raw of text.replace(/\r/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const progress = line.match(/^@@PROGRESS\s+(\d{1,3})/);
    if (progress) {
      sendToWindow("runtime:progress", { id, percent: Math.max(0, Math.min(100, Number(progress[1]))) });
      continue;
    }
    const stage = line.match(/^@@STAGE\s+(.+)/);
    if (stage) {
      sendToWindow("runtime:progress", { id, stage: stage[1].trim().slice(0, 40) });
      continue;
    }
    // 下载速度（09-20）：安装脚本按 500ms 采样输出文件大小算出速率后写成
    // `@@SPEED 1.2 MB/s · 45.3 MB / 350 MB`，这里原样带给界面显示。
    const speed = line.match(/^@@SPEED\s*(.*)/);
    if (speed) {
      const text = speed[1].trim();
      if (text) sendToWindow("runtime:progress", { id, speed: text.slice(0, 48) });
      continue;
    }
    sendToWindow("runtime:progress", { id, message: `${prefix}${line}` });
  }
}

function runRuntimeInstaller(id: DevRuntimeId, script: string, args: string[], node = process.execPath, extraEnv?: Record<string, string | undefined>) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(node, [script, ...args], {
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: node === process.execPath ? "1" : undefined, TOOLS_ROOT: toolsRoot(), ...extraEnv },
    });
    let tail = "";
    const report = (chunk: Buffer | string) => {
      const message = String(chunk);
      if (!message.trim()) return;
      tail = `${tail}\n${message}`.slice(-4000);
      emitRuntimeProgress(id, message);
    };
    child.stdout?.on("data", report);
    child.stderr?.on("data", report);
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(tail.trim().slice(-1200) || `安装进程退出（${code}）`)));
  });
}

async function restartServerWhenIdle(id: DevRuntimeId) {
  if (engineActiveTurnIds.size) sendToWindow("runtime:progress", { id, message: "安装完成，等待当前任务结束后刷新引擎" });
  const deadline = Date.now() + 10 * 60_000;
  while (engineActiveTurnIds.size && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 500));
  await server.restart();
}


// 开发工具目录监视（09-16）：内核/运行时不随包后，除了「开发工具」页的按钮安装，
// 引擎（用户让 Codex 自己装工具）也可能往 tools/ 里写东西。目录一变就广播 auto 事件，
// 渲染层收到后自动刷新开发工具清单与工具状态 —— 界面永远反映真实安装状态，不用手动重开设置。
let toolsWatchDebounce: NodeJS.Timeout | null = null;
try {
  watchFs(toolsRoot(), { recursive: true }, () => {
    if (toolsWatchDebounce) clearTimeout(toolsWatchDebounce);
    // 去抖 1.5s：安装是「下载 zip → 解压很多文件」的高频写入，等写入稳定后再刷新一次
    toolsWatchDebounce = setTimeout(() => {
      toolsWatchDebounce = null;
      sendToWindow("runtime:progress", { id: "__auto__", message: "开发工具目录已更新", auto: true, done: true });
    }, 1500);
  });
} catch (error) {
  // 监视失败只影响「自动刷新」，按钮安装路径仍会主动推 done 事件，不影响功能
  console.warn("[runtime] tools 目录监视失败（自动刷新不可用）:", error);
}

// 首次启动自动安装 Git（09-16 瘦身后续）：git 不再随包，但引擎执行 shell 命令依赖它，
// 用户不点安装的话引擎跑终端命令全是失败。启动时检测到缺失就后台自动装一次
// （install-runtimes.cjs：npmmirror 镜像优先、失败回落官方源），失败不阻塞启动，
// 用户仍可到「开发工具」页手动装；下次启动若仍缺会再试（自愈）。
// 仅 Windows：mac 包仍内置 git（copy-mac-tools 只排除 pw-browsers/cloak-cache），不需要装。
let gitAutoInstallStarted = false;
async function autoInstallGitIfNeeded(): Promise<void> {
  if (process.platform !== "win32" || gitAutoInstallStarted) return;
  const root = toolsRoot();
  if (!root || runtimeInstalls.has("git")) return;
  if (existsSync(path.join(root, devRuntimeSpecs.git.marker))) return;
  gitAutoInstallStarted = true;
  sendToWindow("runtime:progress", { id: "git", message: "检测到未安装 Git，正在后台自动安装（镜像优先，约 90 MB）…" });
  const task = (async () => {
    await runRuntimeInstaller("git", runtimeInstaller("install-runtimes.cjs"), ["git"], process.execPath, { DOWNLOAD_SOURCE: await readDownloadSource() });
    await restartServerWhenIdle("git");
  })();
  runtimeInstalls.set("git", task);
  try {
    await task;
    sendToWindow("runtime:progress", { id: "git", message: "Git 自动安装完成，引擎已刷新", percent: 100, done: true });
  } catch (error) {
    sendToWindow("runtime:progress", { id: "git", message: `Git 自动安装失败：${String(error)}（可稍后在「开发工具」页手动安装）`, done: true });
  } finally {
    runtimeInstalls.delete("git");
  }
}

export { DARWIN_HIDDEN, DARWIN_MARKERS, DARWIN_SPEC_TEXT, IS_MAC, autoInstallGitIfNeeded, devRuntimeSpecs, emitRuntimeProgress, markerRel, pythonSiteDir, readDownloadSource, restartServerWhenIdle, runRuntimeInstaller, runtimeInstalled, runtimeInstaller, runtimeInstalls, toolsWatchDebounce };
export type { DevRuntimeId, DevRuntimeSpec };
