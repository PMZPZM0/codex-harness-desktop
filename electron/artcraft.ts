/**
 * ArtCraft Launcher（11-16）—— Craft App Suite 的统一安装器 / 更新器
 * （storytold/craft-launcher，MIT OR Apache-2.0，纯 Rust 的 egui 程序）。
 *
 * 上游形态（11-16 实测）：Launcher 负责安装 / 更新 / 打开 18 个创作 App ——
 * PhotoCraft（图像）、LightCraft（RAW）、FilmCraft（视频）、EffectCraft（动效）、AniCraft（2D 动画）、
 * VectorCraft（矢量）、FigCraft（界面 / 原型）、DesignCraft（版式）、DeckCraft（演示）、
 * WordCraft（文档）、GridCraft（表格）、PdfCraft（PDF）、CADCraft（CAD）、SoundCraft（音频）、
 * MaterialCraft（材质）、TextureCraft（贴图）、Craft Anything 与社区 App SolidCraft / MailCraft。
 *
 * 宿主只做两件事：
 *   ① 按需下载官方 portable zip（约 11MB）到 `tools/artcraft-launcher`，供卡片安装 / 更新 / 打开；
 *   ② 上游新版随包提供 `craft-ai-mcp` 网关时，自动写 `[mcp_servers.ArtCraft]` ——
 *      一个 MCP 入口（4 个工具：列 App / 找工具 / describe / call）覆盖所有已装 App。
 *
 * ⛔⛔ 11-16 实测（v0.19.2 = 当时 latest）：便携包里**只有 launcher.exe**，没有网关二进制；
 *   exe 里连 `craft-ai-mcp` / `apps.json` / `allowed(` 字样都没有 ⇒ 网关与「AI 可用哪些 App」的
 *   同意表（`ArtCraft/mcp/apps.json`）只存在于上游 main 分支，尚未随 release 出货。
 *   ⇒ MCP 段**只在网关文件真的存在时**才写；否则整段不写，卡片显示「等 Launcher 新版」。
 *   ⇒ 上游 `crates/core/src/mcp_config.rs` 给的 Codex 配置就是：
 *      `[mcp_servers.ArtCraft]` + `command = <gateway>` + `args = ["--stdio"]`（本模块同款）。
 * ⛔ 只下载官方 GitHub release（镜像序 + SHA256SUMS 校验），不重打包、不搬源码、不冒充 ArtCraft 官方。
 * ⛔ 应用本身的安装 / 卸载交给 Launcher（它自己处理 UAC 与安装目录）——宿主不代装。
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { mirrorCandidates } from "./gh-mirror";
import { guardedFetch } from "./net-guard";
import { downloadThroughMirrors } from "./mirror-download";
import { emitRuntimeProgress, isCancelRequested } from "./features/dev-runtimes";
import type { DevRuntimeId } from "./features/dev-runtimes";
import { existingToolPath, tarExecutable, writeToolsRoot } from "./toolchain";
import { codexHome } from "./runtime-refs";

export const ARTCRAFT_REPO = "storytold/craft-launcher";
export const ARTCRAFT_HOME = "https://github.com/storytold/craft-launcher";
export const ARTCRAFT_APPS_HOME = "https://getartcraft.com/apps";
/** config.toml 里的 MCP 服务器名 —— 与上游 `mcp_config.rs` 的 SERVER_KEY 逐字一致（`ArtCraft`）。 */
export const ARTCRAFT_MCP_SERVER = "ArtCraft";

export type ArtCraftPaths = {
  root: string;
  launcher: string;
  versionFile: string;
};

/** 平台可执行文件名（Windows 带 .exe；mac/linux 无后缀）。 */
function exeName(base: string): string {
  return process.platform === "win32" ? `${base}.exe` : base;
}

/** Launcher 安装目录 / 可执行文件 / 版本文件。 */
export function artcraftPaths(): ArtCraftPaths {
  const root = path.join(writeToolsRoot(), "artcraft-launcher");
  return {
    root,
    launcher: path.join(root, exeName("artcraft-launcher")),
    versionFile: path.join(root, "version.txt"),
  };
}

/** 已安装版本（读不到按未安装）。 */
export function artcraftInstalledVersion(): string {
  try { return readFileSync(artcraftPaths().versionFile, "utf8").trim(); } catch { return ""; }
}

/** Launcher 可用 = 版本文件 + 可执行文件都在（版本文件是安装的最后一步）。 */
export function artcraftLauncherPath(): string {
  const paths = artcraftPaths();
  return artcraftInstalledVersion() && existsSync(paths.launcher) ? paths.launcher : "";
}

