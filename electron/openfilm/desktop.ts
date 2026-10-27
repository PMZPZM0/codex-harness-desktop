/**
 * OpenFilm **桌面端**（10-27 批次三 / P4）。
 *
 * 用户令：「有桌面端会更方便」。桌面端 = 上游的 Electron 壳（`apps/desktop`），
 * 自带 ffmpeg 与浏览器、双击即用、Studio 与 CLI **共用同一个项目库**（`~/.openfilm` 与
 * `libraryRoot()` 都是机器级的）。所以我们这条链的价值是：**一次点击把它弄到用户手上**，
 * 而不是自己再做一套播放器。
 *
 * ── 硬纪律（照 docs/OPENFILM-INTEGRATION-2026-10-27.md §1.6 / §6）──────────────
 *   ① **只从上游官方 Release 取包，不镜像、不重打包、不改名**：装的是人家的签名/未公证原包，
 *      我们只负责「下载 → 校验 → 启动它的安装器」。⛔ 不做自家 CDN（那样就得承担分发责任与 notices）。
 *   ② **完整性靠 asset.digest**（GitHub 对每个资产自带 `sha256:…`）。镜像候选序由 `gh-mirror` 统一
 *      （gh-proxy → ghfast → 直连），⚠️ 第三方反代理论上能改包体 ⇒ **必须校验**，校验不过就换下一档。
 *   ③ **不代跑它自己的 electron-updater**：App 更新归 App（菜单里 Check for Updates），我们只显示版本。
 *   ④ **卸载不代删**：Windows 启动它自带的 Uninstall.exe；macOS 在 Finder 里选中 .app 让用户自己扔。
 *      ⛔ 我们绝不 `rm -rf /Applications/OpenFilm.app` —— 那是用户的系统目录。
 *   ⑤ **Windows 只有 x64**（上游不产 arm64）⇒ ARM 设备如实说明「只能用 CLI 形态」，不假装能装。
 *
 * 复用而不是重写：下载 = `updates.downloadUpdate()`（它已经做了镜像候选 / 跟随 302 / 强制 https /
 * sha256 比对 / 校验失败删半截文件）。那时为什么写在那里而不是这里：那份是自更新用的同一条链路，
 * 同一套镜像与校验逻辑，⛔ 再写第二份就会有两处会漂移的「下载」。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { shell } from "electron";
import { mirrorCandidates } from "../gh-mirror";
import { compareVersions, downloadUpdate } from "../updates";
import { broadcastCodexEvent } from "../features/window-bus";
import { desktopDir } from "./paths";
import { launchDetached, runExe } from "./runner";
import { probeStudio } from "./studio";

const REPO = "openfilm/openfilm";
const RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;

type Asset = { name: string; size: number; digest: string; url: string };
export type DesktopRelease = { version: string; tag: string; assets: Asset[]; from: string };

export type DesktopInstalled = { installed: boolean; path: string; version: string };

/** 装在哪（按平台约定；⛔ 只认这两个位置，不扫全盘）。 */
function installedPaths(): string[] {
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return [
      path.join(local, "Programs", "OpenFilm", "OpenFilm.exe"),
      path.join(process.env.ProgramFiles || "C:\\Program Files", "OpenFilm", "OpenFilm.exe"),
    ];
  }
  if (process.platform === "darwin") return ["/Applications/OpenFilm.app", path.join(os.homedir(), "Applications", "OpenFilm.app")];
  return [];
}

export function desktopInstalled(): DesktopInstalled {
  const candidates = installedPaths();
  const found = candidates.find((candidate) => {
    try { return fs.existsSync(candidate); } catch { return false; }
  }) ?? "";
  /* 版本：App 在跑时 Studio 的 health 会报（`app:true`），否则只能空着 ——
     ⛔ 不去解析 exe 的 VersionInfo（要 PowerShell，沙箱里常被禁）。 */
  return { installed: Boolean(found), path: found, version: "" };
}

/** GitHub API（镜像候选序：gh-proxy 通、ghfast 对 API 已 403、直连兜底）。 */
async function fetchRelease(): Promise<DesktopRelease> {
  let lastError = "";
  for (const candidate of mirrorCandidates(RELEASE_API)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(candidate, {
        signal: controller.signal,
        headers: { "User-Agent": "CodexHarness/openfilm", Accept: "application/vnd.github+json" },
      });
      if (!response.ok) { lastError = `HTTP ${response.status}`; continue; }
      const data: any = await response.json();
      const tag = String(data?.tag_name ?? "");
      const assets: Asset[] = (Array.isArray(data?.assets) ? data.assets : []).map((item: any) => ({
        name: String(item?.name ?? ""),
        size: Number(item?.size ?? 0) || 0,
        digest: String(item?.digest ?? ""),
        url: String(item?.browser_download_url ?? ""),
      })).filter((item: Asset) => item.name && item.url);
      if (!tag || !assets.length) { lastError = "release 里没有资产"; continue; }
      return { version: tag.replace(/^v/i, ""), tag, assets, from: new URL(candidate).host || "github.com" };
    } catch (error: any) {
      lastError = String(error?.message ?? error);
    } finally { clearTimeout(timer); }
  }
  throw new Error(`读取 OpenFilm 最新版失败：${lastError}`);
}

