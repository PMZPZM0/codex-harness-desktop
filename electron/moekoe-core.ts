/**
 * MoeKoe Music 纯逻辑（10-20）：搜索/取流响应归一化、安装包选择、镜像 URL。
 * MoeKoe 的本地 API = KuGouMusicApi（默认 127.0.0.1:6521）；⛔ 本文件不 import electron，测试直接 import。
 */

export type MoeKoeSong = {
  hash: string;
  title: string;
  artist: string;
  album: string;
  artwork: string;
  duration: number;
  albumId: string;
  audioId: string;
  payType: number;
  free: boolean;
  hasHigh: boolean;
  hasLossless: boolean;
};

export type MoeKoeAsset = { name: string; url: string; size: number };

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function artworkOf(item: Record<string, unknown>): string {
  const raw = text(item.Image ?? item.AlbumImage ?? (item.trans_param as any)?.union_cover);
  return raw.replace(/\{size\}/g, "480");
}

function titleOf(item: Record<string, unknown>): string {
  const direct = text(item.OriSongName ?? item.SongName ?? item.OriSongName);
  if (direct) return direct;
  const fileName = text(item.FileName);
  const dash = fileName.indexOf(" - ");
  return dash >= 0 ? fileName.slice(dash + 3).trim() : fileName;
}

export function normalizeMoeKoeSearch(payload: unknown, limit = 20): MoeKoeSong[] {
  const root = payload && typeof payload === "object" ? payload as Record<string, any> : {};
  const list: unknown[] = Array.isArray(root?.data?.lists) ? root.data.lists : Array.isArray(root?.data) ? root.data : [];
  const out: MoeKoeSong[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const hash = text(item.FileHash ?? item.hash);
    const title = titleOf(item);
    if (!hash || !title || seen.has(hash)) continue;
    seen.add(hash);
    const payType = Number(item.PayType ?? 0) || 0;
    const singers = Array.isArray(item.Singers)
      ? (item.Singers as Array<Record<string, unknown>>).map((singer) => text(singer.name)).filter(Boolean).join(", ")
      : "";
    out.push({
      hash,
      title,
      artist: text(item.SingerName) || singers,
      album: text(item.AlbumName),
      artwork: artworkOf(item),
      duration: Number(item.Duration ?? 0) || 0,
      albumId: text(item.AlbumID),
      audioId: text(item.Audioid ?? item.SCID ?? item.Scid ?? ""),
      payType,
      free: payType === 0,
      hasHigh: Boolean(item.HQ),
      hasLossless: Boolean(item.SQ ?? item.Res),
    });
    if (out.length >= Math.max(1, Math.min(50, limit))) break;
  }
  return out;
}

export type MoeKoePlayResult = { url: string; trial: boolean; error: string };

