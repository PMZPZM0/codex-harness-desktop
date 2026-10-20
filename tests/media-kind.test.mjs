import test from "node:test";
import assert from "node:assert/strict";
import { MEDIA_SCHEME, collectMediaPaths, extensionOf, isHlsSource, isRemoteMediaSource, mediaDisplaySrc, mediaKindOf } from "../src/lib/media-kind.mjs";

test("mediaKindOf：视频/音频/3D 的窄名单", () => {
  assert.equal(mediaKindOf("C:\\work\\out\\clip.mp4"), "video");
  assert.equal(mediaKindOf("/work/voice.WAV"), "audio");
  assert.equal(mediaKindOf("D:/models/robot.glb"), "model");
  assert.equal(mediaKindOf("https://cdn.example.com/a.txt?token=1"), "");
  assert.equal(mediaKindOf("https://cdn.example.com/a.webm?token=1"), "video");
  assert.equal(mediaKindOf("https://cdn.example.com/a.m3u8?token=1"), "video");
  assert.equal(mediaKindOf("C:\\work\\shot.png"), "");
  assert.equal(mediaKindOf("C:\\work\\archive.zip"), "");
  assert.equal(mediaKindOf(""), "");
});

test("mediaKindOf：data URL 按 MIME 判", () => {
  assert.equal(mediaKindOf("data:audio/wav;base64,AAAA"), "audio");
  assert.equal(mediaKindOf("data:video/mp4;base64,AAAA"), "video");
  assert.equal(mediaKindOf("data:image/png;base64,AAAA"), "");
});

test("extensionOf：Windows/URL/query", () => {
  assert.equal(extensionOf("C:\\a b\\c.MP4"), "mp4");
  assert.equal(extensionOf("https://x/y/z.glb?download=1"), "glb");
  assert.equal(extensionOf("D:/x/y.mp3#t=3"), "mp3");
});

test("mediaDisplaySrc：本地路径双编码，远程/已有协议原样", () => {
  const local = "C:\\a b\\c.mp4";
  assert.equal(mediaDisplaySrc(local), MEDIA_SCHEME + encodeURIComponent(encodeURIComponent(local)));
  assert.equal(mediaDisplaySrc("https://x/y.mp4"), "https://x/y.mp4");
  assert.equal(mediaDisplaySrc("data:audio/wav;base64,AAAA"), "data:audio/wav;base64,AAAA");
  assert.equal(mediaDisplaySrc("harness-media://local?path=x"), "harness-media://local?path=x");
});

test("HLS / 远程地址判定", () => {
  assert.equal(isHlsSource("https://x/a.m3u8?token=1"), true);
  assert.equal(isHlsSource("https://x/a.mp4"), false);
  assert.equal(isRemoteMediaSource("https://x/a.mp3"), true);
  assert.equal(isRemoteMediaSource("C:\\a\\b.mp3"), false);
});

test("collectMediaPaths：递归扫描、去重、跳过图片", () => {
  const value = {
    result: "saved C:\\work\\out\\clip.mp4 and D:\\models\\robot.glb",
    nested: ["C:\\work\\out\\clip.mp4", "C:\\work\\shot.png"],
    remote: "https://cdn.example.com/a.mp3?x=1",
    stream: "https://cdn.example.com/live/index.m3u8?token=2",
  };
  const found = collectMediaPaths(value);
  assert.deepEqual(found.map((item) => item.kind), ["video", "model", "audio", "video"]);
  assert.equal(new Set(found.map((item) => item.path)).size, found.length);
  assert.equal(collectMediaPaths(value, 1).length, 1);
});

test("collectMediaPaths：工具输出的中文标点/中文括号后的路径", () => {
  const found = collectMediaPaths("已渲染 MP4：C:\\out\\成片.mp4（15 帧 / 10 KB）；音频 D:\\a\\voice.wav。");
  assert.deepEqual(found.map((item) => item.path), ["C:\\out\\成片.mp4", "D:\\a\\voice.wav"]);
});
