/**
 * 云侧出站请求的保护壳（11-02，起因：Codex 自检出的主进程原生崩溃）。
 *
 * ⛔⛔ **崩溃是什么**：`node::crypto::TLSWrap::EncOut() use-after-free`，栈是
 *   `uv__write → AfterConnect`。上游 `memapi.ppz123.asia` 响应超时（socket hang up）后，
 *   TLS 流被关掉，但**排队的写入回调仍持有那个流**，下一次发起新 TLS 请求时踩到已释放对象。
 *   这是 Node/OpenSSL 层的问题，**应用层无法在 `TLSWrap` 里加 `isDestroyed()`** ——
 *   那个类不在我们的代码里，Electron 也不暴露补丁点。
 *
 * ⇒ 应用层能做的是**缩小触发窗口**，本文件就干这三件事：
 *   ① **不等 30 秒**：自己的超时（默认 12s）远早于 socket 被上游掐断的窗口，
 *      请求在流被外部关闭之前就主动 abort，避免"外部关闭 + 本地仍在写"的交叠；
 *   ② **同源串行**：同一个 origin 同时只允许一条在飞请求，超时后必须等上一条**彻底结束**
 *      才开始下一条（用户给复现条件正是"超时后立刻发新 TLS 请求"）；
 *   ③ **失败后冷却**：超时/网络错误后该 origin 进入短冷却（默认 1.5s × 次数），
 *      连击时不再原地重锤。
 *
 * ⛔ 不改任何业务语义：返回值和抛错行为与裸 `fetch` 一致（超时抛 AbortError 包装）。
 * ⛔ 只在**主进程**用；渲染层要走 net.fetch（受 CSP 与可信根约束）。
 */

import { net } from "electron";

type Inflight = { origin: string; promise: Promise<unknown> };

const inflight = new Map<string, Promise<unknown>>();
const cooldownUntil = new Map<string, number>();
const failureCount = new Map<string, number>();

export type GuardedFetchOptions = {
  /** 单次请求超时（毫秒）。默认 12s —— 必须明显小于上游 30s 掐断窗口。 */
  timeoutMs?: number;
  /** 失败冷却基数（毫秒）。第 n 次连续失败冷却 n 倍，上限 5 倍。 */
  cooldownMs?: number;
  /** 允许的重试次数（不含首次）。默认 0：云侧写入类请求不该自动重试。 */
  retries?: number;
};

function originOf(input: RequestInfo | URL): string {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : String((input as Request).url ?? "");
    return new URL(raw).origin;
  } catch {
    return "unknown";
  }
}

/** 等冷却结束（如果有）。冷却只在**同一 origin** 上生效。 */
async function waitCooldown(origin: string): Promise<void> {
  const until = cooldownUntil.get(origin) ?? 0;
  const wait = until - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

function markFailure(origin: string, base: number): void {
  const n = (failureCount.get(origin) ?? 0) + 1;
  failureCount.set(origin, n);
  cooldownUntil.set(origin, Date.now() + base * Math.min(n, 5));
}

function markSuccess(origin: string): void {
  failureCount.delete(origin);
  cooldownUntil.delete(origin);
}

/**
 * 受保护的出站 fetch。语义与 `fetch` 相同，仅多了超时 / 同源串行 / 失败冷却。
 * ⛔ 同源串行意味着**并发请求会被排队**（不是并发上限，是队列）——
 *   云侧这些端点本来就是低频调用，串行的代价远小于崩一次。
 */
export async function guardedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: GuardedFetchOptions = {},
): Promise<Response> {
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 12_000);
  const cooldownMs = Math.max(0, options.cooldownMs ?? 1_500);
  const retries = Math.max(0, options.retries ?? 0);
  const origin = originOf(input);

  const run = async (): Promise<Response> => {
    await waitCooldown(origin);
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      /* 调用方自带的 signal（长任务 / 外部取消）必须**叠加**而不是被覆盖：
         AbortSignal.any 任一触发即中止（Node 22 支持）。 */
      const callerSignal = init?.signal ?? null;
      const signal = callerSignal ? AbortSignal.any([controller.signal, callerSignal]) : controller.signal;
      try {
        /* ⛔⛔ 关键：走 **Electron net（Chromium 网络栈）**，不是 Node 的 fetch。
           Node 那条路才会经过 node::crypto::TLSWrap（崩溃点）；Chromium 的 TLS 实现是另一套，
           没有这个 use-after-free。能拿到 net 就用 net，拿不到（极早期/测试环境）才回落。 */
        const doFetch = (typeof net?.fetch === "function" ? net.fetch.bind(net) : fetch) as typeof fetch;
        const response = await doFetch(input, { ...init, signal });
        markSuccess(origin);
        return response;
      } catch (error) {
        lastError = error;
        /* ⛔ 审查修正：callerSignal 主动中止不是上游故障，不计入失败冷却。
           否则用户点一次「停止」，这个 origin 后面要白等 1.5s×n。 */
        if (!callerSignal?.aborted) markFailure(origin, cooldownMs);
        if (attempt < retries) await waitCooldown(origin);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  };

  /* ⛔⛔ 审查修正（11-02）：原来写的是「读一次 inflight 再 await 它」——
     并发时三个请求会在同一个 tick 都读到同一条 prev（后两个还没 set），
     await 结束后**一起放行**，串行等于没做。改成链在**尾巴**上：
     新请求接到"当前最后一条"的后面，形成严格串行链，读与写都在同一个同步块内。 */
  const tail = inflight.get(origin) ?? Promise.resolve();
  const promise = tail.catch(() => undefined).then(() => run());
  inflight.set(origin, promise as Promise<unknown>);
  try {
    return await promise;
  } finally {
    if (inflight.get(origin) === (promise as unknown)) inflight.delete(origin);
  }
}

/** 供诊断/守卫读取：某 origin 当前是否处于冷却。 */
export function guardedFetchSuspended(origin: string): boolean {
  return (cooldownUntil.get(origin) ?? 0) > Date.now();
}

/** 测试用：清空内部状态（⛔ 不要在业务代码里调用）。 */
export function __resetGuardedFetchState(): void {
  inflight.clear();
  cooldownUntil.clear();
  failureCount.clear();
}
