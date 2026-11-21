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
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
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

/** mac：Launcher 是 `.app` 包（应用内不装；识别用户在 /Applications 安装的，或手动放进 tools 的）。 */
function macLauncherApp(): string {
  const candidates = [
    path.join(artcraftPaths().root, "ArtCraft Launcher.app"),
    "/Applications/ArtCraft Launcher.app",
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? "";
}

/** mac `.app` 里的可执行文件：直接 spawn 它才能继承代理环境变量（`open -a` 走 launchd 会丢环境）。 */
function macAppExecutable(appDir: string): string {
  try {
    const macos = path.join(appDir, "Contents", "MacOS");
    for (const name of readdirSync(macos)) {
      const file = path.join(macos, name);
      try { if (statSync(file).isFile()) return file; } catch { /* 继续找 */ }
    }
  } catch { /* 不是标准 bundle */ }
  return "";
}

/** Launcher 可用 = 版本文件 + 可执行文件都在（版本文件是安装的最后一步）；mac 认 .app 包。 */
export function artcraftLauncherPath(): string {
  const paths = artcraftPaths();
  if (artcraftInstalledVersion() && existsSync(paths.launcher)) return paths.launcher;
  if (process.platform === "darwin") return macLauncherApp();
  return "";
}

/** 平台对应的 portable 资产名（与官方 release 命名一致：artcraft-launcher-<ver>-windows-<arch>-portable.zip）。 */
export function artcraftAssetName(version: string): string {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "win32") return `artcraft-launcher-${version}-windows-${arch}-portable.zip`;
  /* ⛔ mac 不在应用内安装：Launcher 是 .app 形态（签名/公证由系统与官网管），
     由用户从 getartcraft.com 安装；这里返回空串让调用方给中文指引，而不是错下 Linux 包。 */
  if (process.platform === "darwin") return "";
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
  /* ⛔ 11-21：不再整目录 rm —— 分片下载的断点续传靠 `<asset>.partN` 存活（见 mirror-download），
     整目录删会让「下载到一半重试」永远从 0 开始。只清与本次无关的残留（旧版本资产 / 上次解压残渣）。 */
  await fs.mkdir(staging, { recursive: true });
  for (const name of await fs.readdir(staging).catch(() => [] as string[])) {
    if (name === asset || /\.part\d+$/.test(name)) continue;
    await fs.rm(path.join(staging, name), { recursive: true, force: true }).catch(() => undefined);
  }
  const archive = path.join(staging, asset);
  emitRuntimeProgress(id, `@@STAGE 下载 ArtCraft Launcher ${version}`);
  emitRuntimeProgress(id, `正在下载 ArtCraft Launcher ${version}（${asset}，约 11 MB）…`);
  /* ⛔ 11-21：成功 / 用户取消才清暂存；**下载失败保留** staging —— 分片断点续传靠 `<asset>.partN`。 */
  let installedOk = false;
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
    installedOk = true;
  } finally {
    if (installedOk || isCancelRequested(id)) {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
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

/** Launcher 的 App 安装根（全局 Program Files 为主；便携模式可能落在 launcher 旁边）。
 *  ⛔ 11-17 用户实测「别的电脑装完完全识别不到」：Launcher 的安装位置**不一定是** C:\Program Files\ArtCraft ——
 *     用户可以在 Launcher 里改 root，或经 per-user MSI 装到别处。所以这里必须覆盖：
 *     Launcher 自己的记录（app.ron 的 install_locations）+ 本应用里手动指定的位置 + 常见默认根。 */
export const CRAFT_APP_IDS = [
  "photocraft", "lightcraft", "vectorcraft", "filmcraft", "effectcraft", "anicraft", "figcraft",
  "designcraft", "deckcraft", "wordcraft", "gridcraft", "pdfcraft", "cadcraft", "soundcraft",
  "materialcraft", "texturecraft", "craftanything", "solidcraft", "mailcraft",
];

/** 手动指定安装根的存档文件（<userData>/artcraft-root.json）。 */
function craftRootFile(): string {
  return path.join(app.getPath("userData"), "artcraft-root.json");
}
/** 读用户手动指定的安装根（空串 = 只用自动检测；目录已被删也按空处理）。 */
export function readCraftRootSetting(): string {
  try {
    const value = String(JSON.parse(readFileSync(craftRootFile(), "utf8"))?.root ?? "").trim();
    return value && existsSync(value) ? value : "";
  } catch { return ""; }
}
/** 写入 / 清除手动安装根（空串 = 删除存档，恢复自动检测）。 */
export function writeCraftRootSetting(root: string): void {
  try {
    if (!root.trim()) { try { fs.unlink(craftRootFile()); } catch { /* 不存在 */ } return; }
    writeFileSync(craftRootFile(), JSON.stringify({ root: root.trim() }, null, 2), "utf8");
  } catch { /* 写不进去就只用自动检测 */ }
}

/** Launcher 自己的数据目录（Windows：ArtCraftLauncherData；其余平台同名）。 */
function launcherDataDir(): string {
  return path.join(artcraftPaths().root, "ArtCraftLauncherData");
}

/** Launcher 记录的自定义安装位置（app.ron 的 `install_locations:(root:Some("…"),per_app:{…})`）。 */
function readLauncherInstallRoots(): string[] {
  const roots: string[] = [];
  try {
    const ron = readFileSync(path.join(launcherDataDir(), "data", "app.ron"), "utf8");
    const unescape = (value: string) => value.replace(/\\(["\\])/g, "$1");
    const root = /root:Some\("((?:[^"\\]|\\.)*)"\)/.exec(ron)?.[1];
    if (root) roots.push(unescape(root));
    const perApp = /per_app:\{([^}]*)\}/.exec(ron)?.[1] ?? "";
    for (const match of perApp.matchAll(/"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
      const value = unescape(match[2]);
      if (value) roots.push(value);
    }
  } catch { /* 没有 Launcher 数据目录就跳过 */ }
  return roots;
}

/** Launcher 目录清单里的 app id（缓存 TOML；用于识别不在静态清单里的新 App）。 */
function readLauncherCatalogIds(): string[] {
  try {
    const cache = JSON.parse(readFileSync(path.join(launcherDataDir(), "cache", "launcher-catalog.json"), "utf8"));
    const toml = String(cache?.catalog ?? "");
    return [...toml.matchAll(/^\s*id\s*=\s*"([a-z0-9-]+)"/gm)].map((match) => match[1].replace(/[^a-z0-9]/g, ""));
  } catch { return []; }
}

function craftAppInstallRoots(): string[] {
  const roots: string[] = [];
  const programFiles = process.env.ProgramFiles ?? "";
  const programFiles86 = process.env["ProgramFiles(x86)"] ?? "";
  const localAppData = process.env.LOCALAPPDATA ?? "";
  const appData = process.env.APPDATA ?? "";
  const programData = process.env.ProgramData ?? "";
  /* ① 常见默认根（含 per-user 与全机安装的各种落点）。 */
  if (programFiles) roots.push(path.join(programFiles, "ArtCraft"));
  if (programFiles86) roots.push(path.join(programFiles86, "ArtCraft"));
  if (localAppData) roots.push(path.join(localAppData, "ArtCraft"), path.join(localAppData, "Programs", "ArtCraft"));
  if (appData) roots.push(path.join(appData, "ArtCraft"));
  if (programData) roots.push(path.join(programData, "ArtCraft"));
  /* ② Launcher 旁边（便携模式；App 可能直接摊在 launcher 根下或 apps/ 里）。 */
  const root = artcraftPaths().root;
  roots.push(root, path.join(root, "apps"), path.join(root, "ArtCraft"));
  /* ③ macOS：Launcher 把 App 装成 /Applications/<App>.app（或用户目录下的 Applications）。 */
  if (process.platform === "darwin") {
    roots.push("/Applications", path.join(homedir(), "Applications"));
  }
  /* ④ 用户手动指定 + Launcher 自己记录的安装位置（用户改过 root 就在这）。 */
  roots.push(readCraftRootSetting(), ...readLauncherInstallRoots());
  return [...new Set(roots.filter(Boolean))];
}

/** 需要“按已知 App 名扫直接子目录”的大目录（per-user MSI 常直接装在 Programs\<App>）。 */
function craftAppSiblingRoots(): string[] {
  const roots: string[] = [];
  if (process.env.ProgramFiles) roots.push(process.env.ProgramFiles);
  if (process.env["ProgramFiles(x86)"]) roots.push(process.env["ProgramFiles(x86)"]!);
  if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, "Programs"));
  return roots;
}

function normalizeCraftId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** 供状态面板展示：本次会扫描的全部根目录（识别不到时用户能据此手动指定）。 */
export function craftScanRoots(): string[] {
  return [...new Set([...craftAppInstallRoots(), ...craftAppSiblingRoots()])];
}

/** 查一个 App 的安装信息（例如 PhotoCraft 的 CLI/GUI 路径要交给 `photocraft` 工具用）。 */
export function installedCraftApp(id: string): InstalledCraftApp | null {
  const target = normalizeCraftId(id);
  return scanCraftAppDirs().find((app) => app.id === target) ?? null;
}

/** 读 Windows exe 的 VERSIONINFO 版本（按 mtime 缓存；读不到返回空串，不阻断状态）。 */
const exeVersionCache = new Map<string, { stamp: string; version: string }>();
async function readExeVersion(exe: string): Promise<string> {
  /* mac：App 版本在 `.app/Contents/Info.plist`（CFBundleShortVersionString）。 */
  if (process.platform === "darwin") {
    try {
      const plist = path.join(path.dirname(exe), "..", "Info.plist");
      return execFileSync("defaults", ["read", plist, "CFBundleShortVersionString"], { encoding: "utf8", timeout: 3000 }).trim();
    } catch { return ""; }
  }
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
 * ⛔ 11-17 用户实测「别的电脑装完完全识别不到」：安装位置**不是固定**的 —— 可能是 Launcher 改过 root、
 *    per-user MSI 直接装到 `%LOCALAPPDATA%\Programs\<App>`、或 portable 摊在 launcher 旁边。
 *    所以：① 已知 App 名（静态清单 ∪ Launcher 目录缓存）才收；② 容器目录（ArtCraft / apps / Programs…）再下一层；
 *    ③ 用户手动指定的根也参与扫描（见 `artcraft:pick-root`）。
 */
function scanCraftAppDirs(): InstalledCraftApp[] {
  const knownIds = new Set<string>([...CRAFT_APP_IDS, ...readLauncherCatalogIds()]);
  const found = new Map<string, InstalledCraftApp>();
  const consider = (root: string, name: string) => {
    /* 11-17：mac 的 App 是 `<App>.app` 包 ⇒ 去掉后缀再归一化，可执行文件在 Contents/MacOS。 */
    const bundle = /\.app$/i.test(name);
    const baseName = name.replace(/\.app$/i, "");
    const id = normalizeCraftId(baseName);
    if (!id || !knownIds.has(id) || found.has(id)) return;
    const dir = path.join(root, name);
    const binDir = bundle ? path.join(dir, "Contents", "MacOS") : dir;
    let files: string[] = [];
    try { files = readdirSync(binDir); } catch { return; }
    const isFile = (file: string) => { try { return statSync(path.join(binDir, file)).isFile(); } catch { return false; } };
    const isCli = (file: string) => /-cli(\.exe)?$/i.test(file);
    const isLauncherExe = (file: string) => process.platform === "win32"
      ? /\.exe$/i.test(file) && !isCli(file) && !/^unins/i.test(file)
      : !isCli(file) && !file.startsWith(".") && isFile(file);
    const preferExe = files.find((file) => normalizeCraftId(path.parse(file).name) === id && isLauncherExe(file));
    const exe = preferExe ?? files.find(isLauncherExe);
    if (!exe) return;
    const cli = files.find(isCli);
    found.set(id, {
      id,
      name: baseName,
      dir,
      exePath: path.join(binDir, exe),
      cliPath: cli ? path.join(binDir, cli) : "",
      version: "",
    });
  };
  const scanChildren = (root: string, onlyKnown: boolean) => {
    let dirs: Dirent[] = [];
    try { dirs = readdirSync(root, { withFileTypes: true }) as Dirent[]; } catch { return; }
    for (const entry of dirs) {
      if (!entry.isDirectory()) continue;
      /* mac 的 .app 也是目录：比较 id 时去掉后缀，否则永远对不上已知 App 名。 */
      const normalized = normalizeCraftId(entry.name.replace(/\.app$/i, ""));
      if (onlyKnown) { consider(root, entry.name); continue; }
      if (knownIds.has(normalized)) { consider(root, entry.name); continue; }
      /* 容器目录（ArtCraft / apps / Craft / Programs / 任意含 App 的父目录）再下一层。 */
      scanChildren(path.join(root, entry.name), true);
    }
  };
  for (const root of craftAppInstallRoots()) scanChildren(root, false);
  for (const root of craftAppSiblingRoots()) scanChildren(root, true);
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
export async function craftAppMcpPlan(lazyAllowed: (id: string) => boolean = () => true): Promise<{ servers: string[]; previous: string[]; sections: string[] }> {
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
      /* 11-21：引擎侧停用（每个 App 一条 MCP 段，全开会把首回合前缀撑爆）；宿主网关按需调用。
         ⛔ 该 App 有用户「ask」规则时不懒加载（保持引擎审批）。 */
      ...(lazyAllowed(app.id) ? ["enabled = false"] : []),
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


/** 读系统代理（host:port；开关关 / 读不到返回空串）。
 *  ⛔ Launcher 用 ureq，只认 HTTPS_PROXY / HTTP_PROXY / ALL_PROXY 环境变量（二进制实测），
 *     **Windows 不读 WinINET、macOS 不读 SystemConfiguration** —— 必须由我们翻译成环境变量传给它，
 *     否则用户开了 Clash 这类系统代理，它仍直连 GitHub（慢到 1MB/s）。 */
export function systemProxyForLauncher(): string {
  try {
    if (process.platform === "darwin") {
      /* macOS：scutil --proxy 的 HTTPSProxy / HTTPProxy / SOCKSProxy 三段。 */
      const out = execFileSync("scutil", ["--proxy"], { encoding: "utf8", timeout: 3000 });
      const num = (key: string) => Number(new RegExp(`${key}\\s*:\\s*(\\d+)`).exec(out)?.[1] ?? 0);
      const str = (key: string) => (new RegExp(`${key}\\s*:\\s*(\\S+)`).exec(out)?.[1] ?? "").trim();
      if (num("HTTPSEnable") === 1 && str("HTTPSProxy")) return `${str("HTTPSProxy")}:${num("HTTPSPort") || 443}`;
      if (num("HTTPEnable") === 1 && str("HTTPProxy")) return `${str("HTTPProxy")}:${num("HTTPPort") || 80}`;
      if (num("SOCKSEnable") === 1 && str("SOCKSProxy")) return `socks5://${str("SOCKSProxy")}:${num("SOCKSPort") || 1080}`;
      return "";
    }
    if (process.platform !== "win32") {
      /* Linux：沿用环境里已有的代理（ureq 原生支持）。 */
      return String(process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || "").trim();
    }
    const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
    const read = (name: string) => {
      const out = execFileSync("reg", ["query", key, "/v", name], { encoding: "utf8", windowsHide: true, timeout: 3000 });
      return String(out ?? "");
    };
    if (!/ProxyEnable\s+REG_DWORD\s+0x1/i.test(read("ProxyEnable"))) return "";
    const raw = read("ProxyServer");
    const value = /ProxyServer\s+REG_SZ\s+(\S+)/i.exec(raw)?.[1] ?? "";
    if (!value) return "";
    /* ProxyServer 可能是 "127.0.0.1:7890"，也可能按协议分组 "http=...;https=..."。 */
    const pick = /(?:^|;)\s*(?:https|http)=([^;]+)/i.exec(value)?.[1] ?? value;
    return pick.replace(/^\w+:\/\//, "").trim();
  } catch { return ""; }
}

/** 打开 ArtCraft Launcher（有系统代理时注入 HTTPS_PROXY/ALL_PROXY，让它下 App 更快）。 */
export function openArtCraftLauncher(): { ok: boolean; error?: string } {
  const launcher = artcraftLauncherPath();
  if (!launcher) {
    return { ok: false, error: "ArtCraft Launcher 还没安装：请到「设置 → 开发工具 → Craft 全家桶」点安装（约 11MB）" };
  }
  try {
    /* 11-17：把系统代理传给 Launcher（ureq 只认环境变量）—— 用户抱怨 App 下载慢时，这是唯一可用的提速口。 */
    const proxy = systemProxyForLauncher();
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (proxy) {
      const url = /^[a-z0-9+.-]+:\/\//i.test(proxy) ? proxy : `http://${proxy}`;
      for (const name of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"]) {
        if (!env[name]) env[name] = url;
      }
      for (const name of ["NO_PROXY", "no_proxy"]) {
        if (!env[name]) env[name] = "localhost,127.0.0.1";
      }
    }
    /* mac 的 .app：直接 spawn 包内可执行文件，否则 `open -a` 经 launchd 启动会把环境变量丢掉。 */
    if (launcher.endsWith(".app")) {
      const exe = macAppExecutable(launcher);
      if (exe) spawn(exe, [], { detached: true, stdio: "ignore", env }).unref();
      else spawn("open", ["-a", launcher], { detached: true, stdio: "ignore", env }).unref();
      return { ok: true };
    }
    spawn(launcher, [], { detached: true, stdio: "ignore", windowsHide: false, env }).unref();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error)?.message ?? String(error) };
  }
}
