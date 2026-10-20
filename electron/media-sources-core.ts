/**
 * 影视源纯逻辑（10-20）：源配置校验、苹果CMS URL 组装、搜索/详情结果归一化、剧集选择。
 * ⛔ 本文件**不 import electron**，测试用 `node --test` 直接 import（Node 24 type stripping）。
 * 网络在 electron/media-sources.ts，落点与工具面在 dispatch-core / dispatch-rpc。
 */

export type MediaSourceConfig = {
  key: string;
  name: string;
  api: string;
  type: number;
  searchable: boolean;
  quickSearch: boolean;
  filterable: boolean;
};

export type PlayEpisode = { name: string; url: string };
export type PlayGroup = { label: string; episodes: PlayEpisode[] };

export type MediaSearchItem = {
  source: string;
  sourceName: string;
  id: string;
  name: string;
  sub: string;
  year: string;
  typeName: string;
  area: string;
  lang: string;
  remarks: string;
  score: string;
  pic: string;
  updatedAt: string;
  episodeCount: number;
  groups: string[];
};

export type MediaDetailItem = MediaSearchItem & {
  playGroups: PlayGroup[];
};

/** 内置 5 源（用户 10-20 提供的 LibreTV/TVBox 清单）；userData/media-sources.json 可覆盖。 */
export const DEFAULT_MEDIA_SOURCES: MediaSourceConfig[] = [
  { key: "ffzy", name: "非凡资源", api: "https://api.ffzyapi.com/api.php/provide/vod", type: 1, searchable: true, quickSearch: true, filterable: true },
  { key: "lz", name: "量子资源", api: "https://cj.lziapi.com/api.php/provide/vod", type: 1, searchable: true, quickSearch: true, filterable: true },
  { key: "gs", name: "光速资源", api: "https://api.guangsuapi.com/api.php/provide/vod", type: 1, searchable: true, quickSearch: true, filterable: true },
  { key: "bf", name: "暴风资源", api: "https://bfzyapi.com/api.php/provide/vod", type: 1, searchable: true, quickSearch: true, filterable: true },
  { key: "pl", name: "飘零资源", api: "https://p2100.net/api.php/provide/vod", type: 1, searchable: true, quickSearch: true, filterable: true },
];

function text(value: unknown): string {
  return String(value ?? "").trim();
}

/** 只收苹果CMS JSON（type=1）；坏条目跳过，不因为一条坏源让整份清单失效。 */
export function normalizeSourceConfig(raw: unknown): MediaSourceConfig[] {
  const root = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  const list = Array.isArray(raw) ? raw : Array.isArray(root?.sites) ? root!.sites as unknown[] : [];
  const out: MediaSourceConfig[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const key = text(item.key).slice(0, 64);
    const name = text(item.name).slice(0, 80);
    const api = text(item.api);
    const type = Number(item.type ?? 1);
    if (!key || !name || !/^https?:\/\//i.test(api) || type !== 1) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      name,
      api,
      type: 1,
      searchable: item.searchable !== 0,
      quickSearch: item.quickSearch !== 0,
      filterable: item.filterable !== 0,
    });
  }
  return out.slice(0, 50);
}

