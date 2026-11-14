/**
 * 统一镜像下载器（11-03 用户：「下载好慢 / 没有进度条 / 没有取消」）。
 *
 * 精选技能包与 Filee 这类 GitHub 大包安装共用这一份，不再各自维护下载循环：
 *   ① **选最快源**：gh-proxy / ghfast / 直连 各探一次（Range 取前 8KB 计 TTFB），按快慢排序，
 *      不再固定 gh-proxy 优先。实测本机 37MB 包直连 2.6MB/s、gh-proxy 0.76MB/s（3.4× 差距），
 *      固定顺序直接决定用户等 48s 还是 14s。存活但慢的源也不再排在第一。
 *   ② 走 Electron `net.fetch`（Chromium 网络栈 + 系统代理）；原先的 `fetch` 是 Node undici，
 *      不吃系统代理，开了代理的用户等于直连海外。
 *   ③ **停滞换源**：20s 没有任何新字节 ⇒ 判这个源死了，换下一个（原实现没有超时，
 *      镜像挂起时会一直等，用户看到的就是"安装半天装不上"）。
 *   ④ 流式落盘 + SHA256 边下边算 + 百分比/速度回调；支持 AbortSignal 与 isCancelled 轮询取消，
 *      失败/取消删除半截文件。
 */
import { net } from "electron";
import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { mirrorCandidates } from "./gh-mirror";

export class DownloadCancelledError extends Error {
  constructor() { super("已取消"); this.name = "DownloadCancelledError"; }
}

export type MirrorProgress = {
  received: number;
  /** 0 = 服务端没给 content-length（只能报已下载字节） */
  total: number;
  host: string;
  percent: number;
  bytesPerSec: number;
};

export type MirrorDownloadResult = { bytes: number; sha256: string; host: string };

const PROBE_TIMEOUT_MS = 1_500;
const PROBE_BYTES = 256 * 1024;
const STALL_MS = 20_000;

/** 探一个候选：**实测吞吐**（最多取 256KB / 1.5s），返回 bytes/s；不通返回 0。
 *  ⛔ 不能只看 TTFB：gh-proxy 对小请求回得快、整包吞吐却可能只有直连的 1/3
 *    （实测 37MB 包：直连 2.6MB/s、gh-proxy 0.76MB/s），TTFB 会把慢源排到第一。
 */
async function probeCandidate(url: string): Promise<number> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await net.fetch(url, { redirect: "follow", signal: controller.signal, headers: { Range: `bytes=0-${PROBE_BYTES - 1}` } });
    if (!res.ok && res.status !== 206) return 0;
    const reader = res.body?.getReader();
    if (!reader) return 0;
    let got = 0;
    while (got < PROBE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value?.byteLength ?? 0;
      if (Date.now() - started >= PROBE_TIMEOUT_MS) break;
    }
    void reader.cancel().catch(() => undefined);
    if (!got) return 0;
    return (got * 1000) / Math.max(1, Date.now() - started);
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

/** 所有候选按「实测吞吐」从高到低排序；实测为 0 的保持原顺序垫底（下载阶段还会报具体错误）。 */
export async function rankMirrors(url: string): Promise<string[]> {
  const candidates = mirrorCandidates(url);
  if (candidates.length <= 1) return candidates;
  const probed = await Promise.all(candidates.map(async (candidate) => ({ candidate, score: await probeCandidate(candidate) })));
  const alive = probed.filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score).map((entry) => entry.candidate);
  const dead = probed.filter((entry) => entry.score <= 0).map((entry) => entry.candidate);
  return [...alive, ...dead];
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

/**
 * 镜像序流式下载到 target。成功返回字节数 / SHA256 / 实际使用的源。
 * ⛔ 取消：外部 signal 或 isCancelled() 任一为真 ⇒ 立刻中止并抛 DownloadCancelledError
 *   （调用方据此返回「已取消」，不要当失败弹红字）。
 */
