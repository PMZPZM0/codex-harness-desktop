/**
 * 媒体类型识别 + 本地媒体 URL 归一化（纯函数、零依赖）。
 *
 * ⛔ 为什么单独成模块：渲染层文件卡 / 用户附件 / 工具产物三处都要判断
 *    「这是视频、音频还是 3D」，各写一份扩展名表必然漂移；协议层（主进程）
 *    也要用同一份 MIME 白名单。这里只放纯逻辑，主进程/测试可直接 import。
 *
 * 支持的格式是**故意的窄名单**：
 * · 视频：mp4 / webm / mov / m4v / ogv（Chromium 原生解码；mov+HEVC 取决于
 *   Electron 自带编解码器，不保证全设备可播）
 * · 音频：mp3 / wav / m4a / aac / ogg / flac / opus
 * · 3D：glb / gltf（现有 ModelViewerModal 只支持这两种；obj/stl/fbx 需要
 *   另外的加载器，不在本轮范围）
 * 图片不进这里 —— 图片走既有的 isImagePath / harness-image 协议。
 */

/** 本地媒体协议前缀（与 electron/features/boot.ts 的 handler 同源）。 */
export const MEDIA_SCHEME = "harness-media://local?path=";

export const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "m4v", "ogv", "m3u8"];
export const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "ogg", "flac", "opus"];
export const MODEL_EXTENSIONS = ["glb", "gltf"];

const VIDEO = new Set(VIDEO_EXTENSIONS);
const AUDIO = new Set(AUDIO_EXTENSIONS);
const MODEL = new Set(MODEL_EXTENSIONS);

/** 本地路径 / URL 的扩展名（小写，不含点）。data URL 返回空串（由 mediaKindOf 读 MIME）。 */
export function extensionOf(value) {
  const s = String(value ?? "").trim();
  if (!s || /^data:/i.test(s)) return "";
  let pathname = s;
  if (/^https?:\/\//i.test(s)) {
    try { pathname = new URL(s).pathname; } catch { pathname = s; }
  }
  const noQuery = pathname.split(/[?#]/)[0];
  const name = noQuery.split(/[\\/]/).pop() || "";
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1].toLowerCase() : "";
}

/** 媒体类型：video | audio | model；图片/未知返回空串（图片继续走旧通道）。 */
export function mediaKindOf(value) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  if (/^data:/i.test(s)) {
    const m = /^data:([^;,]+)/i.exec(s);
    const mime = m ? m[1].toLowerCase() : "";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    if (/model\/(gltf|gltf-binary)/.test(mime)) return "model";
    return "";
  }
  const ext = extensionOf(s);
  if (VIDEO.has(ext)) return "video";
  if (AUDIO.has(ext)) return "audio";
  if (MODEL.has(ext)) return "model";
  return "";
}

export function isVideoPath(value) { return mediaKindOf(value) === "video"; }
export function isAudioPath(value) { return mediaKindOf(value) === "audio"; }
export function isModelPath(value) { return mediaKindOf(value) === "model"; }

/** HLS 播放列表（.m3u8）：视频元素原生播不了，渲染层要用 hls.js 接。 */
export function isHlsSource(value) {
  return extensionOf(value) === "m3u8";
}

/** http(s) 远程地址（本地播放器只对这类地址走 HLS 网络加载）。 */
export function isRemoteMediaSource(value) {
  return /^https?:\/\//i.test(String(value ?? "").trim());
}

/**
 * 媒体显示 src：本地路径 → harness-media 协议；data/blob/http(s)/已有协议原样返回。
 * ⛔ 与 imageDisplaySrc 一样必须**双编码**：Chromium 会先解一层 percent 编码，
 *    路径里的反斜杠/百分号只编码一次会在协议层丢失。
 */
export function mediaDisplaySrc(source) {
  const s = String(source ?? "");
  if (!s) return "";
  if (/^(data:|blob:|https?:|harness-media:)/i.test(s)) return s;
  return `${MEDIA_SCHEME}${encodeURIComponent(encodeURIComponent(s))}`;
}

/**
 * 从工具结果/对象里扫描媒体路径（不读盘，只做字符串匹配；调用方自行 fileExists 验证）。
 * 只收 video/audio/model；图片继续走 imageGeneration/灯箱，不在这里出播放器。
 */
// ⛔ `/` 后跟空格不是 Unix 路径：工具输出「15 帧 / 10 KB」里的斜杠曾被当成路径起点，
//    一路吞到后面的媒体扩展名（实测把音频路径吞成 `/ 10 KB）；`/(?!\s)` 把它挡掉。
const MEDIA_FILE_RE = /(?:[A-Za-z]:[\\/]|\/(?!\s)|https?:\/\/)[^"'`\r\n<>|]*?\.(?:mp4|webm|mov|m4v|ogv|m3u8|mp3|wav|m4a|aac|ogg|flac|opus|glb|gltf)(?:\?[^\s"'`<>]*)?(?:#[^\s"'`<>]*)?(?=$|[\s"'`,;:)\]}>*，。；：、！？（）【】《》“”‘’])/gi;

export function collectMediaPaths(value, limit = 8) {
  const out = [];
  const seen = new Set();
  const push = (raw) => {
    const path = String(raw ?? "").trim().replace(/[)\]}>.,;:]+$/, "");
    if (!path) return;
    const kind = mediaKindOf(path);
    if (!kind || kind === "image" || seen.has(path)) return;
    seen.add(path);
    out.push({ path, kind });
  };
  const visit = (v) => {
    if (out.length >= limit) return;
    if (typeof v === "string") {
      let match;
      MEDIA_FILE_RE.lastIndex = 0;
      while ((match = MEDIA_FILE_RE.exec(v)) && out.length < limit) push(match[0]);
      return;
    }
    if (Array.isArray(v)) { for (const item of v) visit(item); return; }
    if (v && typeof v === "object") { for (const item of Object.values(v)) visit(item); }
  };
  visit(value);
  return out;
}
