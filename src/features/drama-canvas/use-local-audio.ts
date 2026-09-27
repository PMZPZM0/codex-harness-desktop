/**
 * 本地音频 → 可播放 URL（域内私有）。
 *
 * 为什么不能直接用路径当 `<audio src>`：
 *  · 应用只给**图片**注册了 `harness-image://` 协议，非图片扩展名一律 415
 *    （`electron/features/boot.ts` 的协议 handler 只放行常见图片后缀）；
 *  · `file://` 在渲染层被 CSP/webSecurity 挡住。
 * 所以走 `fs:read` 读回 base64 → 造 blob URL。加一层模块级缓存：
 * 同一段配音在多处显示（卡片 + 检查器 + 时间线）不会重复读盘，也不会反复造对象 URL。
 */
import { useEffect, useState } from "react";
import { base64Payload } from "./drama-storage";

const cache = new Map<string, string>();

async function resolve(path: string): Promise<string> {
  const hit = cache.get(path);
  if (hit) return hit;
  const file = await window.codex.readFile(path);
  const bin = atob(base64Payload(file.dataBase64));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  cache.set(path, url);
  return url;
}

/** 本地路径 → blob URL；已是 http/data/blob 的原样返回；失败返回 ""（调用方显示"读不到"）。 */
export function useLocalAudio(path: string): string {
  const [url, setUrl] = useState(() => (path && cache.get(path)) || (/^(https?:|data:|blob:)/i.test(path) ? path : ""));
  useEffect(() => {
    if (!path) { setUrl(""); return; }
    if (/^(https?:|data:|blob:)/i.test(path)) { setUrl(path); return; }
    const cached = cache.get(path);
    if (cached) { setUrl(cached); return; }
    // 只对自己产出的 wav 做这个动作：fs:read 有 2MB 上限，别的格式大概率读不动，白跑一趟
    if (!/\.wav$/i.test(path)) { setUrl(""); return; }
    let alive = true;
    void (async () => {
      try {
        const resolved = await resolve(path);
        if (alive) setUrl(resolved);
      } catch {
        if (alive) setUrl("");
      }
    })();
    return () => { alive = false; };
  }, [path]);
  return url;
}
