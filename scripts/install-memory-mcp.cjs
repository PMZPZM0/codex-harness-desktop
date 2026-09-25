#!/usr/bin/env node
/**
 * 可选的「MCP 记忆服务」按需安装器（@vheins/local-memory-mcp）。
 *
 * ⛔ 设计前提（用户 09-25 明确）：这个服务**不内置**——不进 package.json 依赖、不随包发布，
 *    由用户在 设置 → 记忆 里自主选择是否安装/启用。装到应用 userData 下的独立目录，
 *    卸载就是删目录（与语音模型 `install-voice-models.cjs` 同一套路）。
 *
 * 用法：
 *   node scripts/install-memory-mcp.cjs              # 安装（已装则跳过）
 *   node scripts/install-memory-mcp.cjs --check      # 只查状态（退出码 0=已装可用，2=未装）
 *   node scripts/install-memory-mcp.cjs --uninstall  # 卸载（删目录）
 *   node scripts/install-memory-mcp.cjs --ignore-scripts  # 跳过依赖的 postinstall
 *      ⛔ 什么时候需要它：某些受限环境（CI / 沙箱）禁止依赖的 postinstall 派生子进程
 *         （本机实测：esbuild 的 `node install.js` 会因 spawn 被拦而安装失败）。
 *         正常桌面环境**不要加**这个参数——跳过 postinstall 会让部分原生/平台包缺少构建产物。
 *
 * 落点：<userData>/memory-mcp/（node_modules 在里面），数据库默认由服务端自己决定，
 *       可用 MEMORY_DB_PATH 环境变量覆盖（由调用方在连接器 env 里注入）。
 * 输出：单行 JSON 到 stdout（便于 IPC 解析），人类可读进度走 stderr。
 * 退出码：0=成功/已装；1=失败；2=未安装（仅 --check）。
 */
"use strict";

const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

// 强制清掉宿主注入项（同 e2e harness / 语音模型安装器）
delete process.env.NODE_OPTIONS;
delete process.env.ELECTRON_RUN_AS_NODE;

const args = process.argv.slice(2);
const doCheck = args.includes("--check");
const doUninstall = args.includes("--uninstall");
const ignoreScripts = args.includes("--ignore-scripts");

function userDataRoot() {
  if (process.env.CODEX_HARNESS_USER_DATA) return process.env.CODEX_HARNESS_USER_DATA;
  if (process.platform === "win32") return path.join(process.env.APPDATA || os.homedir(), "Codex Harness Desktop");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Codex Harness Desktop");
  return path.join(os.homedir(), ".config", "Codex Harness Desktop");
}

const ROOT = path.join(userDataRoot(), "memory-mcp");
const SERVER_REL = ["node_modules", "@vheins", "local-memory-mcp", "bin", "mcp-memory-server.js"];
const serverPath = path.join(ROOT, ...SERVER_REL);

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function status() {
  const installed = fs.existsSync(serverPath);
  let version = null;
  try {
    const pkg = path.join(ROOT, "node_modules", "@vheins", "local-memory-mcp", "package.json");
    if (fs.existsSync(pkg)) version = JSON.parse(fs.readFileSync(pkg, "utf8")).version;
  } catch (e) { /* 忽略 */ }
  return { installed, version: version || undefined, root: ROOT, serverPath: installed ? serverPath : undefined };
}

if (doCheck) {
  const s = status();
  emit(s);
  process.exit(s.installed ? 0 : 2);
}

if (doUninstall) {
  try {
    fs.rmSync(ROOT, { recursive: true, force: true });
    emit({ installed: false, removed: true, root: ROOT });
    process.exit(0);
  } catch (e) {
    emit({ installed: true, removed: false, error: String(e.message) });
    process.exit(1);
  }
}

const before = status();
if (before.installed) {
  process.stderr.write(`[memory-mcp] 已安装 v${before.version}，跳过安装\n`);
  emit({ ...before, skipped: true });
  process.exit(0);
}

fs.mkdirSync(ROOT, { recursive: true });
// 独立 package.json：与项目依赖完全隔离（⛔ 不写进项目 package.json）
const manifestPath = path.join(ROOT, "package.json");
if (!fs.existsSync(manifestPath)) {
  fs.writeFileSync(manifestPath, JSON.stringify({
    name: "codex-harness-memory-mcp",
    private: true,
    version: "1.0.0",
    description: "可选安装：@vheins/local-memory-mcp（MCP 记忆服务），由 Codex Harness Desktop 按需装入",
  }, null, 2) + "\n");
}

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const npmArgs = ["install", "@vheins/local-memory-mcp@latest", "--no-audit", "--no-fund"];
if (ignoreScripts) npmArgs.push("--ignore-scripts");
process.stderr.write(`[memory-mcp] 安装到 ${ROOT}\n[memory-mcp] ${npmCmd} ${npmArgs.join(" ")}\n`);

const r = spawnSync(npmCmd, npmArgs, { cwd: ROOT, shell: true, encoding: "utf8", windowsHide: true });
if (r.status !== 0) {
  const tail = String(r.stdout || "").concat(String(r.stderr || "")).split("\n").slice(-6).join("\n");
  process.stderr.write(`[memory-mcp] 安装失败：\n${tail}\n`);
  emit({ installed: false, error: "npm install 失败", detail: tail.slice(0, 600), root: ROOT });
  process.exit(1);
}

const after = status();
if (!after.installed) {
  emit({ installed: false, error: "安装后未找到服务入口", root: ROOT, expect: serverPath });
  process.exit(1);
}
process.stderr.write(`[memory-mcp] 安装完成 v${after.version}\n`);
emit(after);
process.exit(0);
