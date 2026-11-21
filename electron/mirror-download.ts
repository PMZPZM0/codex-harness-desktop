/**
 * 统一镜像下载器（11-03 用户：「下载好慢 / 没有进度条 / 没有取消」）。
 *
 * 精选技能包与 Filee 这类 GitHub 大包安装共用这一份，不再各自维护下载循环：
 *   ① **选最快源**：gh-proxy / ghfast / 直连 各探一次（Range 取前 8KB 计 TTFB），按快慢排序，
 *      不再固定 gh-proxy 优先。实测本机 37MB 包直连 2.6MB/s、gh-proxy 0.76MB/s（3.4× 差距），
 *      固定顺序直接决定用户等 48s 还是 14s。存活但慢的源也不再排在第一。
 *   ② 走 Electron `net.fetch`（Chromium 网络栈 + 系统代理）；原先的 `fetch` 是 Node undici，
 *      不吃系统代理，开了代理的用户等于直连海外。
 *   ③ **停滞换源**：**8 秒**没有任何新字节 ⇒ 判这个源死了，换下一个（原实现 20s，用户体感
 *      「经常 20s 超时」；国内镜像死掉时根本不会吐字节，8s 足够判死）。
 *   ④ 流式落盘 + SHA256 边下边算 + 百分比/速度回调；支持 AbortSignal 与 isCancelled 轮询取消，
 *      失败/取消删除半截文件。
 *   ⑤ **分片并发**（11-21 用户：「镜像太慢」）：实测本机单流 0.83MB/s，同源 4 连接并发到
 *      2.2MB/s（2.6×）。对**支持 Range 的源**切 4 段并行下到 .partN，再按序合并算摘要；
 *      不支持 Range（回 200 全量）或总长太小则回落单流。⛔ 段内失败一律删干净再交回单流。
 */
import { net } from "electron";
import { createReadStream, createWriteStream } from "node:fs";
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
/* ⛔ 11-21 用户实测「经常出现 20s 超时，镜像不稳定还慢」：死源不会吐任何字节，
   20 秒纯属让用户干等 —— 降到 8s（实测 ghfast 类死源在 8s 内一定判出）。 */
const STALL_MS = 8_000;
/* ⛔⛔ 11-15 用户实测「100 来 M 的东西下载几个小时」：只有「零字节」才判死时，
   限速源会**稳定地每秒吐一点**——永远不触发停滞判据，于是 100MB 拖成 1~5 小时
   （实测 gh-proxy.net 6KB/s、gh-proxy.com 269KB/s）。
   ⇒ 下载满 8 秒后，平均速率低于 400KB/s 且**还有别的候选没试** ⇒ 主动换源。
   最后一个候选不因慢被换（否则会把用户本来就慢的网络彻底掐死）。 */
const SLOW_SPEED_BYTES_PER_SEC = 400 * 1024;
const SLOW_GRACE_MS = 8_000;
/* 分片并发：实测（gh-proxy.org，4MB/段）单流 0.83MB/s → 4 连接 2.2MB/s（2.6×）。
   ⛔ 别再往上加：镜像侧会限流，8 连接起收益递减且更容易被掐（429/断流）。 */
const SEGMENT_CONNECTIONS = 4;
/* 小于这个总长不分片：起连接与合并的开销比分片收益更大。 */
const SEGMENT_MIN_BYTES = 4 * 1024 * 1024;

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

/** 所有候选按「实测吞吐」从高到低排序（带分数，供下载阶段跳过死源）。 */
export async function rankMirrors(url: string): Promise<Array<{ candidate: string; score: number }>> {
  const candidates = mirrorCandidates(url);
  if (candidates.length <= 1) return candidates.map((candidate) => ({ candidate, score: -1 }));
  const probed = await Promise.all(candidates.map(async (candidate) => ({ candidate, score: await probeCandidate(candidate) })));
  const alive = probed.filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);
  const dead = probed.filter((entry) => entry.score <= 0);
  return [...alive, ...dead];
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

/** 该源是否支持**真正的** Range（206 + `content-range: bytes 0-0/总长`），返回总长；不支持返回 null。
 *  ⛔ 不能凭「请求带了 Range 参数」判断支持 —— 有的镜像**忽略 Range 直接回 200 全量**
 *    （实测 gh-proxy.com 就是），拿 200 当支持会把整包当一段重复下 N 遍。
 *  ⛔ 总长小于分片阈值也返回 null（起连接+合并的开销比分片收益大）。 */
