/* 把 Node.js LTS + PowerShell 7 LTS 内置到应用 resources/tools/
 * Windows: node -> resources/tools/node/node.exe, pwsh -> resources/tools/pwsh/pwsh.exe
 *          用 Windows 自带 bsdtar (System32\tar.exe) 解压 zip（Git Bash 的 GNU tar 不行）。
 * macOS  ⛔（09-16 适配）：此前本脚本只有 win-x64 资产，mac 上点「安装」下载的全是
 *          Windows 二进制（装了也不能跑）＝「开发工具全部安装失败」的根因之一。
 *          现按平台分叉：darwin 资产（node-darwin-arm64/x64、powershell-osx、
 *          python-build-standalone、evermeet ffmpeg、jq/ninja/rg/uv/cmake 的 mac 构建），
 *          解压后统一 chmod +x（mac 无执行位 = permission denied）。
 * 用法: node scripts/install-runtimes.cjs [id...]
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { spawn, spawnSync } = require("child_process");

const IS_MAC = process.platform === "darwin";
const NODE_VERSION = "v24.19.0";
const NODE_URL = IS_MAC
  ? `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-darwin-${process.arch === "arm64" ? "arm64" : "x64"}.tar.gz`
  : `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-win-x64.zip`;
const PS7_VERSION = "7.6.4";
const PS7_URL = IS_MAC
  ? `https://github.com/PowerShell/PowerShell/releases/download/v${PS7_VERSION}/powershell-${PS7_VERSION}-osx-${process.arch === "arm64" ? "arm64" : "x64"}.tar.gz`
  : `https://github.com/PowerShell/PowerShell/releases/download/v${PS7_VERSION}/PowerShell-${PS7_VERSION}-win-x64.zip`;
// Portable runtimes: no registry changes and no dependency on a system-wide install.
// MinGit is the official Git for Windows command-line bundle. Python uses the
// python-build-standalone (PBS) install_only full build: python + Tkinter + ensurepip
// in one package, so GUI scripts and pip work without any system Python.
// GitHub does not expose a stable "latest asset" URL for MinGit; pin the
// verified release so a fresh install cannot receive a 404 from a renamed asset.
const MINGIT_VERSION = "2.55.0.5";
const MINGIT_URL = `https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.5/MinGit-${MINGIT_VERSION}-64-bit.zip`;
// Python = python-build-standalone（uv 官方构建）install_only 完整版：python + Tkinter 全家
// + ensurepip 一个包全带（约 45MB）。
// ⛔⛔ 10-01 用户机器实录，旧链路（embeddable zip + 官方 exe 安装器补 Tk + get-pip 补 pip）两处断裂：
//   ① 官方 exe 安装器 /quiet 在部分机器**静默空转**（exit 0 但 TargetDir 为空，两台机器复现）；
//   ② exe 半路抛错连坐整条安装链 → pip 引导根本没跑 → Laya/手机控制 `python -m pip` 直接
//      `No module named pip` exit 1。
//   现换 PBS 整包 + 本地 ensurepip（离线确定性，不再下载 get-pip.py），并带健康检查：
//   旧的不完整安装判「未装」→ 用户在「开发工具」点「下载」即整目录换装修复。
// 资产名含 `+`，URL 里写 %2B；npmmirror 有该构建的镜像（chinaMirrorUrl 映射，国内优先）。
const PYTHON_VERSION = "3.13.15";
const PBS_TAG = "20260929";
const PYTHON_PBS_URL = `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/cpython-${PYTHON_VERSION}%2B${PBS_TAG}-x86_64-pc-windows-msvc-install_only.tar.gz`;
/* ⛔⛔ 10-07 改（用户报「FFmpeg 不是国内源，太慢了，几十K」）：
   原来唯一源是 gyan.dev（英国站）。gyan 的同一份构建**同时发布在 GitHub**
   （GyanD/codexffmpeg，资产名 `ffmpeg-<版本>-essentials_build.zip`；内部结构与 gyan 那个 zip
   逐层相同 —— 顶层一个 wrapper 目录 + `bin/ffmpeg.exe`、`bin/ffprobe.exe`
   ⇒ 现有 `strip: true` 与 `marker: "bin\\ffmpeg.exe"` 一个字都不用改）。
   ⇒ 主源改走 GitHub：auto 模式下能吃到 gh-proxy / ghfast 加速（`isGh` 判据自动生效）。
   ⇒ 原来的 gyan.dev 地址降级为**兜底源**（见 install 的 altUrls）——gh 通道全挂时仍能装，
     最坏情况 = 改之前的行为，不会更差。
   ⛔ 版本必须钉住：GitHub 上没有 gyan 那种 `release-essentials` 动态地址。
     升级时改 FFMPEG_VERSION，并让 archiveName 跟着版本走（否则旧缓存包会被复用）。 */
const FFMPEG_VERSION = "9.0.2";
const FFMPEG_URL = `https://github.com/GyanD/codexffmpeg/releases/download/${FFMPEG_VERSION}/ffmpeg-${FFMPEG_VERSION}-essentials_build.zip`;
const FFMPEG_FALLBACK_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
const VSCODE_CLI_URL = "https://update.code.visualstudio.com/latest/cli-win32-x64/stable";
// Android 平台工具（adb）：手机控制（phone-harness）的 Android 通道。
// ⛔ 官方源，**没有国内镜像**（npmmirror 的 binaries 目录下没有该包，实测 404）——走不了 gh 加速，
//    只能直连或用户手动装；卡片里如实说明，不假装有镜像。
const PLATFORM_TOOLS_URL = IS_MAC
  ? "https://dl.google.com/android/repository/platform-tools-latest-darwin.zip"
  : "https://dl.google.com/android/repository/platform-tools-latest-windows.zip";
const JQ_URL = "https://github.com/jqlang/jq/releases/latest/download/jq-windows-amd64.exe";
const NINJA_URL = "https://github.com/ninja-build/ninja/releases/latest/download/ninja-win.zip";
// ⛔ 10-02：不再用 `https://www.7-zip.org/a/7zr.exe`。`7zr` 是**精简版，只认 7z 格式**，
//   被当成「7-Zip CLI」随包会让用户拿到一个打不开 zip/tar.gz 的命令行（实测 l 返回 2）。
//   统一走下面这个 extra 包，取其中的 `x64/7za.exe`（独立完整版）。
const SEVENZIP_VERSION = "25.01";
const YTDLP_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
// GitHub 直连在国内经常不可达；gh-proxy.com / ghfast.top 加速前缀实测稳定（rg/cmake/uv/7zip 均可 206 分段续传）。
// 自动模式（默认）= 国内优先：镜像 → 本机代理（PROXY 环境变量，默认空）→ gh 加速 → 直连兜底。
// ⛔ 09-20 修订：GitHub 资产**加速在前、直连兜底**——直连不会"失败"只会龟速（PowerShell 7 实测 7% 爬行），
//    排在加速前面等于永远轮不到加速。
const GHPROXY = "https://gh-proxy.com/";
const GHFAST = "https://ghfast.top/";
const RG_VERSION = "14.1.1";
const RG_URL = `https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-x86_64-pc-windows-msvc.zip`;
const UV_VERSION = "0.9.5";
const UV_URL = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-pc-windows-msvc.zip`;
const CMAKE_VERSION = "3.31.6";
const CMAKE_URL = `https://github.com/Kitware/CMake/releases/download/v${CMAKE_VERSION}/cmake-${CMAKE_VERSION}-windows-x86_64.zip`;
// 7-Zip 官网国内不稳定，走 github release（gh-proxy 可达）
const SEVENZIP_GH_URL = "https://github.com/ip7z/7zip/releases/download/25.01/7z2501-extra.7z";
/* mac FFmpeg 的两条源（10-07 用户报「FFmpeg 不是国内源，太慢了，几十K」）：
   · ffmpeg-static（eugeneware）——单文件构建，npmmirror 同步了它的 release 资产（实测 302 → CDN）
     ⇒ 国内直连快，是主源；同名 GitHub release 还能吃到 gh 加速。
   · evermeet.cx —— 美国站，只作**兜底**（它同时提供 ffprobe，是唯一同时有两者的源）。
   ⛔ ffmpeg-static **不含 ffprobe**；ffprobe 走 npmmirror 上的 @ffprobe-installer 平台包。
   ⛔ 版本必须钉住：这些地址没有 "latest" 形态，改版本号要连资产名一起改。
   ⛔⛔ ffprobe-installer 的版本**不能取 latest**：实测两个架构的 latest 不是同一个
      （darwin-arm64 latest=5.0.1、darwin-x64 latest=5.1.0，且各自**都没有对方那个版本**），
      取 latest 必有一个架构 404。5.0.0 是两者**唯一交集**（两个 tarball 实测都 200）⇒ 钉 5.0.0。 */
