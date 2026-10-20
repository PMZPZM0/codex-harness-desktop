import test from "node:test";
import assert from "node:assert/strict";
import { buildMirrorUrl, decodeLyricPayload, MOEKOE_OFFICIAL_DOWNLOAD_PAGE, MOEKOE_RELEASE_API, normalizeMoeKoeBrowse, normalizeMoeKoePrivilege, normalizeMoeKoeSearch, normalizeMoeKoeSearchType, normalizeMoeKoeSongUrl, pickLyricCandidate, pickMoeKoeInstaller } from "../electron/moekoe-core.ts";

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

test("搜索类型：song/album/author/special(playlist)/mv", () => {
  assert.equal(normalizeMoeKoeSearchType("playlist"), "special");
  assert.equal(normalizeMoeKoeSearchType("album"), "album");
  assert.equal(normalizeMoeKoeSearchType("bad"), "song");
  const album = normalizeMoeKoeBrowse("album", { data: { lists: [{ albumid: 1, albumname: "魔杰座", singer: "周杰伦", img: "http://x.jpg", songcount: 11, publish_time: "2008-10-15", language: "华语" }] } });
  assert.equal(album[0].kind, "album");
  assert.equal(album[0].id, "1");
  assert.equal(album[0].details.songCount, 11);
  const author = normalizeMoeKoeBrowse("author", { data: { lists: [{ AuthorId: 3520, AuthorName: "周杰伦", Avatar: "http://a.jpg", AudioCount: 1849, AlbumCount: 49, FansNum: 10 }] } });
  assert.equal(author[0].kind, "author");
  assert.equal(author[0].details.audioCount, 1849);
  const playlist = normalizeMoeKoeBrowse("special", { data: { lists: [{ specialid: 7, specialname: "歌单", nickname: "酷乐", img: "http://p.jpg", song_count: 154 }] } });
  assert.equal(playlist[0].kind, "playlist");
  assert.equal(playlist[0].description.includes("154"), true);
  const mv = normalizeMoeKoeBrowse("mv", { data: { lists: [{ MvID: 9, MvName: "晴天", SingerName: "周杰伦", ThumbGif: "http://v.gif", Duration: 317, FileHash: "H", MvHashMark: "1080P" }] } });
  assert.equal(mv[0].kind, "mv");
  assert.equal(mv[0].details.songHash, "H");
});

test("歌词：候选选择 + decodeContent / base64 解码", () => {
  const candidate = pickLyricCandidate({ candidates: [{ id: "1", accesskey: "k", product_from: "官方推荐歌词", song: "晴天", singer: "周杰伦" }] });
  assert.deepEqual(candidate, { id: "1", accesskey: "k", song: "晴天", singer: "周杰伦", source: "官方推荐歌词" });
  assert.equal(pickLyricCandidate({ candidates: [] }), null);
  assert.equal(decodeLyricPayload({ decodeContent: "[00:01.00]hi\r\n[00:02.00]there" }), "[00:01.00]hi\n[00:02.00]there");
  assert.equal(decodeLyricPayload({ content: Buffer.from("[00:01.00]hello").toString("base64") }), "[00:01.00]hello");
});

test("音质权限：standard 可用，High/Lossless 仅提示", () => {
  const q = normalizeMoeKoePrivilege({ data: [{ quality: "128", level: 2, pay_type: 3, privilege: 10, fail_process: 12 }] }, { hasHigh: true, hasLossless: false });
  assert.equal(q.defaultQuality, "128");
  assert.equal(q.payType, 3);
  assert.equal(q.hasHigh, true);
  assert.equal(q.hasLossless, false);
  assert.equal(q.standard, "available");
  assert.match(q.note, /ppage/);
});

test("国内镜像 URL 拼接", () => {
  const url = "https://github.com/a/b.exe";
  assert.equal(buildMirrorUrl("https://gh-proxy.com/", url), "https://gh-proxy.com/https://github.com/a/b.exe");
  assert.equal(buildMirrorUrl("https://ghfast.top", url), "https://ghfast.top/https://github.com/a/b.exe");
  assert.equal(buildMirrorUrl("", url), url);
});

