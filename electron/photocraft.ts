/**
 * PhotoCraft（11-15；11-17 改为由 Craft 全家桶的 Launcher 安装）——
 * 纯 Rust 的开源 Photoshop 重写（storytold/photocraft，MIT/Apache-2.0）。
 *
 * 宿主只做「识别 + 联动」，**不自己下载安装**（用户令「跟其他应用一样走 Launcher，这边负责识别联动」）：
 *   ① Codex 工具 `photocraft`（features/photocraft-ipc.ts）：调色 / 滤镜 / 转换 / 批量 / 命令发现；
 *   ② MCP 连接器 `[mcp_servers.photocraft]`（custom-model-apply 生成；headless CLI，roots 限 ioRoot）；
 *   ③ 图片卡「在 PhotoCraft 中编辑」：外部 GUI 打开当前文件（openPhotoCraftGui）。
 * CLI / GUI 路径来自 `artcraft.ts` 的安装扫描（Launcher 装在哪都能认）；老版本装到
 * `tools/photocraft` 的仍作为兜底，保证升级后不断档。
 * ⛔ 路径边界：工具读写的文件必须落在可信根（会话工作目录 / userData）内；ioRoot 供 MCP 专用。
 * ⛔ 命令参数是外部输入：命令 id 走白名单正则、params 有字节上限，一律 spawn 参数数组不开 shell。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import { trackRuntimeProc } from "./features/dev-runtimes";
import { writeToolsRoot } from "./toolchain";
import { codexHome } from "./runtime-refs";
import { installedCraftApp } from "./artcraft";

export const PHOTOCRAFT_REPO = "storytold/photocraft";
export const PHOTOCRAFT_HOME = "https://github.com/storytold/photocraft";
/** config.toml 里的 MCP 服务器名（harness 生成，⛔ 不属于「用户手工段」）。 */
export const PHOTOCRAFT_MCP_SERVER = "photocraft";

export type PhotoCraftPaths = {
  /** 老版本（本应用直接装）的目录；新装走 Launcher，这里只作兜底与 ioRoot 锚点。 */
  root: string;
  cli: string;
  gui: string;
  versionFile: string;
  ioRoot: string;
};

/** 平台可执行文件名（Windows 带 .exe；mac/linux 无后缀）。 */
function exeName(base: string): string {
  return process.platform === "win32" ? `${base}.exe` : base;
}

/** 老安装路径 / CLI / GUI / 版本文件 / MCP 专用收发目录。 */
export function photocraftPaths(): PhotoCraftPaths {
  const root = path.join(writeToolsRoot(), "photocraft");
  return {
    root,
    cli: path.join(root, exeName("photocraft-cli")),
    gui: path.join(root, exeName("photocraft")),
    versionFile: path.join(root, "version.txt"),
    ioRoot: path.join(app.getPath("userData"), "photocraft-io"),
  };
}

/** Launcher 里装好的 PhotoCraft（CLI/GUI 都指向它）；没装返回 null。 */
function launcherPhotoCraft(): { dir: string; exePath: string; cliPath: string; version: string } | null {
  try { return installedCraftApp("photocraft"); } catch { return null; }
}

/** 实际安装目录（Launcher 优先；老安装兜底；都没有返回空串）。 */
export function photocraftInstallDir(): string {
  const installed = launcherPhotoCraft();
  if (installed?.dir) return installed.dir;
  const paths = photocraftPaths();
  return existsSync(paths.root) ? paths.root : "";
}

/** 已安装版本（Launcher 装的由 artcraft status 给版本；老安装读 version.txt）。 */
export function photocraftInstalledVersion(): string {
  const installed = launcherPhotoCraft();
  if (installed) return installed.version || "";
  try { return readFileSync(photocraftPaths().versionFile, "utf8").trim(); } catch { return ""; }
}

/** CLI 可用 = Launcher 的 `*-cli.exe` 或老安装的 photocraft-cli。 */
export function photocraftCliPath(): string {
  const installed = launcherPhotoCraft();
  if (installed?.cliPath) return installed.cliPath;
  const paths = photocraftPaths();
  return existsSync(paths.cli) ? paths.cli : "";
}

