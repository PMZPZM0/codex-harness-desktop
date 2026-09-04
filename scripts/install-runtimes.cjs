/* 把 Node.js LTS + PowerShell 7 LTS 内置到应用 resources/tools/
 * node  -> resources/tools/node/node.exe
 * pwsh  -> resources/tools/pwsh/pwsh.exe
 * 用法: node scripts/install-runtimes.cjs
 * 说明: 用 Windows 自带 bsdtar (System32\tar.exe) 解压 zip（Git Bash 的 GNU tar 不行）。
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const NODE_VERSION = "v24.19.0";
const NODE_URL = `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-win-x64.zip`;
const PS7_VERSION = "7.6.4";
const PS7_URL = `https://github.com/PowerShell/PowerShell/releases/download/v${PS7_VERSION}/PowerShell-${PS7_VERSION}-win-x64.zip`;
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
// GitHub 直连在国内经常不可达；gh-proxy.com 加速前缀实测稳定（rg/cmake/uv/7zip 均可 206 分段续传）。
// 下载顺序：直连 → gh-proxy 加速 → 本机代理（PROXY 环境变量，默认 Clash 7897）。
const GHPROXY = "https://gh-proxy.com/";
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
const TMP = process.env.TEMP || "C:\\Windows\\Temp";
const requested = new Set(process.argv.slice(2).filter((arg) => !arg.startsWith("--")));
const want = (id) => requested.size === 0 || requested.has(id);
const DIRECT = process.argv.includes("--direct");

// bsdtar 支持 zip 和 Windows 反斜杠路径；Git Bash 的 GNU tar 两者都不行
const BSDTAR = fs.existsSync("C:\\Windows\\System32\\tar.exe") ? "C:\\Windows\\System32\\tar.exe" : "tar";

// 代理：默认用 Clash Verge 混合端口 7897（verge-mihomo），可用 PROXY 环境变量覆盖
const PROXY = process.env.PROXY || "http://127.0.0.1:7897";

function download(url, file) {
  return new Promise((resolve, reject) => {
    const common = `curl -L --fail --silent --show-error --retry 3 --retry-all-errors --connect-timeout 30 --continue-at - -o "${file}" "${url}"`;
    const viaProxy = `curl -L --fail --silent --show-error --retry 3 --retry-all-errors --connect-timeout 30 --continue-at - --proxy "${PROXY}" -o "${file}" "${url}"`;
    if (DIRECT) {
      try { resolve(execSync(common, { stdio: "inherit", timeout: 900000 })); }
      catch (error) { reject(error); }
      return;
    }
    // 通道 1：本机代理（若有）。通道 2：直连。通道 3：gh-proxy 加速（GitHub 资源兜底）。
    try {
      console.log(`[download] via proxy ${PROXY}`);
      resolve(execSync(viaProxy, { stdio: "inherit", timeout: 900000 }));
    } catch {
      try {
        console.log("[download] proxy failed, retrying direct");
        resolve(execSync(common, { stdio: "inherit", timeout: 900000 }));
      } catch {
        if (!url.includes("github.com") && !url.includes("7-zip.org")) { reject(new Error("download failed")); return; }
        console.log("[download] direct failed, retrying via gh-proxy");
        resolve(execSync(common.replace(url, GHPROXY + url), { stdio: "inherit", timeout: 900000 }));
      }
    }
  });
}

function archiveReady(file) {
  if (!fs.existsSync(file) || fs.statSync(file).size < 1024 * 1024) return false;
  try { execSync(`"${BSDTAR}" -tf "${file}"`, { stdio: "ignore", timeout: 120000 }); return true; }
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
  const stripArg = opts.strip ? " --strip-components=1" : "";
  execSync(`"${BSDTAR}" -xf "${zip}" -C "${destDir}"${stripArg}`, { stdio: "inherit" });
  console.log(`[${label}] extracted to ${destDir}`);
}

async function installFile(label, url, destDir, fileName) {
  const target = path.join(destDir, fileName);
  if (fs.existsSync(target) && fs.statSync(target).size > 10 * 1024) { console.log(`[skip] ${label} already at ${target}`); return; }
  fs.mkdirSync(destDir, { recursive: true });
  console.log(`[${label}] downloading ${url}`);
  await download(url, target);
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
  execSync(`"${installer}" /InstallationType=JustMe /RegisterPython=0 /AddToPath=0 /S /D=${destDir}`, { stdio: "inherit", timeout: 900000 });
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
  execSync(`"${installer}" /quiet InstallAllUsers=0 TargetDir="${extractDir}" Include_tcltk=1 Include_pip=0 Include_test=0 Include_doc=0 Include_launcher=0 SimpleInstall=0`, { stdio: "inherit", timeout: 900000 });
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
  execSync(`"${path.join(pythonDir, "python.exe")}" "${script}" --no-warn-script-location`, { stdio: "inherit", timeout: 900000, env: { ...process.env, PYTHONHOME: pythonDir } });
  console.log(`[pip] installed to ${pythonDir}`);
}

/** 预装 Python 常用依赖（requests/httpx/flask/fastapi/playwright），走清华镜像免代理。 */
async function installPipPackages(pythonDir) {
  const marker = path.join(pythonDir, "Lib", "site-packages", "fastapi");
  if (fs.existsSync(marker)) { console.log("[skip] python packages already installed"); return; }
  console.log("[pip-packages] installing " + PIP_PACKAGES + " (tsinghua mirror, no proxy)");
  execSync(`"${path.join(pythonDir, "python.exe")}" -m pip install --no-input -i https://pypi.tuna.tsinghua.edu.cn/simple ${PIP_PACKAGES}`, { stdio: "inherit", timeout: 900000, env: { ...process.env, PYTHONHOME: pythonDir } });
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
      execSync(`"${BSDTAR}" -xf "${zip}" -C "${dir}"`, { stdio: "inherit" });
      console.log(`[mingw] extracted to ${dir}`);
    }
  }

  if (fs.existsSync(path.join(nodeDir, "node.exe"))) console.log("[verify node]", execSync(`"${path.join(nodeDir, "node.exe")}" -v`, { encoding: "utf8" }).trim());
  if (fs.existsSync(path.join(pythonDir, "python.exe"))) {
    console.log("[verify python]", execSync(`"${path.join(pythonDir, "python.exe")}" --version`, { encoding: "utf8" }).trim());
    try { console.log("[verify python-tk]", execSync(`"${path.join(pythonDir, "python.exe")}" -c "import tkinter; print('Tk ' + str(tkinter.TkVersion))"`, { encoding: "utf8" }).trim()); }
    catch (error) { console.log("[verify python-tk] unavailable: " + String(error.message).split("\n")[0]); }
  }
  if (fs.existsSync(path.join(gitDir, "cmd", "git.exe"))) console.log("[verify git]", execSync(`"${path.join(gitDir, "cmd", "git.exe")}" --version`, { encoding: "utf8" }).trim());
  if (fs.existsSync(path.join(TOOLS, "rg", "rg.exe"))) console.log("[verify rg]", execSync(`"${path.join(TOOLS, "rg", "rg.exe")}" --version`, { encoding: "utf8" }).split(/\r?\n/)[0]);
  if (fs.existsSync(path.join(TOOLS, "uv", "uv.exe"))) console.log("[verify uv]", execSync(`"${path.join(TOOLS, "uv", "uv.exe")}" --version`, { encoding: "utf8" }).trim());
  if (fs.existsSync(path.join(TOOLS, "cmake", "bin", "cmake.exe"))) console.log("[verify cmake]", execSync(`"${path.join(TOOLS, "cmake", "bin", "cmake.exe")}" --version`, { encoding: "utf8" }).split(/\r?\n/)[0]);
  if (fs.existsSync(path.join(TOOLS, "miniconda", "Scripts", "conda.exe"))) console.log("[verify conda]", execSync(`"${path.join(TOOLS, "miniconda", "Scripts", "conda.exe")}" --version`, { encoding: "utf8" }).trim());
  if (fs.existsSync(path.join(TOOLS, "mingw", "mingw64", "bin", "gcc.exe"))) console.log("[verify gcc]", execSync(`"${path.join(TOOLS, "mingw", "mingw64", "bin", "gcc.exe")}" --version`, { encoding: "utf8" }).split(/\r?\n/)[0]);
  if (fs.existsSync(path.join(ffmpegDir, "bin", "ffmpeg.exe"))) console.log("[verify ffmpeg]", execSync(`"${path.join(ffmpegDir, "bin", "ffmpeg.exe")}" -version`, { encoding: "utf8" }).split(/\r?\n/)[0]);
  if (fs.existsSync(path.join(vscodeCliDir, "code.exe"))) console.log("[verify code]", execSync(`"${path.join(vscodeCliDir, "code.exe")}" --version`, { encoding: "utf8", timeout: 30000 }).split(/\r?\n/)[0]);
  try {
    if (!fs.existsSync(path.join(psDir, "pwsh.exe"))) throw new Error("not installed");
    const v = execSync(`"${path.join(psDir, "pwsh.exe")}" -NoProfile -NonInteractive -Command "$PSVersionTable.PSVersion.ToString()"`, { encoding: "utf8", timeout: 30000 });
    console.log("[verify ps7]", v.trim());
  } catch (e) {
    if (!want("pwsh")) return console.log("[done] selected tools installed at " + TOOLS);
    console.log("[verify ps7] launched but version query failed: " + String(e.message).split("\n")[0]);
  }
  console.log("[done] tools installed at " + TOOLS);
}

main().catch((e) => { console.error("[fail] " + e.message); process.exit(1); });
