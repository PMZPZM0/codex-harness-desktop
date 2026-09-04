#!/usr/bin/env node
// 一键安装 Codex Harness 的自动化工具链到 resources/tools/npm-global：
//   1. nuphus-mcp     桌面自动化 MCP（屏幕/窗口/键鼠/剪贴板/OCR + Chrome CDP，38 工具）
//   2. @playwright/cli 浏览器自动化命令行（open/snapshot/click/type/screenshot）
//   3. cloakbrowser   反检测指纹浏览器（Playwright API 直接替换）
//   4. playwright-core cloakbrowser 的驱动依赖
// 用法：node scripts/install-automation.cjs [--proxy=http://127.0.0.1:7897]
// 网络说明：默认走 npmmirror 国内镜像；npm 官方源被断流时可加 --proxy 走 Clash。
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const toolsRoot = process.env.TOOLS_ROOT || path.join(root, "resources", "tools");
const nodeDir = path.join(toolsRoot, "node");
const globalDir = path.join(toolsRoot, "npm-global");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const proxy = (process.argv.find((a) => a.startsWith("--proxy=")) || "").split("=")[1];

if (!fs.existsSync(path.join(nodeDir, "node.exe"))) {
  console.error("缺少内置 Node（resources/tools/node）。先运行 scripts/install-runtimes.cjs。");
  process.exit(1);
}
fs.mkdirSync(globalDir, { recursive: true });

const npmArgs = [
  "install", "-g",
  "--prefix", globalDir,
  "--registry=https://registry.npmmirror.com",
  "--allow-scripts=@nuphus/nuphus-mcp",
  "@nuphus/nuphus-mcp", "@playwright/cli@latest", "cloakbrowser", "playwright-core",
];
if (proxy) npmArgs.push("--proxy", proxy, "--https-proxy", proxy);

console.log("[1/3] 安装 npm 包（nuphus-mcp / playwright-cli / cloakbrowser）…");
const install = spawnSync(path.join(nodeDir, "node.exe"), [path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"), ...npmArgs], { stdio: "inherit" });
if (install.status !== 0) process.exit(install.status || 1);

const cloakCache = path.join(toolsRoot, "cloak-cache");

console.log("[2/3] 下载 CloakBrowser 反检测 Chromium 内核（约 200MB，内置缓存 resources/tools/cloak-cache）…");
console.log("      也可用更稳的方式：node scripts/download-cloak.cjs（断点续传 + 代理隧道 + 校验）");
const cloak = spawnSync(process.execPath, [path.join(globalDir, "node_modules", "cloakbrowser", "dist", "cli.js"), "install"], {
  stdio: "inherit",
  env: {
    ...process.env,
    PATH: [path.join(globalDir), nodeDir, process.env.PATH || ""].join(";"),
    CLOAKBROWSER_CACHE_DIR: cloakCache,
    CLOAKBROWSER_AUTO_UPDATE: "0",
  },
});
if (cloak.status !== 0) console.error("cloakbrowser install 失败（可执行 node scripts/download-cloak.cjs 重试）");

console.log("[3/3] 完成。重启应用后：");
console.log("  - Codex 引擎的 config.toml 会注册 nuphus MCP 服务器（重选一次供应商触发 applyCustomModel）");
console.log("  - playwright-cli 首次 open 时会自动下载 Playwright 浏览器内核");
