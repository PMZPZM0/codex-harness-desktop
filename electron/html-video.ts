/**
 * html-video —— 把一段 HTML/CSS 动画**在本地渲成 MP4**（P1，2026-10-11）。
 *
 * 为什么这么做（源自 heygen-com/hyperframes 的思路，但**零外部依赖**）：
 *   · 我们不带 ffmpeg（307MB，本机实测也没有 CLI），但 **Electron 运行时自带 MP4 编码器** ——
 *     实测 `MediaRecorder.isTypeSupported("video/mp4;codecs=avc1") === true`，产出文件头是 `ftyp/isom`。
 *   · 抓帧用 CDP `Page.startScreencast`（Chromium 自己出 JPEG），比逐帧 `capturePage()` 快得多。
 *   · `MediaRecorder` 只存在于渲染进程 ⇒ 另开一个隐藏的「编码窗」（canvas + MediaRecorder），
 *     把舞台窗的每一帧喂进去，收尾时一次性吐出 MP4。
 *
 * ⛔ 安全：`source` 只认两条路 —— http(s) 或**可信根内**的本地文件（同 harness-image / sketch 的口径）。
 *    舞台窗与编码窗都不给 preload、不给 node 集成；舞台窗禁止导航到别的源。
 */
import fs from "node:fs";
import path from "node:path";
import { BrowserWindow } from "electron";
import { isInsideTrustedRoots } from "./runtime-refs";

export type RenderHtmlVideoOptions = {
  /** 本地 HTML 文件路径，或 http(s) URL */
  source: string;
  /** 目标输出文件（.mp4） */
  outPath: string;
  seconds: number;
  fps: number;
  width: number;
  height: number;
};

export type RenderHtmlVideoResult = { ok: true; path: string; bytes: number; frames: number } | { ok: false; error: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function resolveSource(source: string): { url: string } | { error: string } {
  const raw = String(source ?? "").trim();
  if (!raw) return { error: "缺少 source（本地 HTML 路径或 http(s) URL）" };
  if (/^https?:\/\//i.test(raw)) return { url: raw };
  const abs = path.resolve(raw);
  if (!fs.existsSync(abs)) return { error: `文件不存在：${abs}` };
  if (!/\.(html?|htm)$/i.test(abs)) return { error: "只接受 .html / .htm（或 http(s) URL）" };
  if (!isInsideTrustedRoots(abs)) return { error: "路径不在可信目录内（会话工作目录 / 应用数据目录）" };
  return { url: `file://${abs.replace(/\\/g, "/")}` };
}

/** 渲染一帧不落时长：把舞台窗的每一帧喂进编码窗，返回 mp4 字节。 */
export async function renderHtmlToVideo(opts: RenderHtmlVideoOptions): Promise<RenderHtmlVideoResult> {
  const src = resolveSource(opts.source);
  if ("error" in src) return { ok: false, error: src.error };
  const seconds = Math.min(120, Math.max(0.5, Number(opts.seconds) || 3));
  const fps = Math.min(60, Math.max(5, Math.round(Number(opts.fps) || 30)));
  const width = Math.min(4096, Math.max(64, Math.round(Number(opts.width) || 1280)));
  const height = Math.min(4096, Math.max(64, Math.round(Number(opts.height) || 720)));

  let stage: BrowserWindow | null = null;
  let enc: BrowserWindow | null = null;
  try {
    stage = new BrowserWindow({
      show: false,
      width,
      height,
      frame: false,
      webPreferences: { offscreen: false, backgroundThrottling: false, nodeIntegration: false, contextIsolation: true, sandbox: true },
      paintWhenInitiallyHidden: true,
    });
    // ⛔ 舞台窗不许自己导航走（只跑给定的这一个页面）
    stage.webContents.on("will-navigate", (e, url) => { if (url !== src.url) e.preventDefault(); });
    await stage.loadURL(src.url);

    enc = new BrowserWindow({
      show: false,
      width: 64,
      height: 64,
      webPreferences: { backgroundThrottling: false, nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    await enc.loadURL("data:text/html,<body style='margin:0'><canvas id=c></canvas></body>");
    const ready = await enc.webContents.executeJavaScript(`(function(){
      const c = document.getElementById('c');
      c.width = ${width}; c.height = ${height};
      const ctx = c.getContext('2d');
      const track = c.captureStream(0).getVideoTracks()[0];
      const chunks = [];
      const rec = new MediaRecorder(new MediaStream([track]), { mimeType: 'video/mp4;codecs=avc1', videoBitsPerSecond: 6_000_000 });
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      window.__enc = { ctx, track, rec, chunks };
      window.__frame = async (dataUrl) => {
        const img = await createImageBitmap(await (await fetch(dataUrl)).blob());
        ctx.drawImage(img, 0, 0, c.width, c.height);
        track.requestFrame();
      };
      window.__start = () => { rec.start(200); return true; };
      window.__stop = () => new Promise((res) => { rec.onstop = () => res(chunks.length); rec.stop(); });
      window.__blobB64 = async () => {
        const buf = await new Blob(chunks, { type: 'video/mp4' }).arrayBuffer();
        let s = ''; const b = new Uint8Array(buf);
        for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
        return btoa(s);
      };
      return { mime: rec.mimeType, supported: MediaRecorder.isTypeSupported('video/mp4;codecs=avc1') };
    })()`) as { mime: string; supported: boolean };
    if (!ready?.supported) return { ok: false, error: "本运行时不支持 video/mp4 编码（需要 avc1）" };

    await enc.webContents.executeJavaScript("window.__start()");

    const wc = stage.webContents;
    wc.debugger.attach("1.3");
    const pending: string[] = [];
    wc.debugger.on("message", (_e, method, params) => {
      if (method === "Page.screencastFrame") {
        pending.push((params as { data: string }).data);
        void wc.debugger.sendCommand("Page.screencastFrameAck", { sessionId: (params as { sessionId: number }).sessionId }).catch(() => undefined);
      }
    });
    await wc.debugger.sendCommand("Page.enable");
    await wc.debugger.sendCommand("Page.startScreencast", { format: "jpeg", quality: 80, maxWidth: width, maxHeight: height, everyNthFrame: 1 });

    const target = Math.round(seconds * fps);
    const t0 = Date.now();
    let fed = 0;
    while (fed < target && Date.now() - t0 < seconds * 1000 + 10000) {
      if (!pending.length) { await sleep(10); continue; }
      await enc.webContents.executeJavaScript(`window.__frame("data:image/jpeg;base64,${pending.shift()}")`);
      fed += 1;
    }
    await wc.debugger.sendCommand("Page.stopScreencast").catch(() => undefined);
    await enc.webContents.executeJavaScript("window.__stop()");
    const b64 = (await enc.webContents.executeJavaScript("window.__blobB64()")) as string;
    const buf = Buffer.from(b64, "base64");
    if (buf.length < 64 || buf.slice(4, 8).toString("ascii") !== "ftyp") return { ok: false, error: `编码结果不是合法 MP4（ftyp 缺失；抓帧 ${fed} / 字节 ${buf.length}）` };
    fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });
    fs.writeFileSync(opts.outPath, buf);
    return { ok: true, path: opts.outPath, bytes: buf.length, frames: fed };
  } catch (error) {
    return { ok: false, error: String((error as { message?: string })?.message ?? error) };
  } finally {
    try { stage?.webContents.debugger.detach(); } catch { /* 未挂载 */ }
    try { stage?.destroy(); } catch { /* 已销毁 */ }
    try { enc?.destroy(); } catch { /* 已销毁 */ }
  }
}
