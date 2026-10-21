// src/lib/turn-history.mjs
//
// 长会话的「全部回合元数据」缓存（10-21）。
//
// 目的：让消息区的滚动条按**总回合数**撑出高度，而不是只按当前挂载的 5 个回合。
// 引擎 `thread/turns/list` 的 itemsView:"notLoaded" 只回 id/startedAt/status、不带 items，
// 实测 64 回合一次请求 7ms ⇒ 打开会话时后台拉全量元数据，成本可忽略。
//
// 页面分两种：内存里已有完整回合（thread.turns）与只有元数据的 stub。
// 渲染层用 turnHistoryPlan() 计算窗口上方还有多少回合；滚动到虚拟区边界时按页
// 调 loadEarlierTurns 水合（游标续拉 / 本地扩窗）。本模块只做缓存与订阅，不发请求策略。

import { orderTurnsByTime } from "./turn-order.mjs";

const EMPTY = Object.freeze({ stubs: [], estimate: 0, complete: false, fetching: false });
const byThread = new Map();
const inflight = new Map();
const listeners = new Set();
let version = 0;

function emit() {
  version += 1;
  for (const listener of listeners) listener();
}

function threadKey(threadId) {
  return String(threadId ?? "");
}

function publish(threadId, patch) {
  const id = threadKey(threadId);
  if (!id) return EMPTY;
  const next = { ...(byThread.get(id) ?? EMPTY), ...patch };
  byThread.set(id, next);
  emit();
  return next;
}

export function subscribeTurnHistory(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function turnHistoryVersion() {
  return version;
}

export function turnHistoryFor(threadId) {
  return byThread.get(threadKey(threadId)) ?? EMPTY;
}

export function turnHeightEstimateFor(threadId) {
  return turnHistoryFor(threadId).estimate;
}

/** 一轮回合的估算高度（占位区用）。只在会话首次渲染后量一次，之后保持稳定 ——
 *  每次渲染都改会让占位区高度抖动，滚动条反而更像"跳"。 */
export function setTurnHeightEstimate(threadId, estimate) {
  const id = threadKey(threadId);
  const value = Math.round(Number(estimate));
  if (!id || !Number.isFinite(value) || value <= 0) return;
  const prev = byThread.get(id);
  if (prev?.estimate === value) return;
  publish(id, { estimate: value });
}

/** 删除 / revert 后元数据整份作废：下一次打开会话重拉。 */
export function resetTurnHistory(threadId) {
  const id = threadKey(threadId);
  if (!id) return;
  inflight.delete(id);
  if (byThread.delete(id)) emit();
}

/**
 * 后台拉全量回合元数据（不阻塞打开会话）。每个会话只成功拉一次。
 * `request` 由调用方注入（渲染层传 window.codex.request，纯模块不碰宿主 API）。
 *
 * ⛔ 必须用 itemsView:"notLoaded"：full 会把每条工具输出都序列化回来，等于把
 *    懒加载又变回全量水合。notLoaded 的条目没有 items，只用于计数与排序。
 */
export async function primeTurnHistory(threadId, request, options = {}) {
  const id = threadKey(threadId);
  if (!id || typeof request !== "function") return;
  const cached = byThread.get(id);
  if (cached?.complete) return;
  if (inflight.has(id)) return inflight.get(id);

  const limit = Math.max(1, Math.min(100, Number(options.limit) || 100));
  const maxPages = Math.max(1, Math.min(500, Number(options.maxPages) || 100));
  publish(id, { fetching: true });

  const task = (async () => {
    const byId = new Map();
    let cursor = null;
    let complete = false;
    try {
      for (let page = 0; page < maxPages; page += 1) {
        const result = await request("thread/turns/list", {
          threadId: id,
          limit,
          sortDirection: "desc",
          itemsView: "notLoaded",
          ...(cursor ? { cursor } : {}),
        });
        const data = Array.isArray(result?.data) ? result.data : [];
        for (const turn of data) {
          const turnId = String(turn?.id ?? "");
          if (!turnId) continue;
          byId.set(turnId, { id: turnId, startedAt: Number(turn?.startedAt) || 0 });
        }
        cursor = result?.nextCursor ?? null;
        if (!cursor) {
          complete = true;
          break;
        }
      }
      publish(id, { stubs: orderTurnsByTime([...byId.values()]), complete, fetching: false });
    } catch {
      // 拉元数据失败只影响滚动条长度，界面照常（不要冒泡成会话打开失败）。
      publish(id, { fetching: false });
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, task);
  return task;
}