/** 按平台挑包（Windows 只有 x64；macOS 分 arm64 / x64）。 */
export function pickAsset(assets: Asset[], platform = process.platform, arch = process.arch): Asset | null {
  const find = (pattern: RegExp) => assets.find((asset) => pattern.test(asset.name)) ?? null;
  if (platform === "win32") return find(/^OpenFilm-Setup-.*\.exe$/i) ?? find(/\.exe$/i);
  if (platform === "darwin") return arch === "arm64" ? find(/arm64\.dmg$/i) : find(/x64\.dmg$/i);
  return null;
}

/** 本地已下载的包（`<安装根>/desktop/<资产名>`）。 */
function localPackage(name: string): { path: string; size: number } | null {
  if (!name) return null;
  const target = path.join(desktopDir(), name);
  try {
    const stat = fs.statSync(target);
    return stat.isFile() ? { path: target, size: stat.size } : null;
  } catch { return null; }
}

export type DesktopInfo = {
  /** 这台机器能不能装桌面端（Linux / Windows ARM 都不行 —— 上游没产物） */
  supported: boolean;
  reason: string;
  platform: "win32" | "darwin" | "linux";
  installed: DesktopInstalled;
  /** 上游最新版（拉不到时为空 + error） */
  version: string;
  error: string;
  asset: { name: string; size: number } | null;
  /** 已经下载到本地的安装包 */
  local: { path: string; size: number } | null;
  /** 本地包版本落后于上游？ */
  localOutdated: boolean;
  /** Studio 是不是桌面 App 起的（说明用户已经在用桌面端） */
  runningApp: boolean;
};

export async function desktopInfo(): Promise<DesktopInfo> {
  const platform = process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "win32" : "linux";
  const installed = desktopInstalled();
  const studio = await probeStudio().catch(() => null);
  const base: DesktopInfo = {
    supported: platform !== "linux",
    reason: platform === "linux" ? "上游目前只发 Windows / macOS 产物（Linux 可用 CLI 形态）" : "",
    platform, installed, version: "", error: "", asset: null, local: null, localOutdated: false,
    runningApp: Boolean(studio?.app),
  };
  if (!base.supported) return base;
  let release: DesktopRelease;
  try {
    release = await fetchRelease();
  } catch (error: any) {
    return { ...base, error: String(error?.message ?? error) };
  }
  const asset = pickAsset(release.assets);
  const local = asset ? localPackage(asset.name) : null;
  /* 包名里带版本（`OpenFilm-0.2.6-arm64-mac.zip`），dmg / exe 不带 ⇒ 用"上游版本 vs 上次记录的版本"判断过期。
     ⛔ 不去猜本地包的版本（文件名不可靠），只看下载记录文件。 */
  return {
    ...base,
    version: release.version,
    asset: asset ? { name: asset.name, size: asset.size } : null,
    local: local ? { path: local.path, size: local.size } : null,
    localOutdated: Boolean(local && readStamp() && compareVersions(release.version, readStamp()) > 0),
    error: asset ? "" : `上游没有适合本机（${platform}/${process.arch}）的安装包`,
  };
}

/** 下载记录（只记"本地这个包是哪个版本"，用来判断过期）。 */
function stampFile(): string {
  return path.join(desktopDir(), "version.txt");
}
function readStamp(): string {
  try { return fs.readFileSync(stampFile(), "utf8").trim(); } catch { return ""; }
}

function progress(pct: number, log: string) {
  broadcastCodexEvent({ type: "openfilm", phase: "desktop", step: "download", label: "下载桌面端安装包", pct: Math.round(pct), log });
}

/**
 * 下载并校验安装包（走 `downloadUpdate`：镜像候选 + 302 + 强制 https + sha256）。
 * ⛔ 校验不过就换下一档并删掉半截文件（那是它内部行为），全失败则报错给用户。
 */
