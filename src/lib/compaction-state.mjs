/**
 * compaction-state.mjs —— 上下文压缩的**四态模型**（单一真相源，纯函数）。
 *
 * 为什么要有它（10-17 用户令「构建配套工具展示与上报压缩各状态」）：
 *   压缩状态此前散落在三处：时间线的运行线判定、ItemView 的分隔线分支、compactToast 的
 *   running/success/error/cancelled —— 三处各自解释引擎事件，形状一变（例如进行中项
 *   name 挂名而非 type）就**只有一处断**，症状是"没有压缩线、只有一张通用工具卡"。
 *   ⇒ 统一成一个判定：引擎 item（started/completed/failure）× toast ⇒ 四态之一。
 *
 * 四态（与引擎原生生命周期对齐）：
 *   idle       未压缩（没有压缩项、也没有进行中的压缩）
 *   compacting 压缩中（存在 in-progress 压缩项，或 toast 处于 running）
 *   done       压缩完成（存在已完成的压缩项）
 *   failed     压缩失败（压缩项带 error / failure，或 toast 处于 error）
 *
 * ⛔ 判定口径复用 `isCompactionItem`（大小写 + name 兜底），**不在这里再写一份类型字符串**。
 */
import { isCompactionItem } from "./compaction-item.mjs";

export const COMPACTION_STATE = {
  idle: "idle",
  compacting: "compacting",
  done: "done",
  failed: "failed",
};

const STATE_LABEL = {
  idle: "未压缩",
  compacting: "压缩中",
  done: "压缩完成",
  failed: "压缩失败",
};

/** 人类可读标签（界面/日志共用一处，别在组件里再写一份） */
export function compactionStateLabel(state) {
  return STATE_LABEL[state] ?? state;
}

/**
 * 从回合列表 + toast 状态推导压缩四态。
 * @param turns 有序回合数组（每个 { id, items }）
 * @param toastState "running" | "success" | "error" | "cancelled" | undefined
 * @returns {{ state: string, turnId: string, item: any }}
 */
export function compactionStateOf(turns, toastState) {
  let runningTurnId = "";
  let runningItem = null;
  let doneItem = null;
  let doneTurnId = "";
  let failedItem = null;
  let failedTurnId = "";

  for (const turn of Array.isArray(turns) ? turns : []) {
    const turnId = String(turn?.id ?? "");
    for (const item of Array.isArray(turn?.items) ? turn.items : []) {
      if (!isCompactionItem(item)) continue;
      const failed = item?.status === "error" || Boolean(item?.failure?.message);
      const running = !failed && (item?.status === "inProgress" || item?.status === "running");
      if (failed) {
        if (!failedItem) { failedItem = item; failedTurnId = turnId; }
      } else if (running) {
        /* ⛔ 运行中优先：一次压缩只取**第一个**进行中的项（多压缩叠加时以先到的为准）。 */
        if (!runningItem) { runningItem = item; runningTurnId = turnId; }
      } else {
        /* 已完成：取**最后**一条（最新一次压缩的锚点） */
        doneItem = item; doneTurnId = turnId;
      }
    }
  }

  if (runningItem) return { state: COMPACTION_STATE.compacting, turnId: runningTurnId, item: runningItem };
  if (toastState === "running") return { state: COMPACTION_STATE.compacting, turnId: "", item: null };
  if (failedItem || toastState === "error") return { state: COMPACTION_STATE.failed, turnId: failedTurnId, item: failedItem };
  if (doneItem) return { state: COMPACTION_STATE.done, turnId: doneTurnId, item: doneItem };
  if (toastState === "success") return { state: COMPACTION_STATE.done, turnId: "", item: null };
  return { state: COMPACTION_STATE.idle, turnId: "", item: null };
}

/* ── 上报（可观测）：状态变化时打一行，⛔ 相同状态不刷屏 ─────────────────── */
const lastReported = new Map();

/**
 * 上报一次状态（只在**状态变化**时输出）。key 用线程 id，多会话互不干扰。
 * ⛔ 只打 console（渲染层没有文件写权限）—— 需要落盘时由主进程侧订阅；这里保证
 *    「四态 + 时间戳 + 所在回合」齐全，任何一次压缩都能事后复盘。
 */
export function reportCompactionState(key, derived) {
  const k = String(key ?? "");
  if (!k) return;
  const prev = lastReported.get(k);
  const next = `${derived.state}:${derived.turnId}`;
  if (prev === next) return;
  lastReported.set(k, next);
  try {
    const at = new Date().toISOString();
    console.debug(`[compaction] ${at} ${k.slice(0, 8)} ${compactionStateLabel(derived.state)} (${derived.state})${derived.turnId ? ` · 回合 ${derived.turnId.slice(0, 8)}` : ""}`);
  } catch { /* 日志失败不影响功能 */ }
}
