/**
 * 音乐取流令牌（10-20）：插件/兜底拿到的**真实音频地址 + 请求头**只留在主进程，
 * 渲染层拿到的是 `harness-music://stream/<token>`。协议端按 token 反查并流式转发（支持 Range）。
 *
 * ⛔ 为什么不把真实 URL 直接交给渲染层：很多音乐 CDN 要 Referer/UA，跨域也会挡；
 *    令牌还保证「谁都不能让协议去请求任意地址」—— 地址只来自解析结果，渲染层无法伪造。
 * ⛔ 令牌短命（30 分钟）+ 有上限（200 条），每次读写顺手清理过期项，不需要额外定时器。
 */
import { randomUUID } from "node:crypto";

export type MusicStreamEntry = { url: string; headers: Record<string, string>; expiresAt: number };

const STREAMS = new Map<string, MusicStreamEntry>();
const TTL_MS = 30 * 60_000;
const MAX_STREAMS = 200;

function prune(now: number): void {
  for (const [token, entry] of STREAMS) {
    if (entry.expiresAt <= now) STREAMS.delete(token);
  }
  while (STREAMS.size > MAX_STREAMS) {
    const first = STREAMS.keys().next().value;
    if (!first) break;
    STREAMS.delete(first);
  }
}

export function createMusicStream(url: string, headers: Record<string, string> = {}): string {
  const now = Date.now();
  prune(now);
  const token = randomUUID().replace(/-/g, "");
  STREAMS.set(token, { url, headers, expiresAt: now + TTL_MS });
  return token;
}

export function getMusicStream(token: string): MusicStreamEntry | null {
  const now = Date.now();
  prune(now);
  const entry = STREAMS.get(String(token ?? ""));
  if (!entry || entry.expiresAt <= now) {
    if (entry) STREAMS.delete(String(token ?? ""));
    return null;
  }
  return entry;
}
