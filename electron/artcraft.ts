/**
 * ArtCraft Launcher（11-16）—— Craft App Suite 的统一安装器 / 更新器
 * （storytold/craft-launcher，MIT OR Apache-2.0，纯 Rust 的 egui 程序）。
 *
 * 上游形态（11-16 实测）：Launcher 负责安装 / 更新 / 打开 19 个创作 App（17 个官方 + 2 个社区）——
 * PhotoCraft（图像）、LightCraft（RAW）、FilmCraft（视频）、EffectCraft（动效）、AniCraft（2D 动画）、
 * VectorCraft（矢量）、FigCraft（界面 / 原型）、DesignCraft（版式）、DeckCraft（演示）、
 * WordCraft（文档）、GridCraft（表格）、PdfCraft（PDF）、CADCraft（CAD）、SoundCraft（音频）、
 * MaterialCraft（材质）、TextureCraft（贴图）、Craft Anything 与社区 App SolidCraft / MailCraft。
 *
 * 宿主只做两件事：
 *   ① 按需下载官方 portable zip（约 11MB）到 `tools/artcraft-launcher`，供卡片安装 / 更新 / 打开；
 *   ② 扫描 Launcher 的安装目录，把每个已装 App 接成**独立入口**（用户令「跟 PhotoCraft 一样，都单独」）：
 *      每个 App 一条 `[mcp_servers.<id>]`（无头 `<id>-cli.exe mcp`）+ 一个独立 Codex 工具 `craft_<id>`。
 *
 * ⛔⛔ 11-16 实测：上游没有可用的统一网关（`craft-ai-mcp` 只在其 main 分支，v0.19.2 便携包
 *   里没有该二进制）—— 用户也明确不要一个网关（「不容易区分」）⇒ 本应用**只做按 App 拆分**：
 *   没有已装 App 就整段不写；App 卸载后对应段由 artcraft-mcp-servers.json 记账清掉。
 * ⛔ 只下载官方 GitHub release（镜像序 + SHA256SUMS 校验），不重打包、不搬源码、不冒充 ArtCraft 官方。
 * ⛔ 应用本身的安装 / 卸载交给 Launcher（它自己处理 UAC 与安装目录）——宿主不代装。
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import type { Dirent } from "node:fs";
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

/**
 * 从 config.toml 里**直接删掉**这些 App 各自的 `[mcp_servers.<id>]`（含子表）并原子替换。
 * ⛔ 卸载 Launcher 走这条：applyCustomModel 的重建时序里可能被跳过，留下指向已删 CLI 的段。
 */
export function removeCraftAppMcpSections(): boolean {
  const ids = new Set(readCraftMcpIds());
  try {
    for (const app of scanCraftAppDirs()) ids.add(app.id);
  } catch { /* 扫描失败就只清已记账的 */ }
  if (!ids.size) return false;
  const file = path.join(codexHome, "config.toml");
  let text = "";
  try { text = readFileSync(file, "utf8"); } catch { return false; }
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;
  let changed = false;
  for (const line of lines) {
    const header = /^\s*\[([^\]]+)\]/.exec(line);
    if (header) {
      const name = header[1].trim();
      const [table, server] = name.startsWith("mcp_servers.") ? [name, name.slice("mcp_servers.".length)] : ["", ""];
      skipping = Boolean(table) && (ids.has(server) || [...ids].some((id) => server.startsWith(`${id}.`)));
      if (skipping) { changed = true; continue; }
    }
    if (skipping) continue;
    kept.push(line);
  }
  if (changed) {
    const tmp = `${file}.artcraft.tmp`;
    writeFileSync(tmp, kept.join("\n"), "utf8");
    renameSync(tmp, file);
  }
  writeCraftMcpIds([]);
  return changed;
}

export type InstalledCraftApp = {
  /** 目录名归一化后的 id（小写、去非字母数字；"Craft Anything" → "craftanything"）。 */
  id: string;
  /** 安装目录名（界面显示用）。 */
  name: string;
  dir: string;
  /** 主程序（GUI）。 */
  exePath: string;
  /** 无头 CLI（`<id>-cli.exe`）；有它才能注册独立 MCP / 工具。 */
  cliPath: string;
  version: string;
};