async function probeRangeSupport(candidate: string, signal?: AbortSignal): Promise<number | null> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), STALL_MS);
  try {
    const res = await net.fetch(candidate, { redirect: "follow", signal: controller.signal, headers: { Range: "bytes=0-0" } });
    if (res.status !== 206) return null;
    void res.body?.cancel().catch(() => undefined);
    const total = Number((/\/\s*(\d+)\s*$/.exec(res.headers.get("content-range") ?? "") ?? [])[1] ?? 0) || 0;
    return total >= SEGMENT_MIN_BYTES ? total : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * 分片并发下载（4 段并行 → 按序合并 → 整份 SHA256）。
 *
 * 返回 null = 这个源不适合分片（非 206 / 分段字节数不符 / 中途出错），调用方**回落单流**；
 * 取消则抛 DownloadCancelledError（⛔ 不能吞成 null，否则上层会继续试下一个源）。
 */
async function trySegmentedDownload(args: {
  candidate: string;
  target: string;
  total: number;
  host: string;
  signal?: AbortSignal;
  isCancelled?: () => boolean;
  onProgress?: (progress: MirrorProgress) => void;
}): Promise<MirrorDownloadResult | null> {
  const { candidate, target, total, host, signal, isCancelled, onProgress } = args;
  const cancelled = () => Boolean(signal?.aborted) || Boolean(isCancelled?.());
  const chunk = Math.ceil(total / SEGMENT_CONNECTIONS);
  const parts: Array<{ start: number; end: number; file: string }> = [];
  for (let index = 0; index < SEGMENT_CONNECTIONS; index += 1) {
    const start = index * chunk;
    if (start >= total) break;
    parts.push({ start, end: Math.min(total - 1, start + chunk - 1), file: `${target}.part${index}` });
  }
  const received = new Array<number>(parts.length).fill(0);
  /* ⛔ 11-21 用户「下载到一半重试」：断流后从头再下 600MB 最伤体验。分片文件**保留**，
     重试时先看每段已有多少字节 ⇒ 从断点续传；段长对不上（半截写坏）才从头下载该段。 */
  await Promise.all(parts.map(async (part, index) => {
    const expected = part.end - part.start + 1;
    const have = await fs.stat(part.file).then((st) => st.size).catch(() => 0);
    received[index] = have > 0 && have <= expected ? have : 0;
    if (received[index] === 0) await fs.rm(part.file, { force: true }).catch(() => undefined);
  }));
  const resumedBytes = received.reduce((a, b) => a + b, 0);
  if (resumedBytes > 0) onProgress?.({ received: resumedBytes, total, host, percent: Math.min(99, Math.round((resumedBytes / total) * 100)), bytesPerSec: 0 });
  const startedAt = Date.now();
  let firstAt = 0;
  let lastReport = 0;
  const report = () => {
    const now = Date.now();
    if (now - lastReport < 400) return;
    lastReport = now;
    const sum = received.reduce((a, b) => a + b, 0);
    if (!firstAt && sum > 0) firstAt = now;
    const elapsed = firstAt ? (now - firstAt) / 1000 : 0;
    const speed = elapsed >= 0.4 ? sum / elapsed : 0;
    onProgress?.({
      received: sum,
      total,
      host,
      percent: total ? Math.min(100, Math.round((sum / total) * 100)) : 0,
      bytesPerSec: Number.isFinite(speed) ? speed : 0,
    });
  };
  const cleanupParts = async () => {
    for (const part of parts) await fs.rm(part.file, { force: true }).catch(() => undefined);
  };
  try {
    await Promise.all(parts.map(async (part, index) => {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      let stallTimer: NodeJS.Timeout | null = null;
      const arm = () => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => controller.abort(), STALL_MS);
      };
      try {
        arm();
        const expected = part.end - part.start + 1;
        if (received[index] >= expected) return; /* 该段上次已下完 ⇒ 跳过 */
        const from = part.start + received[index];
        const res = await net.fetch(candidate, {
          redirect: "follow",
          signal: controller.signal,
          headers: { Range: `bytes=${from}-${part.end}` },
        });
        if (res.status !== 206 || !res.body) throw new Error(`分段请求未返回 206（${res.status}）`);
        /* 续传：追加写（已有字节保留），配合上面的 Range 起点。
           ⛔ 不走 pipeline：这版 @types 对 (Readable, Transform, WriteStream) 的重载不认，
             而且 abort 时的挂起语义还得自己处理 —— 手写循环与单流那段保持同一套写法。 */
        const sink = createWriteStream(part.file, { flags: "a" });
        const destroyOnAbort = () => sink.destroy();
        controller.signal.addEventListener("abort", destroyOnAbort, { once: true });
        try {
          for await (const buf of res.body as unknown as AsyncIterable<Uint8Array>) {
            if (controller.signal.aborted) throw new DownloadCancelledError();
            arm();
            received[index] += buf.byteLength;
            report();
            if (!sink.write(buf)) {
              /* ⛔ abort 时 sink 被 destroy，drain 永远不会来 ⇒ 与 close 一起 race 掉。 */
              await Promise.race([once(sink, "drain"), once(sink, "close")]).catch(() => undefined);
            }
          }
        } finally {
          controller.signal.removeEventListener("abort", destroyOnAbort);
          sink.end();
          await once(sink, "finish").catch(() => undefined);
        }
        if (received[index] !== expected) throw new Error(`分段字节数不符（${received[index]}/${expected}）`);
      } finally {
        if (stallTimer) clearTimeout(stallTimer);
        signal?.removeEventListener("abort", onAbort);
      }
    }));
    if (cancelled()) throw new DownloadCancelledError();
    /* 合并：按段序 append，边写边算 SHA256（与单流同一份摘要口径，调用方校验逻辑不用改）。 */
    const hash = createHash("sha256");
    const out = createWriteStream(target);
    try {
      for (const part of parts) {
        for await (const buf of createReadStream(part.file)) {
          hash.update(buf as Buffer);
          if (!out.write(buf)) await once(out, "drain");
        }
      }
    } finally {
      out.end();
      await once(out, "finish").catch(() => undefined);
    }
    onProgress?.({ received: total, total, host, percent: 100, bytesPerSec: 0 });
    /* 成功合并 ⇒ 段文件用完即弃。 */
    await cleanupParts();
    return { bytes: total, sha256: hash.digest("hex"), host };
  } catch (error) {
    if (error instanceof DownloadCancelledError || cancelled()) {
      await cleanupParts();
      await fs.rm(target, { force: true }).catch(() => undefined);
      throw new DownloadCancelledError();
    }
    /* ⛔ 11-21：**失败不删段文件** —— 用户实测「下载到一半重试」，保留断点下次续传；
       数据不可信的场景（尺寸/摘要校验不过）由 clearDownloadParts 显式清理。 */
    return null;
  }
}

