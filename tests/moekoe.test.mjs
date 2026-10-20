import test from "node:test";
import assert from "node:assert/strict";
import { buildMirrorUrl, normalizeMoeKoeSearch, normalizeMoeKoeSongUrl, pickMoeKoeInstaller } from "../electron/moekoe-core.ts";

const item = {
  FileHash: "B3A52A7A958BF0AED0EBFBA2E9A818B7",
  OriSongName: "晴天",
  FileName: "周杰伦 - 晴天",
  SingerName: "周杰伦",
  AlbumName: "叶惠美",
  AlbumID: "966846",
  Audioid: 20505418,
  Duration: 269,
  PayType: 3,
  Image: "http://imge.kugou.com/stdmusic/{size}/cover.jpg",
  HQ: { Hash: "HQ" },
  SQ: { Hash: "SQ" },
};

test("MoeKoe 搜索结果：字段归一化 + free/payType", () => {
  const songs = normalizeMoeKoeSearch({ data: { lists: [item] } }, 10);
  assert.equal(songs.length, 1);
  assert.deepEqual(songs[0], {
    hash: "B3A52A7A958BF0AED0EBFBA2E9A818B7",
    title: "晴天",
    artist: "周杰伦",
    album: "叶惠美",
    artwork: "http://imge.kugou.com/stdmusic/480/cover.jpg",
    duration: 269,
    albumId: "966846",
    audioId: "20505418",
    payType: 3,
    free: false,
    hasHigh: true,
    hasLossless: true,
  });
  assert.equal(normalizeMoeKoeSearch({ data: { lists: [{ ...item, FileHash: "f", PayType: 0 }] } }, 10)[0].free, true);
  assert.equal(normalizeMoeKoeSearch({ data: { lists: [{ ...item, FileHash: "1" }, { ...item, FileHash: "2" }] } }, 1).length, 1);
});

test("MoeKoe 取流响应：数组/字符串/备份/试听/风控", () => {
  assert.equal(normalizeMoeKoeSongUrl({ url: ["https://a/1.mp3"] }).url, "https://a/1.mp3");
  assert.equal(normalizeMoeKoeSongUrl({ url: "https://a/2.mp3" }).url, "https://a/2.mp3");
  assert.equal(normalizeMoeKoeSongUrl({ url: [], backupUrl: ["https://a/3.mp3"] }).url, "https://a/3.mp3");
  const trial = normalizeMoeKoeSongUrl({ hash_offset: { end_ms: 60000 } });
  assert.equal(trial.trial, true);
  assert.equal(trial.url, "");
  const risk = normalizeMoeKoeSongUrl({ errcode: 20028, error: "本次请求需要验证" });
  assert.match(risk.error, /验证/);
  assert.equal(normalizeMoeKoeSongUrl({}).url, "");
});

test("MoeKoe 安装包：优先 x64、跳过 blockmap/ia32", () => {
  const asset = pickMoeKoeInstaller([
    { name: "latest.yml", browser_download_url: "https://x/latest.yml", size: 1 },
    { name: "MoeKoe_Music_Setup_v1.7.1-ia32.exe", browser_download_url: "https://x/ia32.exe", size: 1 },
    { name: "MoeKoe_Music_Setup_v1.7.1-x64.exe.blockmap", browser_download_url: "https://x/x64.blockmap", size: 1 },
    { name: "MoeKoe_Music_Setup_v1.7.1-x64.exe", browser_download_url: "https://x/x64.exe", size: 133162960 },
  ]);
  assert.equal(asset.name, "MoeKoe_Music_Setup_v1.7.1-x64.exe");
  assert.equal(pickMoeKoeInstaller([{ name: "MoeKoe_Music_Setup.exe", browser_download_url: "https://x/a.exe", size: 2 }]).name, "MoeKoe_Music_Setup.exe");
  assert.equal(pickMoeKoeInstaller([{ name: "x.dmg", browser_download_url: "https://x/a.dmg" }]), null);
});

test("国内镜像 URL 拼接", () => {
  const url = "https://github.com/a/b.exe";
  assert.equal(buildMirrorUrl("https://gh-proxy.com/", url), "https://gh-proxy.com/https://github.com/a/b.exe");
  assert.equal(buildMirrorUrl("https://ghfast.top", url), "https://ghfast.top/https://github.com/a/b.exe");
  assert.equal(buildMirrorUrl("", url), url);
});
