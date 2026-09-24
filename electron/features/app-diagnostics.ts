/**
 * app-diagnostics（09-22 架构改造：从 electron/main.ts 组合根按域拆出，纯搬迁）
 *
 * 域：**应用级诊断与数据管理** —— 环境自检（/doctor）、引擎信息（/debug）、
 *     存储占用统计与缓存清理（设置 → 数据与统计）、性能计数快照、应用重启。
 * 搬出符号：commandOutput / sizeLabel / fileStat / dirEntries / engineLogFile / dirSize +
 *           IPC handler app:userData / app:home-dir / app:doctor / app:storage-info /
 *           app:storage-clear / app:perf-counters / app:engine-info / app:relaunch。
 * 消费方：main.ts（import 回 fileStat / sizeLabel / dirEntries）、渲染层 /doctor 与设置页。
 *
 * 代码与原地逐字一致（仅顶部 import、文件头注释、末尾 export 清单）。
 * 跨域符号经 `import … from "../main"` 取用 —— **活绑定**（TS→CJS 编译成 `main_1.X` 属性访问），
 * 且**只在 handler 回调体内求值**（模块体不碰跨域符号）⇒ 不受 main.ts 模块体执行顺序影响
 * （第 2 轮 userData 漂移事故的复发防线：main.ts 的 `const codexHome = path.join(app.getPath(...))`
 *  是模块体语句，本模块在其之前被 import 加载 —— 顶层求值会拿到错的 userData）。
 * 注册时机不变：main.ts 模块加载期 import 本文件 ⇒ ipcMain.handle 立即执行（早于 whenReady）。
 */