/** 平台对应的 portable 资产名（与官方 release 命名一致：artcraft-launcher-<ver>-windows-<arch>-portable.zip）。 */
export function artcraftAssetName(version: string): string {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "win32") return `artcraft-launcher-${version}-windows-${arch}-portable.zip`;
  return `artcraft-launcher-${version}-linux-${arch === "arm64" ? "aarch64" : "x86_64"}.tar.gz`;
}

/** 上游网关二进制可能的落位（⛔ 现在通常都不存在：网关还没随 release 出货）。 */
function craftAiMcpCandidates(): string[] {
  const file = exeName("craft-ai-mcp");
  const root = artcraftPaths().root;
  const list: string[] = [];
  const localAppData = process.env.LOCALAPPDATA ?? "";
  if (localAppData) list.push(path.join(localAppData, "ArtCraft", "mcp", "bin", file));
  const programFiles = process.env.ProgramFiles ?? "";
  if (programFiles) list.push(path.join(programFiles, "ArtCraft", "mcp", "bin", file));
  // portable 模式：数据放在 exe 旁边（portable.txt），上游可能落在以下几种形态之一。
  list.push(path.join(root, "ArtCraft", "mcp", "bin", file));
  list.push(path.join(root, "mcp", "bin", file));
  list.push(path.join(root, "data", "ArtCraft", "mcp", "bin", file));
  if (process.platform === "darwin") {
    list.push(path.join(app.getPath("home"), "Library", "Application Support", "ArtCraft", "mcp", "bin", file));
  }
  if (process.platform === "linux") {
    list.push(path.join(app.getPath("home"), ".local", "share", "ArtCraft", "mcp", "bin", file));
  }
  return list;
}

/** 网关路径（存在才返回；不存在返回空串 —— 调用方据此决定写不写 MCP 段）。 */
export function craftAiMcpPath(): string {
  for (const candidate of craftAiMcpCandidates()) {
    if (existsSync(candidate)) return candidate;
  }
  return "";
}

/** Codex 的 MCP 配置片段（上游 mcp_config.rs 同款；网关不存在返回空串）。 */
export function artcraftConfigSnippet(): string {
  const gateway = craftAiMcpPath();
  if (!gateway) return "";
  const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return [
    `[mcp_servers.${ARTCRAFT_MCP_SERVER}]`,
    `command = "${escape(gateway)}"`,
    'args = ["--stdio"]',
  ].join("\n") + "\n";
}

/** 从 SHA256SUMS.txt 里取目标资产的官方哈希（拿不到返回空，不假装校验过）。 */
async function fetchSumsDigest(asset: string, version: string): Promise<string> {
  const url = `https://github.com/${ARTCRAFT_REPO}/releases/download/v${version}/SHA256SUMS.txt`;
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

/** 递归找 launcher 可执行文件（portable 包会套一层目录）。 */
async function findLauncher(root: string, depth = 0): Promise<string> {
  if (depth > 3) return "";
  let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return ""; }
  const wanted = exeName("artcraft-launcher");
  for (const entry of entries) {
    if (!entry.isDirectory() && entry.name === wanted) return path.join(root, entry.name);
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const hit = await findLauncher(path.join(root, entry.name), depth + 1);
    if (hit) return hit;
  }
  return "";
}