const FFMPEG_STATIC_VERSION = "b6.1.1";
const FFPROBE_INSTALLER_VERSION = "5.0.0";
// Python 常用 Web/API 依赖（引擎自检缺失项）。走清华 PyPI 镜像，无需代理。
const PIP_PACKAGES = "requests httpx flask fastapi playwright";
// 文档转换依赖：让 Codex 能读 PDF / Word / Excel / PPT 附件（把二进制文档转成 Markdown 再喂给模型）。
// **按需下载，不内置**（09-21 用户定稿：「这个 markitdown 有国内镜像源嘛，有的话，就不内置了，按需下载，
//   codex 自己也可以下载」）—— 有清华 PyPI 镜像，装一次约 4~5 分钟，没必要让所有人默认付约 120 MB。
// 两个入口：① 「开发工具」页卡片（want("markitdown")）② Codex 自己按需装（技能里给了清华镜像命令）。
// ⛔ 别把它并进 PIP_PACKAGES：那会让**每个**装 Python 的用户默认付这份体积（预检【83】有负向断言）。
// ⛔ 刻意不用 `markitdown[all]`：实测 273 MB+，含 Azure 云端文档智能 SDK 与音频/YouTube 依赖，
//    与本地文件转换无关（其中 pandas+numpy 一项就占 90 MB）。
// ⛔ 也刻意不用 `[xlsx]`：那条 extra 同样拉 pandas+numpy，而转 xlsx 实际只需 openpyxl（1.8 MB）。
//    xlsx 支持靠单独装 openpyxl 拿到。实测这套组合约 85 MB。
//    方括号加引号：spawn 走 shell，mac 的 sh 会做 glob 展开（Windows cmd 不会），引号两边都安全。
const DOC_PACKAGES = ['"markitdown[pdf,docx,pptx]"', "openpyxl"];
// Miniconda：官方 exe 静默安装（/InstallationType=JustMe /RegisterPython=0 /S /D=目标目录）
// ⛔⛔ 10-07 用户实测「miniconda 压根安装不了」：repo.anaconda.com 国内直连极慢/失败。
//    清华 TUNA 镜像逐字节同步官方 miniconda 目录（实测两个平台资产都在，文件名一致），
//    ⇒ **镜像打头、官方站兜底**（download() 的 extraSources 永远排最后）。
const MINICONDA_VERSION = "py312_25.1.1-2";
const MINICONDA_URL = `https://repo.anaconda.com/miniconda/Miniconda3-${MINICONDA_VERSION}-Windows-x86_64.exe`;
const MINICONDA_TUNA_URL = `https://mirrors.tuna.tsinghua.edu.cn/anaconda/miniconda/Miniconda3-${MINICONDA_VERSION}-Windows-x86_64.exe`;
// MinGW-w64 完整工具链（WinLibs：gcc/g++/make/gdb）。版本固定，资产名含编译器版本号。
const WINLIBS_VERSION = "16.2.0posix-14.0.0-ucrt-r1";
const WINLIBS_ZIP = "winlibs-x86_64-posix-seh-gcc-16.2.0-mingw-w64ucrt-14.0.0-r1.zip";
const WINLIBS_URL = `https://github.com/brechtsanders/winlibs_mingw/releases/download/${WINLIBS_VERSION}/${WINLIBS_ZIP}`;

const TOOLS = process.env.TOOLS_ROOT || path.join(__dirname, "..", "resources", "tools");
const TMP = process.env.TEMP || process.env.TMP || os.tmpdir();
const requested = new Set(process.argv.slice(2).filter((arg) => !arg.startsWith("--")));
const want = (id) => requested.size === 0 || requested.has(id);
const DIRECT = process.argv.includes("--direct");

// 解压器：Windows 用系统自带 bsdtar（zip / tar.gz / tar.xz 通吃）；mac 自带 bsdtar。
// ⛔⛔ 10-02 外部用户报障修的坑：这里原来**硬编码** `C:\Windows\System32\tar.exe`：
//   ① Windows 装在 D:\ 之类「系统盘不是 C:」的机器取不到 ⇒ 回落到裸 `tar`，而多数机器的
//      PATH 上并没有 tar ⇒ **下载明明成功、解压必定失败**，报错还只剩 `"tar"` 两个字
//      （cmd 找不到命令的输出被截断），用户点多少次都一样、也看不出是「缺解压器」；
//   ② 即使系统盘是 C:，走 `shell: true` 让 cmd 去解析 `tar` 也依赖调用方的 PATH 环境。
//   现在：按 %SystemRoot%/System32 → C:/Windows/System32 → **显式扫 PATH** 三级解析成**绝对路径**，
//   解析不到就地报清楚（见 extractorHint），而不是把一句 `"tar"` 丢给用户。
const WINDIR = process.env.SystemRoot || process.env.windir || "C:\\Windows";

/** 在 PATH 上显式找一个可执行文件（拿到绝对路径，不依赖子 shell 的 PATH 解析）。 */
function findOnPath(name) {
  const exts = String(process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean);
  for (const dir of String(process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of ["", ...exts]) {
      try {
        const p = path.join(dir, name + ext);
        if (fs.existsSync(p)) return p;
      } catch { /* 忽略非法路径段 */ }
    }
  }
  return "";
}

function tarCandidates() {
  if (IS_MAC) return ["/usr/bin/tar"];
  return [path.join(WINDIR, "System32", "tar.exe"), "C:\\Windows\\System32\\tar.exe"];
}
const BSDTAR = (() => {
  for (const p of tarCandidates()) { try { if (fs.existsSync(p)) return p; } catch { /* ignore */ } }
  return findOnPath("tar") || "tar";
})();
const BSDTAR_OK = BSDTAR !== "tar";

/** 随包 7-Zip 的命令行。
 *  ⛔⛔ 10-02 实测：优先 `7za.exe`（**独立版**，zip/gzip/tar/7z 全内置）。
 *    原来只认 `7z.exe` —— extra 包里的 `7z.exe` **依赖同目录的 `7z.dll`**，而我们只落了一个 exe，
 *    于是它连普通 zip 都打不开（`7z l` 对有效 zip 返回 2「Cannot open the file as archive」，
 *    自带格式表里根本没有 zip/gzip/tar）⇒ 「内置 7-Zip」实际是个空壳，既救不了解压、本身也不好用。 */
function sevenZipCli() {
  try {
    for (const name of ["7za.exe", "7z.exe"]) {
      const p = path.join(TOOLS, "sevenzip", name);
      if (fs.existsSync(p)) return p;
    }
  } catch { /* ignore */ }
  return "";
}

/** Windows 自带 PowerShell（解压兜底用；零依赖，Win7 起就带）。 */
function powershellExe() {
  if (IS_MAC) return "";
  return findOnPath("powershell") || path.join(WINDIR, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/** 解压失败时给用户看的「解压器现状」——别再让他对着 `"tar"` 猜。 */
function extractorHint() {
  if (BSDTAR_OK) return `解压器 ${BSDTAR}`;
  const seven = sevenZipCli();
  return `系统解压器不可用（已找：${tarCandidates().join(" / ")} 与 PATH）${seven ? `；随包 7-Zip：${seven}` : "；随包 7-Zip 也没找到"}；另有 Windows 自带 PowerShell 兜底（仅 zip）`;
}

// ⛔ mac：无执行位 = permission denied。解压/单文件落地后统一补 +x（zip 不保 Unix 位）。
function chmodExec(target) {
  if (!IS_MAC) return;
  const walk = (p) => {
    let entries = [];
    try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(p, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) { try { fs.chmodSync(full, 0o755); } catch { /* 只读等场景跳过 */ } }
    }
  };
  try {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) walk(target);
    else fs.chmodSync(target, 0o755);
  } catch { /* 目标不存在时由调用方报错 */ }
}

// 代理：仅当显式设置 PROXY 环境变量时才走本机代理（开发机可用）。
// 09-16 起安装包不带工具链，普通用户机器上没有 7897 —— 默认空，避免每个文件白等 30s 连接超时。
const PROXY = process.env.PROXY || "";

// 国内镜像加速（09-16）：有镜像源的先走镜像，失败再按 直连 → gh-proxy 逐通道回落。
// npmmirror 同步了 nodejs.org、python.org/ftp 与 git-for-windows 的 releases 资产。
function chinaMirrorUrl(url) {
  if (url.startsWith("https://nodejs.org/dist/")) return url.replace("https://nodejs.org/dist/", "https://cdn.npmmirror.com/binaries/node/");
  if (url.startsWith("https://www.python.org/ftp/python/")) return url.replace("https://www.python.org/ftp/python/", "https://cdn.npmmirror.com/binaries/python/");
  if (url.startsWith("https://github.com/git-for-windows/git/releases/download/")) return url.replace("https://github.com/git-for-windows/git/releases/download/", "https://cdn.npmmirror.com/binaries/git-for-windows/");
  // python-build-standalone（PBS）：npmmirror 同步了该构建的全部 release 资产（实测 302 → CDN）
  if (url.startsWith("https://github.com/astral-sh/python-build-standalone/releases/download/")) return url.replace("https://github.com/astral-sh/python-build-standalone/releases/download/", "https://registry.npmmirror.com/-/binary/python-build-standalone/");
  /* ⛔⛔ 10-07 补两条（用户报「miniconda 压根安装不了」+「FFmpeg 不是国内源，太慢了，几十K」）：
     两条都**实测过**镜像真的有对应文件，不是照着别人的镜像表抄的。
     · Miniconda：官方 repo.anaconda.com 在国内常年龟速/被限速；清华 TUNA 的 anaconda 镜像
       **文件名与官方逐字相同** ⇒ 只换域名，版本号/资产名一个字都不用改（实测 200）。
     · ffmpeg-static（eugeneware）：npmmirror 同步了它的 release 资产，含 darwin-arm64/x64 两个
       构建（实测 302 → CDN）；mac 侧 ffmpeg 的主源。 */
  if (url.startsWith("https://repo.anaconda.com/miniconda/")) return url.replace("https://repo.anaconda.com/miniconda/", "https://mirrors.tuna.tsinghua.edu.cn/anaconda/miniconda/");
  if (url.startsWith("https://github.com/eugeneware/ffmpeg-static/releases/download/")) return url.replace("https://github.com/eugeneware/ffmpeg-static/releases/download/", "https://registry.npmmirror.com/-/binary/ffmpeg-static/");
  return null;
}

