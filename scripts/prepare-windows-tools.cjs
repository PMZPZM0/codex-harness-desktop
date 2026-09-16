/**
 * 在 Windows 上把「随包工具链」现造到 resources/tools。
 *
 * 为什么需要它：package.json 的 build.extraResources 指向 resources/tools/*，而整个目录被
 * .gitignore 排除（大体积二进制），所以 **CI 的干净检出里什么都没有**。mac 一直有
 * scripts/prepare-mac-tools.cjs 负责现造，Windows 过去靠手工在本机攒目录 —— 结果是
 * 「Windows 包只能在开发机上打」，tag 触发的自动发布流水线（.github/workflows/release.yml）
 * 无法覆盖 Windows。本脚本补齐这条链。
 *
 * 产出（与 package.json build.extraResources 的 from 逐条对应）：
 *   node/             ← nodejs.org win-x64（v24.19.0，与 mac 侧同版本）
 *   npm-global/       ← npm i -g --prefix：@nuphus/nuphus-mcp + @playwright/cli + playwright-core
 *   vscode-cli/       ← update.code.visualstudio.com cli-win32-x64
 *   cloudflared.exe   ← cloudflare/cloudflared release
 *   ponytail-plugin/  ← ponytail v4.9.0 源码包（strip 1）
 *   pwsh-headless/    ← 由随包源码 pwsh-headless/PwshHeadless.cs 现场编译（无窗口 pwsh 转发壳）
 *
 * 不产出 **是设计**（09-16 安装包瘦身：有国内加速源的一律改「开发工具」页按需下载）：
 *   pwsh / python / git / rg / uv / cmake / ninja / sevenzip / jq / ffmpeg / miniconda / mingw
 *   —— 它们由应用内 install-runtimes.cjs 在用户机器上下载，不进安装包。
 *   CloakBrowser 同样不在这里装（09-16 起从随包剥离，改为按需 npm 下载）。
 *
 * 用法：
 *   node scripts/prepare-windows-tools.cjs
 *   TOOLS_ROOT=<目录> node scripts/prepare-windows-tools.cjs   # 验收隔离用（不动真随包目录）
 *
 * 跑完必须过 `node scripts/verify-packaged-tools.cjs <TOOLS_ROOT>`（真 MCP 握手）。
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

if (process.platform !== "win32") throw new Error("Run on Windows (win32-x64)");

const tools = path.resolve(process.env.TOOLS_ROOT || path.join(__dirname, "..", "resources", "tools"));
const repoSource = path.resolve(__dirname, "..");
const downloads = path.resolve(repoSource, ".test-tmp", "win-downloads");
fs.mkdirSync(downloads, { recursive: true });
fs.mkdirSync(tools, { recursive: true });

const NODE_VERSION = "v24.19.0";
const NUPHUS_VERSION = "0.2.2";
const PLAYWRIGHT_CLI_VERSION = "0.1.18";
const PLAYWRIGHT_CORE_VERSION = "1.62.1";
const PONYTAIL_VERSION = "v4.9.0";

const run = (file, args, env = {}) =>
  execFileSync(file, args, { stdio: "inherit", env: { ...process.env, ...env }, timeout: 30 * 60_000 });

/** bsdtar（System32\tar.exe）同时认识 zip 与 tar.gz；Git Bash 的 GNU tar 解不了 zip */
function tarBin() {
  const system32 = path.join(process.env.WINDIR || "C:\\Windows", "System32", "tar.exe");
  if (fs.existsSync(system32)) return system32;
  throw new Error("缺少 %WINDIR%\\System32\\tar.exe（bsdtar），无法解压 zip");
}

/**
 * 下载：直连 → gh-proxy 加速 → 带本机代理。
 * GitHub 资产在国内直连经常被掐（实测 `curl: (52) Empty reply from server`），而 CI runner 上
 * 直连就是最优路径 —— 所以做顺序回落而不是按平台分支。
 */
function download(url, name) {
  const file = path.join(downloads, name);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) {
    console.log(`[download] 复用缓存 ${name}`);
    return file;
  }
  const attempts = [{ label: "直连", url, noproxy: true }];
  if (url.startsWith("https://github.com/")) {
    attempts.push({ label: "gh-proxy 加速", url: "https://gh-proxy.com/" + url, noproxy: true });
  }
  attempts.push({ label: "本机代理", url, noproxy: false });
  for (const attempt of attempts) {
    console.log(`[download] ${attempt.label} ${attempt.url}`);
    // --connect-timeout 收紧：GitHub 在国内是「连不上」而不是「慢」，不设的话单次能空等 --max-time
    const args = ["--fail", "--location", "--retry", "2", "--connect-timeout", "20", "--max-time", "1800"];
    if (attempt.noproxy) args.push("--noproxy", "*");
    args.push("--output", file, attempt.url);
    try {
      run("curl.exe", args);
      if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
      console.warn(`[download] ${attempt.label} 产出为空，换通道`);
    } catch (error) {
      console.warn(`[download] ${attempt.label} 失败：${String(error.message).split("\n")[0]}`);
    }
  }
  throw new Error(`下载失败（所有通道都不通）：${url}`);
}