import { app, ipcMain, systemPreferences } from "electron";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { bundledGit, bundledPython, npmGlobalRoot, toolchainEnv, toolsRoot } from "../toolchain";
import { codexBinaryPath } from "../codex-server";
import { codexHome, customModelFile, customModelsFile, server } from "../runtime-refs";
import { enrichScanCountSnapshot } from "../main";
import { engineDebugLogPath, imagesDir as resolveImagesDir } from "../user-data-paths";
ipcMain.handle("app:userData", () => app.getPath("userData"));
ipcMain.handle("app:home-dir", () => os.homedir());
// ── 内置斜杠命令支撑：/doctor（环境诊断）、/debug（引擎信息）、/export（导出会话）、
//    /bashes（后台终端）、/plugin-validate（插件目录校验）────────────────────────
/** 跑一次外部命令取输出，带超时，失败返回空串（诊断用，绝不抛错） */
function commandOutput(binary: string, args: string[], timeoutMs = 6000): Promise<string> {
  return new Promise((resolve) => {
    let done = false;
    let out = "";
    const finish = (value: string) => { if (done) return; done = true; clearTimeout(timer); resolve(value.trim()); };
    const timer = setTimeout(() => { try { child?.kill(); } catch { /* 已退出 */ } finish(out || "（超时未返回）"); }, timeoutMs);
    let child: ReturnType<typeof spawn> | undefined;
    try {
      child = spawn(binary, args, { windowsHide: true, env: toolchainEnv() });
      child.stdout?.on("data", (chunk) => { out += String(chunk); });
      child.stderr?.on("data", (chunk) => { out += String(chunk); });
      child.on("error", () => finish(""));
      child.on("close", () => finish(out));
    } catch { finish(""); }
  });
}
function sizeLabel(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}
function fileStat(target: string) {
  try { return statSync(target); } catch { return null; }
}
function dirEntries(target: string) {
  try { return readdirSync(target); } catch { return null; }
}
function engineLogFile() {
  for (const name of ["logs_2.sqlite", "logs_1.sqlite", "logs.sqlite"]) {
    const stat = fileStat(path.join(codexHome, name));
    if (stat) return { path: path.join(codexHome, name), size: stat.size, modifiedAt: stat.mtimeMs };
  }
  return null;
}
ipcMain.handle("app:doctor", async (_event, input: { cwd?: string } = {}) => {
  const checks: { label: string; ok: boolean; detail: string }[] = [];
  checks.push({
    label: "应用", ok: true,
    detail: `Codex Harness Desktop ${app.getVersion()} · Electron ${process.versions.electron} · Node ${process.versions.node} · ${process.platform}/${process.arch}`,
  });
  let binary = "";
  try { binary = codexBinaryPath(); } catch { binary = ""; }
  const binaryOk = Boolean(binary) && existsSync(binary);
  checks.push({ label: "引擎二进制", ok: binaryOk, detail: binaryOk ? binary : "未找到 codex 引擎二进制（重新安装 @openai/codex 依赖）" });
  if (binaryOk) {
    const version = await commandOutput(binary, ["--version"]);
    checks.push({ label: "引擎版本", ok: Boolean(version), detail: version || "读取版本失败" });
  }
  checks.push({ label: "引擎服务", ok: server.running, detail: server.running ? "app-server 子进程运行中" : "app-server 未运行——发起一次对话会自动拉起" });
  const configStat = fileStat(path.join(codexHome, "config.toml"));
  checks.push({
    label: "引擎配置", ok: Boolean(configStat),
    detail: configStat ? `config.toml · ${sizeLabel(configStat.size)} · 更新于 ${new Date(configStat.mtimeMs).toLocaleString("zh-CN")}` : `${codexHome}\\config.toml 不存在`,
  });
  let modelOk = false;
  let modelDetail = "未配置自定义模型（/model 打开模型设置）";
  try {
    const raw = JSON.parse(readFileSync(existsSync(customModelsFile) ? customModelsFile : customModelFile, "utf8"));
    const list = Array.isArray(raw) ? raw : (raw?.providers ?? [raw]).filter(Boolean);
    const enabled = list.filter((entry: any) => entry?.enabled !== false);
    modelOk = enabled.length > 0;
    modelDetail = modelOk
      ? `${enabled.length}/${list.length} 个模型服务启用 · ${enabled.slice(0, 3).map((entry: any) => `${entry.name ?? entry.id}/${entry.model ?? ""}`).join("、")}`
      : `已配置 ${list.length} 个模型服务，但全部停用`;
  } catch { /* 尚未配置模型 */ }
  checks.push({ label: "模型", ok: modelOk, detail: modelDetail });
  const cwd = input?.cwd ? String(input.cwd) : "";
  checks.push({ label: "工作区", ok: Boolean(cwd) && existsSync(cwd), detail: cwd ? (existsSync(cwd) ? cwd : `${cwd}（目录已不存在）`) : "未选择工作区（/cd 选择目录）" });
  if (cwd && existsSync(cwd)) {
    const git = bundledGit() || "git";
    const version = await commandOutput(git, ["--version"], 4000);
    const branch = version ? await commandOutput(git, ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], 4000) : "";
    checks.push({
      label: "Git", ok: Boolean(version),
      detail: version ? `${version}${branch && !branch.includes("fatal") ? ` · 分支 ${branch}` : " · 当前目录不是 git 仓库"}` : "未检测到 git（应用内置或系统 PATH 中均找不到）",
    });
  }
  const log = engineLogFile();
  checks.push({
    label: "引擎日志", ok: !log || log.size < 200 * 1024 * 1024,
    detail: log ? `${path.basename(log.path)} · ${sizeLabel(log.size)}${log.size > 200 * 1024 * 1024 ? "（偏大，可在设置里清理 codex-home）" : ""}` : "暂无日志文件",
  });
  const toolRoot = toolsRoot();
  const modulesDir = npmGlobalRoot();
  checks.push({
    label: "自动化工具链", ok: Boolean(modulesDir) && existsSync(modulesDir),
    detail: modulesDir ? `${modulesDir}${existsSync(modulesDir) ? " · 已安装" : " · 未安装（npm 包缺失）"}` : "未找到 resources/tools",
  });
  if (process.platform === "darwin") {
    const accessibility = systemPreferences.isTrustedAccessibilityClient(false);
    const screen = systemPreferences.getMediaAccessStatus("screen");
    checks.push({
      label: "macOS 辅助功能权限", ok: accessibility,
      detail: accessibility ? "已授权键鼠和窗口控制" : "请在系统设置 → 隐私与安全性 → 辅助功能中允许本应用及 Nuphus",
    });
    checks.push({
      label: "macOS 屏幕录制权限", ok: screen === "granted",
      detail: screen === "granted" ? "已授权屏幕捕获" : "请在系统设置 → 隐私与安全性 → 屏幕录制中允许本应用及 Nuphus，授权后重新启动应用",
    });
  }
  const git = bundledGit();
  const python = bundledPython();
  checks.push({ label: "Git 运行时", ok: Boolean(git), detail: git || "未找到 Git（请重新安装应用工具包）" });
  checks.push({ label: "Python 运行时", ok: Boolean(python), detail: python || "未找到 Python（请重新安装应用工具包）" });
  if (python) {
    const tk = await commandOutput(python, ["-c", "import tkinter; print('Tk ' + str(tkinter.TkVersion))"], 5000);
    checks.push({ label: "Python Tkinter", ok: Boolean(tk), detail: tk || "内置 Python 已存在，但 Tkinter/Tcl/Tk 组件缺失" });
  }
  const free = Math.round(os.freemem() / 1024 ** 3 * 10) / 10;
  checks.push({ label: "内存", ok: free >= 1, detail: `可用物理内存 ${free} GB / 共 ${(os.totalmem() / 1024 ** 3).toFixed(1)} GB` });
  return { checks, at: Date.now() };
});
// ── 数据管理 / 缓存清理（设置 → 数据与统计 → 数据管理） ──
/** 递归统计目录字节数（忽略不可读项） */
async function dirSize(root: string): Promise<number> {
  let total = 0;
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(root, entry.name);
      try {
        if (entry.isDirectory()) total += await dirSize(full);
        else if (entry.isFile()) total += (await fs.stat(full)).size;
        // 符号链接等跳过，避免重复计数
      } catch { /* 忽略不可读项 */ }
    }
  } catch { /* 目录不存在/无权限 */ }
  return total;
}
ipcMain.handle("app:storage-info", async () => {
  const ud = app.getPath("userData");
  /* ⛔ 09-22 收口：images/日志路径的唯一真相源在 ../user-data-paths（惰性求值）*/
  const imagesDir = resolveImagesDir();
  const engineLog = engineDebugLogPath();
  // ⛔ 09-16 修 Bug 7：真实 rollout 落在 `codexHome/sessions/` + `archived_sessions/`
  //    （`threads.rollout_path` 就是 `<CH>/sessions/2026/09/14/rollout-*.jsonl`）。
  //    旧实现量的是 `codexHome/rollouts` —— 那个目录**根本不存在**，`dirSize` 对不存在的目录
  //    catch 后返回 0 ⇒ 设置页「会话记录」占用**结构上不可能正确**（恒为 0）。
  //    同项目的 thread-backup.ts 用的就是正确路径，这里是笔误不是有意。
  const rolloutDirs = [path.join(codexHome, "sessions"), path.join(codexHome, "archived_sessions")];
  const [imagesBytes, engineLogBytes, rolloutsBytes] = await Promise.all([
    dirSize(imagesDir),
    (async () => { try { return (await fs.stat(engineLog)).size; } catch { return 0; } })(),
    Promise.all(rolloutDirs.map((dir) => dirSize(dir))).then((parts) => parts.reduce((sum, part) => sum + part, 0)),
  ]);
  return {
    items: [
      // rollout 原档 = 全部会话历史，绝不在此处提供删除（清了就丢记录），仅展示占用
      { key: "rollouts", label: "会话记录（rollout 原档，含全部历史）", bytes: rolloutsBytes, deletable: false },
      { key: "images", label: "本地图片缩略图缓存", bytes: imagesBytes, deletable: true },
      { key: "engine-log", label: "引擎诊断日志（黑匣子）", bytes: engineLogBytes, deletable: true },
    ],
    userData: ud,
    engineLog,
    imagesDir,
  };
});