/**
 * 执行外部命令并转发输出。
 *
 * ⛔⛔ 09-19 用户实测（首启安装弹出 `C:\WINDOWS\system32\cmd.exe` 黑窗）：
 *   父进程是 Electron 主进程、**没有控制台**，子进程一旦用 `stdio: "inherit"`，
 *   Windows 会给它**新分配一个控制台窗口** —— 那就是用户看到的黑框。
 *   改用管道 + windowsHide；输出由本脚本转发到自己的 stdout
 *   （主进程会把它变成界面的安装进度消息）。
 *  · quiet：不把大段输出刷到进度区（失败时仍带上错误尾巴）
 */
function runCommand(command, opts = {}) {
  const result = spawnSync(command, [], {
    shell: true,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: opts.timeout ?? 900000,
    env: opts.env ?? process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  // 默认不刷屏（界面进度区保持干净）；需要展示进展的长命令用 runStreaming 或显式 showOutput
  if (out && opts.showOutput) process.stdout.write(out.slice(-3000) + "\n");
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(out.slice(-1200) || `命令失败（退出码 ${result.status}）：${command}`);
  return out;
}

/** 异步执行长命令：逐块转发输出，可解析进度（下载/解压/装包用）。 */
function runStreaming(command, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [], {
      shell: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: opts.env ?? process.env,
    });
    let tail = "";
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* 已退出 */ }
      reject(new Error(`${opts.label ?? "命令"}超时`));
    }, opts.timeout ?? 900000);
    const onData = (chunk) => {
      const text = String(chunk);
      tail = (tail + text).slice(-4000);
      if (opts.onChunk) { opts.onChunk(text); return; }
      if (opts.quiet) return;
      const lines = text.replace(/\r/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
      if (lines.length) process.stdout.write(lines.slice(-4).join("\n") + "\n");
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(tail);
      else reject(new Error(tail.trim().slice(-1200) || `${opts.label ?? "命令"}退出（${code}）`));
    });
  });
}

/** 人类可读的速率 / 体积文案（UI 直接显示，不再二次加工）。 */
function formatSpeed(bytesPerSecond) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "";
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let value = bytesPerSecond;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** 取远端总大小（进度条分母）。取不到返回 0 —— 此时只显示「已下载 + 速度」，不显示百分比。 */
async function probeTotalSize(url) {
  try {
    const out = runCommand(`curl -sIL --max-time 25 "${url}"`);
    const hits = [...String(out).matchAll(/^content-length:\s*(\d+)/gim)];
    // 取最后一个：跟随重定向后那一条才是实体大小（前面可能是 302 的空 body）
    return hits.length ? Number(hits[hits.length - 1][1]) || 0 : 0;
  } catch { return 0; }
}

/**
 * 跑 curl 下载，同时**按固定间隔采样输出文件大小**来算百分比与瞬时速度。
 *
 * ⛔⛔ 为什么不用 curl 自带的进度输出（09-20 实测出来的硬事实）：
 *   · `--progress-bar`（`-#`）在 stderr **不是 TTY**（我们走管道）时只输出 `#=#=#` 占位行，
 *     完全没有百分比 —— 这正是**此前进度条一直空着、右边只显示 `--`** 的根因；
 *   · 默认进度表在非 TTY 下也只在**结束时**吐一行总结，中途同样无数据可解析。
 *   ⇒ 采样文件大小是唯一与终端类型无关、Windows/mac 都可靠的数据源，
 *     顺便把「瞬时速度」也一起算出来了（curl 的进度输出本来就不给这个）。
 */
function downloadWithProgress(args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn("curl", args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    let lastSize = opts.startSize ?? 0;
    let lastAt = Date.now();
    let lastPercent = -1;
    let finished = false;
    const stop = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearInterval(sampler);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* 已退出 */ }
      stop();
      reject(new Error("下载超时"));
    }, opts.timeout ?? 900000);
    const sampler = setInterval(() => {
      let size = 0;
      try { size = fs.statSync(opts.file).size; } catch { return; }
      const now = Date.now();
      const seconds = (now - lastAt) / 1000;
      if (seconds <= 0) return;
      const speed = Math.max(0, (size - lastSize) / seconds);
      lastSize = size;
      lastAt = now;
      if (opts.total > 0) {
        // 上限留 1%：curl 干净退出后我们再补 100，避免进度条先满再干等
        const percent = Math.max(0, Math.min(99, Math.round((size / opts.total) * 100)));
        if (percent !== lastPercent) {
          lastPercent = percent;
          process.stdout.write(`@@PROGRESS ${percent}\n`);
        }
      }
      const speedText = formatSpeed(speed);
      if (speedText) {
        const amount = opts.total > 0 ? `${formatBytes(size)} / ${formatBytes(opts.total)}` : formatBytes(size);
        process.stdout.write(`@@SPEED ${speedText} · ${amount}\n`);
      }
    }, 500);
    const onData = (chunk) => {
      const text = String(chunk);
      tail = (tail + text).slice(-4000);
      // ⛔ 白名单式转发（09-20 实测修正）：只放行 curl 的**诊断行**，其余一律丢弃。
      //   曾用黑名单（滤掉含 % / Dload / #= 的行）——实测漏网：慢速时 curl 会周期性吐
      //   `0   0   0  0  0  0  0  0 --:--:-- ...` 这类表格行（不含 %、不以 #= 开头），
      //   一路灌进界面消息区。白名单不会漏：下载过程里 curl 对用户有意义的输出只有
      //   错误与告警（`curl: (22) ...` / `Warning: ...`）。
      const keep = text.replace(/\r/g, "\n").split("\n").map((line) => line.trim())
        .filter((line) => /^curl:\s*\(\d+\)/i.test(line) || /^warning:/i.test(line));
      if (keep.length) process.stdout.write(keep.slice(-3).join("\n") + "\n");
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (error) => { stop(); reject(error); });
    child.on("close", (code) => {
      stop();
      if (code === 0) resolve(tail);
      else reject(new Error(tail.trim().slice(-1200) || `下载退出（${code}）`));
    });
  });
}

/** 下载源（09-20 用户「所有工具下载加下载源选择」）：主进程经 DOWNLOAD_SOURCE 环境变量传入，
 *  取值 auto（默认）/ mirror / ghproxy / ghfast / direct / proxy —— 与「开发工具」页的下载源选择一一对应。
 *  ⛔ 不能用命令行参数传：argv 里的裸词会被当成工具 id（want() 的 requested 集合）。 */
const SOURCE = (process.env.DOWNLOAD_SOURCE || "auto").toLowerCase();

async function download(url, file, extraSources = []) {
  process.stdout.write("@@STAGE 下载\n");
  // @@TARGET（10-07 取消功能配套）：把下载落盘路径报给主进程 —— 取消安装时按它删半截压缩包。
  process.stdout.write("@@TARGET " + file + "\n");
  // 见 downloadWithProgress 的注释：进度与速度都靠采样文件大小，curl 这边只要「安静地下载」。
  const curlArgs = ["-L", "--fail", "--show-error", "--retry", "3", "--retry-all-errors",
    "--connect-timeout", "30", "--continue-at", "-", "-o", file];
  const mirror = chinaMirrorUrl(url);
  const isGh = url.includes("github.com");
  const ghAccels = isGh
    ? [["gh-proxy 加速", curlArgs.slice(), GHPROXY + url], ["ghfast 加速", curlArgs.slice(), GHFAST + url]]
    : [];
  const direct = [["直连", curlArgs.slice(), url]];
  const viaProxy = PROXY ? [[`本机代理 ${PROXY}`, [...curlArgs, "--proxy", PROXY], url]] : [];
  // 按用户选的源组装通道顺序；所选源对当前资产不可用时回落「直连」，保证一定有可行通道。
  let attempts;
  switch (SOURCE) {
    case "direct": attempts = direct; break;
    // 国内优先（mirror）：有 npmmirror 镜像走镜像；纯 GitHub 资产没有镜像，国内优先 = gh 加速打头
    case "mirror": attempts = mirror ? [["国内镜像 npmmirror", curlArgs.slice(), mirror], ...direct] : [...ghAccels, ...direct]; break;
    case "ghproxy": attempts = isGh ? [ghAccels[0], ...direct] : [...ghAccels, ...direct]; break;
    case "ghfast": attempts = isGh ? [ghAccels[1], ...direct] : [...ghAccels, ...direct]; break;
    case "proxy": attempts = [...viaProxy, ...direct]; break;
    // auto（默认）= 国内优先：镜像 → (代理) → gh 加速 → 直连
    case "auto":
    default: attempts = [
      ...(mirror ? [["国内镜像 npmmirror", curlArgs.slice(), mirror]] : []),
      ...viaProxy,
      ...ghAccels,
      ...direct,
    ]; break;
  }
  /* ⛔ 兜底源（10-07 加）：**完全不同的源头**，永远排在最后 —— 它是"上面所有通道都挂了"才走的路，
     不能插在前面抢通道。典型用法：Windows FFmpeg 主源是 GitHub（能吃 gh 加速），
     兜底留回官方站 gyan.dev（本身可用，只是慢）。
     ⛔ 显示名只取主机名：整条 URL 刷进进度区会把界面撑爆，用户也只需要知道"换到哪个站了"。 */
  for (const extra of extraSources) {
    let host = "备用源";
    try { host = new URL(extra).host; } catch { /* 非法 URL：用兜底文案 */ }
    attempts.push([`备用源 ${host}`, curlArgs.slice(), extra]);
  }
  if (SOURCE !== "auto") console.log(`[download] 指定下载源: ${SOURCE}`);
  let lastError;
  for (const [label, args, effectiveUrl] of attempts) {
    try {
      console.log(`[download] via ${label}: ${effectiveUrl}`);
      const startSize = fs.existsSync(file) ? fs.statSync(file).size : 0;
      const total = await probeTotalSize(effectiveUrl);
      if (total > 0) console.log(`[download] 文件大小 ${formatBytes(total)}${startSize > 0 ? `（续传起点 ${formatBytes(startSize)}）` : ""}`);
      await downloadWithProgress([...args, effectiveUrl], { file, startSize, total });
      process.stdout.write("@@PROGRESS 100\n");
      return;
    } catch (error) {
      lastError = error;
      console.log(`[download] ${label} 失败，换下一通道`);
    }
  }
  throw lastError ?? new Error("download failed: " + url);
}