function extract(archive, destination, { strip = 0, extra = [] } = {}) {
  // 先清空目标目录：否则「换了版本号重跑」会把上一个版本的文件混进包里（本地尤其容易踩，
  // 而且实测在已存在的目录上重复解压会长时间卡住）。CI 每次都是干净目录，行为一致。
  if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  run(tarBin(), ["-xf", archive, "-C", destination, ...(strip ? [`--strip-components=${strip}`] : []), ...extra]);
}

/**
 * nuphus-call 命令行桥。
 * 引擎的 developer_instructions 让模型用 `nuphus-call …` 命令行方式调用桌面工具（35 个工具
 * schema 不进上下文），而 `npm-global` 会被注入引擎的 PATH ⇒ 这个命令必须存在。
 * 它不是任何 npm 包的 bin，npm 不会生成，必须手工写；mac 侧对应 npm-global/bin/nuphus-call。
 * ⛔ 内容与开发机现成产物逐字节一致（含两处行尾空格）——不要「美化」它。
 */
function writeNuphusCallShim(prefix) {
  fs.writeFileSync(path.join(prefix, "nuphus-call.cmd"), '@echo off  \r\n"%~dp0..\\node\\node.exe" "%~dp0..\\nuphus-call.mjs" %*  \r\n', "utf8");
}

/**
 * PowerShell 无窗口桥：源码在随包里（.gitignore 特批），产物必须现场编译
 */
function buildHeadlessBridge() {
  const source = path.join(repoSource, "resources", "tools", "pwsh-headless", "PwshHeadless.cs");
  if (!fs.existsSync(source)) throw new Error(`缺少源码 ${source}`);
  const outDir = path.join(tools, "pwsh-headless");
  const out = path.join(outDir, "pwsh.exe");
  fs.mkdirSync(outDir, { recursive: true });
  const candidates = [
    path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
  ];
  const csc = candidates.find(fs.existsSync);
  if (!csc) throw new Error("找不到 .NET Framework 的 csc.exe，无法编译 pwsh-headless");
  // /target:winexe = GUI 子系统：双击/调用都不弹控制台窗口（这就是「无窗口桥」的全部含义）
  run(csc, ["/nologo", "/target:winexe", "/optimize+", `/out:${out}`, source]);
  if (!fs.existsSync(out)) throw new Error("pwsh-headless 编译后没有产生 pwsh.exe");
  console.log(`[pwsh-headless] 编译完成 ${out} (${fs.statSync(out).size} B)`);
}