export async function downloadDesktop(): Promise<{ ok: boolean; path?: string; error?: string; version?: string; info?: DesktopInfo }> {
  /* ⛔ 先判平台（纯本地），再拉 Release —— 别为了"支持吗"先打一次 GitHub API。
     整条路径只拉**一次** API（`info` 里的那次是返回前给界面刷新的，不是重复判断）。 */
  if (process.platform !== "win32" && process.platform !== "darwin") {
    return { ok: false, error: "上游目前只发 Windows / macOS 产物（Linux 可用 CLI 形态）" };
  }
  let release: DesktopRelease;
  try {
    release = await fetchRelease();
  } catch (error: any) {
    return { ok: false, error: String(error?.message ?? error) };
  }
  const asset = pickAsset(release.assets);
  if (!asset) return { ok: false, error: `上游没有适合本机（${process.platform}/${process.arch}）的安装包` };
  const sha256 = asset.digest.replace(/^sha256:/i, "");
  const target = path.join(desktopDir(), asset.name);
  fs.mkdirSync(desktopDir(), { recursive: true });
  progress(1, `从 GitHub 获取 ${asset.name}（${(asset.size / 1048576).toFixed(0)}MB）…`);
  try {
    const result = await downloadUpdate(asset.url, target, ({ percent, receivedBytes }) => {
      progress(Math.max(2, Math.min(99, percent * 100)), `已下载 ${(receivedBytes / 1048576).toFixed(1)}MB / ${(asset.size / 1048576).toFixed(0)}MB`);
    }, sha256 || undefined);
    fs.writeFileSync(stampFile(), release.version, "utf8");
    progress(100, `已校验并保存：${result.path}`);
    return { ok: true, path: result.path, version: release.version, info: await desktopInfo() };
  } catch (error: any) {
    progress(0, "");
    return { ok: false, error: String(error?.message ?? error), info: await desktopInfo() };
  }
}

export type DesktopAction = "install" | "silent" | "reveal" | "uninstall";

export type DesktopRunResult = { ok: boolean; action: DesktopAction; error?: string; note?: string; info?: DesktopInfo };