/** 从子进程输出里挑**最能说明问题**的一行：优先含 Error/Cannot/fail/「不是内部或外部命令」的行。
 *  ⛔ 不能只取第一行也不能只取最后一行 —— 7z 的第一行是版本横幅、tar 的末行是
 *  「Error exit delayed from previous errors」，都不是用户需要看到的原因（10-02 实测）。 */
const keyLine = (error) => {
  const lines = String((error && error.message) || error).split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => /error|cannot|fail|错误|失败|不是内部或外部命令/i.test(l)) || lines[lines.length - 1] || "（无输出）";
};

/**
 * 归档「能不能用」的判据：**逐个解压器试「列目录」，只要有一个能列出就算完好**。
 * ⛔⛔ 不能因为某一个解压器失败就断定坏包 —— 各解压器能力不同（10-02 实测）：
 *   · Windows bsdtar **读不了 .7z**（`-tf` 返回 1）；
 *   · 旧的 7zr 精简版读不了 zip / tar.gz；extra 包缺 dll 的 7z.exe 同样读不了。
 *   按「一失败即坏」会把好包删掉、重下、再报一句误导性的「包已损坏」（自测当场踩到，
 *   7-Zip 的 extra 包就被误删了两次）。
 * 只有当**能读该格式的手段全都失败**时才判定损坏；zip 三种手段都能读，故 zip 三连失败＝真坏；
 * 其它格式若没有任何手段可读 ⇒ 无法判断，按体积信任（交给解压阶段报错，不误删）。
 */
function archiveReady(file) {
  let size = 0;
  try {
    if (!fs.existsSync(file)) return false;
    size = fs.statSync(file).size;
  } catch { return false; }
  // ⛔⛔ 不能拿「>1MB」当完整性判据（10-02 CI 全红就死在这）：ninja 的 zip 只有 **285KB**，
  //   原来的「小于 1MB 一律视为不可用」把它判成坏包 ⇒ 删缓存 → 重下 → 还是"坏" → 直接失败，
  //   Windows 与 mac 两个 job 同时挂。体积只配用来挡空文件/半截文件，真判据是**能否列目录**。
  if (size <= 0) return false;
  if (BSDTAR_OK) {
    try { runCommand(`"${BSDTAR}" -tf "${file}"`, { quiet: true, timeout: 120000 }); return true; }
    catch { /* 这个解压器读不了该格式，换下一个 */ }
  }
  const seven = sevenZipCli();
  if (seven) {
    try { runCommand(`"${seven}" l "${file}"`, { quiet: true, timeout: 120000 }); return true; }
    catch { /* 同上 */ }
  }
  if (/\.zip$/i.test(file) && !IS_MAC) {
    try {
      runCommand(`"${powershellExe()}" -NoProfile -NonInteractive -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::OpenRead('${file}').Dispose()"`, { quiet: true, timeout: 120000 });
      return true;
    } catch { return false; } // zip 三种手段都读不了 ⇒ 确实是坏包
  }
  // 没有能读该格式的解压器 ⇒ 无从判断：按体积信任（这里才需要下限，挡住空文件/半截文件）
  return size >= 64 * 1024;
}

/** 7z 没有 --strip-components：目标目录下只有一层顶层目录时，把它的内容抬上来（等效 strip=1）。 */
function liftUp(dir) {
  const entries = fs.readdirSync(dir);
  if (entries.length !== 1 || !fs.statSync(path.join(dir, entries[0])).isDirectory()) return;
  const only = path.join(dir, entries[0]);
  for (const item of fs.readdirSync(only)) fs.renameSync(path.join(only, item), path.join(dir, item));
  fs.rmdirSync(only);
}

/**
 * 解压归档到 destDir。三级降级，任何一级成功即返回：
 *   ① 系统 bsdtar（`%SystemRoot%\System32\tar.exe`，zip/tar.gz 通吃）；
 *   ② 随包 7-Zip（优先独立版 `7za.exe`；zip 一次解完，.tar.gz 两步：先解 .tar 再解 tar）；
 *   ③ **Windows 自带 PowerShell 的 `Expand-Archive`**（零依赖、Win7 起就有，仅 zip）——
 *      10-02 实测这条能把 MinGit 完整解出来并跑起 `git version 2.55.0.windows.5`。
 * ⛔⛔ 10-02 外部用户报障：那台机器**系统没有可用的 tar**（`System32\tar.exe` 取不到、PATH 上也没有），
 *   旧代码只能回落到裸 `tar` ⇒ **所有**走归档的工具（git / pwsh / ffmpeg / rg / cmake / python…）
 *   全部报同一句 `[fail] "tar"`，用户完全看不出是缺解压器、点多少次都一样。
 */
async function extractArchive(archive, destDir, strip, label) {
  const isZip = /\.zip$/i.test(archive);
  const isTarGz = /\.(tar\.gz|tgz)$/i.test(archive);
  // `.7z` 只有 7-Zip 系能解（系统 bsdtar **读不了 7z**，实测 -tf 返回 1）——
  // 这条链路自己要用来装 7-Zip 本体，必须留着（旧的 7zr 精简版也能解 .7z，故新装不会死锁）。
  const isSeven = /\.7z$/i.test(archive);
  const tried = [];
  // ① 系统 bsdtar（最快，且是 .tar.gz 的首选）
  if (BSDTAR_OK) {
    const stripArg = strip ? " --strip-components=1" : "";
    try {
      await runStreaming(`"${BSDTAR}" -xf "${archive}" -C "${destDir}"${stripArg}`, { label: `${label} 解压`, quiet: true, timeout: 900000 });
      return;
    } catch (error) {
      tried.push(`系统 tar：${keyLine(error)}`);
      console.log(`[${label}] 系统 tar 解压失败（${keyLine(error)}），改用兜底解压器`);
    }
  }
  // ② 随包 7-Zip
  const seven = sevenZipCli();
  if (seven && (isZip || isTarGz || isSeven)) {
    try {
      if (isZip || isSeven) {
        // ⛔ 7z 的 -o 与其后路径之间**不能有空格**（写成 `-o "dir"` 会被当成两个参数）
        await runStreaming(`"${seven}" x "${archive}" -o"${destDir}" -y`, { label: `${label} 解压(7z)`, quiet: true, timeout: 900000 });
      } else {
        const stage = fs.mkdtempSync(path.join(os.tmpdir(), "ch-targz-"));
        try {
          await runStreaming(`"${seven}" x "${archive}" -o"${stage}" -y`, { label: `${label} 解压(7z gz)`, quiet: true, timeout: 900000 });
          const inner = fs.readdirSync(stage).map((n) => path.join(stage, n)).find((p) => /\.tar$/i.test(p));
          if (!inner) throw new Error(`${path.basename(archive)} 里没找到内层 .tar`);
          await runStreaming(`"${seven}" x "${inner}" -o"${destDir}" -y`, { label: `${label} 解压(7z tar)`, quiet: true, timeout: 900000 });
        } finally {
          try { fs.rmSync(stage, { recursive: true, force: true }); } catch { /* 临时目录清不掉不影响安装 */ }
        }
      }
      if (strip) liftUp(destDir);
      return;
    } catch (error) {
      tried.push(`随包 7-Zip：${keyLine(error)}`);
      // 解了一半的残骸必须清掉，否则下一个兜底解压器会与之混在一起（半新半旧最难查）
      try { fs.rmSync(destDir, { recursive: true, force: true }); fs.mkdirSync(destDir, { recursive: true }); } catch { /* ignore */ }
      console.log(`[${label}] 随包 7-Zip 解压失败（${keyLine(error)}），改用下一个兜底`);
    }
  }
  // ③ Windows 自带 PowerShell 的 Expand-Archive（仅 zip）
  if (isZip && !IS_MAC) {
    try {
      await runStreaming(`"${powershellExe()}" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '${archive}' -DestinationPath '${destDir}' -Force"`, { label: `${label} 解压(Expand-Archive)`, quiet: true, timeout: 900000 });
      if (strip) liftUp(destDir);
      return;
    } catch (error) {
      tried.push(`PowerShell Expand-Archive：${keyLine(error)}`);
    }
  } else if (isTarGz) {
    tried.push(".tar.gz 没有 PowerShell 兜底（它只覆盖 zip）");
  }
  throw new Error(`${label} 解压失败：${tried.join("；") || "没有可用解压器"} ｜ ${extractorHint()}`);
}

