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

/** 优先 x64 安装包，跳过 blockmap/ia32；没有 x64 时用通用 exe。 */
export function pickMoeKoeInstaller(assets: unknown): MoeKoeAsset | null {
  const list = Array.isArray(assets) ? assets : [];
  const candidates = list
    .filter((asset) => asset && typeof asset === "object")
    .map((asset) => asset as Record<string, unknown>)
    .map((asset) => ({
      name: text(asset.name),
      url: text(asset.browser_download_url ?? asset.url),
      size: Number(asset.size ?? 0) || 0,
    }))
    .filter((asset) => /\.exe$/i.test(asset.name) && !/\.blockmap$/i.test(asset.name) && /^https?:\/\//i.test(asset.url));
  return candidates.find((asset) => /x64/i.test(asset.name))
    ?? candidates.find((asset) => !/ia32|arm64/i.test(asset.name))
    ?? null;
}

export function buildMirrorUrl(mirror: string, url: string): string {
  const base = text(mirror);
  if (!base) return url;
  return base.endsWith("/") ? `${base}${url}` : `${base}/${url}`;
}
