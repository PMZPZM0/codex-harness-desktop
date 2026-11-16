/**
 * PhotoCraft（11-15）—— 纯 Rust 的开源 Photoshop 重写（storytold/photocraft，MIT/Apache-2.0）。
 *
 * 电脑侧能力：CLI（convert / info / run / batch / commands / mcp）+ 原生 GUI（photocraft.exe）。
 * 宿主提供三层出口：
 *   ① Codex 工具 `photocraft`（features/photocraft-ipc.ts）：调色 / 滤镜 / 转换 / 批量 / 命令发现；
 *   ② MCP 连接器 `[mcp_servers.photocraft]`（custom-model-apply 生成；headless CLI，roots 限 ioRoot）；
 *   ③ 图片卡「在 PhotoCraft 中编辑」：外部 GUI 打开当前文件（openPhotoCraftGui）。
 *
 * ⛔ 只下载官方 GitHub release（镜像序 + SHA256SUMS 校验），不重打包、不搬源码。
 * ⛔ 体积约 137MB ⇒ 按需下载（>50MB 口径），不随包。
 * ⛔ 路径边界：工具读写的文件必须落在可信根（会话工作目录 / userData）内；ioRoot 供 MCP 专用。
 * ⛔ 命令参数是外部输入：命令 id 走白名单正则、params 有字节上限，一律 spawn 参数数组不开 shell。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { mirrorCandidates } from "./gh-mirror";
import { guardedFetch } from "./net-guard";
import { downloadThroughMirrors } from "./mirror-download";
import { emitRuntimeProgress, isCancelRequested, trackRuntimeProc } from "./features/dev-runtimes";
import type { DevRuntimeId } from "./features/dev-runtimes";
import { dirSizeBytes, existingToolPath, tarExecutable, writeToolsRoot } from "./toolchain";
import { codexHome } from "./runtime-refs";

export const PHOTOCRAFT_REPO = "storytold/photocraft";
export const PHOTOCRAFT_HOME = "https://github.com/storytold/photocraft";
/** config.toml 里的 MCP 服务器名（harness 生成，⛔ 不属于「用户手工段」）。 */
export const PHOTOCRAFT_MCP_SERVER = "photocraft";

export type PhotoCraftPaths = {
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

/** 安装目录 / CLI / GUI / 版本文件 / MCP 专用收发目录。 */
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

/** 已安装版本（读不到按未安装）。 */
export function photocraftInstalledVersion(): string {
  try { return readFileSync(photocraftPaths().versionFile, "utf8").trim(); } catch { return ""; }
}

/** CLI 可用 = 文件存在 + 版本文件在（安装以版本文件落盘为最后一步）。 */
export function photocraftCliPath(): string {
  const paths = photocraftPaths();
  return photocraftInstalledVersion() && existsSync(paths.cli) ? paths.cli : "";
}

/** GUI 可用（Windows / Linux release 自带；mac 的 CLI zip 不含 GUI，回落到系统安装的 PhotoCraft.app）。 */
export function photocraftGuiPath(): string {
  const paths = photocraftPaths();
  if (existsSync(paths.gui)) return paths.gui;
  if (process.platform === "darwin") {
    for (const candidate of ["/Applications/PhotoCraft.app", "/Applications/PhotoCraft.app/Contents/MacOS/PhotoCraft"]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return "";
}

/** 平台对应的 portable 资产名（与官方 release 命名一致）。 */
export function photocraftAssetName(version: string): string {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "win32") return `photocraft-${version}-windows-${arch}-portable.zip`;
  if (process.platform === "darwin") return `photocraft-cli-${version}-macos-universal.zip`;
  return `photocraft-${version}-linux-${arch === "arm64" ? "aarch64" : "x86_64"}.tar.gz`;
}

/** 从 SHA256SUMS.txt 里取目标资产的官方哈希（拿不到返回空，不假装校验过）。 */
async function fetchSumsDigest(asset: string, version: string): Promise<string> {
  const url = `https://github.com/${PHOTOCRAFT_REPO}/releases/download/v${version}/SHA256SUMS.txt`;
  for (const candidate of mirrorCandidates(url)) {
    try {
      const res = await guardedFetch(candidate, { signal: AbortSignal.timeout(25_000) }, { timeoutMs: 25_000 });
      if (!res.ok) continue;
      const text = await res.text();
      for (const line of text.split(/\r?\n/)) {
        const match = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
        if (match && match[2].trim() === asset) return match[1].toLowerCase();
      }
    } catch { /* 下一个镜像 */ }
  }
  return "";
}

/** 跑一个解压器（参数数组，不开 shell）；失败带尾部输出。 */
function runTool(exe: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let tail = "";
    const grab = (chunk: unknown) => { tail = `${tail}\n${String(chunk)}`.slice(-2000); };
    try {
      const child = spawn(exe, args, { windowsHide: true });
      child.stdout?.on("data", grab);
      child.stderr?.on("data", grab);
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`解压失败（${code}）：${tail.trim().slice(-600)}`))));
    } catch (error) { reject(error as Error); }
  });
}