export async function downloadThroughMirrors(options: {
  url: string;
  target: string;
  signal?: AbortSignal;
  isCancelled?: () => boolean;
  onProgress?: (progress: MirrorProgress) => void;
  /** 镜像返回 200 + 错误页时不能当成功：校验 zip 魔数 PK */
  expectZipMagic?: boolean;
  stallMs?: number;
}): Promise<MirrorDownloadResult> {
  const { url, target, signal, isCancelled, onProgress, expectZipMagic, stallMs = STALL_MS } = options;
  const cancelled = () => Boolean(signal?.aborted) || Boolean(isCancelled?.());
  if (cancelled()) throw new DownloadCancelledError();
  await fs.mkdir(path.dirname(target), { recursive: true });

  const ordered = await rankMirrors(url);
  const tried: string[] = [];
  for (const candidate of ordered) {
    if (cancelled()) throw new DownloadCancelledError();
    const host = hostOf(candidate);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    let stallTimer: NodeJS.Timeout | null = null;
    let stalled = false;
    const armStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => { stalled = true; controller.abort(); }, stallMs);
    };
    try {
      armStall();
      const res = await net.fetch(candidate, { redirect: "follow", signal: controller.signal });
      if (!res.ok || !res.body) { tried.push(`${host}(HTTP ${res.status})`); continue; }
      const total = Number(res.headers.get("content-length") ?? 0) || 0;
      const file = createWriteStream(target);
      const hash = createHash("sha256");
      const finished = once(file, "finish");
      let received = 0;
      let reported = 0;
      let windowBytes = 0;
      let firstByteAt = 0;
      let windowAt = Date.now();
      const report = (force = false) => {
        const now = Date.now();
        if (!force && now - windowAt < 400) return;
        if (!firstByteAt && received > 0) firstByteAt = now;
        reported = received;
        windowBytes = 0;
        windowAt = now;
        /* ⛔ 不用「本窗口增量 / 窗口时长」：Chromium 会成块交付（一次几十 MB），
           算出来是几十上百 MB/s 的假峰值。用**从首字节起的平均速率**，稳定且不骗人。 */
        const elapsed = firstByteAt ? (now - firstByteAt) / 1000 : 0;
        const speed = elapsed >= 0.4 ? received / elapsed : 0;
        onProgress?.({
          received,
          total,
          host,
          percent: total ? Math.min(100, Math.round((received / total) * 100)) : 0,
          bytesPerSec: Number.isFinite(speed) && speed > 0 ? speed : 0,
        });
      };
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          if (cancelled()) { controller.abort(); throw new DownloadCancelledError(); }
          armStall();
          received += chunk.byteLength;
          windowBytes += chunk.byteLength;
          hash.update(chunk);
          if (!file.write(chunk)) {
            /* ⛔ 11-14 实测死锁：镜像卡住时 stall 定时器 abort 了 controller，但如果这里正等
               write 的 drain（写缓冲满），abort 不会让文件流发 drain ⇒ 整个下载永远挂着（进度停在某个字节数）。
               等信息量回压时必须同时 races 掉 abort。 */
            let onAbort: (() => void) | null = null;
            const aborted = new Promise<never>((_, reject) => {
              onAbort = () => reject(new Error("download aborted"));
              if (controller.signal.aborted) onAbort();
              else controller.signal.addEventListener("abort", onAbort, { once: true });
            });
            try {
              await Promise.race([once(file, "drain"), aborted]);
            } finally {
              if (onAbort) controller.signal.removeEventListener("abort", onAbort);
            }
          }
          // 首块必报（小包也能立刻看见进度），之后按时间/字节节流；小包也要有多次更新
          const step = total ? Math.min(Math.max(64 * 1024, total / 100), 512 * 1024) : 512 * 1024;
          if (!reported || windowBytes >= step) report(true);
          else report();
        }
      } finally {
        file.end();
        if (stallTimer) clearTimeout(stallTimer);
      }
      await finished;
      if (!received) throw new Error("下载到 0 字节");
      if (expectZipMagic) {
        const head = (await fs.readFile(target)).subarray(0, 2).toString("latin1");
        if (head !== "PK") throw new Error("下载内容不是 zip（镜像可能返回了错误页）");
      }
      const sha256 = hash.digest("hex");
      onProgress?.({ received, total: total || received, host, percent: 100, bytesPerSec: 0 });
      return { bytes: received, sha256, host };
    } catch (error) {
      /* 取消也要删半截文件（否则临时目录攒垃圾、下次续传可能拿到坏包）。 */
      if (error instanceof DownloadCancelledError || cancelled()) {
        await fs.rm(target, { force: true }).catch(() => undefined);
        throw new DownloadCancelledError();
      }
      tried.push(`${host}(${stalled ? `停滞 ${Math.round(stallMs / 1000)}s` : String((error as { message?: unknown })?.message ?? error).slice(0, 48)})`);
      await fs.rm(target, { force: true }).catch(() => undefined);
    } finally {
      signal?.removeEventListener("abort", onAbort);
      if (stallTimer) clearTimeout(stallTimer);
    }
  }
  throw new Error(`下载失败：${tried.join(" → ")}`);
}