test("官方下载源：music.moekoe.cn 对应的 GitHub release 仓库", () => {
  assert.equal(MOEKOE_OFFICIAL_DOWNLOAD_PAGE, "https://music.moekoe.cn/download.html");
  assert.equal(MOEKOE_RELEASE_API, "https://api.github.com/repos/iAJue/MoeKoeMusic/releases/latest");
});

test("安装包按平台/架构选择：macOS 选 zip，不能拿 Windows exe", () => {
  const mac = [
    { name: "MoeKoe_Music_v1.7.1-arm64.dmg", browser_download_url: "https://x/arm64.dmg", size: 1 },
    { name: "MoeKoe_Music_v1.7.1-arm64.zip", browser_download_url: "https://x/arm64.zip", size: 1 },
    { name: "MoeKoe_Music_v1.7.1-x64.dmg", browser_download_url: "https://x/x64.dmg", size: 1 },
    { name: "MoeKoe_Music_v1.7.1-x64.zip", browser_download_url: "https://x/x64.zip", size: 1 },
    { name: "MoeKoe_Music_Setup_v1.7.1-x64.exe", browser_download_url: "https://x/x64.exe", size: 1 },
  ];
  assert.equal(pickMoeKoeInstaller(mac, "darwin", "arm64").name, "MoeKoe_Music_v1.7.1-arm64.zip");
  assert.equal(pickMoeKoeInstaller(mac, "darwin", "x64").name, "MoeKoe_Music_v1.7.1-x64.zip");
  assert.equal(pickMoeKoeInstaller(mac, "win32", "x64").name, "MoeKoe_Music_Setup_v1.7.1-x64.exe");
  assert.equal(pickMoeKoeInstaller([{ name: "MoeKoe_Music_v1.7.1-arm64.dmg", browser_download_url: "https://x/a.dmg", size: 1 }], "darwin", "arm64").name, "MoeKoe_Music_v1.7.1-arm64.dmg");
  assert.equal(pickMoeKoeInstaller(mac, "linux", "x64"), null);
});

test("安装包选择：Windows ia32/universal、Apple Silicon 绝不回落 x64、Linux 架构", () => {
  const win = [
    { name: "MoeKoe_Music_Setup_v1.7.1.exe", browser_download_url: "https://x/universal.exe", size: 1 },
    { name: "MoeKoe_Music_Setup_v1.7.1-ia32.exe", browser_download_url: "https://x/ia32.exe", size: 1 },
    { name: "MoeKoe_Music_Setup_v1.7.1-x64.exe", browser_download_url: "https://x/x64.exe", size: 1 },
  ];
  assert.equal(pickMoeKoeInstaller(win, "win32", "ia32").name, "MoeKoe_Music_Setup_v1.7.1-ia32.exe");
  assert.equal(pickMoeKoeInstaller(win, "win32", "x64").name, "MoeKoe_Music_Setup_v1.7.1-x64.exe");
  assert.equal(pickMoeKoeInstaller(win, "win32", "arm64").name, "MoeKoe_Music_Setup_v1.7.1-x64.exe");
  assert.equal(pickMoeKoeInstaller(win.filter((a) => !/x64|ia32/.test(a.name)), "win32", "x64").name, "MoeKoe_Music_Setup_v1.7.1.exe");
  const macX64Only = [{ name: "MoeKoe_Music_v1.7.1-x64.zip", browser_download_url: "https://x/x64.zip", size: 1 }];
  assert.equal(pickMoeKoeInstaller(macX64Only, "darwin", "arm64"), null);
  const linux = [
    { name: "MoeKoe_Music_v1.7.1-x86_64.AppImage", browser_download_url: "https://x/x86.AppImage", size: 1 },
    { name: "MoeKoe_Music_v1.7.1-arm64.AppImage", browser_download_url: "https://x/arm.AppImage", size: 1 },
  ];
  assert.equal(pickMoeKoeInstaller(linux, "linux", "arm64").name, "MoeKoe_Music_v1.7.1-arm64.AppImage");
  assert.equal(pickMoeKoeInstaller(linux, "linux", "x64").name, "MoeKoe_Music_v1.7.1-x86_64.AppImage");
});