async function install(label, url, destDir, opts = {}) {
  const marker = path.join(destDir, opts.marker || "node.exe");
  if (fs.existsSync(marker)) { console.log(`[skip] ${label} already at ${marker}`); return; }
  const zip = path.join(TMP, opts.archiveName || path.basename(url));
  /* 兜底源（10-07）：主源的所有通道（镜像/代理/gh 加速/直连）都失败后，再逐个试这些**完全不同的源**。
     ⛔ 只在 download() 里追加、**不改变主源的通道顺序** —— 主源该有的国内优先顺序原样保留。 */
  const altUrls = Array.isArray(opts.altUrls) ? opts.altUrls : [];
  // ⛔⛔ 10-02 用户报障的**根因**：缓存校验不过时原来直接调 download()，而 download 用的是
  //   `curl --continue-at -`（断点续传）—— **续传只补尾巴，坏文件永远修不好**。用户机器上那份
  //   MinGit 体积已等于线上大小（第一趟就下坏了），于是每次点安装都是
  //   「续传 0 字节 → 进度瞬间 100% → 解压失败」，重试一万次都一模一样，用户只能来报障。
  //   ⇒ 校验不过必须先删掉，让这次下载从 0 字节开始。
  if (fs.existsSync(zip) && !archiveReady(zip)) {
    console.log(`[${label}] 本地缓存的压缩包校验不通过（${formatBytes(fs.statSync(zip).size)}），已删除，改为完整重新下载`);
    fs.rmSync(zip, { force: true });
  }
  // 复用已下载的 zip（通过 archiveReady 才算完整）
  if (!archiveReady(zip)) {
    console.log(`[${label}] downloading ${url}`);
    await download(url, zip, altUrls);
  } else {
    console.log(`[${label}] reuse cached ${zip}`);
  }
  // ⛔ 下载完**必须再校验一次**：代理劫持 / 中途断流会落下一个「体积对、内容坏」的包，
  //   当场发现并重下一次，好过等到解压阶段报一句看不懂的错。只重下一次（两次都坏=源/网络问题）。
  if (!archiveReady(zip)) {
    console.log(`[${label}] 下载完成的压缩包校验不通过，删除后重下一次`);
    fs.rmSync(zip, { force: true });
    await download(url, zip, altUrls);
    if (!archiveReady(zip)) {
      const size = fs.existsSync(zip) ? formatBytes(fs.statSync(zip).size) : "文件缺失";
      throw new Error(`${label}：下载的压缩包校验不通过（${size}）—— 多半是网络或代理把响应换成了错误页面（校园网 / 公司网关最常见）。请到「设置 → 开发工具」换一个下载源，或稍后重试`);
    }
  }
  fs.mkdirSync(destDir, { recursive: true });
  process.stdout.write("@@STAGE 解压\n");
  await extractArchive(zip, destDir, Boolean(opts.strip), label);
  chmodExec(destDir);
  console.log(`[${label}] extracted to ${destDir}`);
}

async function installFile(label, url, destDir, fileName) {
  const target = path.join(destDir, fileName);
  if (fs.existsSync(target) && fs.statSync(target).size > 10 * 1024) { console.log(`[skip] ${label} already at ${target}`); return; }
  fs.mkdirSync(destDir, { recursive: true });
  console.log(`[${label}] downloading ${url}`);
  await download(url, target);
  chmodExec(target);
  console.log(`[${label}] installed to ${target}`);
}

/**
 * mac 单文件二进制的**带解压**安装（10-07）。
 *
 * ⛔⛔ 为什么不能继续用 installFile：它是「下载即落盘」——
 *   原写法 `installFile("https://evermeet.cx/ffmpeg/get/ffmpeg/zip", binDir, "ffmpeg")`
 *   把 evermeet 的 **zip 原样写成 `tools/ffmpeg/bin/ffmpeg`**（实测该 URL 返回
 *   `Content-Type: application/zip`、`Content-Disposition: filename="ffmpeg-….zip"`）
 *   ⇒ 装出来的"ffmpeg"是个压缩包，一执行就报错。**装完不校验就永远发现不了**
 *   （卡片只看文件在不在，`toolchain.ts` 找不到可执行文件才报）。
 *
 * sources = 有序源表，**前面的全失败才走后面**；每项：
 *   · url         下载地址（download() 会按下载源设置再叠一层镜像/gh 加速）
 *   · archiveName 落到临时目录的文件名 —— ⛔ 必须带真实后缀（extractArchive 靠后缀选解压器，
 *                 evermeet 的 URL 结尾是 `/zip`、basename 取出来没有后缀）
 *   · unpack      gz（单文件 gzip，用 Node zlib 解）｜zip（根目录就是二进制）｜npm（tgz 里在 package/ 下）
 * ⛔ 解出来必须做**体积下限校验**：网络网关把响应换成错误页面时体积会小得离谱，
 *   当场发现好过让用户拿着一个 300 字节的"ffmpeg"来报障。
 */
async function installMacBinary(label, destDir, name, sources) {
  const target = path.join(destDir, name);
  if (fs.existsSync(target) && fs.statSync(target).size > 1024 * 1024) { console.log(`[skip] ${label} already at ${target}`); return; }
  fs.mkdirSync(destDir, { recursive: true });
  let lastError;
  for (const src of sources) {
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), `ch-${name}-`));
    try {
      const archive = path.join(stage, src.archiveName);
      await download(src.url, archive);
      if (src.unpack === "gz") {
        fs.writeFileSync(target, zlib.gunzipSync(fs.readFileSync(archive)), { mode: 0o755 });
      } else {
        await extractArchive(archive, stage, false, label);
        fs.copyFileSync(src.unpack === "npm" ? path.join(stage, "package", name) : path.join(stage, name), target);
        fs.chmodSync(target, 0o755);
      }
      const size = fs.statSync(target).size;
      if (size < 1024 * 1024) throw new Error(`解出来的文件只有 ${formatBytes(size)}，不像可执行文件`);
      console.log(`[${label}] installed to ${target} (${formatBytes(size)})`);
      return;
    } catch (error) {
      lastError = error;
      try { fs.rmSync(target, { force: true }); } catch { /* 清不掉不影响换源重试 */ }
      console.log(`[${label}] 源 ${src.url} 失败（${keyLine(error)}），换下一个源`);
    } finally {
      try { fs.rmSync(stage, { recursive: true, force: true }); } catch { /* 临时目录清不掉不影响安装 */ }
    }
  }
  throw lastError ?? new Error(`${label}：所有源都失败`);
}

/** Miniconda 静默安装到目标目录：官方 exe + 静默参数（JustMe、不注册 Python、/S）。 */
async function installConda(destDir) {
  const marker = path.join(destDir, "Scripts", "conda.exe");
  if (fs.existsSync(marker)) { console.log(`[skip] miniconda already at ${marker}`); return; }
  const installer = path.join(TMP, `Miniconda3-${MINICONDA_VERSION}-Windows-x86_64.exe`);
  if (!fs.existsSync(installer) || fs.statSync(installer).size < 20 * 1024 * 1024) {
    console.log(`[miniconda] downloading ${MINICONDA_TUNA_URL}（官方站兜底）`);
    await download(MINICONDA_TUNA_URL, installer, [MINICONDA_URL]);
  }
  fs.mkdirSync(destDir, { recursive: true });
  console.log(`[miniconda] silent installing to ${destDir}（约 1-2 分钟）`);
  process.stdout.write("@@STAGE 静默安装\n");
  await runStreaming(`"${installer}" /InstallationType=JustMe /RegisterPython=0 /AddToPath=0 /S /D=${destDir}`, { label: "Miniconda 安装", quiet: true, timeout: 900000 });
  // 静默安装后补一个 .condarc 用清华镜像（国内下载包更快），失败不影响安装本身
  try { fs.writeFileSync(path.join(destDir, ".condarc"), "channels:\n  - https://mirrors.tuna.tsinghua.edu.cn/anaconda/pkgs/main\n  - https://mirrors.tuna.tsinghua.edu.cn/anaconda/pkgs/free\n  - defaults\nshow_channel_urls: true\n", "utf8"); } catch { /* 可选优化 */ }
  console.log("[miniconda] installed to " + destDir);
}

/** Windows Python 健康判据（安装侧口径，与 electron/features/dev-runtimes.ts 的
 *  runtimeInstalled python 分支**同一套清单**，改一处必须同步另一处）：
 *  python.exe + pip + Tkinter 全家 + tcl 库全在才算健康。
 *  旧 embeddable 安装缺 pip/tkinter ⇒ 不健康 ⇒ 整目录换装完整版
 *  （10-01 用户机器上 Laya 报 `No module named pip` 的修复入口）。 */
function winPythonHealthy(pythonDir) {
  const markers = [
    "python.exe",
    // ⛔ 判 pip 用**模块目录**而不是 Scripts/pip.exe：PBS 的 install_only 已自带 pip 包
    //   （Lib/site-packages/pip，实测 26.2.1），但不带 Scripts/ 下的 .exe 外壳 ——
    //   而本项目所有消费方走的都是 `python -m pip`（laya / 手机控制 / 文档转换），
    //   按 pip.exe 判会误判成「没装」。
    path.join("Lib", "site-packages", "pip", "__init__.py"),
    path.join("DLLs", "_tkinter.pyd"),
    path.join("DLLs", "tcl86t.dll"),
    path.join("DLLs", "tk86t.dll"),
    path.join("tcl", "tcl8.6", "init.tcl"),
    path.join("Lib", "tkinter", "__init__.py"),
  ];
  return markers.every((entry) => fs.existsSync(path.join(pythonDir, entry)));
}

function copyAlias(dir, source, alias) {
  const from = path.join(dir, source);
  const to = path.join(dir, alias);
  if (fs.existsSync(from) && !fs.existsSync(to)) fs.copyFileSync(from, to);
}

/** 删除待换装的 Python 目录（只给「旧的不完整安装」换装用）。⛔ 两条硬要求：
 *  ① 链接（junction / symlink）**只删链接本身**，绝不递归进入 —— 本项目早年踩过
 *     递归删除顺着链接把目标目录掏空（连带删掉主仓库 123 个文件）；
 *  ② Python 可能正被占用（引擎里的 python MCP、Laya 服务）⇒ Windows 上删运行中的 exe 会 EBUSY，
 *     此时抛出**可行动**的提示，而不是把裸 errno 丢给用户。 */
