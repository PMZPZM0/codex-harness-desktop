/**
 * MoeKoe Music 对接（10-20）：本机已安装的酷狗第三方客户端 + 它的本地 API。
 *
 * 通道：
 *   · HTTP 127.0.0.1:6521（KuGouMusicApi）：/register/dev → dfid；/search 搜歌；/song/url 取流。
 *   · WebSocket 127.0.0.1:6520：仅 播放/暂停、上一首、下一首（moekoe_control）。
 *   · 安装：官方下载源（music.moekoe.cn/download.html → iAJue/MoeKoeMusic 最新 release）。
 *     官网「我是来自中国大陆（使用镜像加速下载）」= gh-proxy 前缀；本实现同序：
 *     gh-proxy → ghfast → 直连，按平台/架构选包
 *     （Windows x64·ia32 / macOS arm64·x64 zip·dmg / Linux AppImage）→ 安装/启动。
 * ⛔ 不在本应用里内置曲库/插件；只调用用户安装的 MoeKoe。付费/会员歌能否完整播放取决于 MoeKoe 登录账号
 *    的 VIP 状态，取不到就如实报错，不伪造成功。
 *
 * 声明：本集成**仅用于接口调用** —— 只调用 MoeKoe Music 的本地 KuGouMusicApi 接口，
 * 不内置其源码/资源、不收取任何费用、未对原项目进行二次创作；MoeKoe Music（GPL-2.0）
 * 与 KuGouMusicApi（MIT）版权归原作者，音乐内容版权归源站/权利人。仅用于在线试听，
 * 禁止批量下载/商业使用。
 */
import { app, net } from "electron";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { buildMirrorUrl, decodeLyricPayload, MOEKOE_MIRRORS, MOEKOE_OFFICIAL_DOWNLOAD_PAGE, MOEKOE_RELEASE_API, normalizeMoeKoeBrowse, normalizeMoeKoePrivilege, normalizeMoeKoeSearch, normalizeMoeKoeSearchType, normalizeMoeKoeSongUrl, pickLyricCandidate, pickMoeKoeInstaller, type MoeKoeSong } from "./moekoe-core";
import { createMusicStream } from "./music-streams";

const API_BASE = "http://127.0.0.1:6521";
const WS_URL = "ws://127.0.0.1:6520";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";
const SONG_CACHE_MAX = 500;

let deviceDfid = "";
const songCache = new Map<string, MoeKoeSong>();

