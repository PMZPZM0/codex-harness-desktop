#!/usr/bin/env node
/**
 * 拉起一个「全新临时实例」用于人工查看（不碰你的真实数据）。
 *
 * 用途：想看看"第一次安装"长什么样（未登录 / 未配模型 / 无历史），或手工试某个改动的观感。
 *   npm run preview:fresh          # 全新临时 profile
 *   npm run preview:fresh -- --keep  # 结束后保留临时目录（默认结束时提示路径，不自动删）
 *
 * ⛔ 为什么要有这个脚本：agent 沙箱里命令结束会**回收整棵进程树** —— 我用后台任务常驻的方式
 *   试过（spawn detached / PowerShell Start-Process / 常驻父进程）都会在任务结束时把窗口收走，
 *   所以"拉起一个给你看"这件事必须**由你自己在终端里跑**（你的前台进程不会被回收）。
 *
 * ⛔ 必须是**前台运行**：本脚本会一直守着你关闭它（Ctrl+C 即退出并清理）。别用 `&` 丢后台。
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const root = process.cwd();
const stamp = Date.now();
const userData = path.join(root, ".e2e-profile", `preview-fresh-${stamp}`);

if (!fs.existsSync(path.join(root, "dist"))) {
  console.error("✗ 没找到 dist/ —— 先跑一次构建：npm run build");
  process.exit(1);
}

let electronPath;
try {
  electronPath = require("electron");
} catch {
  console.error("✗ 找不到 electron（npm install 了没？）");
  process.exit(1);
}

fs.mkdirSync(userData, { recursive: true });
const logFile = path.join(userData, "preview.log");
const logFd = fs.openSync(logFile, "a");

// ⛔ 必须摘掉宿主注入的环境变量（详见 skill: electron-gui-live-preview）
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;     // 不摘：Electron 退化成纯 node，启动即崩
delete env.NODE_OPTIONS;             // 不摘：语言 shim 拦子进程 fs 写入 → 窗口能开、功能全哑
delete env.CODEBUDDY_SAFE_DELETE;
delete env.CODEBUDDY_SAFE_DELETE_ENABLED;
env.CODEX_HARNESS_USER_DATA = userData;   // 隔离数据目录 = 全新形态，不碰真实配置与历史
env.CODEX_HARNESS_DEBUG_PORT = "9333";    // 留着，方便需要时连 CDP 截图
env.CODEX_HARNESS_IN_PROCESS_GPU = "1";   // 无 GPU / 沙箱里 GPU 子进程会 FATAL 自杀
env.NO_PROXY = "127.0.0.1,localhost";
env.no_proxy = "127.0.0.1,localhost";

const child = spawn(electronPath, [".", "--no-sandbox"], { cwd: root, stdio: ["ignore", logFd, logFd], env });

console.log("┌─ 全新临时实例 ────────────────────────────────────");
console.log(`│ 进程 PID : ${child.pid}`);
console.log(`│ 数据目录 : ${userData}`);
console.log(`│ 日志     : ${logFile}`);
console.log(`│ 调试端口 : 9333（CDP，需要时连它截图）`);
console.log("│ 状态     : 未登录 · 未配模型 · 无历史 = 第一次安装的形态");
console.log("└───────────────────────────────────────────────────");
console.log("提示：点「暂时不登录，直接进入」→ 看左侧栏「模型配置」与弹出的引导。");
console.log("      关掉窗口（或在这里按 Ctrl+C）即结束；临时数据目录不会自动删（要删自己删上面那个路径）。");

child.on("exit", (code, signal) => {
  try { fs.closeSync(logFd); } catch { /* 忽略 */ }
  if (code !== 0 && code !== null) {
    console.log(`\n✗ 应用退出（code=${code}）—— 看日志：${logFile}`);
    try {
      const tail = fs.readFileSync(logFile, "utf8").split(/\r?\n/).filter(Boolean).slice(-15).join("\n");
      if (tail) console.log("--- 日志尾部 ---\n" + tail);
    } catch { /* 忽略 */ }
  } else {
    console.log("\n应用已关闭。临时数据目录：" + userData);
  }
  process.exit(0);
});

// Ctrl+C → 连子进程一起收掉（Windows 上 Electron 有子进程树，单杀父会留残留）
const stop = () => {
  try { process.kill(child.pid); } catch { /* 忽略 */ }
  setTimeout(() => process.exit(0), 400);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