/** 下载 + 校验 + 解压安装（version = release tag 去 v）。更新链也走这一个函数。 */
export async function installArtCraftFromGitHub(id: DevRuntimeId, version: string): Promise<void> {
  if (process.platform === "darwin") {
    throw new Error("ArtCraft Launcher 的 mac 版是 .app 安装包，本应用不代装：请从 getartcraft.com 安装 Launcher 后重启本应用，网关会被自动检测");
  }
  if (!/^[0-9][0-9A-Za-z.\-]*$/.test(version)) throw new Error(`ArtCraft Launcher 版本号异常：${version}`);
  const paths = artcraftPaths();
  const asset = artcraftAssetName(version);
  const staging = path.join(writeToolsRoot(), ".artcraft-download");
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { recursive: true });
  const archive = path.join(staging, asset);
  emitRuntimeProgress(id, `@@STAGE 下载 ArtCraft Launcher ${version}`);
  emitRuntimeProgress(id, `正在下载 ArtCraft Launcher ${version}（${asset}，约 11 MB）…`);
  try {
    const actualSha = (await downloadThroughMirrors({
      url: `https://github.com/${ARTCRAFT_REPO}/releases/download/v${version}/${asset}`,
      target: archive,
      expectZipMagic: asset.endsWith(".zip"),
      isCancelled: () => isCancelRequested(id),
      onProgress: (p) => {
        emitRuntimeProgress(id, `@@PROGRESS ${p.total ? p.percent : 0}`);
        const mb = p.total
          ? `${(p.received / 1048576).toFixed(1)} MB / ${(p.total / 1048576).toFixed(1)} MB`
          : `${(p.received / 1048576).toFixed(1)} MB`;
        emitRuntimeProgress(id, `正在下载 ArtCraft Launcher（${mb}）`);
      },
    })).sha256;
    if (isCancelRequested(id)) throw new Error("已取消");
    emitRuntimeProgress(id, "校验 SHA256…");
    const expectedSha = await fetchSumsDigest(asset, version);
    if (expectedSha && actualSha && expectedSha !== actualSha) {
      throw new Error(`ArtCraft Launcher SHA256 校验失败（下载可能被截断）：期望 ${expectedSha.slice(0, 12)}…，实际 ${actualSha.slice(0, 12)}… —— 请重试`);
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
        else await runTool(tarExecutable(), ["-xf", archive, "-C", stage]);
      }
      const launcher = await findLauncher(stage);
      if (!launcher) throw new Error("ArtCraft Launcher 安装包解压后找不到 artcraft-launcher（包结构可能变了）");
      const launcherDir = path.dirname(launcher);
      if (path.resolve(launcherDir) !== path.resolve(stage)) {
        const lifted = `${stage}.root`;
        await fs.rm(lifted, { recursive: true, force: true });
        await fs.mkdir(lifted, { recursive: true });
        for (const entry of await fs.readdir(launcherDir)) await fs.rename(path.join(launcherDir, entry), path.join(lifted, entry));
        await fs.rm(stage, { recursive: true, force: true });
        await fs.rename(lifted, stage);
      }
      if (process.platform !== "win32") await fs.chmod(path.join(stage, exeName("artcraft-launcher")), 0o755).catch(() => undefined);
      await fs.rm(paths.root, { recursive: true, force: true });
      await fs.rename(stage, paths.root);
    } finally {
      await fs.rm(stage, { recursive: true, force: true }).catch(() => undefined);
      await fs.rm(`${stage}.root`, { recursive: true, force: true }).catch(() => undefined);
    }
    await fs.writeFile(paths.versionFile, version + "\n", "utf8");
    emitRuntimeProgress(id, "@@PROGRESS 100");
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** 生成 `[mcp_servers.ArtCraft]` 段（网关不存在返回空数组）。由 custom-model-apply 统一拼进 config.toml。 */
export function artcraftMcpSection(): string[] {
  const snippet = artcraftConfigSnippet();
  if (!snippet) return [];
  return [...snippet.trimEnd().split("\n"), "startup_timeout_sec = 30", ""];
}

/** MCP 段当前是否已写进 config.toml（状态展示用；⛔ 不触发引擎重启）。 */
export function artcraftMcpRegistered(): boolean {
  try {
    const text = readFileSync(path.join(app.getPath("userData"), "codex-home", "config.toml"), "utf8");
    return /\[mcp_servers\.ArtCraft\]/.test(text);
  } catch { return false; }
}

/**
 * 从 config.toml 里**直接删掉** `[mcp_servers.ArtCraft]`（含子表）并原子替换。
 * ⛔ 卸载走这条：applyCustomModel 的重建时序里可能被跳过，留下指向已删网关的段。
 */
export function removeArtCraftMcpSection(): boolean {
  const file = path.join(codexHome, "config.toml");
  let text = "";
  try { text = readFileSync(file, "utf8"); } catch { return false; }
  if (!text.includes("[mcp_servers.ArtCraft")) return false;
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;
  let changed = false;
  for (const line of lines) {
    const header = /^\s*\[([^\]]+)\]/.exec(line);
    if (header) {
      const name = header[1].trim();
      skipping = name === "mcp_servers.ArtCraft" || name.startsWith("mcp_servers.ArtCraft.");
      if (skipping) { changed = true; continue; }
    }
    if (skipping) continue;
    kept.push(line);
  }
  if (!changed) return false;
  const tmp = `${file}.artcraft.tmp`;
  writeFileSync(tmp, kept.join("\n"), "utf8");
  renameSync(tmp, file);
  return true;
}

/** 打开 Launcher（未安装给中文指引）。 */
export function openArtCraftLauncher(): { ok: boolean; error?: string } {
  const launcher = artcraftLauncherPath();
  if (!launcher) {
    return { ok: false, error: "ArtCraft Launcher 还没安装：请到「设置 → 开发工具 → Craft 全家桶」点安装（约 11MB）" };
  }
  try {
    spawn(launcher, [], { detached: true, stdio: "ignore", windowsHide: false }).unref();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error)?.message ?? String(error) };
  }
}