/** GUI 可用（Launcher 的主程序；老安装 / mac 的 PhotoCraft.app 兜底）。 */
export function photocraftGuiPath(): string {
  const installed = launcherPhotoCraft();
  if (installed?.exePath && /\.exe$/i.test(installed.exePath)) return installed.exePath;
  const paths = photocraftPaths();
  if (existsSync(paths.gui)) return paths.gui;
  if (process.platform === "darwin") {
    for (const candidate of ["/Applications/PhotoCraft.app", "/Applications/PhotoCraft.app/Contents/MacOS/PhotoCraft"]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return "";
}

/** 生成 `[mcp_servers.photocraft]` 段（未安装返回空数组）。由 custom-model-apply 统一拼进 config.toml。 */
export function photocraftMcpSection(): string[] {
  const cli = photocraftCliPath();
  if (!cli) return [];
  const ioRoot = photocraftPaths().ioRoot;
  try { mkdirSync(ioRoot, { recursive: true }); } catch { /* 读目录已存在 / 无权限时不阻断 config 生成 */ }
  const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return [
    `[mcp_servers.${PHOTOCRAFT_MCP_SERVER}]`,
    `command = "${escape(cli)}"`,
    `args = ["mcp", "--no-gpu", "--automation-read-root", "${escape(ioRoot)}", "--automation-write-root", "${escape(ioRoot)}"]`,
    "startup_timeout_sec = 30",
    /* 11-21：引擎侧停用（22KB schema 不进每轮前缀）；宿主 mcp_tools/mcp_call 按需启动。 */
    "enabled = false",
    "",
  ];
}

/** MCP 段当前是否已写进 config.toml（状态展示用；⛔ 不触发引擎重启）。 */
export function photocraftMcpRegistered(): boolean {
  try {
    const text = readFileSync(path.join(app.getPath("userData"), "codex-home", "config.toml"), "utf8");
    return /\[mcp_servers\.photocraft\]/.test(text);
  } catch { return false; }
}

/**
 * 从 config.toml 里**直接删掉** `[mcp_servers.photocraft]`（含子表）并原子替换。
 * ⛔ 卸载 App 后必须走这条：applyCustomModel 的重建时序里可能被跳过，留下指向已删 CLI 的段。
 */
export function removePhotoCraftMcpSection(): boolean {
  const file = path.join(codexHome, "config.toml");
  let text = "";
  try { text = readFileSync(file, "utf8"); } catch { return false; }
  if (!text.includes("[mcp_servers.photocraft")) return false;
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;
  let changed = false;
  for (const line of lines) {
    const header = /^\s*\[([^\]]+)\]/.exec(line);
    if (header) {
      const name = header[1].trim();
      skipping = name === "mcp_servers.photocraft" || name.startsWith("mcp_servers.photocraft.");
      if (skipping) { changed = true; continue; }
    }
    if (skipping) continue;
    kept.push(line);
  }
  if (!changed) return false;
  const tmp = `${file}.photocraft.tmp`;
  writeFileSync(tmp, kept.join("\n"), "utf8");
  renameSync(tmp, file);
  return true;
}

/** 外部 GUI 打开一张图（未安装 GUI 返回错误说明）。 */
export function openPhotoCraftGui(file?: string): { ok: boolean; error?: string } {
  const gui = photocraftGuiPath();
  if (!gui) {
    if (process.platform === "darwin") return { ok: false, error: "mac 版只随 CLI；请从 getartcraft.com 安装 PhotoCraft App 后再试" };
    return { ok: false, error: "PhotoCraft 还没安装：请到「设置 → 开发工具 → Craft 全家桶」用 Launcher 安装 PhotoCraft" };
  }
  try {
    if (gui.endsWith(".app")) {
      spawn("open", ["-a", gui, ...(file ? [file] : [])], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn(gui, file ? [file] : [], { detached: true, stdio: "ignore", windowsHide: false }).unref();
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error)?.message ?? String(error) };
  }
}

/** 跑一次 CLI（参数数组；返回 stdout；非零带 stderr 尾部）。 */
export async function runPhotoCraftCli(args: string[], timeoutMs = 180_000): Promise<{ stdout: string; stderr: string }> {
  const cli = photocraftCliPath();
  if (!cli) throw new Error("PhotoCraft 还没安装：请到「设置 → 开发工具 → Craft 全家桶」用 Launcher 安装它");
  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const done = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error); else resolve({ stdout, stderr });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cli, args, { windowsHide: true });
    } catch (error) { done(error as Error); return; }
    trackRuntimeProc("artcraft", child);
    child.stdout?.on("data", (chunk) => { stdout = (stdout + String(chunk)).slice(-2_000_000); });
    child.stderr?.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-200_000); });
    child.on("error", (error) => done(error));
    const timer = setTimeout(() => { try { child.kill(); } catch { /* 已退出 */ } done(new Error(`PhotoCraft 执行超时（${Math.round(timeoutMs / 1000)}s）`)); }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) done();
      else done(new Error(`PhotoCraft 退出码 ${code}：${(stderr || stdout).trim().slice(-600) || "无输出"}`));
    });
  });
}
