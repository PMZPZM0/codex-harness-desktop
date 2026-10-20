/**
 * 影视源搜索（10-20）：苹果CMS（type=1）在线源检索 + 详情 + 打开。
 *
 * 数据源：内置 5 源；`<userData>/media-sources.json` 存在时优先用它（格式同 LibreTV/TVBox 的
 * `{ sites: [...] }`），首次运行会把内置清单写过去方便用户增删。⛔ 只收 type=1 的 JSON API；
 * type=0（XML）和需要 drpy/JS 的源不在这里解析。
 *
 * 播放：直链 m3u8 / mp4 交给渲染层 MediaPreview（m3u8 走 hls.js）；分享页/网页播放页交给系统浏览器。
 * ⛔ 不做下载、不缓存、不代理第三方流；内容可用性由源站决定。
 */
import { app, net, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_MEDIA_SOURCES,
  buildApiUrl,
  isDirectVideoUrl,
  isHlsUrl,
  normalizeDetailPayload,
  normalizeSearchPayload,
  normalizeSourceConfig,
  pickEpisode,
  rankSearchItems,
  type MediaSearchItem,
  type MediaSourceConfig,
} from "./media-sources-core";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";
const DEFAULT_TIMEOUT_MS = 15_000;

export type MediaSourcesState = { sources: MediaSourceConfig[]; origin: string; warning?: string };

function messageOf(error: unknown): string {
  return String((error as Error)?.message ?? error);
}

function defaults(): MediaSourceConfig[] {
  return DEFAULT_MEDIA_SOURCES.map((source) => ({ ...source }));
}

/** 读源清单：userData 覆盖优先；首次运行把内置清单落盘，用户才有地方改。 */
export async function readMediaSources(): Promise<MediaSourcesState> {
  const file = path.join(app.getPath("userData"), "media-sources.json");
  try {
    const raw = await fs.readFile(file, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
    } catch (error) {
      return { sources: defaults(), origin: "builtin", warning: `自定义源不是合法 JSON（${messageOf(error)}），本次用内置 5 源：${file}` };
    }
    const sources = normalizeSourceConfig(parsed);
    if (sources.length) return { sources, origin: file };
    return { sources: defaults(), origin: "builtin", warning: `自定义源里没有可用的苹果CMS type=1 条目，本次用内置 5 源：${file}` };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      return { sources: defaults(), origin: "builtin", warning: `读取自定义源失败（${messageOf(error)}），本次用内置 5 源` };
    }
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify({ sites: DEFAULT_MEDIA_SOURCES }, null, 2), "utf8");
    } catch { /* 写不进去不致命：本次仍用内置源 */ }
    return { sources: defaults(), origin: `builtin（已写入 ${file}）` };
  }
}

