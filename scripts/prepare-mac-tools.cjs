const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

if (process.platform !== "darwin") throw new Error("Run on the target macOS architecture");
const tools = path.resolve("resources/tools");
const downloads = path.resolve(".test-tmp/mac-downloads");
fs.mkdirSync(downloads, { recursive: true });
fs.mkdirSync(tools, { recursive: true });
const arch = process.arch;
if (!["arm64", "x64"].includes(arch)) throw new Error(`Unsupported architecture: ${arch}`);
const run = (file, args, env = {}) => execFileSync(file, args, {
  stdio: "inherit", env: { ...process.env, ...env }, timeout: 20 * 60_000,
});
async function json(url) {
  // CI runner IP 共享，无认证调 api.github.com 会撞 60/h 限流（403）——带 token 提到 1000/h
  const headers = {};
  if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN || process.env.GH_TOKEN}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(60000), headers });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}
function download(url, name) {
  const file = path.join(downloads, name);
  run("curl", ["--fail", "--location", "--retry", "3", "--max-time", "600", "--output", file, url]);
  return file;
}
function tar(url, name, destination, strip = false) {
  const file = download(url, name);
  fs.mkdirSync(destination, { recursive: true });
  run("tar", ["-xf", file, "-C", destination, ...(strip ? ["--strip-components=1"] : [])]);
}
async function main() {
  const nodeVersion = "v24.19.0";
  const nodeArchive = `node-${nodeVersion}-darwin-${arch}.tar.gz`;
  tar(`https://nodejs.org/dist/${nodeVersion}/${nodeArchive}`, nodeArchive, path.join(tools, "node"), true);
  const node = path.join(tools, "node/bin/node");
  const npm = path.join(tools, "node/lib/node_modules/npm/bin/npm-cli.js");
  const prefix = path.join(tools, "npm-global");
  const env = {
    PATH: `${tools}/node/bin:${prefix}/bin:${process.env.PATH}`,
    NO_UPDATE_NOTIFIER: "1",
    CLOAKBROWSER_CACHE_DIR: path.join(tools, "cloak-cache"),
    CLOAKBROWSER_AUTO_UPDATE: "false",
    PLAYWRIGHT_BROWSERS_PATH: path.join(tools, "pw-browsers"),
  };
  // x64 没有 nuphus-mcp-osx-x64 平台包，postinstall check 必炸；原生二进制由 cargo 构建提供（tools/nuphus/）
  const npmFlags = arch === "x64"
    ? ["--ignore-scripts"]
    : ["--allow-scripts=@nuphus/nuphus-mcp"];
  // ⛔ 09-16 用户「CloakBrowser 不用内置，按需下载就行」：这里**不再**装 cloakbrowser，
  //    它由应用「开发工具」页按需 npm 下载（npmmirror）。内核（cloak-cache）本来就不随包。
  run(node, [npm, "install", "-g", "--prefix", prefix, "--registry=https://registry.npmjs.org",
    ...npmFlags, "@nuphus/nuphus-mcp@0.2.3", "@playwright/cli@0.1.18",
    "playwright-core@1.58.2"], env);
  const modules = path.join(prefix, "lib/node_modules");
  // Keep the same module layout as the Windows distribution.
  fs.renameSync(modules, path.join(prefix, "node_modules"));
  fs.symlinkSync("../node_modules", modules);
  run(node, [path.join(prefix, "node_modules/@playwright/cli/node_modules/playwright/cli.js"), "install", "chromium"], env);

  if (arch === "x64") {
    const native = path.resolve(".test-tmp/nuphus-src/target/release");
    const destination = path.join(tools, "nuphus");
    fs.mkdirSync(destination, { recursive: true });
    fs.copyFileSync(path.join(native, "nuphus-mcp"), path.join(destination, "nuphus-mcp"));
    fs.chmodSync(path.join(destination, "nuphus-mcp"), 0o755);
    for (const file of fs.readdirSync(native).filter((name) => name.endsWith(".dylib"))) {
      fs.copyFileSync(path.join(native, file), path.join(destination, file));
    }
    // ONNX Runtime 上游已放弃 Intel Mac：1.27 的 NuGet 与 GitHub release 都只有 osx-arm64。
    // 有 dylib 就带上；没有则降级为警告（Intel 版缺语音/OCR 能力，其余功能正常），不再硬失败。
    if (!fs.existsSync(path.join(destination, "libonnxruntime.dylib"))) {
      console.log("[prepare] Intel Mac 无官方 ONNX Runtime 1.27（上游已放弃 osx-x64）：语音/OCR 能力降级，其余功能正常");
    }
  }
  const helper = path.join(prefix, "bin/nuphus-call");
  fs.writeFileSync(helper, '#!/bin/sh\nDIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"\nexec "$DIR/node/bin/node" "$DIR/nuphus-call.mjs" "$@"\n');
  fs.chmodSync(helper, 0o755);
  fs.unlinkSync(path.join(prefix, "bin/nuphus-mcp"));
  fs.writeFileSync(path.join(prefix, "bin/nuphus-mcp"), '#!/bin/sh\nif [ -z "$NUPHUS_BIN" ]; then echo "Start from the application toolchain" >&2; exit 1; fi\nexec "$NUPHUS_BIN" "$@"\n');
  fs.chmodSync(path.join(prefix, "bin/nuphus-mcp"), 0o755);

  const pythonRelease = await json("https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest");
  const triple = arch === "arm64" ? "aarch64" : "x86_64";
  const pythonAsset = pythonRelease.assets.find((asset) =>
    asset.name.startsWith("cpython-3.13.") && asset.name.endsWith(`${triple}-apple-darwin-install_only.tar.gz`));
  if (!pythonAsset) throw new Error("No macOS Python 3.13 standalone runtime");
  tar(pythonAsset.browser_download_url, pythonAsset.name, tools);
  run(path.join(tools, "python/bin/python3"), ["-c", "import tkinter; print('Tk', tkinter.TkVersion)"]);
  run(path.join(tools, "python/bin/python3"), ["-m", "pip", "install", "requests", "httpx", "flask", "fastapi", "playwright"]);
  tar(`https://github.com/PowerShell/PowerShell/releases/download/v7.6.4/powershell-7.6.4-osx-${arch}.tar.gz`,
    "pwsh.tar.gz", path.join(tools, "pwsh"));
  fs.chmodSync(path.join(tools, "pwsh/pwsh"), 0o755);

  // ⛔ cloudflared（手机配对的公网隧道）。Windows 侧由 prepare-windows-tools 下载 cloudflared.exe；
  //    mac 侧此前**完全没有**，而 remote.ts 又写死了 `…/tools/cloudflared.exe` ⇒ mac 上隧道从不启动，
  //    扫码配对只能走局域网（用户报「mac 上手机连不上」类问题的根因之一）。09-17 补齐。
  //    资产：cloudflared-darwin-{amd64|arm64}.tgz，解出来就是单个无后缀二进制，必须补执行位。
  const cfRelease = await json("https://api.github.com/repos/cloudflare/cloudflared/releases/latest");
  const cfAssetName = `cloudflared-darwin-${arch === "arm64" ? "arm64" : "amd64"}.tgz`;
  const cfAsset = cfRelease.assets.find((asset) => asset.name === cfAssetName);
  if (!cfAsset) throw new Error(`cloudflared latest 里没有 ${cfAssetName}`);
  const cloudflaredDir = path.join(tools, "cloudflared");
  tar(cfAsset.browser_download_url, cfAssetName, cloudflaredDir);
  // 归档内层结构若变了（套了一层目录），在解压结果里找回真正的二进制再补执行位
  const cfBinary = path.join(cloudflaredDir, "cloudflared");
  if (!fs.existsSync(cfBinary)) {
    const found = fs.readdirSync(cloudflaredDir, { withFileTypes: true })
      .map((entry) => entry.isDirectory() ? path.join(cloudflaredDir, entry.name, "cloudflared") : "")
      .find((candidate) => candidate && fs.existsSync(candidate));
    if (!found) throw new Error(`cloudflared 解压后找不到可执行文件（${cloudflaredDir}）`);
    fs.renameSync(found, cfBinary);
  }
  fs.chmodSync(cfBinary, 0o755);
  console.log(`[cloudflared] ${cfRelease.tag_name} → ${cfBinary}`);
  tar("https://github.com/DietrichGebert/ponytail/archive/refs/tags/v4.9.0.tar.gz",
    "ponytail.tar.gz", path.join(tools, "ponytail-plugin"), true);
  fs.writeFileSync(path.join(tools, "mac-runtime-manifest.json"), JSON.stringify({
    platform: process.platform, arch, node: nodeVersion, nuphus: "0.2.3",
    // cloakbrowser 09-16 起不随包（按需下载），故不再记入随包清单
    playwrightCli: "0.1.18", python: pythonAsset.name, cloudflared: cfRelease.tag_name, source: process.env.GITHUB_SHA || "",
    helperSha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(tools, "nuphus-call.mjs"))).digest("hex"),
  }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
