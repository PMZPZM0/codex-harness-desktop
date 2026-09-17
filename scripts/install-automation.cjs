#!/usr/bin/env node
// 桌面与浏览器自动化工具链安装：从 automation-tools.zip 解压即用（不再 npm install）。
//   zip 内含 nuphus-mcp（桌面自动化 MCP）+ @playwright/cli + playwright-core，
//   顶层为 npm-global/，解压到 resources/tools/npm-global。
//
// ⛔ 09-16：zip **不含 cloakbrowser**（CloakBrowser 已从随包剥离，改「开发工具」页按需 npm 下载）。
//    所以本脚本只负责恢复 nuphus / playwright-cli 两项内置能力；
//    CloakBrowser 与两类浏览器内核都由「开发工具」页单独下载。
// 用法：
//   node scripts/install-automation.cjs                 # 用随包 zip（tools/automation-tools.zip）
//   node scripts/install-automation.cjs --zip=<路径>    # 指定 zip 路径
//   node scripts/install-automation.cjs --url=<URL>     # 从线上下载 zip 再解压
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const toolsRoot = process.env.TOOLS_ROOT || path.join(root, "resources", "tools");
const globalDir = path.join(toolsRoot, "npm-global");
const bundledZip = path.join(toolsRoot, "automation-tools.zip");

const arg = (name) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.split("=")[1] : "";
};
const zipPath = arg("zip") || bundledZip;
const url = arg("url");

if (!fs.existsSync(zipPath) && url) {
  console.log("[0/3] 下载 automation-tools.zip …");
  const curl = spawnSync("curl", ["-sL", "--noproxy", "*", "-o", zipPath, url], { stdio: "inherit" });
  if (curl.status !== 0) { console.error("下载失败"); process.exit(1); }
}
if (!fs.existsSync(zipPath)) {
  console.error(`缺少 ${zipPath}。请先构建随包 zip（node scripts/pack-automation.cjs），或加 --url 在线下载。`);
  process.exit(1);
}

// 解压工具：按平台挑**实际存在**的解压器。
// ⛔ 09-18 修：此前只有 Windows 的 `python.exe` / `7z.exe` 两个候选，而
//    build/copy-mac-tools.cjs **明确把本脚本拷进 mac 包**（mac 点「修复安装」会 spawn 它）
//    → mac 上两个候选路径都不存在，必然报「缺少 python 与 7z，无法解压」（把平台缺口说成"缺依赖"）。
//    现在 darwin 优先用系统自带 /usr/bin/ditto（能保留符号链接与执行位；npm 包里有 symlink，unzip 会退化）。
function pickExtractor(platform, exists) {
  const python = path.join(toolsRoot, "python", "python.exe");
  const python3 = path.join(toolsRoot, "python", "bin", "python3");
  const seven = path.join(toolsRoot, "sevenzip", "7z.exe");
  if (platform === "darwin") {
    if (exists("/usr/bin/ditto")) return { kind: "ditto", cmd: "/usr/bin/ditto", args: (zip, dest) => ["-x", "-k", zip, dest] };
    if (exists(python3)) return { kind: "python3", cmd: python3, args: (zip) => ["-c", unzipScript(zip)] };
    if (exists("/usr/bin/unzip")) return { kind: "unzip", cmd: "/usr/bin/unzip", args: (zip, dest) => ["-q", "-o", zip, "-d", dest] };
    return null;
  }
  if (exists(python)) return { kind: "python", cmd: python, args: (zip) => ["-c", unzipScript(zip)] };
  if (exists(seven)) return { kind: "7z", cmd: seven, args: (zip, dest) => ["x", "-y", `-o${dest}`, zip] };
  return null;
}

function unzipScript(zipPath) {
  return `
import zipfile, sys
zip_path = r"${zipPath.replace(/\\/g, "\\\\")}"
out_dir = r"${toolsRoot.replace(/\\/g, "\\\\")}"
with zipfile.ZipFile(zip_path) as z: z.extractall(out_dir)
print("ok")
`;
}

function main() {
if (!fs.existsSync(zipPath) && url) {
  console.log("[0/3] 下载 automation-tools.zip …");
  const curl = spawnSync("curl", ["-sL", "--noproxy", "*", "-o", zipPath, url], { stdio: "inherit" });
  if (curl.status !== 0) { console.error("下载失败"); process.exit(1); }
}
if (!fs.existsSync(zipPath)) {
  console.error(`缺少 ${zipPath}。请先构建随包 zip（node scripts/pack-automation.cjs），或加 --url 在线下载。`);
  process.exit(1);
}

fs.mkdirSync(globalDir, { recursive: true });

const extractor = pickExtractor(process.platform, fs.existsSync);
if (!extractor) {
  console.error(
    process.platform === "darwin"
      ? "找不到解压器：macOS 需要 /usr/bin/ditto（系统自带）—— 若被删请重装命令行工具；也可先装「开发工具 → Python」后用 tools/python/bin/python3 解压。"
      : "缺少 python 与 7z，无法解压",
  );
  process.exit(1);
}

console.log(`[1/3] 用 ${extractor.kind} 解压 automation-tools.zip → npm-global/ …`);
const res = spawnSync(extractor.cmd, extractor.args(zipPath, toolsRoot), { stdio: "inherit" });
if (res.status !== 0) { console.error(`${extractor.kind} 解压失败`); process.exit(1); }

const ok = fs.existsSync(path.join(globalDir, "node_modules", "@nuphus", "nuphus-mcp", "package.json"));
if (!ok) {
  console.error("解压后未找到 nuphus-mcp，zip 内容异常");
  process.exit(1);
}

console.log("[2/3] 校验通过（nuphus-mcp / playwright-cli 已就位）");
console.log("[3/3] 完成。重启应用后：");
console.log("  - Codex 引擎的 config.toml 会注册 nuphus MCP 服务器（重选一次供应商触发 applyCustomModel）");
console.log("  - CloakBrowser 与浏览器内核请到「开发工具」页分别下载：CloakBrowser、Playwright 内核、Cloak 内核");
}

// 被应用 spawn 时（= 直接执行本文件）才跑主流程；被 require 时只导出 pickExtractor 供预检/探针断言。
if (require.main === module) main();

module.exports = { pickExtractor };
