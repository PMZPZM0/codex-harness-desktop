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
// embeddable distribution plus the matching official Tcl/Tk components so GUI
// scripts can import tkinter without relying on a system Python installation.
// GitHub does not expose a stable "latest asset" URL for MinGit; pin the
// verified release so a fresh install cannot receive a 404 from a renamed asset.
const MINGIT_VERSION = "2.55.0.5";
const MINGIT_URL = `https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.5/MinGit-${MINGIT_VERSION}-64-bit.zip`;
const PYTHON_VERSION = "3.13.13";
const PYTHON_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`;
const PYTHON_FULL_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-amd64.exe`;
const GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py";
const FFMPEG_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
const VSCODE_CLI_URL = "https://update.code.visualstudio.com/latest/cli-win32-x64/stable";
const JQ_URL = "https://github.com/jqlang/jq/releases/latest/download/jq-windows-amd64.exe";
const NINJA_URL = "https://github.com/ninja-build/ninja/releases/latest/download/ninja-win.zip";
const SEVENZIP_URL = "https://www.7-zip.org/a/7zr.exe";
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
// Python 常用 Web/API 依赖（引擎自检缺失项）。走清华 PyPI 镜像，无需代理。
const PIP_PACKAGES = "requests httpx flask fastapi playwright";
// Miniconda：官方 exe 静默安装（/InstallationType=JustMe /RegisterPython=0 /S /D=目标目录）
const MINICONDA_VERSION = "py312_25.1.1-2";
const MINICONDA_URL = `https://repo.anaconda.com/miniconda/Miniconda3-${MINICONDA_VERSION}-Windows-x86_64.exe`;
// MinGW-w64 完整工具链（WinLibs：gcc/g++/make/gdb）。版本固定，资产名含编译器版本号。
const WINLIBS_VERSION = "16.2.0posix-14.0.0-ucrt-r1";
const WINLIBS_ZIP = "winlibs-x86_64-posix-seh-gcc-16.2.0-mingw-w64ucrt-14.0.0-r1.zip";
const WINLIBS_URL = `https://github.com/brechtsanders/winlibs_mingw/releases/download/${WINLIBS_VERSION}/${WINLIBS_ZIP}`;

const TOOLS = process.env.TOOLS_ROOT || path.join(__dirname, "..", "resources", "tools");
const TMP = process.env.TEMP || process.env.TMP || os.tmpdir();
const requested = new Set(process.argv.slice(2).filter((arg) => !arg.startsWith("--")));
const want = (id) => requested.size === 0 || requested.has(id);
const DIRECT = process.argv.includes("--direct");

// 解压器：Windows 用 System32 bsdtar；mac 系统自带 bsdtar（/usr/bin/tar，zip/tar.gz/tar.xz 通吃）
const BSDTAR = IS_MAC ? "/usr/bin/tar" : (fs.existsSync("C:\\Windows\\System32\\tar.exe") ? "C:\\Windows\\System32\\tar.exe" : "tar");

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

