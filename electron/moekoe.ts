/**
 * MoeKoe Music 对接（10-20）：本机已安装的酷狗第三方客户端 + 它的本地 API。
 *
 * 通道：
 *   · HTTP 127.0.0.1:6521（KuGouMusicApi）：/register/dev → dfid；/search 搜歌；/song/url 取流。
 *   · WebSocket 127.0.0.1:6520：仅 播放/暂停、上一首、下一首（moekoe_control）。
 *   · 安装：GitHub release → 国内镜像（gh-proxy / ghfast）下载 x64 安装包 → 启动安装程序。
 * ⛔ 不在本应用里内置曲库/插件；只调用用户安装的 MoeKoe。付费/会员歌能否完整播放取决于 MoeKoe 登录账号
 *    的 VIP 状态（本机实测 is_vip=0 → 60s 试听），取不到就如实报错，不伪造成功。
 */
import { app, net } from "electron";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { buildMirrorUrl, normalizeMoeKoeSearch, normalizeMoeKoeSongUrl, pickMoeKoeInstaller, type MoeKoeSong } from "./moekoe-core";
import { createMusicStream } from "./music-streams";

const API_BASE = "http://127.0.0.1:6521";
const WS_URL = "ws://127.0.0.1:6520";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";
const MIRRORS = ["https://gh-proxy.com/", "https://ghfast.top/", ""];
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

async function apiPing(): Promise<string> {
  try {
    const response = await net.fetch(`${API_BASE}/register/dev`, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) return "";
    const data = await response.json() as any;
    const dfid = String(data?.data?.dfid ?? "").trim();
    return dfid;
  } catch {
    return "";
  }
}

async function ensureApi(launch = true): Promise<void> {
  const dfid = await apiPing();
  if (dfid) { deviceDfid = dfid; return; }
  const exe = findMoeKoeExe();
  if (!exe) throw new Error("没有找到 MoeKoe Music（未安装或不在常见路径）；先调用 moekoe_install 安装");
  if (!launch) throw new Error("MoeKoe Music 已安装但 API 6521 没在运行");
  spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
  for (let attempt = 0; attempt < 40; attempt++) {
    await sleep(500);
    const next = await apiPing();
    if (next) { deviceDfid = next; return; }
  }
  throw new Error("已启动 MoeKoe Music，但 API 6521 在 20 秒内没有就绪（可能还在加载，或被客户端设置关闭）");
}