/** 兼容 `/song/url` 的 `url: string[]`、`url: string`、`backupUrl` 与付费 offset。 */
export function normalizeMoeKoeSongUrl(payload: unknown): MoeKoePlayResult {
  const root = payload && typeof payload === "object" ? payload as Record<string, any> : {};
  const candidates: string[] = [];
  if (Array.isArray(root.url)) candidates.push(...root.url);
  else if (typeof root.url === "string") candidates.push(root.url);
  if (Array.isArray(root.backupUrl)) candidates.push(...root.backupUrl);
  const url = candidates.find((item) => typeof item === "string" && /^https?:\/\//i.test(item)) ?? "";
  if (url) return { url, trial: false, error: "" };
  if (root.hash_offset) return { url: "", trial: true, error: "会员/付费歌曲：当前 MoeKoe 登录态只返回 60 秒试听，没有完整直链" };
  const message = text(root.error ?? root.msg);
  if (Number(root.errcode) === 20028 || /验证/.test(message)) return { url: "", trial: false, error: "酷狗要求安全验证：请在 MoeKoe 客户端搜索/播放一次完成验证后再试" };
  return { url: "", trial: false, error: message || "MoeKoe API 没有返回可播放地址" };
}

/**
 * 按平台选安装包：
 *   Windows → x64 .exe（跳过 ia32/blockmap）；
 *   macOS → 优先匹配架构的 .zip（自动化解压到 Applications），没有 zip 再 .dmg；
 *   Linux → AppImage（存在时，供手动运行）。
 * ⛔ 绝不能把 .exe 发给 Mac（旧版就是这样，Mac 上必失败）。
 */
export function pickMoeKoeInstaller(assets: unknown, platform: string = "win32", arch: string = "x64"): MoeKoeAsset | null {
  const list = Array.isArray(assets) ? assets : [];
  const candidates = list
    .filter((asset) => asset && typeof asset === "object")
    .map((asset) => asset as Record<string, unknown>)
    .map((asset) => ({
      name: text(asset.name),
      url: text(asset.browser_download_url ?? asset.url),
      size: Number(asset.size ?? 0) || 0,
    }))
    .filter((asset) => !/\.blockmap$/i.test(asset.name) && /^https?:\/\//i.test(asset.url));
  if (platform === "darwin") {
    const archName = /arm64/i.test(arch) ? "arm64" : /x64|x86_64/i.test(arch) ? "x64" : arch;
    const zips = candidates.filter((asset) => /\.zip$/i.test(asset.name));
    const dmgs = candidates.filter((asset) => /\.dmg$/i.test(asset.name));
    const forArch = (items: typeof zips) => items.find((asset) => asset.name.toLowerCase().includes(archName.toLowerCase()));
    return forArch(zips) ?? forArch(dmgs) ?? zips[0] ?? dmgs[0] ?? null;
  }
  if (platform === "linux") {
    return candidates.find((asset) => /\.AppImage$/i.test(asset.name)) ?? null;
  }
  const exes = candidates.filter((asset) => /\.exe$/i.test(asset.name));
  return exes.find((asset) => /x64/i.test(asset.name))
    ?? exes.find((asset) => !/ia32|arm64/i.test(asset.name))
    ?? null;
}

export function buildMirrorUrl(mirror: string, url: string): string {
  const base = text(mirror);
  if (!base) return url;
  return base.endsWith("/") ? `${base}${url}` : `${base}/${url}`;
}

/* ── 搜索类型（10-20 文档：/search 支持 song / album / author / special / mv）──────── */

export type MoeKoeSearchType = "song" | "album" | "author" | "special" | "mv";
export type MoeKoeBrowseItem = {
  kind: "album" | "author" | "playlist" | "mv";
  id: string;
  title: string;
  artist: string;
  cover: string;
  description: string;
  details: Record<string, string | number>;
};

export function normalizeMoeKoeSearchType(value: unknown): MoeKoeSearchType {
  const type = text(value).toLowerCase();
  if (type === "special" || type === "playlist") return "special";
  if (type === "album" || type === "author" || type === "mv") return type;
  return "song";
}

export function normalizeMoeKoeBrowse(type: Exclude<MoeKoeSearchType, "song">, payload: unknown, limit = 20): MoeKoeBrowseItem[] {
  const root = payload && typeof payload === "object" ? payload as Record<string, any> : {};
  const list: unknown[] = Array.isArray(root?.data?.lists) ? root.data.lists : Array.isArray(root?.data) ? root.data : [];
  const out: MoeKoeBrowseItem[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, any>;
    if (type === "album") {
      const id = text(item.albumid ?? item.albumId);
      const title = text(item.albumname ?? item.title);
      if (!id || !title) continue;
      out.push({
        kind: "album", id, title, artist: text(item.singer ?? item.singers?.map?.((s: any) => s?.name).filter(Boolean).join(", ")),
        cover: text(item.img), description: `${Number(item.songcount) || 0} 首 · ${text(item.publish_time)} · ${text(item.language)}`,
        details: { songCount: Number(item.songcount) || 0, publishTime: text(item.publish_time), language: text(item.language), company: text(item.company) },
      });
    } else if (type === "author") {
      const id = text(item.AuthorId);
      const title = text(item.AuthorName);
      if (!id || !title) continue;
      out.push({
        kind: "author", id, title, artist: "", cover: text(item.Avatar),
        description: `${Number(item.AudioCount) || 0} 首歌曲 · ${Number(item.AlbumCount) || 0} 专辑 · ${Number(item.FansNum) || 0} 粉丝`,
        details: { audioCount: Number(item.AudioCount) || 0, albumCount: Number(item.AlbumCount) || 0, videoCount: Number(item.VideoCount) || 0, fans: Number(item.FansNum) || 0 },
      });
    } else if (type === "special") {
      const id = text(item.specialid);
      const title = text(item.specialname);
      if (!id || !title) continue;
      out.push({
        kind: "playlist", id, title, artist: text(item.nickname), cover: text(item.img),
        description: `${Number(item.song_count) || 0} 首 · ${Number(item.play_count) || 0} 播放 · ${text(item.publish_time)}`,
        details: { songCount: Number(item.song_count) || 0, playCount: Number(item.play_count) || 0, author: text(item.nickname), publishTime: text(item.publish_time) },
      });
    } else {
      const id = text(item.MvID);
      const title = text(item.MvName);
      if (!id || !title) continue;
      const cover = text(item.ThumbGif) || (/^https?:\/\//i.test(text(item.Pic)) ? text(item.Pic) : "");
      out.push({
        kind: "mv", id, title, artist: text(item.SingerName), cover,
        description: `${Number(item.Duration) || 0}s · ${text(item.MvHashMark)} · ${text(item.PublishDate)}`,
        details: { songHash: text(item.FileHash), duration: Number(item.Duration) || 0, publishDate: text(item.PublishDate), mvHash: text(item.MvHash), quality: text(item.MvHashMark) },
      });
    }
    if (out.length >= Math.max(1, Math.min(50, limit))) break;
  }
  return out;
}

/* ── 歌词（/search/lyric → /lyric）────────────────────────────────────────── */

export type MoeKoeLyricCandidate = { id: string; accesskey: string; song: string; singer: string; source: string };

export function pickLyricCandidate(payload: unknown): MoeKoeLyricCandidate | null {
  const root = payload && typeof payload === "object" ? payload as Record<string, any> : {};
  const list = Array.isArray(root.candidates) ? root.candidates : Array.isArray(root?.data?.candidates) ? root.data.candidates : [];
  const candidates = list
    .filter((item: any) => item && text(item.id) && text(item.accesskey))
    .sort((a: any, b: any) => (String(b.product_from ?? "").includes("官方") ? 1 : 0) - (String(a.product_from ?? "").includes("官方") ? 1 : 0));
  const first = candidates[0];
  return first ? { id: text(first.id), accesskey: text(first.accesskey), song: text(first.song), singer: text(first.singer), source: text(first.product_from) } : null;
}

/** `/lyric` 的 `decodeContent` 已是明文；旧形态是 base64 的 `content`，两种都收。 */
export function decodeLyricPayload(payload: unknown): string {
  const root = payload && typeof payload === "object" ? payload as Record<string, any> : {};
  const decoded = text(root.decodeContent);
  if (decoded.includes("[")) return decoded.replace(/\r\n/g, "\n");
  const content = text(root.content);
  if (content) {
    try {
      const plain = Buffer.from(content, "base64").toString("utf8");
      if (plain.includes("[")) return plain.replace(/\r\n/g, "\n");
    } catch { /* 不是 base64 */ }
  }
  return decoded || content;
}

/* ── 音质权限（/privilege/lite）────────────────────────────────────────────── */

export type MoeKoeQualitySummary = {
  defaultQuality: string;
  level: number;
  payType: number;
  privilege: number;
  failProcess: string;
  hasHigh: boolean;
  hasLossless: boolean;
  standard: "available";
  note: string;
};

export function normalizeMoeKoePrivilege(payload: unknown, song?: Pick<MoeKoeSong, "hasHigh" | "hasLossless"> | null): MoeKoeQualitySummary {
  const root = payload && typeof payload === "object" ? payload as Record<string, any> : {};
  const item = Array.isArray(root.data) ? root.data[0] : root;
  const p = item && typeof item === "object" ? item : {};
  const payType = Number(p.pay_type ?? 0) || 0;
  const privilege = Number(p.privilege ?? 0) || 0;
  const failProcess = Array.isArray(p.fail_process) ? p.fail_process.join(",") : text(p.fail_process);
  const hasHigh = Boolean(song?.hasHigh);
  const hasLossless = Boolean(song?.hasLossless);
  return {
    defaultQuality: text(p.quality),
    level: Number(p.level) || 0,
    payType,
    privilege,
    failProcess,
    hasHigh,
    hasLossless,
    standard: "available",
    note: payType > 0
      ? "standard（128k）走客户端同款 ppage 可完整播放；high/lossless 可能需会员/版权，失败请降回 standard"
      : "standard（128k）可完整播放",
  };
}