/** 打开安装包所在目录并选中它（⛔ 不代跑：先让用户看见这个文件是什么）。 */
function revealFile(target: string): { ok: boolean; error?: string } {
  try {
    if (!fs.existsSync(target)) return { ok: false, error: `找不到文件：${target}` };
    shell.showItemInFolder(target);
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

/**
 * macOS：挂载 dmg → 拷 .app 到 /Applications → 清 quarantine → 卸载镜像。
 * ⛔ 必须清 quarantine：上游包**未公证**，不清会被 Gatekeeper 拦（设计稿 §6）。
 * ⛔ 目标已存在就先拒绝（覆盖安装可能丢用户设置，交给用户决定：用 reveal 自己去拖）。
 */
async function installMacDmg(dmg: string): Promise<{ ok: boolean; error?: string; note?: string }> {
  const mountPoint = path.join(os.tmpdir(), `openfilm-mount-${Date.now()}`);
  try { fs.mkdirSync(mountPoint, { recursive: true }); } catch { /* 已存在 */ }
  const attach = await runExe("hdiutil", ["attach", "-nobrowse", "-quiet", "-mountpoint", mountPoint, dmg], { timeoutMs: 120_000 });
  if (attach.code !== 0) return { ok: false, error: `挂载失败：${(attach.stderr || attach.stdout).trim().slice(-300)}` };
  try {
    const appName = fs.readdirSync(mountPoint).find((name) => name.endsWith(".app"));
    if (!appName) return { ok: false, error: "安装包里没有 .app（镜像内容异常）" };
    const source = path.join(mountPoint, appName);
    const target = path.join("/Applications", appName);
    if (fs.existsSync(target)) {
      return { ok: false, error: `/Applications 里已经有 ${appName}：请先把它拖到废纸篓（或直接用「打开安装包」自己覆盖）` };
    }
    const copy = await runExe("cp", ["-R", source, target], { timeoutMs: 300_000 });
    if (copy.code !== 0) return { ok: false, error: `拷贝到 /Applications 失败：${(copy.stderr || copy.stdout).trim().slice(-300)}` };
    /* 未公证包：不清 quarantine 会被 Gatekeeper 拦下 */
    await runExe("xattr", ["-dr", "com.apple.quarantine", target], { timeoutMs: 60_000 });
    await launchDetached("open", ["-a", target]);
    return { ok: true, note: `已安装到 ${target} 并启动（上游包未公证，已替你清掉 quarantine）` };
  } finally {
    await runExe("hdiutil", ["detach", mountPoint, "-quiet"], { timeoutMs: 120_000 }).catch(() => undefined);
    try { fs.rmdirSync(mountPoint); } catch { /* 非空/已被卸载 */ }
  }
}

/**
 * 动作分发。
 *  · install  Windows：带界面跑安装器（看得见、UAC 由系统弹）；macOS：挂载 dmg 自动装。
 *  · silent   Windows：NSIS `/S` 静默装（首次可能弹 UAC）；macOS 不支持（无静默安装概念）。
 *  · reveal   打开安装包所在目录（macOS 同时尝试 `open` 挂载 dmg，让用户自己拖）。
 *  · uninstall 启动上游自带卸载器 / 在 Finder 里选中 .app（⛔ 我们绝不代删）。
 */
export async function runDesktop(action: DesktopAction): Promise<DesktopRunResult> {
  const info = await desktopInfo();
  const asset = info.asset;
  const local = asset ? localPackage(asset.name) : null;
  const pkg = local?.path ?? "";

  if (action === "reveal") {
    /* 没有包就先看已安装位置（用户可能想找 App 本体） */
    const target = pkg || info.installed.path;
    if (!target) return { ok: false, action, error: "还没有下载安装包，也找不到已安装的程序", info };
    if (!pkg && process.platform === "darwin") {
      const opened = await launchDetached("open", ["-R", target]);
      return { ok: opened.ok, action, error: opened.error, note: "已在 Finder 里选中 App", info };
    }
    const revealed = revealFile(target);
    return { ok: revealed.ok, action, error: revealed.error, info };
  }

  if (action === "uninstall") {
    if (!info.installed.installed) return { ok: false, action, error: "没有检测到已安装的桌面端", info };
    if (process.platform === "win32") {
      const dir = path.dirname(info.installed.path);
      let uninstaller = "";
      try {
        uninstaller = fs.readdirSync(dir).filter((name) => /^Uninstall.*\.exe$/i.test(name))
          .map((name) => path.join(dir, name))[0] ?? "";
      } catch { /* 目录读不到就走 reveal 兜底 */ }
      if (uninstaller) {
        const run = await launchDetached(uninstaller, []);
        return { ok: run.ok, action, error: run.error, note: run.ok ? "已启动上游卸载程序（按它的界面走完）" : "", info };
      }
      const revealed = revealFile(info.installed.path);
      return { ok: revealed.ok, action, error: revealed.error, note: "没找到卸载器，已在资源管理器里定位到安装目录", info };
    }
    /* macOS：只选中，不代删 —— 拖进废纸篓是用户的动作 */
    const opened = await launchDetached("open", ["-R", info.installed.path]);
    return { ok: opened.ok, action, error: opened.error, note: "已在 Finder 里选中 OpenFilm.app：把它拖进废纸篓即卸载（⛔ 我们不会替你删系统目录）", info };
  }

  /* install / silent */
  if (!pkg) return { ok: false, action, error: "还没下载安装包：先点「下载桌面端」", info };
  if (process.platform === "darwin") {
    if (action === "silent") return { ok: false, action, error: "macOS 没有静默安装：用「打开安装包」自己拖，或点「安装」由我们挂载拷贝", info };
    const result = await installMacDmg(pkg);
    return { ok: result.ok, action, error: result.error, note: result.note, info: await desktopInfo() };
  }
  if (process.platform !== "win32") return { ok: false, action, error: "当前平台不支持桌面端安装", info };
  /* Windows：带界面 = 什么都不加；静默 = NSIS `/S`（⛔ 不加 /D，让上游用它自己的默认目录） */
  const args = action === "silent" ? ["/S"] : [];
  const run = await launchDetached(pkg, args, { cwd: path.dirname(pkg) });
  return {
    ok: run.ok, action, error: run.error,
    note: run.ok ? (action === "silent" ? "已开始静默安装（首次可能弹一次 UAC 授权）" : "已打开安装程序，按它的界面走完即可") : "",
    info,
  };
}

/** 给模型/界面的一句话概述（⛔ 不夸大：我们只管下载与启动安装器）。 */
export function desktopSummary(info: DesktopInfo): string {
  if (!info.supported) return `本机不支持桌面端：${info.reason}`;
  const parts = [`桌面端：${info.installed.installed ? `已安装（${info.installed.path}）` : "未安装"}`];
  if (info.version) parts.push(`上游最新 ${info.version}`);
  if (info.local) parts.push(`安装包已下载（${(info.local.size / 1048576).toFixed(0)}MB）`);
  if (info.runningApp) parts.push("当前 Studio 由桌面 App 启动");
  if (info.error) parts.push(`提示：${info.error}`);
  return parts.join(" · ");
}