async function fetchJson(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  const response = await net.fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/json, text/plain, */*" },
    signal: AbortSignal.timeout(Math.max(2_000, Math.min(60_000, timeoutMs))),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}${raw ? `：${raw.slice(0, 120)}` : ""}`);
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(`源站没有返回 JSON（可能被防火墙/Cloudflare 拦截）：${raw.slice(0, 120)}`);
  }
}

export type MediaSearchInput = { query?: unknown; sources?: unknown; limit?: unknown; timeoutMs?: unknown };

export async function searchMediaSources(input: MediaSearchInput = {}) {
  const state = await readMediaSources();
  const query = String(input.query ?? "").trim();
  const wanted = Array.isArray(input.sources) ? input.sources.map((item) => String(item)) : [];
  const selected = wanted.length ? state.sources.filter((source) => wanted.includes(source.key)) : state.sources;
  const limit = Math.max(1, Math.min(20, Math.floor(Number(input.limit)) || 8));
  const timeoutMs = Number(input.timeoutMs) || DEFAULT_TIMEOUT_MS;
  if (!query) {
    return {
      query: "",
      origin: state.origin,
      warning: state.warning,
      sources: selected.map((source) => ({ key: source.key, name: source.name })),
      results: [] as MediaSearchItem[],
      hint: "query 留空只列源；带上片名/关键词再搜。",
    };
  }
  if (!selected.length) {
    return { query, origin: state.origin, warning: state.warning, sources: [], results: [] as MediaSearchItem[], hint: `没有匹配的源；可用 key：${state.sources.map((source) => source.key).join("、")}` };
  }
  const statuses = await Promise.all(selected.map(async (source) => {
    if (!source.searchable) return { key: source.key, name: source.name, ok: false, count: 0, error: "该源未开启搜索", items: [] as MediaSearchItem[] };
    try {
      const url = buildApiUrl(source.api, { ac: "videolist", wd: query });
      const payload = await fetchJson(url, timeoutMs);
      const items = rankSearchItems(normalizeSearchPayload(payload, source, limit), query);
      return { key: source.key, name: source.name, ok: true, count: items.length, error: "", items };
    } catch (error) {
      return { key: source.key, name: source.name, ok: false, count: 0, error: messageOf(error), items: [] as MediaSearchItem[] };
    }
  }));
  return {
    query,
    origin: state.origin,
    warning: state.warning,
    sources: statuses.map(({ items: _items, ...status }) => status),
    results: statuses.flatMap((status) => status.items),
    hint: "结果按源分组；要剧集地址用 media_source_detail，要直接看用 media_source_open。",
  };
}

export type MediaDetailInput = { source?: unknown; id?: unknown; timeoutMs?: unknown };

export async function getMediaSourceDetail(input: MediaDetailInput) {
  const state = await readMediaSources();
  const key = String(input.source ?? "").trim();
  const id = String(input.id ?? "").trim();
  const source = state.sources.find((item) => item.key === key) ?? state.sources.find((item) => item.name === key);
  if (!source) {
    throw new Error(`没有找到源「${key || "(空)"}」；可用源：${state.sources.map((item) => `${item.key}(${item.name})`).join("、")}`);
  }
  if (!id) throw new Error("缺少 id（用 media_source_search 结果里的 id）");
  const url = buildApiUrl(source.api, { ac: "detail", ids: id });
  const payload = await fetchJson(url, Number(input.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const item = normalizeDetailPayload(payload, source);
  if (!item) throw new Error(`源 ${source.name} 没有返回 id=${id} 的详情（可能已下架或 id 不对）`);
  return {
    origin: state.origin,
    source: { key: source.key, name: source.name },
    item,
    hint: "播放用 media_source_open（source + id + episode，episode 可给 1 基序号或剧集名）。",
  };
}

export type MediaOpenInput = { source?: unknown; id?: unknown; episode?: unknown; mode?: unknown; timeoutMs?: unknown };

export async function openMediaSource(input: MediaOpenInput) {
  const detail = await getMediaSourceDetail(input);
  const groups = detail.item.playGroups;
  if (!groups.length) throw new Error(`《${detail.item.name}》没有可播放地址（源站可能只提供网页/需会员）`);
  const picked = pickEpisode(groups, input.episode as string | number | undefined);
  if (!picked) throw new Error(`没有选到剧集（episode=${String(input.episode ?? "")}）`);
  const url = picked.episode.url;
  let protocol = "";
  try { protocol = new URL(url).protocol; } catch { /* 下面统一拒 */ }
  if (protocol !== "http:" && protocol !== "https:") throw new Error(`播放地址协议不支持：${url.slice(0, 120)}`);
  const title = `${detail.item.name}${picked.episode.name ? ` · ${picked.episode.name}` : ""}`;
  const mode = String(input.mode ?? "auto");
  const direct = isDirectVideoUrl(url);
  if (mode === "in-app" && !direct) {
    throw new Error(`这个源给的是网页播放页，不能直接内播（${url.slice(0, 120)}）；改用 mode="external" 交给浏览器，或换一个给直链的源`);
  }
  if (mode === "external" || !direct) {
    await shell.openExternal(url);
    return { opened: "external" as const, name: detail.item.name, title, group: picked.group.label, episode: picked.episode.name, url };
  }
  const { sendToWindow } = await import("./features/window-bus");
  sendToWindow("media-preview:open", { source: url, kind: "video", title, autoPlay: false });
  return { opened: "in-app" as const, name: detail.item.name, title, group: picked.group.label, episode: picked.episode.name, url, hls: isHlsUrl(url) };
}