ipcMain.handle("app:storage-clear", async (_event, target: "engine-log" | "images") => {
  const ud = app.getPath("userData");
  if (target === "engine-log") {
    await fs.rm(engineDebugLogPath(), { force: true });
    return { ok: true, target };
  }
  if (target === "images") {
    await fs.rm(resolveImagesDir(), { recursive: true, force: true });
    return { ok: true, target };
  }
  return { ok: false, error: "未知清理目标" };
});

ipcMain.handle("app:perf-counters", () => enrichScanCountSnapshot());

ipcMain.handle("app:engine-info", async () => {
  let binary = "";
  try { binary = codexBinaryPath(); } catch { binary = ""; }
  const version = binary && existsSync(binary) ? await commandOutput(binary, ["--version"]) : "";
  const entries = dirEntries(codexHome) ?? [];
  const databases = entries
    .filter((name) => name.endsWith(".sqlite"))
    .map((name) => ({ name, size: fileStat(path.join(codexHome, name))?.size ?? 0 }))
    .sort((a, b) => b.size - a.size);
  return {
    codexHome,
    binary,
    binaryExists: Boolean(binary) && existsSync(binary),
    version,
    running: server.running,
    userData: app.getPath("userData"),
    agentsMd: Boolean(fileStat(path.join(codexHome, "AGENTS.md"))),
    configToml: Boolean(fileStat(path.join(codexHome, "config.toml"))),
    logFile: engineLogFile(),
    databases: databases.slice(0, 8),
    sessions: (dirEntries(path.join(codexHome, "sessions"))?.length ?? 0),
    archived: (dirEntries(path.join(codexHome, "archived_sessions"))?.length ?? 0),
  };
});

ipcMain.handle("app:relaunch", () => {
  app.relaunch();
  app.exit(0);
});

/** 工具函数对 features/main 侧开放（fs:read / fs:exists / re-export 消费方）。 */
export { commandOutput, dirEntries, dirSize, engineLogFile, fileStat, sizeLabel };
