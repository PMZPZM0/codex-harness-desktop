#!/usr/bin/env node
// 桌面与浏览器自动化工具链安装：从 automation-tools.zip 解压即用（不再 npm install）。
//   zip 内含 nuphus-mcp（桌面自动化 MCP）+ @playwright/cli + cloakbrowser + playwright-core，
//   顶层为 npm-global/，解压到 resources/tools/npm-global。
// 用法：
//   node scripts/install-automation.cjs                 # 用随包 zip（tools/automation-tools.zip）
//   node scripts/install-automation.cjs --zip=<路径>    # 指定 zip 路径
//   node scripts/install-automation.cjs --url=<URL>     # 从线上下载 zip 再解压
// 说明：浏览器内核（Playwright Chromium / Cloak 指纹内核）不随包，由「开发工具」页分别下载。
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

// 解压工具：优先内置 python（zipfile，自带可靠），7z.exe 无 7z.dll 时不可独立解压仅作回退
const seven = path.join(toolsRoot, "sevenzip", "7z.exe");
const python = path.join(toolsRoot, "python", "python.exe");
fs.mkdirSync(globalDir, { recursive: true });

console.log("[1/3] 解压 automation-tools.zip → npm-global/ …");
if (fs.existsSync(python)) {
  const py = `
import zipfile, sys
zip_path = r"${zipPath.replace(/\\/g, "\\\\")}"
out_dir = r"${toolsRoot.replace(/\\/g, "\\\\")}"
with zipfile.ZipFile(zip_path) as z: z.extractall(out_dir)
print("ok")
`;
  const res = spawnSync(python, ["-c", py], { stdio: "inherit" });
  if (res.status !== 0) { console.error("python 解压失败"); process.exit(1); }
} else if (fs.existsSync(seven)) {
  const res = spawnSync(seven, ["x", "-y", `-o${toolsRoot}`, zipPath], { stdio: "inherit" });
  if (res.status !== 0) { console.error("7z 解压失败"); process.exit(1); }
} else {
  console.error("缺少 python 与 7z，无法解压");
  process.exit(1);
}

const ok = fs.existsSync(path.join(globalDir, "node_modules", "@nuphus", "nuphus-mcp", "package.json"));
if (!ok) {
  console.error("解压后未找到 nuphus-mcp，zip 内容异常");
  process.exit(1);
}

console.log("[2/3] 校验通过（nuphus-mcp / playwright-cli / cloakbrowser 已就位）");
console.log("[3/3] 完成。重启应用后：");
console.log("  - Codex 引擎的 config.toml 会注册 nuphus MCP 服务器（重选一次供应商触发 applyCustomModel）");
console.log("  - 浏览器内核请到「开发工具」页分别下载：Playwright Chromium、Cloak 指纹内核");