async function apiJson(pathname: string, timeoutMs = 20_000): Promise<any> {
  await ensureApi();
  const response = await net.fetch(`${API_BASE}${pathname}`, {
    headers: { accept: "application/json", "user-agent": USER_AGENT, Authorization: `dfid=${deviceDfid}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await response.text();
  try { return JSON.parse(raw); }
  catch { throw new Error(`MoeKoe API 没有返回 JSON（HTTP ${response.status}）：${raw.slice(0, 120)}`); }
}

export async function moekoeStatus() {
  const exe = findMoeKoeExe();
  const dfid = await apiPing();
  if (dfid) deviceDfid = dfid;
  return {
    installed: Boolean(exe),
    running: Boolean(dfid),
    api: API_BASE,
    exe: exe || "",
    accountNote: "API 不返回会员状态；付费歌是否完整取决于 MoeKoe 登录账号的 VIP（本机实测 is_vip=0 时只给 60 秒试听）。",
  };
}

export type MoeKoeSearchInput = { query?: unknown; limit?: unknown };

export async function searchMoeKoe(input: MoeKoeSearchInput = {}) {
  const query = String(input.query ?? "").trim();
  const limit = Math.max(1, Math.min(50, Math.floor(Number(input.limit)) || 20));
  if (!query) {
    return { query: "", ...(await moekoeStatus()), results: [], hint: "query 留空只返回 MoeKoe 安装/API 状态；带上歌名/歌手再搜。" };
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
      : `其中 ${results.length - free} 首为付费/会员歌（free=false）；当前 MoeKoe 账号若无 VIP，取流只会得到 60 秒试听。优先选 free=true 的结果，或先在 MoeKoe 登录会员账号。`,
  };
}

export type MoeKoePlayInput = { hash?: unknown; albumId?: unknown; audioId?: unknown; quality?: unknown; title?: unknown; artist?: unknown; artwork?: unknown };

export async function playMoeKoe(input: MoeKoePlayInput) {
  const hash = String(input.hash ?? "").trim();
  if (!hash) throw new Error("缺少 hash（用 moekoe_search 结果里的 hash）");
  await ensureApi();
  const cached = songCache.get(hash);
  const albumId = String(input.albumId ?? cached?.albumId ?? "").trim();
  const audioId = String(input.audioId ?? cached?.audioId ?? "").trim();
  const title = String(input.title ?? cached?.title ?? "").trim();
  const artist = String(input.artist ?? cached?.artist ?? "").trim();
  const artwork = String(input.artwork ?? cached?.artwork ?? "").trim();
  const qualityKey = String(input.quality ?? "standard");
  const quality = qualityKey === "lossless" ? "flac" : qualityKey === "high" ? "320" : "128";
  const payload = await apiJson(`/song/url?hash=${encodeURIComponent(hash)}&album_id=${encodeURIComponent(albumId || "0")}&album_audio_id=${encodeURIComponent(audioId || "0")}&quality=${quality}`, 25_000);
  const normalized = normalizeMoeKoeSongUrl(payload);
  if (!normalized.url) {
    const pay = cached ? `（PayType=${cached.payType}${cached.free ? "，标记为免费" : "，付费/会员"}）` : "";
    throw new Error(`${normalized.error}${pay}。可以换 free=true 的歌，或先在 MoeKoe 客户端登录有会员的账号并完成安全验证后再试。`);
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

export async function installMoeKoe(input: { confirm?: unknown } = {}) {
  const status = await moekoeStatus();
  if (status.running) return { ...status, action: "none", message: "MoeKoe Music 已安装并正在运行，无需安装。" };
  if (status.installed) {
    const exe = status.exe;
    spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
    return { ...status, action: "launched", message: "MoeKoe Music 已安装，已帮您启动；等它加载完再搜索/播放。" };
  }
  if (input.confirm !== true) {
    return {
      ...status,
      action: "needs-confirm",
      message: "尚未安装 MoeKoe Music。安装会下载约 133MB 的安装包并启动安装程序（会改动系统，可能弹 UAC）。用户确认后带 confirm=true 再调用 moekoe_install。",
    };
  }
  const releaseResponse = await net.fetch("https://api.github.com/repos/MoeKoeMusic/MoeKoeMusic/releases/latest", {
    headers: { accept: "application/vnd.github+json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!releaseResponse.ok) throw new Error(`获取 MoeKoe 最新版本失败：HTTP ${releaseResponse.status}`);
  const release = await releaseResponse.json() as any;
  const asset = pickMoeKoeInstaller(release?.assets);
  if (!asset) throw new Error("最新 release 里没有找到 Windows x64 安装包");
  const dir = path.join(app.getPath("userData"), "downloads");
  await fsp.mkdir(dir, { recursive: true });
  const target = path.join(dir, asset.name);
  if (fs.existsSync(target)) {
    const stat = fs.statSync(target);
    if (!asset.size || stat.size === asset.size) {
      spawn(target, [], { detached: true, stdio: "ignore" }).unref();
      return { ...status, action: "installer-launched", installer: target, mirror: "cache", message: "安装包已存在，已启动安装程序；请完成安装后调用 moekoe_status。" };
    }
    fs.rmSync(target, { force: true });
  }
  let lastError = "";
  for (const mirror of MIRRORS) {
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
      spawn(target, [], { detached: true, stdio: "ignore" }).unref();
      return { ...status, action: "installer-launched", installer: target, mirror: mirror || "github", bytes: stat.size, message: "安装包已下载并启动安装程序；请完成安装后调用 moekoe_status。" };
    } catch (error) {
      lastError = messageOf(error);
      try { fs.rmSync(part, { force: true }); } catch { /* noop */ }
    }
  }
  throw new Error(`国内镜像下载安装包失败：${lastError}。可以稍后重试，或手动从 https://music.moekoe.cn/ 下载。`);
}