function removePythonDir(pythonDir) {
  let stat = null;
  try { stat = fs.lstatSync(pythonDir); } catch { return; }
  if (stat.isSymbolicLink()) {
    console.log("[python] 目标目录是链接（junction/symlink），只删链接本身、不进入目标");
    try { fs.unlinkSync(pythonDir); }
    catch (error) { throw new Error(`删除链接失败（${pythonDir}）：${String(error.message).split("\n")[0]}`); }
    return;
  }
  try { fs.rmSync(pythonDir, { recursive: true, force: true }); }
  catch (error) {
    throw new Error(`删除旧 Python 失败（多半是正被占用：请先关掉用到 Python 的会话/服务再重试）：${String(error.message).split("\n")[0]}`);
  }
}
/** pip 引导：**功能判据**（`python -m pip --version` 能不能跑），不是看文件。
 *  ⛔ PBS 的 install_only 自带 pip 包（Lib/site-packages/pip，实测 26.2.1）但**没有**
 *  Scripts/pip.exe（Windows）/ bin/pip3（mac）外壳 ⇒ 任何文件判据都会误报；
 *  而本项目所有消费方走的都是 `python -m pip`（laya / 手机控制 / 文档转换）。
 *  真缺 pip（旧 embeddable 连模块都没有）时用 PBS 自带的 ensurepip 离线补装
 *  ——不下载 get-pip.py（bootstrap.pypa.io 国内不稳，那就是 10-01 用户机器上断掉的一环）。
 *  @param py 解释器绝对路径（Windows: <dir>/python.exe；mac: <dir>/bin/python3） */
async function ensurePip(py) {
  const usable = () => { try { runCommand(`"${py}" -m pip --version`, { timeout: 120000 }); return true; } catch { return false; } };
  if (usable()) { console.log("[skip] pip already usable"); return; }
  process.stdout.write("@@STAGE 安装 pip\n");
  await runStreaming(`"${py}" -m ensurepip --default-pip`, { label: "pip 引导", quiet: true, timeout: 600000 });
  // ⛔ 不能只看 exit 0：ensurepip 静默没装上时脚本会显示「安装完成」而 pip 其实没有（09-21 同款 UX 缺口）
  if (!usable()) throw new Error("ensurepip 之后 `python -m pip --version` 仍不可用——Python 安装不完整，请重试「下载」换装");
  console.log(`[pip] ready (${py})`);
}

/** pip 索引源：国内镜像优先、官方兜底（顺序即优先级）。 */
const PIP_INDEXES = [
  "https://pypi.tuna.tsinghua.edu.cn/simple",
  "https://mirrors.cloud.tencent.com/pypi/simple",
  "https://mirrors.aliyun.com/pypi/simple/",
  "https://pypi.mirrors.ustc.edu.cn/simple/",
  "https://pypi.org/simple/",
];

/**
 * 带多源兜底的 pip install（流式）。
 * ⛔⛔ 10-02 用户报障实录：清华源的**索引页正常（200）但具体 wheel 直链 403/404**
 *   （镜像侧文件失效或限流）⇒ 单源模式下就是一个包下不下来、整条安装全挂。
 * ⛔ pip 下载 wheel 失败**不会**自动换 index（`--extra-index-url` 同样不救），
 *   它选定 URL 后失败即报错 ⇒ 只能整个命令换源重跑。
 *   本函数按 PIP_INDEXES 顺序重试，全部失败才抛错，并把每个源的原因汇总给用户。
 */
async function pipInstall(py, packages, label, env, timeout = 1800000) {
  const tried = [];
  for (let i = 0; i < PIP_INDEXES.length; i++) {
    const index = PIP_INDEXES[i];
    if (i > 0) {
      console.log(`[${label}] 换源重试（${i + 1}/${PIP_INDEXES.length}）：${index}`);
      process.stdout.write(`@@STAGE ${label}（换源 ${i + 1}/${PIP_INDEXES.length}）\n`);
    }
    try {
      await runStreaming(`"${py}" -m pip install -U --no-input --retries 3 --timeout 30 -i ${index} ${packages}`, { label, timeout, env });
      if (i > 0) console.log(`[${label}] 成功（改用源：${index}）`);
      return;
    } catch (error) {
      tried.push(`  · ${index}\n    ${keyLine(error)}`);
    }
  }
  throw new Error(`${label} 失败：试过 ${PIP_INDEXES.length} 个源都不成功。\n${tried.join("\n")}`);
}

/** 预装 Python 常用依赖（requests/httpx/flask/fastapi/playwright），走国内镜像免代理。
 *  ⛔ 文档转换（markitdown）**不在这里** —— 它是按需下载项，见 DOC_PACKAGES 处的说明。 */
async function installPipPackages(pythonDir) {
  const marker = path.join(pythonDir, "Lib", "site-packages", "fastapi");
  if (fs.existsSync(marker)) { console.log("[skip] python packages already installed"); return; }
  console.log("[pip-packages] installing " + PIP_PACKAGES + " (mirror chain, no proxy)");
  process.stdout.write("@@STAGE 安装 Python 依赖\n");
  // pip 下载/安装有天然的分步输出：流式转发给界面（进度区能看到 Collecting / Installing）
  await pipInstall(path.join(pythonDir, "python.exe"), PIP_PACKAGES, "Python 依赖安装", { ...process.env, PYTHONHOME: pythonDir }, 900000);
  console.log("[pip-packages] done");
}

/** site-packages 的实际路径：Windows 是 `Lib/site-packages`，mac/posix 是 `lib/pythonX.Y/site-packages`。
 *  ⛔ 别把 mac 的版本号写死（python3.13）—— 上游换小版本目录就变了，「装没装」判定失效会反复重装。 */
function pythonSitePackages(pythonDir) {
  const win = path.join(pythonDir, "Lib", "site-packages");
  if (fs.existsSync(win)) return win;
  const lib = path.join(pythonDir, "lib");
  if (fs.existsSync(lib)) {
    const hit = fs.readdirSync(lib).filter((name) => /^python\d+\.\d+$/.test(name)).sort().pop();
    if (hit) return path.join(lib, hit, "site-packages");
  }
  return null;
}

/** 文档转换依赖（markitdown + openpyxl）——**按需安装**（约 120 MB；不内置的原因见 DOC_PACKAGES 处）。
 *  幂等：已装过就直接跳过（判定看 site-packages 里有没有 markitdown 包目录）。 */
async function installDocTools(pythonDir) {
  const site = pythonSitePackages(pythonDir);
  if (site && fs.existsSync(path.join(site, "markitdown"))) { console.log("[skip] markitdown already installed"); return; }
  const py = process.platform === "darwin" ? path.join(pythonDir, "bin", "python3") : path.join(pythonDir, "python.exe");
  // ⛔ 不能在这里静默 return：脚本 EXIT=0 时界面会显示「安装完成」，而用户其实什么都没装到
  //    （09-21 代码审查抓到的 UX 缺口）。抛出去，界面才会显示真实原因。
  if (!fs.existsSync(py)) {
    throw new Error("需要先安装「Python + Tkinter + pip」（在「基础运行时」分组里），再安装文档转换");
  }
  console.log("[markitdown] installing " + DOC_PACKAGES.join(" ") + " (mirror chain)");
  process.stdout.write("@@STAGE 安装文档转换依赖\n");
  const env = { ...process.env };
  // mac 的 python-build-standalone 不需要 PYTHONHOME（装了反而会打乱 sys.path）
  if (process.platform !== "darwin") env.PYTHONHOME = pythonDir;
  await pipInstall(py, DOC_PACKAGES.join(" "), "文档转换依赖安装", env);
  console.log("[markitdown] done");
}