async function main() {
  // 1) Node：既是随包运行时，也是后面 npm 安装与打包脚本的执行体。
  //    已就位且**版本一致**就跳过（本机重跑不必每次解 1990 个文件；CI 是干净目录，必然现装）。
  const nodeDir = path.join(tools, "node");
  const node = path.join(nodeDir, "node.exe");
  const nodeReady = (() => {
    if (!fs.existsSync(node)) return false;
    try {
      return execFileSync(node, ["-v"], { encoding: "utf8" }).trim() === NODE_VERSION;
    } catch {
      return false;
    }
  })();
  if (nodeReady) {
    console.log(`[node] 已有 ${NODE_VERSION}，跳过`);
  } else {
    const nodeArchive = `node-${NODE_VERSION}-win-x64.zip`;
    extract(download(`https://nodejs.org/dist/${NODE_VERSION}/${nodeArchive}`, nodeArchive), nodeDir, { strip: 1 });
  }
  const npmCli = path.join(tools, "node", "node_modules", "npm", "bin", "npm-cli.js");
  console.log("[node] " + execFileSync(node, ["-v"], { encoding: "utf8" }).trim());

  // 2) 自动化工具链（随包预解压、开箱即用）。CloakBrowser 明确不在其中。
  const prefix = path.join(tools, "npm-global");
  const env = {
    PATH: [path.join(tools, "node"), prefix, process.env.PATH].join(path.delimiter),
    NO_UPDATE_NOTIFIER: "1",
    CLOAKBROWSER_CACHE_DIR: path.join(tools, "cloak-cache"),
    CLOAKBROWSER_AUTO_UPDATE: "false",
    PLAYWRIGHT_BROWSERS_PATH: path.join(tools, "pw-browsers"),
  };
  run(node, [
    npmCli, "install", "-g", "--prefix", prefix,
    "--registry=https://registry.npmjs.org",
    // ⛔ npm 11 起默认**不跑**依赖的 install 脚本（实测只打 warn 就跳过），而 nuphus-mcp 的
    //    postinstall（bin/check.js）会校验平台原生二进制是否就位 —— 跳过它等于放行一个坏包。
    //    与 mac 侧同一处置（那边对 arm64 也显式放行）。
    "--allow-scripts=@nuphus/nuphus-mcp",
    `@nuphus/nuphus-mcp@${NUPHUS_VERSION}`, `@playwright/cli@${PLAYWRIGHT_CLI_VERSION}`, `playwright-core@${PLAYWRIGHT_CORE_VERSION}`,
  ], env);

  // 3) VS Code CLI（latest 口径，已就位就跳过）
  const vscodeCode = path.join(tools, "vscode-cli", "code.exe");
  if (fs.existsSync(vscodeCode)) {
    console.log("[vscode-cli] 已存在，跳过");
  } else {
    const vscodeArchive = download("https://update.code.visualstudio.com/latest/cli-win32-x64/stable", "vscode-cli-win32-x64.zip");
    extract(vscodeArchive, path.join(tools, "vscode-cli"));
  }

  // 4) cloudflared（远程接入隧道）。已就位就跳过：它是「latest」口径，本机重跑没必要再拉 52MB
  const cloudflaredTarget = path.join(tools, "cloudflared.exe");
  if (fs.existsSync(cloudflaredTarget) && fs.statSync(cloudflaredTarget).size > 0) {
    console.log("[cloudflared] 已存在，跳过下载");
  } else {
    const cloudflared = download(
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe",
      "cloudflared-windows-amd64.exe",
    );
    fs.copyFileSync(cloudflared, cloudflaredTarget);
  }

  // 5) ponytail 写代码模式插件源码（应用「开发工具」页把它种进引擎）
  const ponytailArchive = download(
    `https://github.com/DietrichGebert/ponytail/archive/refs/tags/${PONYTAIL_VERSION}.tar.gz`,
    `ponytail-${PONYTAIL_VERSION}.tar.gz`,
  );
  extract(ponytailArchive, path.join(tools, "ponytail-plugin"), { strip: 1 });

  // 6) nuphus-call 命令行桥 + pwsh 无窗口桥
  writeNuphusCallShim(prefix);
  buildHeadlessBridge();

  // 7) 硬校验：缺任何一项都等于发坏包（electron-builder 对缺失的 extraResources 源是**静默跳过**）
  const required = [
    ["node/node.exe", "随包 Node"],
    ["npm-global/node_modules/@nuphus/nuphus-mcp/package.json", "Nuphus 桌面自动化"],
    ["npm-global/node_modules/@playwright/cli/package.json", "Playwright CLI"],
    ["npm-global/nuphus-call.cmd", "nuphus-call 命令行桥"],
    ["vscode-cli/code.exe", "VS Code CLI"],
    ["cloudflared.exe", "cloudflared"],
    ["ponytail-plugin/.codex-plugin", "ponytail 插件源"],
    ["pwsh-headless/pwsh.exe", "pwsh 无窗口桥"],
  ];
  const missing = required.filter(([rel]) => !fs.existsSync(path.join(tools, rel)));
  if (missing.length) throw new Error("工具链不齐：" + missing.map(([rel, label]) => `${label}(${rel})`).join(" / "));

  fs.writeFileSync(path.join(tools, "win-runtime-manifest.json"), JSON.stringify({
    platform: process.platform, arch: process.arch, node: NODE_VERSION,
    nuphus: NUPHUS_VERSION, playwrightCli: PLAYWRIGHT_CLI_VERSION, playwrightCore: PLAYWRIGHT_CORE_VERSION,
    ponytail: PONYTAIL_VERSION, source: process.env.GITHUB_SHA || "",
    // cloakbrowser 09-16 起不随包（按需下载），故不记入随包清单
  }, null, 2));

  console.log(`[done] 随包工具链已就绪：${tools}`);
  console.log("      下一步：node scripts/verify-packaged-tools.cjs " + path.relative(repoSource, tools));
}

main().catch((error) => { console.error("[fail] " + error.message); process.exitCode = 1; });