/** 删除某次下载残留的续传分片。
 *  ⛔ 只在校验失败 / 尺寸不符时调用：那时段里的字节不可信，续传只会把坏数据接上去。 */
export async function clearDownloadParts(target: string): Promise<void> {
  for (let index = 0; index < SEGMENT_CONNECTIONS; index += 1) {
    await fs.rm(`${target}.part${index}`, { force: true }).catch(() => undefined);
  }
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
  /* 探针已判死的源直接跳过 —— 「8s 停滞 × 4 档」的纯等待正是用户说的「经常 20s 超时」体感来源。
     ⛔ 只有全部源都死（anyAlive=false）时才逐个真试，别把最后一线希望也跳掉。 */
  const anyAlive = ordered.some((entry) => entry.score > 0);
  for (let candidateIndex = 0; candidateIndex < ordered.length; candidateIndex += 1) {
    const candidate = ordered[candidateIndex].candidate;
    /** 后面还有候选可试（只有这时才允许因为「太慢」或「停滞」主动换源） */
    const hasAlternative = candidateIndex < ordered.length - 1;
    let slowSource = false;
    if (cancelled()) throw new DownloadCancelledError();
    const host = hostOf(candidate);
    if (anyAlive && ordered[candidateIndex].score <= 0 && hasAlternative) {
      tried.push(`${host}(探针不通，跳过)`);
      continue;
    }
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
      /* ⛔ 11-21 用户「镜像太慢」：先看这个源支不支持真 Range，支持就 4 段并发下（实测 2.6×）。
         返回 null = 该源不适合分片（忽略 Range / 分段不符 / 出错）⇒ 继续走下面的单流，不算失败。 */
      const rangeTotal = await probeRangeSupport(candidate, signal);
      if (rangeTotal) {
        const segmented = await trySegmentedDownload({ candidate, target, total: rangeTotal, host, signal, isCancelled, onProgress });
        if (segmented) return segmented;
        if (cancelled()) throw new DownloadCancelledError();
      }
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
        /* 限速源换源（见 SLOW_SPEED_BYTES_PER_SEC 的说明）：只标记并 abort，由 catch 记一笔后试下一个。 */
        if (hasAlternative && !slowSource && elapsed * 1000 >= SLOW_GRACE_MS && speed > 0 && speed < SLOW_SPEED_BYTES_PER_SEC) {
          slowSource = true;
          controller.abort();
        }
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
              /* ⛔ `once(file,"drain")` 在 abort 胜出后仍挂着：文件流若随后 close/error，
                 那个没人 await 的 promise 会变成 unhandled rejection。这里把它收敛成 void。 */
              const drained = once(file, "drain").then(() => undefined, () => undefined);
              await Promise.race([drained, aborted]);
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
      tried.push(`${host}(${slowSource ? "太慢，已换源" : stalled ? `停滞 ${Math.round(stallMs / 1000)}s` : String((error as { message?: unknown })?.message ?? error).slice(0, 48)})`);
      await fs.rm(target, { force: true }).catch(() => undefined);
    } finally {
      signal?.removeEventListener("abort", onAbort);
      if (stallTimer) clearTimeout(stallTimer);
    }
  }
  throw new Error(`下载失败：${tried.join(" → ")}`);
}
