/**
 * 自媒体工作台 · 生图（11-09 接入 dsh-media-desk 的 OpenAI 兼容生图，MIT）。
 *
 * 请求 `POST {baseUrl}/images/generations`（OpenAI 兼容）：body = model/prompt/size/quality/n=1；
 * 回包接受 `data[0].b64_json` 或 `data[0].url`（也兼容 `images[0]`）。
 * ⛔ 只收图片 MIME（png/jpg/webp/gif）、单张 ≤40MB；永久错误（401/404/坏 URL）不重试。
 * ⛔ 图片落在 `<userData>/media-desk/files/`，渲染层用 harness-image 协议按绝对路径显示。
 */
import fs from "node:fs";
import path from "node:path";
import { newId, type MediaDeskSettings } from "./store";

const MAX_BYTES = 40 * 1024 * 1024;
const EXT_BY_MIME: Record<string, string> = {
  "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif",
};

function genUrl(baseUrl: string): string {
  const base = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  if (/\/images\/generations$/i.test(base)) return base;
  return `${base}/images/generations`;
}

function pickImage(data: any): { b64?: string; url?: string } {
  const node = data?.data?.[0] ?? data?.images?.[0] ?? null;
  if (!node) return {};
  return { b64: typeof node.b64_json === "string" ? node.b64_json : undefined, url: typeof node.url === "string" ? node.url : undefined };
}

async function once(settings: MediaDeskSettings, prompt: string, timeoutMs: number): Promise<{ buffer: Buffer; mime: string }> {
  const img = settings.image;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(genUrl(img.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", ...(img.apiKey ? { authorization: `Bearer ${img.apiKey}` } : {}) },
      body: JSON.stringify({
        model: img.model, prompt, size: img.size || "1536x1024", n: 1,
        ...(img.quality ? { quality: img.quality } : {}),
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`生图接口返回 ${res.status}：${text.slice(0, 200)}`);
    let data: any = null;
    try { data = JSON.parse(text); } catch { throw new Error("生图接口返回的不是 JSON（可能不是 OpenAI 兼容地址）"); }
    const hit = pickImage(data);
    if (hit.b64) {
      const buffer = Buffer.from(hit.b64, "base64");
      return { buffer, mime: mimeOf(buffer) };
    }
    if (hit.url) {
      const download = await fetch(hit.url, { signal: controller.signal });
      if (!download.ok) throw new Error(`下载生成图失败：HTTP ${download.status}`);
      const mime = String(download.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const buffer = Buffer.from(await download.arrayBuffer());
      return { buffer, mime: EXT_BY_MIME[mime] ? mime : mimeOf(buffer) };
    }
    throw new Error("生图接口没有返回图片（缺 b64_json / url）");
  } finally {
    clearTimeout(timer);
  }
}

/** 看文件头判 MIME（服务端 content-type 不可靠时兜底）。 */
function mimeOf(buffer: Buffer): string {
  if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50) return "image/png";
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer.length > 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buffer.length > 6 && buffer.toString("ascii", 0, 3) === "GIF") return "image/gif";
  return "";
}

/** 生成一张图并落盘；返回绝对路径。永久错误不重试，瞬时错误（超时/5xx）重试一次。 */
export async function generateImage(settings: MediaDeskSettings, prompt: string, outDir: string, timeoutMs = 180_000): Promise<string> {
  const img = settings.image;
  if (!img.baseUrl.trim() || !img.model.trim()) {
    throw new Error("还没有配置生图接口：请到「自媒体工作台 → 设置」填写图片 API（baseUrl / model / key）。");
  }
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { buffer, mime } = await once(settings, prompt, timeoutMs);
      if (!EXT_BY_MIME[mime]) throw new Error("生成结果不是受支持的图片格式（png/jpg/webp/gif）");
      if (buffer.length > MAX_BYTES) throw new Error("生成图超过 40MB，已放弃");
      fs.mkdirSync(outDir, { recursive: true });
      const file = path.join(outDir, `${newId("img")}${EXT_BY_MIME[mime]}`);
      fs.writeFileSync(file, buffer);
      return file;
    } catch (error: any) {
      lastError = error;
      const message = String(error?.message ?? error);
      // 永久错误（鉴权/地址错/格式错）立即放弃，⛔ 别把 401 重试成两次计费。
      if (/返回 40[0134]|不是 JSON|没有返回图片|不是受支持|超过 40MB/.test(message)) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