/** Launcher 的 App 安装根（全局 Program Files 为主；便携模式可能落在 launcher 旁边）。 */
function craftAppInstallRoots(): string[] {
  const roots: string[] = [];
  const programFiles = process.env.ProgramFiles ?? "";
  const programFiles86 = process.env["ProgramFiles(x86)"] ?? "";
  const localAppData = process.env.LOCALAPPDATA ?? "";
  if (programFiles) roots.push(path.join(programFiles, "ArtCraft"));
  if (programFiles86) roots.push(path.join(programFiles86, "ArtCraft"));
  if (localAppData) roots.push(path.join(localAppData, "Programs", "ArtCraft"));
  const root = artcraftPaths().root;
  roots.push(path.join(root, "ArtCraft"));
  roots.push(path.join(root, "apps"));
  return [...new Set(roots)];
}

/** 读 Windows exe 的 VERSIONINFO 版本（按 mtime 缓存；读不到返回空串，不阻断状态）。 */
const exeVersionCache = new Map<string, { stamp: string; version: string }>();
async function readExeVersion(exe: string): Promise<string> {
  if (process.platform !== "win32") return "";
  let stamp = "";
  try { stamp = String(statSync(exe).mtimeMs); } catch { return ""; }
  const cached = exeVersionCache.get(exe);
  if (cached && cached.stamp === stamp) return cached.version;
  const version = await new Promise<string>((resolve) => {
    let out = "";
    /* ⛔ 路径经环境变量传入，不进 PowerShell 源码（防引号注入）。 */
    try {
      const child = spawn("powershell", ["-NoProfile", "-Command", "(Get-Item -LiteralPath $env:ARTCRAFT_EXE).VersionInfo.ProductVersion"], {
        windowsHide: true,
        env: { ...process.env, ARTCRAFT_EXE: exe },
      });
      child.stdout?.on("data", (chunk) => { out = (out + String(chunk)).slice(-300); });
      const timer = setTimeout(() => { try { child.kill(); } catch { /* 已退出 */ } resolve(""); }, 6000);
      child.on("error", () => { clearTimeout(timer); resolve(""); });
      child.on("close", () => { clearTimeout(timer); resolve(out.trim().split(/\r?\n/).pop()?.trim() ?? ""); });
    } catch { resolve(""); }
  });
  exeVersionCache.set(exe, { stamp, version });
  return version;
}

/**
 * 扫描 Launcher 已安装的 App（联动用：装完回来这里就能看到「已安装」）。
 * ⛔ 只看 Launcher 自己的安装目录，不猜别的路径；目录里的 `*-cli.exe` 单独记录（MCP/工具用它）。
 */
