import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MEDIA_SOURCES,
  buildApiUrl,
  isDirectVideoUrl,
  isHlsUrl,
  mediaKindOfPath,
  normalizeDetailPayload,
  normalizeSearchPayload,
  normalizeSourceConfig,
  parsePlayGroups,
  pickEpisode,
  rankSearchItems,
} from "../electron/media-sources-core.ts";

test("内置源：5 个苹果CMS JSON 源", () => {
  assert.equal(DEFAULT_MEDIA_SOURCES.length, 5);
  assert.ok(DEFAULT_MEDIA_SOURCES.every((source) => source.type === 1 && /^https:\/\//.test(source.api)));
});

test("normalizeSourceConfig：只收 type=1 / http(s) / 唯一 key", () => {
  const sources = normalizeSourceConfig({
    sites: [
      { key: "a", name: "A", api: "https://a/api", type: 1 },
      { key: "a", name: "重复", api: "https://dup/api", type: 1 },
      { key: "b", name: "B", api: "ftp://b/api", type: 1 },
      { key: "c", name: "C", api: "https://c/api", type: 0 },
      { key: "d", name: "D", api: "https://d/api", type: 1, searchable: 0 },
    ],
  });
  assert.deepEqual(sources.map((source) => source.key), ["a", "d"]);
  assert.equal(sources[1].searchable, false);
  assert.deepEqual(normalizeSourceConfig({ sites: [] }), []);
  assert.deepEqual(normalizeSourceConfig(null), []);
});

test("buildApiUrl：保留原有 query，正确编码中文", () => {
  const url = buildApiUrl("https://x/api.php/provide/vod?foo=1", { ac: "videolist", wd: "庆余年" });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("foo"), "1");
  assert.equal(parsed.searchParams.get("ac"), "videolist");
  assert.equal(parsed.searchParams.get("wd"), "庆余年");
});

test("parsePlayGroups：$$$ 分线路、# 分集、名称$地址", () => {
  const groups = parsePlayGroups(
    "feifan$$$ffm3u8",
    "第01集$https://a/1.m3u8#第02集$https://a/2.m3u8$$$第01集$https://b/play/1",
  );
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].label, "feifan");
  assert.deepEqual(groups[0].episodes.map((item) => item.name), ["第01集", "第02集"]);
  assert.equal(groups[0].episodes[0].url, "https://a/1.m3u8");
  assert.equal(groups[1].label, "ffm3u8");
  assert.equal(groups[1].episodes[0].url, "https://b/play/1");
});

test("parsePlayGroups：无名称时补第 N 集，非 http 地址丢弃", () => {
  const groups = parsePlayGroups("", "https://a/1.m3u8#javascript:alert(1)#https://a/2.mp4");
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].episodes.map((item) => item.name), ["第1集", "第2集"]);
  assert.equal(groups[0].label, "线路1");
});

test("normalizeSearchPayload：过滤无效条目并按 limit 截断", () => {
  const source = DEFAULT_MEDIA_SOURCES[0];
  const items = normalizeSearchPayload({
    list: [
      { vod_id: 1, vod_name: "庆余年", vod_year: "2019", vod_play_url: "第1集$https://a/1.m3u8" },
      { vod_id: "", vod_name: "没有 id" },
      { vod_id: 2, vod_name: "庆余年 第二季", vod_year: "2024" },
      { vod_id: 3, vod_name: "第三部" },
    ],
  }, source, 2);
  assert.equal(items.length, 2);
  assert.equal(items[0].source, "ffzy");
  assert.equal(items[0].episodeCount, 1);
  assert.equal(items[0].groups[0], "线路1");
});

test("rankSearchItems：精确 > 前缀 > 包含 > 副标题，再按年份", () => {
  const base = { source: "s", sourceName: "S", id: "1", sub: "", year: "", typeName: "", area: "", lang: "", remarks: "", score: "", pic: "", updatedAt: "", episodeCount: 0, groups: [] };
  const items = [
    { ...base, id: "1", name: "庆余年 第二季", year: "2024" },
    { ...base, id: "2", name: "庆余年", year: "2019" },
    { ...base, id: "3", name: "新庆余年纪事", year: "2025" },
    { ...base, id: "4", name: "别的剧", sub: "庆余年同人", year: "2020" },
  ];
  assert.deepEqual(rankSearchItems(items, "庆余年").map((item) => item.id), ["2", "1", "3", "4"]);
});

test("pickEpisode：优先 m3u8 线路，支持序号与剧集名", () => {
  const groups = parsePlayGroups(
    "page$$$hls",
    "第1集$https://page/1$$$第1集$https://hls/1.m3u8#第2集$https://hls/2.m3u8",
  );
  const byDefault = pickEpisode(groups);
  assert.equal(byDefault.group.label, "hls");
  assert.equal(byDefault.episode.url, "https://hls/1.m3u8");
  const second = pickEpisode(groups, 2);
  assert.equal(second.episode.url, "https://hls/2.m3u8");
  const byName = pickEpisode(groups, "第02集");
  assert.equal(byName.episode.url, "https://hls/2.m3u8");
  const outOfRange = pickEpisode(groups, 99);
  assert.equal(outOfRange.episode.url, "https://hls/1.m3u8");
});

test("normalizeDetailPayload：返回剧集分组", () => {
  const item = normalizeDetailPayload({
    list: [{ vod_id: 7, vod_name: "测试剧", vod_play_from: "hls", vod_play_url: "第1集$https://x/1.m3u8#第2集$https://x/2.m3u8" }],
  }, DEFAULT_MEDIA_SOURCES[1]);
  assert.equal(item.name, "测试剧");
  assert.equal(item.playGroups.length, 1);
  assert.equal(item.playGroups[0].episodes.length, 2);
  assert.equal(normalizeDetailPayload({ list: [] }, DEFAULT_MEDIA_SOURCES[1]), null);
});

test("主进程媒体类型：窄名单 + URL query", () => {
  assert.equal(mediaKindOfPath("C:\\a\\b\\clip.MP4"), "video");
  assert.equal(mediaKindOfPath("https://x/live/index.m3u8?token=1"), "video");
  assert.equal(mediaKindOfPath("D:/music/a.flac"), "audio");
  assert.equal(mediaKindOfPath("D:/models/robot.glb"), "model");
  assert.equal(mediaKindOfPath("C:\\a\\shot.png"), "");
  assert.equal(mediaKindOfPath("https://v.gsuus.com/play/kazVzrma"), "");
});

test("地址判定：直链视频 / HLS", () => {
  assert.equal(isDirectVideoUrl("https://x/a.m3u8?token=1"), true);
  assert.equal(isDirectVideoUrl("https://x/a.MP4#t=1"), true);
  assert.equal(isDirectVideoUrl("https://v.gsuus.com/play/kazVzrma"), false);
  assert.equal(isHlsUrl("https://x/a.m3u8?token=1"), true);
  assert.equal(isHlsUrl("https://x/a.mp4"), false);
});
