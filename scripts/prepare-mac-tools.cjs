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
  run(node, [npm, "install", "-g", "--prefix", prefix, "--registry=https://registry.npmjs.org",
    ...npmFlags, "@nuphus/nuphus-mcp@0.2.2", "@playwright/cli@0.1.18",
    "cloakbrowser@0.5.9", "playwright-core@1.58.2"], env);
  const modules = path.join(prefix, "lib/node_modules");
  // Keep the same module layout as the Windows distribution.
  fs.renameSync(modules, path.join(prefix, "node_modules"));
  fs.symlinkSync("../node_modules", modules);
  run(node, [path.join(prefix, "node_modules/cloakbrowser/dist/cli.js"), "install"], env);
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
    // build.rs 的 NuGet 下载在 CI 偶发静默失败（只警告）；这里兜底手动提取 osx-x64 的 ONNX Runtime
    if (!fs.existsSync(path.join(destination, "libonnxruntime.dylib"))) {
      console.log("[prepare] cargo 构建未产出 ONNX dylib，改从 NuGet 直接提取");
      const nupkg = download("https://www.nuget.org/api/v2/package/Microsoft.ML.OnnxRuntime/1.27.0", "onnxruntime-x64.nupkg");
      const ortDir = path.resolve(".test-tmp/ort-extract");
      fs.rmSync(ortDir, { recursive: true, force: true });
      run("unzip", ["-o", "-q", nupkg, "runtimes/osx-x64/native/*", "-d", ortDir]);
      const ortNative = path.join(ortDir, "runtimes", "osx-x64", "native");
      for (const file of fs.readdirSync(ortNative)) {
        fs.copyFileSync(path.join(ortNative, file), path.join(native, file));
        fs.copyFileSync(path.join(ortNative, file), path.join(destination, file));
      }
    }
    if (!fs.existsSync(path.join(destination, "libonnxruntime.dylib"))) throw new Error("Missing Intel ONNX runtime");
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
  tar("https://github.com/DietrichGebert/ponytail/archive/refs/tags/v4.9.0.tar.gz",
    "ponytail.tar.gz", path.join(tools, "ponytail-plugin"), true);
  fs.writeFileSync(path.join(tools, "mac-runtime-manifest.json"), JSON.stringify({
    platform: process.platform, arch, node: nodeVersion, nuphus: "0.2.2", cloakbrowser: "0.5.9",
    playwrightCli: "0.1.18", python: pythonAsset.name, source: process.env.GITHUB_SHA || "",
    helperSha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(tools, "nuphus-call.mjs"))).digest("hex"),
  }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
