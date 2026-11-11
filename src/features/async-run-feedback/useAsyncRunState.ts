/**
 * 异步执行反馈板块 · 状态层（11-11 立）
 *
 * ⛔⛔ 架构：这是**独立板块**，不往群聊域里塞状态：
 *   · 数据只来自主进程广播的 `group-async-run` 事件（零 IPC、零存储）；
 *   · 关掉群弹窗再打开时按事件重建（⛔ 不依赖 dispatch 的 Promise 生命周期）；
 *   · 群派活 / 独立团会话 / 普通群互不影响：事件带 groupId，别的群直接丢弃。
 *
 * 扩展点（将来要加新的异步任务类型时只改这两处，⛔ 别另开一条事件链）：
 *   ① `PHASES`：新增相位（如 "retrying" / "cancelled"）；
 *   ② `reduceAsyncRunEvent`：新增事件到状态的归约规则。
 *   展示形态只加在 `AsyncRunPanel.tsx`。
 */
import { useEffect, useState } from "react";

export type AsyncRunPhase = "queued" | "running" | "done" | "failed";

export type AsyncRunRow = {
  memberId: string;
  name: string;
  phase: AsyncRunPhase;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
};

export type AsyncRunBatch = {
  total: number;
  done: number;
  failed: number;
  startedAt: number;
  settledAt?: number;
  note: string;
  rows: AsyncRunRow[];
};

/** ⛔ 相位表是唯一的取值来源；新增相位先在这里登记。 */
export const PHASES: AsyncRunPhase[] = ["queued", "running", "done", "failed"];

const emptyBatch = (): AsyncRunBatch => ({
  total: 0, done: 0, failed: 0, startedAt: Date.now(), note: "", rows: [],
});

function isPhase(value: unknown): value is AsyncRunPhase {
  return PHASES.includes(String(value) as AsyncRunPhase);
}

/** 纯函数归约（守卫直接跑）：一条事件 → 该群的新一批状态。 */
export function reduceAsyncRunEvent(
  prev: AsyncRunBatch | null,
  event: Record<string, unknown>,
): AsyncRunBatch | null {
  const phase = String(event?.phase ?? "");
  const at = Number(event?.at ?? 0) || Date.now();
  if (phase === "batch") {
    return {
      ...emptyBatch(),
      startedAt: at,
      total: Number(event?.total ?? 0) || 0,
      note: String(event?.note ?? ""),
    };
  }
  const cur = prev ?? emptyBatch();
  if (phase === "settled") {
    return {
      ...cur,
      settledAt: at,
      done: Number(event?.done ?? cur.done) || 0,
      failed: Number(event?.failed ?? cur.failed) || 0,
    };
  }
  if (!isPhase(phase)) return cur;
  const memberId = String(event?.memberId ?? "");
  if (!memberId) return cur;
  const name = String(event?.name ?? "") || memberId;
  const idx = cur.rows.findIndex((row) => row.memberId === memberId);
  const old = idx >= 0 ? cur.rows[idx] : null;
  const row: AsyncRunRow = {
    memberId,
    name,
    phase,
    queuedAt: old?.queuedAt ?? at,
    startedAt: phase === "running" ? (old?.startedAt ?? at) : old?.startedAt,
    finishedAt: phase === "done" || phase === "failed" ? at : old?.finishedAt,
  };
  const rows = idx >= 0
    ? cur.rows.map((item, i) => (i === idx ? row : item))
    : [...cur.rows, row];
  return { ...cur, rows, total: Math.max(cur.total, rows.length) };
}

/** 事件属于哪个作用域：群聊 → groupId；外面会话（主对话里派团）→ threadId。
 *  ⛔ 两个都带时以群为准（群聊会话本来就有 groupId）。 */
export function scopeKeyOf(event: Record<string, unknown>): string {
  return String(event?.groupId ?? "") || String(event?.threadId ?? "");
}

/** 订阅某个作用域（群 or 会话）的异步执行事件。
 *  ⛔ 只在板块内调用，不进 app-state 组合根；⛔ 别的群 / 别的会话的事件直接丢弃。 */
export function useAsyncRunState(scope: { groupId?: string; threadId?: string }): AsyncRunBatch | null {
  const key = String(scope?.groupId ?? "") || String(scope?.threadId ?? "");
  const [batches, setBatches] = useState<Record<string, AsyncRunBatch | null>>({});
  useEffect(() => {
    const off = window.codex?.onHarnessEvent?.((event: Record<string, unknown>) => {
      if (!event || String(event.type ?? "") !== "group-async-run") return;
      const scopeKey = scopeKeyOf(event);
      if (!scopeKey) return;
      setBatches((prev) => ({ ...prev, [scopeKey]: reduceAsyncRunEvent(prev[scopeKey] ?? null, event) }));
    });
    return () => { try { off?.(); } catch { /* 卸载时解绑失败不影响其它板块 */ } };
  }, []);
  return key ? batches[key] ?? null : null;
}
