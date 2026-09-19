/**
 * electron/rollout-pool.ts —— rollout 磁盘 I/O 的 worker 客户端（零阻塞宿主）
 *
 * 背景（2026-09-12 多会话性能）：所有会话共用**同一个主进程事件循环**，而 rollout 的
 * 扫描/解析是同步文件 I/O。它出现在 `codex:request` 链上时，那段时间**所有会话**的事件
 * 转发全部停摆 —— 这就是「多会话一起卡」的形态。本模块把这块整体挪进 worker 线程，
 * 主进程侧只剩内存操作与 Promise 等待。
 *
 * 约定：
 *   · worker 常驻（自带缓存，跨请求复用）；懒启动，第一次用到才建。
 *   · 每个请求带自增 id，用 Map 配对 Promise；worker 崩溃时**一次性失败所有在途请求**
 *     并允许下次调用重建 worker（绝不静默挂住）。
 *   · worker 源码以字符串内联（`{ eval: true }`），因为打包后 `app.asar` 内的路径
 *     worker_threads 读不到（详见 scripts/gen-rollout-worker.mjs）。
 */

import { Worker } from "node:worker_threads";
import { ROLLOUT_WORKER_SOURCE } from "./rollout-worker-source";

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
/** 单请求超时：worker 异常时不能让调用方永久等下去（宁可报错，也不静默挂住） */
const REQUEST_TIMEOUT_MS = 15_000;

function ensureWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(ROLLOUT_WORKER_SOURCE, { eval: true });
  } catch (error) {
    console.warn("[rollout-pool] worker 启动失败，本次请求将回退主线程同步实现：", (error as Error)?.message);
    worker = null;
    return null;
  }
  worker.on("message", (msg: any) => {
    const entry = pending.get(msg?.id);
    if (!entry) return;
    pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.ok) entry.resolve(msg.data);
    else entry.reject(new Error(String(msg.error ?? "rollout worker failed")));
  });
  worker.on("error", (error) => {
    console.warn("[rollout-pool] worker 出错，后续请求将重建：", error?.message);
    failAll(error instanceof Error ? error : new Error(String(error)));
  });
  worker.on("exit", (code) => {
    if (code !== 0) console.warn(`[rollout-pool] worker 退出（code=${code}），后续请求将重建`);
    failAll(new Error(`rollout worker exited (${code})`));
  });
  worker.unref?.();
  return worker;
}

function failAll(error: Error) {
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(error);
  }
  pending.clear();
  worker = null;
}

function call(op: "list" | "enrich" | "purge" | "healLineage", payload: Record<string, unknown>): Promise<any> {
  const w = ensureWorker();
  if (!w) return Promise.reject(new Error("rollout worker unavailable"));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`rollout worker 超时（${REQUEST_TIMEOUT_MS}ms, op=${op}）`));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    try {
      w.postMessage({ id, op, ...payload });
    } catch (error) {
      pending.delete(id);
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** 侧栏会话列表兜底扫描（worker 版：目录遍历与单文件解析都在 worker 线程里） */
export function listRolloutThreadsAsync(codexHome: string): Promise<any[]> {
  return call("list", { root: codexHome });
}

/** 把 rollout 里的工具调用补进 thread（worker 版） */
export function enrichThreadWithRolloutToolsAsync(thread: any, codexHome: string): Promise<any> {
  return call("enrich", { thread, root: codexHome });
}

/** 永久删除线程时清理磁盘 rollout 文件（worker 版）。
 *  不清理的话，侧栏的 rollout 兜底扫描会在下次启动把删掉的会话捞回来
 *  （09-18 用户实测「我删除了，重启又恢复了」，根因见 rollout-worker.cjs 的 purgeRolloutFiles）。
 *  ⛔ 09-19 起 purge 带**血缘守卫**：被别的活着的会话依赖的源 rollout 不会被删（kept），
 *  否则那些会话会报 `missing source rollout` 彻底打不开。 */
export function purgeRolloutFilesAsync(codexHome: string, ids: string[]): Promise<{ removed: string[]; failed: { path: string; error: string }[]; kept?: { path: string; id: string; dependents: string[] }[] }> {
  return call("purge", { root: codexHome, ids });
}

/** 血缘自愈（worker 版）：把「源 rollout 已丢失」的子会话首行血缘字段摘掉，让它能独立加载。
 *  ⛔ 只修**已断链**的（源还在的不动）——源在的会话保留血缘才有完整历史。 */
export function healRolloutLineageAsync(codexHome: string): Promise<{ healed: { path: string; id: string; lostFrom: string }[]; failed: { path: string; error: string }[] }> {
  return call("healLineage", { root: codexHome });
}