function messageOf(error: unknown): string {
  return String((error as Error)?.message ?? error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cacheSong(song: MoeKoeSong): void {
  songCache.set(song.hash, song);
  while (songCache.size > SONG_CACHE_MAX) {
    const first = songCache.keys().next().value;
    if (!first) break;
    songCache.delete(first);
  }
}

/** 扫描常见安装位置（含自定义盘符的 Program Files，例如 D:\Program Files）。 */
export function findMoeKoeExe(): string {
  const explicit = String(process.env.MOEKOE_EXE ?? "").trim();
  if (explicit && fs.existsSync(explicit)) return explicit;
  if (process.platform === "darwin") {
    const home = process.env.HOME || app.getPath("home");
    for (const base of ["/Applications", path.join(home, "Applications")]) {
      for (const appName of ["MoeKoe Music.app", "MoeKoeMusic.app"]) {
        const macosDir = path.join(base, appName, "Contents", "MacOS");
        try {
          if (!fs.existsSync(macosDir)) continue;
          const preferred = path.join(macosDir, "MoeKoe Music");
          if (fs.existsSync(preferred)) return preferred;
          const first = fs.readdirSync(macosDir).find((name) => {
            try { return fs.statSync(path.join(macosDir, name)).isFile(); } catch { return false; }
          });
          if (first) return path.join(macosDir, first);
        } catch { /* 无权限/无此 app */ }
      }
    }
    return "";
  }
  if (process.platform === "linux") {
    const home = process.env.HOME || app.getPath("home");
    for (const candidate of ["/opt/MoeKoe Music/moekoe-music", path.join(home, "Applications", "MoeKoe Music.AppImage")]) {
      try { if (fs.existsSync(candidate)) return candidate; } catch { /* noop */ }
    }
    return "";
  }
  const candidates = new Set<string>();
  const bases = new Set<string>();
  for (const value of [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env.ProgramW6432, process.env["ProgramFiles(x86)"]]) {
    if (value) bases.add(value);
  }
  for (const base of bases) {
    candidates.add(path.join(base, "MoeKoe Music", "MoeKoe Music.exe"));
    candidates.add(path.join(base, "Programs", "MoeKoe Music", "MoeKoe Music.exe"));
  }
  for (const drive of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
    for (const dir of ["Program Files", "Program Files (x86)"]) {
      candidates.add(`${drive}:\\${dir}\\MoeKoe Music\\MoeKoe Music.exe`);
    }
  }
  for (const candidate of candidates) {
    try { if (fs.existsSync(candidate)) return candidate; } catch { /* 无权限/无此盘 */ }
  }
  return "";
}

async function apiProbe(): Promise<{ reachable: boolean; dfid: string }> {
  try {
    const response = await net.fetch(`${API_BASE}/register/dev`, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) return { reachable: false, dfid: "" };
    const data = await response.json() as any;
    return { reachable: true, dfid: String(data?.data?.dfid ?? "").trim() };
  } catch {
    return { reachable: false, dfid: "" };
  }
}

async function apiPing(): Promise<string> {
  return (await apiProbe()).dfid;
}

async function ensureApi(launch = true): Promise<void> {
  const probe = await apiProbe();
  if (probe.dfid) deviceDfid = probe.dfid;
  // ⛔ 服务可达但 /register/dev 暂时不发 dfid（酷狗风控/注册抖动）不等于 API 挂了：
  //   搜索/专辑/歌词/音质权限都能无 dfid 调；只有取流需要 dfid，由 playMoeKoe 如实报错。
  if (probe.reachable) return;
  const exe = findMoeKoeExe();
  if (!exe) throw new Error("没有找到 MoeKoe Music（未安装或不在常见路径）；先调用 moekoe_install 安装");
  if (!launch) throw new Error("MoeKoe Music 已安装但 API 6521 没在运行");
  launchInstalledApp(exe);
  for (let attempt = 0; attempt < 40; attempt++) {
    await sleep(500);
    const next = await apiProbe();
    if (next.dfid) deviceDfid = next.dfid;
    if (next.reachable) return;
  }
  throw new Error("已启动 MoeKoe Music，但 API 6521 在 20 秒内没有就绪（可能还在加载，或被客户端设置关闭）");
}

async function apiJson(pathname: string, timeoutMs = 20_000): Promise<any> {
  await ensureApi();
  const headers: Record<string, string> = { accept: "application/json", "user-agent": USER_AGENT };
  if (deviceDfid) headers.Authorization = `dfid=${deviceDfid}`;
  const response = await net.fetch(`${API_BASE}${pathname}`, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await response.text();
  try { return JSON.parse(raw); }
  catch { throw new Error(`MoeKoe API 没有返回 JSON（HTTP ${response.status}）：${raw.slice(0, 120)}`); }
}

export async function moekoeStatus() {
  const exe = findMoeKoeExe();
  const probe = await apiProbe();
  if (probe.dfid) deviceDfid = probe.dfid;
  return {
    installed: Boolean(exe),
    running: probe.reachable,
    api: API_BASE,
    exe: exe || "",
    accountNote: "API 不返回会员状态；standard（128k，客户端同款 ppage_id）通常可完整播放，high/lossless 可能触发会员/版权试听。",
  };
}

export type MoeKoeSearchInput = { query?: unknown; limit?: unknown; type?: unknown };

export async function searchMoeKoe(input: MoeKoeSearchInput = {}) {
  const query = String(input.query ?? "").trim();
  const type = normalizeMoeKoeSearchType(input.type);
  const limit = Math.max(1, Math.min(50, Math.floor(Number(input.limit)) || 20));
  if (!query) {
    return { query: "", ...(await moekoeStatus()), results: [], hint: "query 留空只返回 MoeKoe 安装/API 状态；带上歌名/歌手再搜。" };
  }
  if (type !== "song") {
    const payload = await apiJson(`/search?keywords=${encodeURIComponent(query)}&page=1&pagesize=${limit}&type=${type}`);
    const results = normalizeMoeKoeBrowse(type, payload, limit);
    return {
      query,
      type,
      source: "MoeKoe Music / 酷狗",
      total: Number(payload?.data?.total ?? results.length) || results.length,
      results,
      hint: type === "special"
        ? "special=歌单（播放列表）元数据；播歌请用 type=song 搜歌名/歌手。"
        : `${type} 是元数据；播歌请用 type=song 搜歌名/歌手。`,
    };
  }
  const payload = await apiJson(`/search?keywords=${encodeURIComponent(query)}&page=1&pagesize=${limit}&type=song`);
  const results = normalizeMoeKoeSearch(payload, limit);
  for (const song of results) cacheSong(song);
  const free = results.filter((song) => song.free).length;
  return {
    query,
    source: "MoeKoe Music / 酷狗",
    total: Number(payload?.data?.total ?? results.length) || results.length,
    free,
    results,
    hint: free === results.length
      ? "全部是免费歌，可直接 moekoe_play。"
      : `其中 ${results.length - free} 首为付费/会员歌（free=false）；取流失败时先降回 quality=standard 再试。`,
  };
}

export type MoeKoeLyricInput = { hash?: unknown; title?: unknown; artist?: unknown };

export async function moeKoeLyric(input: MoeKoeLyricInput) {
  const hash = String(input.hash ?? "").trim();
  const cached = hash ? songCache.get(hash) : undefined;
  const title = String(input.title ?? cached?.title ?? "").trim();
  const artist = String(input.artist ?? cached?.artist ?? "").trim();
  const query = [title, artist].filter(Boolean).join(" ") || hash;
  if (!query) throw new Error("缺少 hash 或 title（用 moekoe_search 拿）");
  const params = new URLSearchParams({ keywords: query, man: "no" });
  if (hash) params.set("hash", hash);
  const found = await apiJson(`/search/lyric?${params.toString()}`);
  const candidate = pickLyricCandidate(found);
  if (!candidate) throw new Error("没有找到匹配歌词；可以换歌名+歌手或只传 hash 再试");
  const payload = await apiJson(`/lyric?id=${encodeURIComponent(candidate.id)}&accesskey=${encodeURIComponent(candidate.accesskey)}&fmt=lrc&decode=true`);
  const lyric = decodeLyricPayload(payload);
  if (!lyric.trim()) throw new Error("歌词接口返回为空（可能这首没有授权歌词）");
  return { hash, title: title || candidate.song, singer: artist || candidate.singer, source: candidate.source || "MoeKoe 歌词", format: "lrc", lyric };
}

export async function moeKoeQualities(input: { hash?: unknown }) {
  const hash = String(input.hash ?? "").trim();
  if (!hash) throw new Error("缺少 hash（用 moekoe_search 拿）");
  const cached = songCache.get(hash);
  const payload = await apiJson(`/privilege/lite?hash=${encodeURIComponent(hash)}`);
  const summary = normalizeMoeKoePrivilege(payload, cached);
  return { hash, title: cached?.title ?? "", artist: cached?.artist ?? "", source: "MoeKoe Music / 酷狗", ...summary };
}

export type MoeKoePlayInput = { hash?: unknown; albumId?: unknown; audioId?: unknown; quality?: unknown; title?: unknown; artist?: unknown; artwork?: unknown };

export async function playMoeKoe(input: MoeKoePlayInput) {
  const hash = String(input.hash ?? "").trim();
  if (!hash) throw new Error("缺少 hash（用 moekoe_search 结果里的 hash）");
  await ensureApi();
  const cached = songCache.get(hash);
  const title = String(input.title ?? cached?.title ?? "").trim();
  const artist = String(input.artist ?? cached?.artist ?? "").trim();
  const artwork = String(input.artwork ?? cached?.artwork ?? "").trim();
  const qualityKey = String(input.quality ?? "standard");
  const quality = qualityKey === "lossless" ? "flac" : qualityKey === "high" ? "320" : "128";
  // ⛔ ppage_id 是 MoeKoe 客户端同款参数：缺了它，付费歌会被判风控/只给 60 秒试听（实测）。
  const payload = await apiJson(`/song/url?hash=${encodeURIComponent(hash)}&quality=${quality}&ppage_id=356753938`, 25_000);
  const normalized = normalizeMoeKoeSongUrl(payload);
  if (!normalized.url) {
    const pay = cached ? `（PayType=${cached.payType}${cached.free ? "，标记为免费" : ""}）` : "";
    throw new Error(`${normalized.error}${pay}。标准音质（quality=standard）通常可完整播放；高音质失败可降档重试，仍失败再在 MoeKoe 客户端播放一次完成安全验证。`);
  }
  // ⛔ 不要加 Referer：酷狗 CDN 对 Referer 返回 ERR_BLOCKED_BY_CLIENT（实测），只带 UA 即可
  const token = createMusicStream(normalized.url, { "user-agent": USER_AGENT });
  const displayTitle = `${title || "MoeKoe 音乐"}${artist ? ` - ${artist}` : ""}`;
  const { sendToWindow } = await import("./features/window-bus");
  sendToWindow("media-preview:open", {
    source: `harness-music://stream/${token}`,
    kind: "audio",
    title: displayTitle,
    poster: artwork,
    autoPlay: true,
  });
  return { playing: true, title: displayTitle, source: "MoeKoe Music / 酷狗", quality: qualityKey, url: normalized.url };
}

export async function controlMoeKoe(action: string) {
  const command = String(action ?? "").trim();
  if (!["toggle", "next", "prev"].includes(command)) throw new Error("action 只支持 toggle / next / prev");
  await ensureApi();
  const { default: WebSocket } = await import("ws");
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let state: Record<string, unknown> = {};
    const timer = setTimeout(() => { try { ws.close(); } catch { /* noop */ } reject(new Error("连接 MoeKoe 6520 控制通道超时")); }, 4_000);
    ws.on("message", (raw: any) => {
      try {
        const message = JSON.parse(String(raw));
        if (message?.type === "playerState") state = message.data ?? {};
      } catch { /* 忽略非 JSON */ }
    });
    ws.on("open", () => {
      setTimeout(() => {
        try { ws.send(JSON.stringify({ type: "control", data: { command } })); } catch { /* noop */ }
        setTimeout(() => {
          clearTimeout(timer);
          try { ws.close(); } catch { /* noop */ }
          resolve({ ok: true, command, state });
        }, 450);
      }, 250);
    });
    ws.on("error", (error: Error) => { clearTimeout(timer); reject(new Error(`连接 MoeKoe 6520 失败：${messageOf(error)}`)); });
  });
}

function canWriteDir(dir: string): boolean {
  try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; }
}