function scanCraftAppDirs(): InstalledCraftApp[] {
  const found = new Map<string, InstalledCraftApp>();
  for (const root of craftAppInstallRoots()) {
    let dirs: Dirent[] = [];
    try { dirs = readdirSync(root, { withFileTypes: true }) as Dirent[]; } catch { continue; }
    for (const entry of dirs) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      let files: string[] = [];
      try { files = readdirSync(dir); } catch { continue; }
      const exe = files.find((file) => /\.exe$/i.test(file) && !/-cli\.exe$/i.test(file) && !/^unins/i.test(file));
      if (!exe) continue;
      const id = entry.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!id || found.has(id)) continue;
      const cli = files.find((file) => /-cli\.exe$/i.test(file));
      found.set(id, {
        id,
        name: entry.name,
        dir,
        exePath: path.join(dir, exe),
        cliPath: cli ? path.join(dir, cli) : "",
        version: "",
      });
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** 已安装 App（带版本；版本读 exe 元数据并缓存，供界面显示）。 */
export async function listInstalledCraftApps(): Promise<InstalledCraftApp[]> {
  const apps = scanCraftAppDirs();
  /* ⛔ 并发读版本：PowerShell 单次可能几百 ms，机器上装了多个 App 时串行会拖住状态轮询
     （首次一屏 5 个 App ≈ 2~3s）。缓存按 exe+mtime，重复轮询不再 spawn。 */
  await Promise.all(apps.map(async (app) => { app.version = await readExeVersion(app.exePath); }));
  return apps;
}

/** 我们写进 config.toml 的 App MCP 服务器名单（删 App 后据此清掉旧段）。 */
function craftMcpStateFile(): string {
  return path.join(app.getPath("userData"), "artcraft-mcp-servers.json");
}
function readCraftMcpIds(): string[] {
  try {
    const parsed = JSON.parse(readFileSync(craftMcpStateFile(), "utf8")) as { servers?: unknown };
    return Array.isArray(parsed?.servers) ? parsed.servers.map(String).filter((id) => /^[a-z0-9]{2,40}$/.test(id)) : [];
  } catch { return []; }
}
function writeCraftMcpIds(ids: string[]): void {
  try {
    writeFileSync(craftMcpStateFile(), JSON.stringify({ servers: [...new Set(ids)].sort() }, null, 2), "utf8");
  } catch { /* 写不了账本不影响当前配置生成 */ }
}

/**
 * 本轮 config 生成要写的「每个 App 一条独立 MCP 段」+ 需要清理的旧名单。
 * ⛔ 与 PhotoCraft 同款：一个 App 一个 `[mcp_servers.<id>]`（Codex 里就是独立工具，便于区分）。
 * ⛔ 只有带 `-cli.exe` 的 App 才能注册（MCP 走无头 CLI）；PhotoCraft 用它自己的 `photocraft` 段。
 */
export async function craftAppMcpPlan(): Promise<{ servers: string[]; previous: string[]; sections: string[] }> {
  const previous = readCraftMcpIds();
  const apps = scanCraftAppDirs().filter((app) => app.id !== "photocraft" && app.cliPath);
  const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const sections: string[] = [];
  const servers: string[] = [];
  for (const app of apps) {
    servers.push(app.id);
    sections.push(
      `[mcp_servers.${app.id}]`,
      `command = "${escape(app.cliPath)}"`,
      'args = ["mcp"]',
      "startup_timeout_sec = 30",
      "",
    );
  }
  writeCraftMcpIds(servers);
  return { servers, previous, sections };
}

/** 当前已写入 config 的 App MCP 名单（状态展示用；⛔ 不触发引擎重启）。 */
export function craftAppMcpServers(): string[] {
  return readCraftMcpIds();
}

/** 跑某个已装 App 的无头 CLI（参数数组、不开 shell；返回 stdout；非零带 stderr 尾部）。 */
export async function runCraftAppCli(appId: string, args: string[], timeoutMs = 300_000): Promise<{ stdout: string; stderr: string; app: InstalledCraftApp }> {
  const app = scanCraftAppDirs().find((entry) => entry.id === appId.toLowerCase().replace(/[^a-z0-9]/g, ""));
  if (!app) throw new Error(`没找到已安装的 App「${appId}」：请先在 Craft 全家桶里用 Launcher 安装`);
  if (!app.cliPath) throw new Error(`「${app.name}」没有无头 CLI（缺 *-cli.exe），无法供 Codex 调用`);
  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const done = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error); else resolve({ stdout, stderr, app });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(app.cliPath, args, { windowsHide: true });
    } catch (error) { done(error as Error); return; }
    child.stdout?.on("data", (chunk) => { stdout = (stdout + String(chunk)).slice(-2_000_000); });
    child.stderr?.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-200_000); });
    child.on("error", (error) => done(error));
    const timer = setTimeout(() => { try { child.kill(); } catch { /* 已退出 */ } done(new Error(`${app.name} 执行超时（${Math.round(timeoutMs / 1000)}s）`)); }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) done();
      else done(new Error(`${app.name} 退出码 ${code}：${(stderr || stdout).trim().slice(-600) || "无输出"}`));
    });
  });
}

/** 打开某个已安装 App 的 GUI（可带文件；未装给中文指引）。 */
export function openCraftApp(appId: string, file?: string): { ok: boolean; error?: string } {
  const app = scanCraftAppDirs().find((entry) => entry.id === appId.toLowerCase().replace(/[^a-z0-9]/g, ""));
  if (!app) return { ok: false, error: `没找到已安装的 App「${appId}」：请在 Craft 全家桶里用 Launcher 安装` };
  try {
    spawn(app.exePath, file ? [file] : [], { detached: true, stdio: "ignore", windowsHide: false }).unref();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error)?.message ?? String(error) };
  }
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