async function main() {
  const nodeDir = path.join(TOOLS, "node");
  const psDir = path.join(TOOLS, "pwsh");
  const gitDir = path.join(TOOLS, "git");
  const pythonDir = path.join(TOOLS, "python");
  const ffmpegDir = path.join(TOOLS, "ffmpeg");
  const vscodeCliDir = path.join(TOOLS, "vscode-cli");
  const jqDir = path.join(TOOLS, "jq");
  const ninjaDir = path.join(TOOLS, "ninja");
  const sevenzipDir = path.join(TOOLS, "sevenzip");
  const ytdlpDir = path.join(TOOLS, "yt-dlp");
  if (want("node")) await install("node", NODE_URL, nodeDir, { marker: "node.exe", strip: true });
  if (want("pwsh")) await install("ps7", PS7_URL, psDir, { marker: "pwsh.exe", strip: false });
  if (want("git")) await install("mingit", MINGIT_URL, gitDir, { marker: "cmd\\git.exe", strip: false });
  if (want("python")) {
    // 健康检查前置：旧版不完整安装（有 python.exe 但缺 pip/tkinter）先整目录换装，
    // 否则 install() 看 marker 直接 skip、坏安装永远修不好（10-01 用户机器实录）。
    if (!winPythonHealthy(pythonDir)) {
      if (fs.existsSync(pythonDir)) {
        console.log("[python] 现有 Python 不完整（缺 pip 或 Tkinter），换装完整版（python-build-standalone）…");
        removePythonDir(pythonDir);
      }
      await install("python", PYTHON_PBS_URL, pythonDir, { marker: "python.exe", strip: true, archiveName: `pbs-cpython-${PYTHON_VERSION}-install_only.tar.gz` });
    } else {
      console.log(`[skip] python already healthy at ${pythonDir}`);
    }
    copyAlias(pythonDir, "python.exe", "python3.exe");
    copyAlias(pythonDir, "python.exe", "py.exe");
    await ensurePip(path.join(pythonDir, "python.exe"));
    await installPipPackages(pythonDir);
  }
  // 文档转换依赖（按需安装，不并入 PIP_PACKAGES）：用户点「开发工具 → 文档转换」卡片才走这里。
  //  放在 if (want("python")) **之外** —— 只点这一张卡片时不该顺手把 Python 重装一遍。
  if (want("markitdown")) await installDocTools(pythonDir);
  if (want("ffmpeg")) await install("ffmpeg", FFMPEG_URL, ffmpegDir, {
    marker: "bin\\ffmpeg.exe",
    strip: true,
    archiveName: `ffmpeg-${FFMPEG_VERSION}-essentials_build.zip`,
    altUrls: [FFMPEG_FALLBACK_URL],
  });
  if (want("vscode-cli")) await install("vscode-cli", VSCODE_CLI_URL, vscodeCliDir, { marker: "code.exe", strip: false, archiveName: "vscode-cli-win32-x64.zip" });
  // adb（zip 内一层 platform-tools/ ⇒ strip 掉），装到 tools/platform-tools/adb.exe
  if (want("platform-tools")) await install("platform-tools", PLATFORM_TOOLS_URL, path.join(TOOLS, "platform-tools"), { marker: "adb.exe", strip: true, archiveName: "platform-tools-latest-windows.zip" });
  if (want("jq")) await installFile("jq", JQ_URL, jqDir, "jq.exe");
  if (want("ninja")) await install("ninja", NINJA_URL, ninjaDir, { marker: "ninja.exe", strip: false, archiveName: "ninja-win.zip" });
  if (want("sevenzip")) {
    // ⛔⛔ 10-02 用户报障挖出的真缺陷：主通道原来下的是 `https://www.7-zip.org/a/7zr.exe`
    //   —— **7zr 是 7-Zip 的精简版，只支持 7z 格式**，还被改名成 `7z.exe` 存下来。
    //   实测随包那个「7-Zip CLI」对有效 zip / tar.gz 一律 `l` 返回 2（自带格式表里没有 zip/gzip/tar）
    //   ⇒ 既不能当解压兜底，用户拿它当命令行工具也打不开压缩包。
    //   现在统一取 extra 包里的 **`x64/7za.exe`（独立完整版，zip/gzip/tar/7z 全内置）**，
    //   并复制一份为 `7z.exe`（用户敲 `7z` 照常可用）。
    //   ⛔ 判据必须是 `7za.exe`：旧安装只有 7z.exe ⇒ 属坏安装，必须重装（否则永远 skip、永远打不开 zip）。
    const za = path.join(sevenzipDir, "7za.exe");
    if (!fs.existsSync(za)) {
      // ⛔⛔ 顺序不能反：先把 extra 包解到**临时目录**，成功之后再替换 sevenzip 目录。
      //   反过来（先删旧目录）会踩死局：那台缺 tar 的机器上，唯一能解 .7z 的恰恰是待删的这个
      //   7zr（解 .7z 是它的本职格式），删完就再也解不开自己了。
      const stage = fs.mkdtempSync(path.join(os.tmpdir(), "ch-7zip-"));
      try {
        await install("7zip-gh", SEVENZIP_GH_URL, stage, { marker: "x64\\7za.exe", strip: false, archiveName: "7z2501-extra.7z" });
        const from = path.join(stage, "x64", "7za.exe");
        if (!fs.existsSync(from)) throw new Error("7-Zip extra 包里没有 x64/7za.exe");
        // 落地前才动旧目录（只有确认新二进制已就位才清理）
        if (fs.existsSync(sevenzipDir)) fs.rmSync(sevenzipDir, { recursive: true, force: true });
        fs.mkdirSync(sevenzipDir, { recursive: true });
        fs.copyFileSync(from, za);
        fs.copyFileSync(from, path.join(sevenzipDir, "7z.exe"));
        console.log("[7zip] 已安装完整版 7za.exe（支持 zip / gzip / tar / 7z；旧的 7zr 精简版已替换）");
      } finally {
        try { fs.rmSync(stage, { recursive: true, force: true }); } catch { /* 临时目录清不掉不影响安装 */ }
      }
    }
  }
  if (want("yt-dlp")) await installFile("yt-dlp", YTDLP_URL, ytdlpDir, "yt-dlp.exe");
  if (want("rg")) await install("rg", RG_URL, path.join(TOOLS, "rg"), { marker: "rg.exe", strip: true, archiveName: `ripgrep-${RG_VERSION}-x86_64-pc-windows-msvc.zip` });
  if (want("uv")) await install("uv", UV_URL, path.join(TOOLS, "uv"), { marker: "uv.exe", strip: false, archiveName: `uv-${UV_VERSION}-x86_64-pc-windows-msvc.zip` });
  if (want("cmake")) await install("cmake", CMAKE_URL, path.join(TOOLS, "cmake"), { marker: "bin\\cmake.exe", strip: true, archiveName: `cmake-${CMAKE_VERSION}-windows-x86_64.zip` });
  if (want("conda")) await installConda(path.join(TOOLS, "miniconda"));
  // WinLibs zip 解压后是 mingw64/ 一层目录，挪到 TOOLS/mingw 下
  if (want("mingw")) {
    const dir = path.join(TOOLS, "mingw");
    if (fs.existsSync(path.join(dir, "mingw64", "bin", "g++.exe"))) { console.log(`[skip] mingw already at ${dir}`); }
    else {
      const zip = path.join(TMP, WINLIBS_ZIP);
      if (!archiveReady(zip)) { console.log(`[mingw] downloading ${WINLIBS_URL}`); await download(WINLIBS_URL, zip); }
      else console.log(`[mingw] reuse cached ${zip}`);
      fs.mkdirSync(dir, { recursive: true });
      runCommand(`"${BSDTAR}" -xf "${zip}" -C "${dir}"`, {});
      console.log(`[mingw] extracted to ${dir}`);
    }
  }

  if (fs.existsSync(path.join(nodeDir, "node.exe"))) console.log("[verify node]", runCommand(`"${path.join(nodeDir, "node.exe")}" -v`, { encoding: "utf8" }).trim());
  if (fs.existsSync(path.join(pythonDir, "python.exe"))) {
    console.log("[verify python]", runCommand(`"${path.join(pythonDir, "python.exe")}" --version`, { encoding: "utf8" }).trim());
    try { console.log("[verify python-tk]", runCommand(`"${path.join(pythonDir, "python.exe")}" -c "import tkinter; print('Tk ' + str(tkinter.TkVersion))"`, { encoding: "utf8" }).trim()); }
    catch (error) { console.log("[verify python-tk] unavailable: " + String(error.message).split("\n")[0]); }
  }
  // ⛔⛔ 09-20 用户实测（Miniconda 装完弹「安装失败」）：验证是**收尾快照**，不是安装的一部分——
  //   任何一条 verify 抛错都会被 main() 的 catch 连坐成「整个安装失败」，而文件其实已经装好。
  //   根因之一是 conda 的已知限制：**安装路径含空格时 conda.exe 启动器起不来**
  //   （工具目录默认在应用名下，如 D:\Codex Harness Desktop\...，必含空格）。
  //   ⇒ 所有 verify 一律非致命：失败只打 [verify X] unavailable + 原因，不影响安装结果。
  const safeVerify = (label, command, opts = {}) => {
    try { console.log(`[verify ${label}]`, runCommand(command, { encoding: "utf8", ...opts }).split(/\r?\n/)[0].trim()); }
    catch (e) { console.log(`[verify ${label}] unavailable: ` + String(e.message).split("\n")[0] + (label === "conda" && TOOLS.includes(" ") ? "（conda.exe 启动器不支持含空格的安装路径，属 conda 已知限制；Python 环境本身已装好，可用 miniconda\\python.exe 直接使用）" : "")); }
  };
  if (fs.existsSync(path.join(nodeDir, "node.exe"))) console.log("[verify node]", runCommand(`"${path.join(nodeDir, "node.exe")}" -v`, { encoding: "utf8" }).trim());
  if (fs.existsSync(path.join(pythonDir, "python.exe"))) {
    console.log("[verify python]", runCommand(`"${path.join(pythonDir, "python.exe")}" --version`, { encoding: "utf8" }).trim());
    try { console.log("[verify python-tk]", runCommand(`"${path.join(pythonDir, "python.exe")}" -c "import tkinter; print('Tk ' + str(tkinter.TkVersion))"`, { encoding: "utf8" }).trim()); }
    catch (error) { console.log("[verify python-tk] unavailable: " + String(error.message).split("\n")[0]); }
  }
  if (fs.existsSync(path.join(gitDir, "cmd", "git.exe"))) safeVerify("git", `"${path.join(gitDir, "cmd", "git.exe")}" --version`);
  if (fs.existsSync(path.join(TOOLS, "rg", "rg.exe"))) safeVerify("rg", `"${path.join(TOOLS, "rg", "rg.exe")}" --version`);
  if (fs.existsSync(path.join(TOOLS, "uv", "uv.exe"))) safeVerify("uv", `"${path.join(TOOLS, "uv", "uv.exe")}" --version`);
  if (fs.existsSync(path.join(TOOLS, "cmake", "bin", "cmake.exe"))) safeVerify("cmake", `"${path.join(TOOLS, "cmake", "bin", "cmake.exe")}" --version`);
  if (fs.existsSync(path.join(TOOLS, "miniconda", "Scripts", "conda.exe"))) safeVerify("conda", `"${path.join(TOOLS, "miniconda", "Scripts", "conda.exe")}" --version`);
  if (fs.existsSync(path.join(TOOLS, "mingw", "mingw64", "bin", "gcc.exe"))) safeVerify("gcc", `"${path.join(TOOLS, "mingw", "mingw64", "bin", "gcc.exe")}" --version`);
  if (fs.existsSync(path.join(ffmpegDir, "bin", "ffmpeg.exe"))) safeVerify("ffmpeg", `"${path.join(ffmpegDir, "bin", "ffmpeg.exe")}" -version`);
  if (fs.existsSync(path.join(vscodeCliDir, "code.exe"))) safeVerify("code", `"${path.join(vscodeCliDir, "code.exe")}" --version`, { timeout: 30000 });
  try {
    if (!fs.existsSync(path.join(psDir, "pwsh.exe"))) throw new Error("not installed");
    const v = runCommand(`"${path.join(psDir, "pwsh.exe")}" -NoProfile -NonInteractive -Command "$PSVersionTable.PSVersion.ToString()"`, { encoding: "utf8", timeout: 30000 });
    console.log("[verify ps7]", v.trim());
  } catch (e) {
    if (!want("pwsh")) return console.log("[done] selected tools installed at " + TOOLS);
    console.log("[verify ps7] launched but version query failed: " + String(e.message).split("\n")[0]);
  }
  console.log("[done] tools installed at " + TOOLS);
}