/** 启动已安装客户端：macOS 走 LaunchServices（open -a），其余直接执行二进制。 */
function launchInstalledApp(binary: string): void {
  if (process.platform === "darwin" && /\/Contents\/MacOS\//i.test(binary)) {
    const appPath = binary.replace(/\/Contents\/MacOS\/.*$/i, "");
    spawn("open", ["-a", appPath || binary], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn(binary, [], { detached: true, stdio: "ignore" }).unref();
}

/** 下载完成后的安装动作：Windows 启动 NSIS；macOS 解压 zip 到 Applications；Linux 运行 AppImage。 */
function launchDownloadedInstaller(target: string) {
  if (process.platform === "darwin") {
    if (/\.dmg$/i.test(target)) {
      spawn("open", [target], { detached: true, stdio: "ignore" }).unref();
      return { action: "dmg-opened" as const, installer: target, message: "已打开 dmg，请把 MoeKoe Music 拖入 Applications；完成后调用 moekoe_status。" };
    }
    if (!/\.zip$/i.test(target)) throw new Error("macOS 自动安装只支持 .zip；.dmg 请手动打开拖入 Applications");
    const tmp = `${target}.unpack`;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    const unpacked = spawnSync("ditto", ["-x", "-k", target, tmp], { stdio: "ignore" });
    if (unpacked.status !== 0) throw new Error("解压 macOS 安装包失败（ditto 返回非零）");
    const appName = fs.readdirSync(tmp).find((name) => name.endsWith(".app"));
    if (!appName) throw new Error("macOS 安装包里没有找到 .app");
    const destBase = canWriteDir("/Applications") ? "/Applications" : path.join(app.getPath("home"), "Applications");
    fs.mkdirSync(destBase, { recursive: true });
    const dest = path.join(destBase, appName);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(path.join(tmp, appName), dest, { recursive: true });
    fs.rmSync(tmp, { recursive: true, force: true });
    spawn("open", ["-a", dest], { detached: true, stdio: "ignore" }).unref();
    return { action: "installed-mac" as const, installer: target, app: dest, message: `已安装到 ${dest} 并启动；如 macOS 提示安全验证，请在「系统设置 → 隐私与安全性」允许。` };
  }
  if (process.platform === "linux") {
    fs.chmodSync(target, 0o755);
    spawn(target, [], { detached: true, stdio: "ignore" }).unref();
    return { action: "appimage-launched" as const, installer: target, message: "已启动 AppImage；请完成首次运行后调用 moekoe_status。" };
  }
  spawn(target, [], { detached: true, stdio: "ignore" }).unref();
  return { action: "installer-launched" as const, installer: target, message: "安装包已启动；请完成安装后调用 moekoe_status。" };
}

export async function installMoeKoe(input: { confirm?: unknown } = {}) {
  const status = await moekoeStatus();
  if (status.running) return { ...status, action: "none", message: "MoeKoe Music 已安装并正在运行，无需安装。" };
  if (status.installed) {
    launchInstalledApp(status.exe);
    return { ...status, action: "launched", message: "MoeKoe Music 已安装，已帮您启动；等它加载完再搜索/播放。" };
  }
  if (input.confirm !== true) {
    const platformHint = process.platform === "darwin"
      ? (/arm64/i.test(process.arch) ? "macOS Apple Silicon（arm64 zip）" : "macOS Intel（x64 zip）")
      : process.platform === "win32"
        ? (/ia32|x86/i.test(process.arch) ? "Windows 32 位（ia32 exe）" : "Windows 64 位（x64 exe）")
        : "Linux AppImage";
    return {
      ...status,
      action: "needs-confirm",
      platformPackage: platformHint,
      officialPage: MOEKOE_OFFICIAL_DOWNLOAD_PAGE,
      message: `尚未安装 MoeKoe Music。安装会从官方下载源（${MOEKOE_OFFICIAL_DOWNLOAD_PAGE} 同款 GitHub release，国内走 gh-proxy 镜像）下载 ${platformHint}，约 130–160MB，并启动安装程序（会改动系统，可能弹 UAC 或 macOS 安全提示）。用户确认后带 confirm=true 再调用 moekoe_install。`,
    };
  }
  const releaseResponse = await net.fetch(MOEKOE_RELEASE_API, {
    headers: { accept: "application/vnd.github+json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!releaseResponse.ok) throw new Error(`获取 MoeKoe 官方最新版本失败：HTTP ${releaseResponse.status}（下载页 ${MOEKOE_OFFICIAL_DOWNLOAD_PAGE}）`);
  const release = await releaseResponse.json() as any;
  const asset = pickMoeKoeInstaller(release?.assets, process.platform, process.arch);
  if (!asset) throw new Error(`官方 release ${release?.tag_name ?? ""} 里没有匹配 ${process.platform}/${process.arch} 的安装包（支持 Windows x64·ia32 / macOS arm64·x64 / Linux AppImage）；可到 ${MOEKOE_OFFICIAL_DOWNLOAD_PAGE} 手动下载`);
  const dir = path.join(app.getPath("userData"), "downloads");
  await fsp.mkdir(dir, { recursive: true });
  const target = path.join(dir, asset.name);
  if (fs.existsSync(target)) {
    const stat = fs.statSync(target);
    if (!asset.size || stat.size === asset.size) {
      const launched = launchDownloadedInstaller(target);
      return { ...status, ...launched, source: "official", mirror: "cache", asset: asset.name };
    }
    fs.rmSync(target, { force: true });
  }
  let lastError = "";
  for (const mirror of MOEKOE_MIRRORS) {
    const url = buildMirrorUrl(mirror, asset.url);
    const part = `${target}.part`;
    try {
      const response = await net.fetch(url, {
        headers: { "user-agent": USER_AGENT },
        redirect: "follow",
        signal: AbortSignal.timeout(10 * 60_000),
      });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body as any), fs.createWriteStream(part));
      const stat = fs.statSync(part);
      if (asset.size && stat.size !== asset.size) throw new Error(`大小不符（${stat.size}/${asset.size}）`);
      fs.renameSync(part, target);
      const launched = launchDownloadedInstaller(target);
      return { ...status, ...launched, source: "official", mirror: mirror || "github", asset: asset.name, bytes: stat.size };
    } catch (error) {
      lastError = messageOf(error);
      try { fs.rmSync(part, { force: true }); } catch { /* noop */ }
    }
  }
  throw new Error(`下载或安装失败：${lastError}。可以稍后重试，或到官方下载页 ${MOEKOE_OFFICIAL_DOWNLOAD_PAGE} 手动下载（中国大陆勾选镜像加速）。`);
}