/** 递归找 CLI（portable 包可能套一层目录）。 */
async function findCli(root: string, depth = 0): Promise<string> {
  if (depth > 3) return "";
  let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return ""; }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (!entry.isDirectory() && entry.name === exeName("photocraft-cli")) return full;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const hit = await findCli(path.join(root, entry.name), depth + 1);
    if (hit) return hit;
  }
  return "";
}

/** 下载 + 校验 + 解压安装（version = release tag 去 v）。更新链也走这一个函数。 */
export async function installPhotoCraftFromGitHub(id: DevRuntimeId, version: string): Promise<void> {
  if (!/^[0-9][0-9A-Za-z.\-]*$/.test(version)) throw new Error(`PhotoCraft 版本号异常：${version}`);
  const paths = photocraftPaths();
  const asset = photocraftAssetName(version);
  const staging = path.join(writeToolsRoot(), ".photocraft-download");
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { recursive: true });
  const archive = path.join(staging, asset);
  emitRuntimeProgress(id, `@@STAGE 下载 PhotoCraft ${version}`);
  emitRuntimeProgress(id, `正在下载 PhotoCraft ${version}（${asset}，约 137 MB）…`);
  try {
    const actualSha = (await downloadThroughMirrors({
      url: `https://github.com/${PHOTOCRAFT_REPO}/releases/download/v${version}/${asset}`,
      target: archive,
      expectZipMagic: asset.endsWith(".zip"),
      isCancelled: () => isCancelRequested(id),
      onProgress: (p) => {
        emitRuntimeProgress(id, `@@PROGRESS ${p.total ? p.percent : 0}`);
        const mb = p.total
          ? `${(p.received / 1048576).toFixed(1)} MB / ${(p.total / 1048576).toFixed(1)} MB`
          : `${(p.received / 1048576).toFixed(1)} MB`;
        emitRuntimeProgress(id, `正在下载 PhotoCraft（${mb}）`);
      },
    })).sha256;
    if (isCancelRequested(id)) throw new Error("已取消");
    emitRuntimeProgress(id, "校验 SHA256…");
    const expectedSha = await fetchSumsDigest(asset, version);
    if (expectedSha && actualSha && expectedSha !== actualSha) {
      throw new Error(`PhotoCraft SHA256 校验失败（下载可能被截断）：期望 ${expectedSha.slice(0, 12)}…，实际 ${actualSha.slice(0, 12)}… —— 请重试`);
    }
    emitRuntimeProgress(id, "正在解压…");
    const stage = `${paths.root}.installing`;
    await fs.rm(stage, { recursive: true, force: true });
    await fs.mkdir(stage, { recursive: true });
    try {
      if (asset.endsWith(".tar.gz")) {
        await runTool(tarExecutable(), ["-xzf", archive, "-C", stage]);
      } else {
        const sevenZip = existingToolPath("sevenzip", "7z.exe");
        if (sevenZip) await runTool(sevenZip, ["x", archive, `-o${stage}`, "-y"]);
        else if (process.platform === "darwin") await runTool("unzip", ["-q", archive, "-d", stage]);
        else await runTool(tarExecutable(), ["-xf", archive, "-C", stage]);
      }
      const cli = await findCli(stage);
      if (!cli) throw new Error("PhotoCraft 安装包解压后找不到 photocraft-cli（包结构可能变了）");
      const cliDir = path.dirname(cli);
      if (path.resolve(cliDir) !== path.resolve(stage)) {
        const lifted = `${stage}.root`;
        await fs.rm(lifted, { recursive: true, force: true });
        await fs.mkdir(lifted, { recursive: true });
        for (const entry of await fs.readdir(cliDir)) await fs.rename(path.join(cliDir, entry), path.join(lifted, entry));
        await fs.rm(stage, { recursive: true, force: true });
        await fs.rename(lifted, stage);
      }
      if (process.platform !== "win32") await fs.chmod(path.join(stage, exeName("photocraft-cli")), 0o755).catch(() => undefined);
      await fs.rm(paths.root, { recursive: true, force: true });
      await fs.rename(stage, paths.root);
    } finally {
      await fs.rm(stage, { recursive: true, force: true }).catch(() => undefined);
      await fs.rm(`${stage}.root`, { recursive: true, force: true }).catch(() => undefined);
    }
    mkdirSync(paths.ioRoot, { recursive: true });
    await fs.writeFile(paths.versionFile, version + "\n", "utf8");
    emitRuntimeProgress(id, "@@PROGRESS 100");
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
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
 * ⛔ 卸载必须走这条：applyCustomModel 的 mcp_servers 重建在卸载时序里可能被跳过/失败，
 *    留下指向已删除 CLI 的段（实测）。安装仍由 applyCustomModel 写（它能拿到完整配置上下文）。
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
    return { ok: false, error: "PhotoCraft 还没安装：请到「设置 → 开发工具 → PhotoCraft 图像编辑」点安装" };
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
  if (!cli) throw new Error("PhotoCraft 还没安装：请到「设置 → 开发工具 → PhotoCraft 图像编辑」点安装（约 137MB）");
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
    trackRuntimeProc("photocraft" as DevRuntimeId, child);
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