export function buildApiUrl(api: string, params: Record<string, string | number | undefined>): string {
  const url = new URL(api);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || String(value) === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/** 苹果CMS 的 `vod_play_url`：线路用 $$$ 分隔，剧集用 # 分隔，单集是 `名称$地址`。 */
export function parsePlayGroups(from: unknown, playUrl: unknown): PlayGroup[] {
  const urlGroups = String(playUrl ?? "").split("$$$");
  const labels = String(from ?? "").split("$$$");
  const groups: PlayGroup[] = [];
  urlGroups.forEach((raw, groupIndex) => {
    const episodes: PlayEpisode[] = [];
    raw.split("#").forEach((entry, episodeIndex) => {
      const value = entry.trim();
      if (!value) return;
      const cut = value.indexOf("$");
      const name = cut >= 0 ? value.slice(0, cut).trim() : "";
      const url = cut >= 0 ? value.slice(cut + 1).trim() : value;
      if (!/^https?:\/\//i.test(url)) return;
      // 编号按**有效集**递增：中间夹了坏地址时不能跳号（更贴近播放器的「第 N 集」）
      episodes.push({ name: name || `第${episodes.length + 1}集`, url });
    });
    if (episodes.length) {
      const label = (labels[groupIndex] || `线路${groupIndex + 1}`).trim() || `线路${groupIndex + 1}`;
      groups.push({ label, episodes });
    }
  });
  return groups;
}

export function normalizeSearchItem(item: unknown, source: MediaSourceConfig): MediaSearchItem {
  const raw = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
  const playGroups = parsePlayGroups(raw.vod_play_from, raw.vod_play_url);
  return {
    source: source.key,
    sourceName: source.name,
    id: text(raw.vod_id),
    name: text(raw.vod_name),
    sub: text(raw.vod_sub),
    year: text(raw.vod_year),
    typeName: text(raw.vod_class),
    area: text(raw.vod_area),
    lang: text(raw.vod_lang),
    remarks: text(raw.vod_remarks),
    score: text(raw.vod_douban_score || raw.vod_score),
    pic: text(raw.vod_pic),
    updatedAt: text(raw.vod_time),
    episodeCount: playGroups.reduce((sum, group) => sum + group.episodes.length, 0),
    groups: playGroups.map((group) => group.label),
  };
}

export function normalizeSearchPayload(payload: unknown, source: MediaSourceConfig, limit = 8): MediaSearchItem[] {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const list = Array.isArray(root.list) ? root.list : [];
  const capped = Math.max(1, Math.min(20, Math.floor(limit) || 8));
  return list
    .map((item) => normalizeSearchItem(item, source))
    .filter((item) => Boolean(item.id && item.name))
    .slice(0, capped);
}

export function normalizeDetailPayload(payload: unknown, source: MediaSourceConfig): MediaDetailItem | null {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const list = Array.isArray(root.list) ? root.list : [];
  const first = list[0];
  if (!first || typeof first !== "object") return null;
  const item = first as Record<string, unknown>;
  const base = normalizeSearchItem(item, source);
  return { ...base, playGroups: parsePlayGroups(item.vod_play_from, item.vod_play_url) };
}

/** 搜索结果排序：精确片名 > 前缀 > 包含，其次按年份/评分降序（同源内）。 */
export function rankSearchItems(items: MediaSearchItem[], query: string): MediaSearchItem[] {
  const needle = text(query).toLowerCase();
  const score = (item: MediaSearchItem): number => {
    const name = item.name.toLowerCase();
    if (name === needle) return 4;
    if (name.startsWith(needle)) return 3;
    if (name.includes(needle)) return 2;
    return item.sub.toLowerCase().includes(needle) ? 1 : 0;
  };
  return [...items].sort((a, b) => {
    const rank = score(b) - score(a);
    if (rank) return rank;
    const year = Number(b.year) - Number(a.year);
    if (Number.isFinite(year) && year !== 0) return year;
    return (Number(b.score) || 0) - (Number(a.score) || 0);
  });
}

export type MediaPreviewKind = "video" | "audio" | "model";

const PREVIEW_VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v", "ogv", "m3u8"]);
const PREVIEW_AUDIO_EXT = new Set(["mp3", "wav", "m4a", "aac", "ogg", "flac", "opus"]);
const PREVIEW_MODEL_EXT = new Set(["glb", "gltf"]);

/** 主进程侧的媒体类型判定（与渲染层 src/lib/media-kind 同口径，窄名单）。 */
export function mediaKindOfPath(value: string): MediaPreviewKind | "" {
  const name = String(value ?? "").split(/[?#]/)[0].split(/[\\/]/).pop() ?? "";
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  if (PREVIEW_VIDEO_EXT.has(extension)) return "video";
  if (PREVIEW_AUDIO_EXT.has(extension)) return "audio";
  if (PREVIEW_MODEL_EXT.has(extension)) return "model";
  return "";
}

export function isDirectVideoUrl(url: string): boolean {
  return /\.(m3u8|mp4|webm|mov|m4v|ogv)(?:[?#]|$)/i.test(String(url ?? ""));
}

export function isHlsUrl(url: string): boolean {
  return /\.m3u8(?:[?#]|$)/i.test(String(url ?? ""));
}

export type PickedEpisode = {
  group: PlayGroup;
  groupIndex: number;
  episode: PlayEpisode;
  episodeIndex: number;
};

/** 选剧集：默认优先 m3u8 线路的第一集；episode 可给 1 基序号或剧集名包含匹配。 */
export function pickEpisode(groups: PlayGroup[], episode?: string | number): PickedEpisode | null {
  if (!groups.length) return null;
  const preferred = groups.findIndex((group) => group.episodes.some((item) => isHlsUrl(item.url)));
  const order = groups.map((_, index) => index);
  if (preferred >= 0) {
    order.splice(order.indexOf(preferred), 1);
    order.unshift(preferred);
  }
  const raw = episode === undefined || episode === null ? "" : String(episode).trim();
  if (!raw) {
    const groupIndex = order[0];
    return { group: groups[groupIndex], groupIndex, episode: groups[groupIndex].episodes[0], episodeIndex: 0 };
  }
  const index = Number(raw);
  if (Number.isInteger(index) && index >= 1) {
    for (const groupIndex of order) {
      const found = groups[groupIndex].episodes[index - 1];
      if (found) return { group: groups[groupIndex], groupIndex, episode: found, episodeIndex: index - 1 };
    }
  }
  // 名称里的集数按数字比：`第02集` / `第2集` / `02` 都应命中同一集
  const wantedNumber = /(\d+)/.exec(raw)?.[1];
  if (wantedNumber !== undefined) {
    const wanted = Number(wantedNumber);
    for (const groupIndex of order) {
      const episodeIndex = groups[groupIndex].episodes.findIndex((item) => {
        const found = /(\d+)/.exec(item.name)?.[1];
        return found !== undefined && Number(found) === wanted;
      });
      if (episodeIndex >= 0) return { group: groups[groupIndex], groupIndex, episode: groups[groupIndex].episodes[episodeIndex], episodeIndex };
    }
  }
  for (const groupIndex of order) {
    const episodeIndex = groups[groupIndex].episodes.findIndex((item) => item.name === raw || item.name.includes(raw));
    if (episodeIndex >= 0) return { group: groups[groupIndex], groupIndex, episode: groups[groupIndex].episodes[episodeIndex], episodeIndex };
  }
  const groupIndex = order[0];
  return { group: groups[groupIndex], groupIndex, episode: groups[groupIndex].episodes[0], episodeIndex: 0 };
}
