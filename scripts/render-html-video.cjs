/**
 * HTML/CSS → MP4 本地渲染器（P1 地基，2026-10-11）
 *
 * 思路（源自 heygen-com/hyperframes，但**零外部依赖**）：不引 ffmpeg、不引它的包 ——
 *   ① 用 Electron 自带的 Chromium 打开目标 HTML（file:// 或 http(s)）；
 *   ② 用 CDP `Page.startScreencast` 抓帧（Chromium 自己出 JPEG，比逐帧 capturePage 快得多）；
 *   ③ 把每帧喂给一个隐藏的编码页（canvas + MediaRecorder）；
 *   ④ MediaRecorder 收尾时吐出**真 MP4**（实测本运行时 `video/mp4;codecs=avc1` 受支持，
 *      文件头 `ftyp/isom` 已验；⇒ 不需要 307MB 的 ffmpeg）。
 *
 * 用法：electron scripts/render-html-video.cjs <输入HTML/URL> <秒> <fps> <输出.mp4> [宽] [高]
 * ⛔ 这是**开发/工具脚本**（不是应用功能）；产品化时把这套引擎搬进主进程板块。
 */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const src = args[0];
const seconds = Number(args[1] ?? 3);
const fps = Number(args[2] ?? 30);
const out = args[3];
const width = Number(args[4] ?? 1280);
const height = Number(args[5] ?? 720);

const log = (...a) => console.log("[render-html-video]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!src || !out) throw new Error("用法: electron render-html-video.cjs <html|url> <秒> <fps> <out.mp4> [w] [h]");
  const url = /^https?:/.test(src) ? src : `file://${path.resolve(src).replace(/\\/g, "/")}`;

  // ── 舞台窗：跑目标动画 ──
  const stage = new BrowserWindow({
    show: false, width, height, frame: false,
    webPreferences: { offscreen: false, backgroundThrottling: false },
  });
  await stage.loadURL(url);

  // ── 编码窗：canvas + MediaRecorder（MediaRecorder 只存在于渲染进程）──
  const enc = new BrowserWindow({ show: false, width: 64, height: 64, webPreferences: { backgroundThrottling: false } });
  await enc.loadURL("data:text/html,<body style='margin:0'><canvas id=c></canvas></body>");
  const ready = await enc.webContents.executeJavaScript(`(function(){
    const c = document.getElementById('c');
    c.width = ${width}; c.height = ${height};
    const ctx = c.getContext('2d');
    const track = c.captureStream(0).getVideoTracks()[0];
    const chunks = [];
    const rec = new MediaRecorder(c.captureStream ? new MediaStream([track]) : null, { mimeType: 'video/mp4;codecs=avc1', videoBitsPerSecond: 6_000_000 });
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    window.__enc = { ctx, track, rec, chunks, done: null };
    window.__frame = async (dataUrl) => {
      const img = await createImageBitmap(await (await fetch(dataUrl)).blob());
      ctx.drawImage(img, 0, 0, c.width, c.height);
      track.requestFrame();
    };
    window.__start = () => { rec.start(200); return true; };
    window.__stop = () => new Promise((res) => { rec.onstop = () => res(chunks.length); rec.stop(); });
    window.__blobB64 = async () => {
      const buf = await new Blob(chunks, { type: 'video/mp4' }).arrayBuffer();
      let s = ''; const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(s);
    };
    return { mime: rec.mimeType, supported: MediaRecorder.isTypeSupported('video/mp4;codecs=avc1') };
  })()`);
  log("编码器就绪:", JSON.stringify(ready));

  await enc.webContents.executeJavaScript("window.__start()");

  // ── CDP 抓帧 ──
  const wc = stage.webContents;
  wc.debugger.attach("1.3");
  let frames = 0;
  const pending = [];
  wc.debugger.on("message", (_e, method, params) => {
    if (method === "Page.screencastFrame") {
      frames += 1;
      pending.push(params.data);
      wc.debugger.sendCommand("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => undefined);
    }
  });
  await wc.debugger.sendCommand("Page.enable");
  const target = Math.round(seconds * fps);
  await wc.debugger.sendCommand("Page.startScreencast", { format: "jpeg", quality: 80, maxWidth: width, maxHeight: height, everyNthFrame: 1 });

  const t0 = Date.now();
  let fed = 0;
  while (fed < target && Date.now() - t0 < seconds * 1000 + 8000) {
    if (!pending.length) { await sleep(10); continue; }
    const data = pending.shift();
    await enc.webContents.executeJavaScript(`window.__frame("data:image/jpeg;base64,${data}")`);
    fed += 1;
  }
  await wc.debugger.sendCommand("Page.stopScreencast").catch(() => undefined);
  const chunkCount = await enc.webContents.executeJavaScript("window.__stop()");
  const b64 = await enc.webContents.executeJavaScript("window.__blobB64()");
  const buf = Buffer.from(b64, "base64");
  fs.writeFileSync(out, buf);
  log(`抓帧 ${frames} / 编码 ${fed} 帧 / chunks=${chunkCount} / 输出 ${buf.length} 字节 → ${out}`);
  log("文件头:", buf.slice(0, 16).toString("hex"), "| ftyp:", buf.slice(8, 12).toString("ascii"));
  stage.destroy(); enc.destroy();
}

app.whenReady().then(() => main().then(() => { app.exit(0); }).catch((e) => { console.error("[render-html-video] 失败:", e); app.exit(1); }));