/** ⛔ mac 分支（09-16）：此前 mac 上跑的也是下面的 Windows 安装表——下载 win-x64 资产、
 *  marker 全是 .exe，装完根本跑不起来。darwin 资产集中在这里（与 main.ts 的
 *  DARWIN_MARKERS 一一对应，改一处必须同步另一处）。 */
async function mainMac() {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const jqArch = process.arch === "arm64" ? "arm64" : "amd64";
  const rgArch = process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  // adb（darwin 侧，与 Windows 侧**对称**存在 —— 预检【34】比对两平台安装表）
  if (want("platform-tools")) await install("platform-tools", PLATFORM_TOOLS_URL, path.join(TOOLS, "platform-tools"), { marker: "adb", strip: true, archiveName: "platform-tools-latest-darwin.zip" });
  if (want("node")) await install("node", NODE_URL, path.join(TOOLS, "node"), { marker: "bin/node", strip: true });
  if (want("pwsh")) await install("ps7", PS7_URL, path.join(TOOLS, "pwsh"), { marker: "pwsh", strip: false });
  if (want("git")) {
    // mac 不单独装 git：系统 git（/usr/bin/git）随 Xcode CLT 提供，装不装由系统弹窗引导。
    // 已有系统 git（homebrew 同样算）→ 直接算已装；没有就触发 CLT 安装对话框。
    const candidates = ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"];
    if (candidates.some((p) => fs.existsSync(p))) {
      console.log("[skip] git (system) available");
    } else {
      console.log("[git] no system git — launching Xcode Command Line Tools installer…");
      try { runCommand("xcode-select --install", { timeout: 60000 }); } catch { /* 已装/已请求时非零 */ }
      console.log("[git] 若系统弹窗未出现，请手动执行: xcode-select --install");
    }
  }
  if (want("python")) {
    // python-build-standalone（uv 官方构建）：install_only 包解到 TOOLS 根 → python/bin/python3
    const dir = TOOLS;
    if (fs.existsSync(path.join(dir, "python", "bin", "python3"))) {
      console.log(`[skip] python already at ${dir}`);
    } else {
      const release = JSON.parse(runCommand(`curl -sL --fail --max-time 60 "https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest"`, { encoding: "utf8", maxBuffer: 1 << 26 }));
      const triple = process.arch === "arm64" ? "aarch64" : "x86_64";
      const asset = (release.assets || []).find((a) => a.name.startsWith("cpython-3.13.") && a.name.endsWith(`${triple}-apple-darwin-install_only.tar.gz`));
      if (!asset) throw new Error("No macOS Python 3.13 standalone runtime asset");
      await install("python", asset.browser_download_url, dir, { marker: "python/bin/python3", strip: false, archiveName: asset.name });
    }
    const python = path.join(TOOLS, "python", "bin", "python3");
    if (want("python") && fs.existsSync(python)) {
      // PBS（含 mac 构建）不预装 pip 的**脚本外壳**，先走同一个功能判据 + ensurepip 兜底
      try { await ensurePip(python); }
      catch (error) { console.log("[pip] ensurepip failed (optional): " + String(error.message).split("\n")[0]); }
      try {
        await pipInstall(python, PIP_PACKAGES, "Python 依赖安装", undefined, 900000);
      } catch (error) { console.log("[pip-packages] failed (optional): " + keyLine(error)); }
    }
  }
  // 文档转换依赖：mac 侧的按需补装入口（默认已随上面的 pip 安装装好，这里给老用户补装/修复）。
  //  ⛔ 必须与 Windows 侧**对称存在**：预检【34】会比对两平台的安装表，只在一侧有的话，
  //    另一平台点「文档转换」卡片会静默什么都不装（用户以为装上了）。
  if (want("markitdown")) await installDocTools(path.join(TOOLS, "python"));
  /* FFmpeg（mac）：**必须解压**，且走国内源（10-07 用户报「FFmpeg 不是国内源，太慢了，几十K」）。
     · ffmpeg 主源 = ffmpeg-static 的单文件构建（npmmirror 优先 → gh 加速 → 直连），
       兜底 = evermeet 的 zip（境外，慢但可用）。
     · ffprobe 主源 = npmmirror 上的 @ffprobe-installer 平台包（tgz 里在 package/ffprobe），
       兜底 = evermeet zip。
     ⛔ ffprobe 是**可选**能力（toolchain.bundledFfprobe 取不到就返回空串，调用方按"探测不了"
       保守处理）⇒ 它拿不到**不阻塞** ffmpeg 装好，但也**必须把失败打出来**，不假装成功。 */
  if (want("ffmpeg")) {
    const fmpegBin = path.join(TOOLS, "ffmpeg", "bin");
    const ffTriple = process.arch === "arm64" ? "arm64" : "x64";
    await installMacBinary("ffmpeg", fmpegBin, "ffmpeg", [
      {
        url: `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_STATIC_VERSION}/ffmpeg-darwin-${ffTriple}.gz`,
        archiveName: `ffmpeg-darwin-${ffTriple}.gz`,
        unpack: "gz",
      },
      { url: "https://evermeet.cx/ffmpeg/get/ffmpeg/zip", archiveName: "ffmpeg-evermeet.zip", unpack: "zip" },
    ]);
    try {
      await installMacBinary("ffprobe", fmpegBin, "ffprobe", [
        {
          url: `https://registry.npmmirror.com/@ffprobe-installer/darwin-${ffTriple}/-/darwin-${ffTriple}-${FFPROBE_INSTALLER_VERSION}.tgz`,
          archiveName: `ffprobe-darwin-${ffTriple}.tgz`,
          unpack: "npm",
        },
        { url: "https://evermeet.cx/ffmpeg/get/ffprobe/zip", archiveName: "ffprobe-evermeet.zip", unpack: "zip" },
      ]);
    } catch (error) {
      console.log(`[ffprobe] 可选组件安装失败（不影响 ffmpeg）：${keyLine(error)}`);
    }
  }
  if (want("vscode-cli")) await install("vscode-cli", `https://update.code.visualstudio.com/latest/cli-darwin-${arch}/stable`, path.join(TOOLS, "vscode-cli"), { marker: "code", strip: false, archiveName: `vscode-cli-darwin-${arch}.zip` });
  if (want("jq")) await installFile("jq", `https://github.com/jqlang/jq/releases/latest/download/jq-macos-${jqArch}`, path.join(TOOLS, "jq"), "jq");
  if (want("ninja")) await install("ninja", "https://github.com/ninja-build/ninja/releases/latest/download/ninja-mac.zip", path.join(TOOLS, "ninja"), { marker: "ninja", strip: false, archiveName: "ninja-mac.zip" });
  if (want("sevenzip")) await install("7zip", "https://github.com/ip7z/7zip/releases/download/25.01/7z2501-mac.tar.xz", path.join(TOOLS, "sevenzip"), { marker: "7zz", strip: false });
  if (want("yt-dlp")) await installFile("yt-dlp", "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos", path.join(TOOLS, "yt-dlp"), "yt-dlp");
  if (want("rg")) await install("rg", `https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-${rgArch}.tar.gz`, path.join(TOOLS, "rg"), { marker: "rg", strip: true });
  if (want("uv")) await install("uv", `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${rgArch}.tar.gz`, path.join(TOOLS, "uv"), { marker: "uv", strip: false });
  if (want("cmake")) await install("cmake", `https://github.com/Kitware/CMake/releases/download/v${CMAKE_VERSION}/cmake-${CMAKE_VERSION}-macos-universal.tar.gz`, path.join(TOOLS, "cmake"), { marker: "CMake.app/Contents/bin/cmake", strip: false });
  if (want("conda")) {
    const condaDir = path.join(TOOLS, "miniconda");
    if (fs.existsSync(path.join(condaDir, "bin", "conda"))) { console.log(`[skip] miniconda already at ${condaDir}`); }
    else {
      const mcName = `Miniconda3-py312_25.1.1-2-MacOSX-${arch === "arm64" ? "arm64" : "x86_64"}.sh`;
      const installer = path.join(TMP, mcName);
      // ⛔ 10-07：与 Windows 侧同一修法——清华镜像打头（国内直连官方站极慢 = 「miniconda
      //    压根安装不了」），官方 repo.anaconda.com 留兜底。实测 TUNA 上两个 mac 资产都在。
      await download(`https://mirrors.tuna.tsinghua.edu.cn/anaconda/miniconda/${mcName}`, installer,
        [`https://repo.anaconda.com/miniconda/${mcName}`]);
      fs.mkdirSync(condaDir, { recursive: true });
      console.log(`[miniconda] batch installing to ${condaDir}`);
      runCommand(`bash "${installer}" -b -p "${condaDir}"`, { timeout: 900000 });
      console.log("[miniconda] installed to " + condaDir);
    }
  }
  console.log("[done] tools installed at " + TOOLS);
}

if (IS_MAC) mainMac().catch((e) => { console.error("[fail] " + e.message); process.exit(1); });
else main().catch((e) => { console.error("[fail] " + e.message); process.exit(1); });