async function download(url, file) {
  process.stdout.write("@@STAGE 下载\n");
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

function archiveReady(file) {
  if (!fs.existsSync(file) || fs.statSync(file).size < 1024 * 1024) return false;
  try { runCommand(`"${BSDTAR}" -tf "${file}"`, { quiet: true, timeout: 120000 }); return true; }
  catch { return false; }
}

async function install(label, url, destDir, opts = {}) {
  const marker = path.join(destDir, opts.marker || "node.exe");
  if (fs.existsSync(marker)) { console.log(`[skip] ${label} already at ${marker}`); return; }
  const zip = path.join(TMP, opts.archiveName || path.basename(url));
  // 复用已下载的 zip（>1MB 视为完整）
  if (!archiveReady(zip)) {
    console.log(`[${label}] downloading ${url}`);
    await download(url, zip);
  } else {
    console.log(`[${label}] reuse cached ${zip}`);
  }
  fs.mkdirSync(destDir, { recursive: true });
  process.stdout.write("@@STAGE 解压\n");
  const stripArg = opts.strip ? " --strip-components=1" : "";
  await runStreaming(`"${BSDTAR}" -xf "${zip}" -C "${destDir}"${stripArg}`, { label: `${label} 解压`, quiet: true, timeout: 900000 });
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

/** Miniconda 静默安装到目标目录：官方 exe + 静默参数（JustMe、不注册 Python、/S）。 */
async function installConda(destDir) {
  const marker = path.join(destDir, "Scripts", "conda.exe");
  if (fs.existsSync(marker)) { console.log(`[skip] miniconda already at ${marker}`); return; }
  const installer = path.join(TMP, `Miniconda3-${MINICONDA_VERSION}-Windows-x86_64.exe`);
  if (!fs.existsSync(installer) || fs.statSync(installer).size < 20 * 1024 * 1024) {
    console.log(`[miniconda] downloading ${MINICONDA_URL}`);
    await download(MINICONDA_URL, installer);
  }
  fs.mkdirSync(destDir, { recursive: true });
  console.log(`[miniconda] silent installing to ${destDir}（约 1-2 分钟）`);
  process.stdout.write("@@STAGE 静默安装\n");
  await runStreaming(`"${installer}" /InstallationType=JustMe /RegisterPython=0 /AddToPath=0 /S /D=${destDir}`, { label: "Miniconda 安装", quiet: true, timeout: 900000 });
  // 静默安装后补一个 .condarc 用清华镜像（国内下载包更快），失败不影响安装本身
  try { fs.writeFileSync(path.join(destDir, ".condarc"), "channels:\n  - https://mirrors.tuna.tsinghua.edu.cn/anaconda/pkgs/main\n  - https://mirrors.tuna.tsinghua.edu.cn/anaconda/pkgs/free\n  - defaults\nshow_channel_urls: true\n", "utf8"); } catch { /* 可选优化 */ }
  console.log("[miniconda] installed to " + destDir);
}

function enablePythonSite(dir) {
  const pth = path.join(dir, `python313._pth`);
  if (!fs.existsSync(pth)) return;
  const raw = fs.readFileSync(pth, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (!lines.includes("Lib")) lines.splice(Math.max(0, lines.findIndex((line) => line.startsWith("#"))), 0, "Lib");
  if (!lines.includes("Lib\\site-packages")) lines.push("Lib\\site-packages");
  const importIndex = lines.findIndex((line) => line === "#import site" || line === "import site");
  if (importIndex >= 0) lines[importIndex] = "import site";
  else lines.push("import site");
  fs.writeFileSync(pth, `${lines.join("\n")}\n`, "utf8");
}

/** 补齐官方 Python 同版本 Tcl/Tk：embeddable zip 默认没有 tkinter。 */
async function ensureTkinter(pythonDir) {
  const markerFiles = ["_tkinter.pyd", "tcl86t.dll", "tk86t.dll", "zlib1.dll", path.join("Lib", "tkinter", "__init__.py"), path.join("tcl", "tcl8.6", "init.tcl")];
  if (markerFiles.every((entry) => fs.existsSync(path.join(pythonDir, entry)))) {
    console.log("[python-tk] tkinter already bundled");
    return;
  }
  const installer = path.join(TMP, `python-${PYTHON_VERSION}-amd64-full.exe`);
  const extractDir = path.join(TMP, `codex-harness-python-${PYTHON_VERSION}-full`);
  if (!fs.existsSync(installer) || fs.statSync(installer).size < 20 * 1024 * 1024) {
    console.log(`[python-tk] downloading ${PYTHON_FULL_URL}`);
    await download(PYTHON_FULL_URL, installer);
  }
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  console.log("[python-tk] extracting official Tcl/Tk components");
  runCommand(`"${installer}" /quiet InstallAllUsers=0 TargetDir="${extractDir}" Include_tcltk=1 Include_pip=0 Include_test=0 Include_doc=0 Include_launcher=0 SimpleInstall=0`, { timeout: 900000 });
  const copyFiles = ["_tkinter.pyd", "tcl86t.dll", "tk86t.dll", "zlib1.dll"];
  fs.mkdirSync(pythonDir, { recursive: true });
  for (const file of copyFiles) fs.copyFileSync(path.join(extractDir, "DLLs", file), path.join(pythonDir, file));
  fs.cpSync(path.join(extractDir, "Lib", "tkinter"), path.join(pythonDir, "Lib", "tkinter"), { recursive: true, force: true });
  fs.cpSync(path.join(extractDir, "tcl"), path.join(pythonDir, "tcl"), { recursive: true, force: true });
  enablePythonSite(pythonDir);
  console.log("[python-tk] tkinter bundled");
}

function copyAlias(dir, source, alias) {
  const from = path.join(dir, source);
  const to = path.join(dir, alias);
  if (fs.existsSync(from) && !fs.existsSync(to)) fs.copyFileSync(from, to);
}

async function installPip(pythonDir) {
  const marker = path.join(pythonDir, "Scripts", "pip.exe");
  if (fs.existsSync(marker)) { console.log(`[skip] pip already at ${marker}`); return; }
  const script = path.join(TMP, "codex-harness-get-pip.py");
  if (!fs.existsSync(script) || fs.statSync(script).size < 10 * 1024) await download(GET_PIP_URL, script);
  await runStreaming(`"${path.join(pythonDir, "python.exe")}" "${script}" --no-warn-script-location`, { label: "pip 引导", quiet: true, timeout: 900000, env: { ...process.env, PYTHONHOME: pythonDir } });
  console.log(`[pip] installed to ${pythonDir}`);
}

/** 预装 Python 常用依赖（requests/httpx/flask/fastapi/playwright），走清华镜像免代理。 */
async function installPipPackages(pythonDir) {
  const marker = path.join(pythonDir, "Lib", "site-packages", "fastapi");
  if (fs.existsSync(marker)) { console.log("[skip] python packages already installed"); return; }
  console.log("[pip-packages] installing " + PIP_PACKAGES + " (tsinghua mirror, no proxy)");
  process.stdout.write("@@STAGE 安装 Python 依赖\n");
  // pip 下载/安装有天然的分步输出：流式转发给界面（进度区能看到 Collecting / Installing）
  await runStreaming(`"${path.join(pythonDir, "python.exe")}" -m pip install --no-input -i https://pypi.tuna.tsinghua.edu.cn/simple ${PIP_PACKAGES}`, { label: "Python 依赖安装", timeout: 900000, env: { ...process.env, PYTHONHOME: pythonDir } });
  console.log("[pip-packages] done");
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
    await install("python", PYTHON_URL, pythonDir, { marker: "python.exe", strip: false });
    await ensureTkinter(pythonDir);
    enablePythonSite(pythonDir);
    copyAlias(pythonDir, "python.exe", "python3.exe");
    copyAlias(pythonDir, "python.exe", "py.exe");
    await installPip(pythonDir);
    await installPipPackages(pythonDir);
  }
  if (want("ffmpeg")) await install("ffmpeg", FFMPEG_URL, ffmpegDir, { marker: "bin\\ffmpeg.exe", strip: true, archiveName: "ffmpeg-release-essentials.zip" });
  if (want("vscode-cli")) await install("vscode-cli", VSCODE_CLI_URL, vscodeCliDir, { marker: "code.exe", strip: false, archiveName: "vscode-cli-win32-x64.zip" });
  if (want("jq")) await installFile("jq", JQ_URL, jqDir, "jq.exe");
  if (want("ninja")) await install("ninja", NINJA_URL, ninjaDir, { marker: "ninja.exe", strip: false, archiveName: "ninja-win.zip" });
  if (want("sevenzip")) {
    // 官网 7-zip.org 国内不稳定；先试官网，失败走 github release（gh-proxy 兜底在 download 内）
    try { await installFile("7zip", SEVENZIP_URL, sevenzipDir, "7z.exe"); }
    catch { await install("7zip-gh", SEVENZIP_GH_URL, sevenzipDir, { marker: "7z.exe", strip: false, archiveName: "7z2501-extra.7z" }); }
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
      try {
        runCommand(`"${python}" -m pip install --no-input -i https://pypi.tuna.tsinghua.edu.cn/simple ${PIP_PACKAGES}`, { timeout: 900000 });
      } catch (error) { console.log("[pip-packages] failed (optional): " + String(error.message).split("\n")[0]); }
    }
  }
  // evermeet.cx 的 mac 单文件构建（官方 gyan.dev 只有 Windows 包）
  if (want("ffmpeg")) {
    await installFile("ffmpeg", "https://evermeet.cx/ffmpeg/get/ffmpeg/zip", path.join(TOOLS, "ffmpeg", "bin"), "ffmpeg");
    await installFile("ffprobe", "https://evermeet.cx/ffmpeg/get/ffprobe/zip", path.join(TOOLS, "ffmpeg", "bin"), "ffprobe");
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
      const installer = path.join(TMP, `Miniconda3-py312_25.1.1-2-MacOSX-${arch === "arm64" ? "arm64" : "x86_64"}.sh`);
      await download(`https://repo.anaconda.com/miniconda/Miniconda3-py312_25.1.1-2-MacOSX-${arch === "arm64" ? "arm64" : "x86_64"}.sh`, installer);
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
