/**
 * /goal 目标条（10-06 夜五轮，用户对照 Qoder 截图：贴输入框上方、与输入框同宽、软粉底的圆角条）：
 *   「🎯 目标 · 计时」+ 目标内容（单行省略）+ 状态词（自动推进中 / 已暂停 / 受阻 / 已完成）；
 *   尾部三个图标键：**编辑 / 删除 / 暂停-继续**（Qoder 同款布局）。
 * 计时 = **引擎侧累积**（thread/goal/get 的 timeUsedSeconds + updatedAt 差值；活动态每秒跳、
 *   暂停/完成冻结）—— ⛔ 不本地记开始时间：切会话/重启后必须仍准，引擎数据是唯一真相源。
 * 暂停/继续 = `thread/goal/set {objective, status:"paused"|"active"}`（10-06 隔离引擎实测：
 *   set 接受 status；⛔ 引擎没有 thread/goal/pause|resume 这两个方法，别改回去）。
 * ⛔ 暂停只停"引擎的下一次自动续跑"；正在跑的回合由调用方（composer）补一发 interrupt。
 * 动作处理（编辑弹窗 / set / clear / interrupt）都在 composer 侧，这里只负责画与计时。
 */
import { useEffect, useState } from "react";
import { Pause, PenLine, Play, Target, Trash2 } from "lucide-react";
import { formatGoalTime } from "../../lib/goal-time.mjs";

export function GoalBar({ threadId, goalText, goalStatus, running, onEdit, onTogglePause, onDelete }: {
  threadId: string;
  goalText: string;
  goalStatus: string | null;
  running: boolean;
  onEdit: () => void;
  onTogglePause: () => void;
  onDelete: () => void;
}) {
  const [meta, setMeta] = useState<{ timeUsedSeconds: number; updatedAt: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // 引擎侧计时回填（goal 变化就重取：状态/文本变了说明有新快照）
  useEffect(() => {
    let alive = true;
    if (!threadId || !goalText) { setMeta(null); return; }
    void window.codex.request("thread/goal/get", { threadId }).then((result: any) => {
      if (!alive) return;
      const goal = result?.goal;
      setMeta(goal ? { timeUsedSeconds: Number(goal.timeUsedSeconds ?? 0), updatedAt: Number(goal.updatedAt ?? 0) } : null);
    }).catch(() => { /* 引擎不支持时静默：计时留空即可 */ });
    return () => { alive = false; };
  }, [threadId, goalText, goalStatus]);
  // 活动态每秒跳；暂停/完成时冻结（不挂 interval，读数保持上次快照值）
  useEffect(() => {
    if (goalStatus !== "active") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [goalStatus]);
  const paused = goalStatus === "paused";
  const complete = goalStatus === "complete";
  // 计时 = 引擎累积值 +（活动态）距 lastUpdated 的差值 —— 引擎在回合计边界更新时也不会倒退。
  // ⛔ updatedAt 缺失/为 0 时**不外推**（缺了还按 epoch 差值加 = 读数变成几十万小时）
  const seconds = meta ? meta.timeUsedSeconds + (goalStatus === "active" && meta.updatedAt > 0 ? Math.max(0, Math.floor(now / 1000) - meta.updatedAt) : 0) : null;
  const timeLabel = seconds == null ? "" : ` · ${formatGoalTime(seconds)}`;
  const stateLabel = complete ? "已完成" : paused ? "已暂停" : goalStatus === "blocked" ? "受阻" : "自动推进中";
  return (
    <div className={`goal-bar ${paused ? "paused" : ""} ${complete ? "done" : ""}`} role="status" aria-label="目标模式">
      <Target size={14} className="goal-bar-icon" />
      <span className="goal-bar-title">目标{timeLabel}</span>
      <span className="goal-bar-text" title={goalText}>{goalText}</span>
      <span className="goal-bar-state">{stateLabel}</span>
      <span className="goal-bar-actions">
        <button type="button" className="goal-bar-btn" title="编辑目标" aria-label="编辑目标" onClick={onEdit}><PenLine size={14} /></button>
        <button type="button" className="goal-bar-btn danger" title="删除目标（清除后不再自动推进）" aria-label="删除目标" onClick={onDelete}><Trash2 size={14} /></button>
        {!complete && (
          <button type="button" className="goal-bar-btn" title={paused ? "继续推进" : running ? "暂停推进（会停止正在跑的回合）" : "暂停推进"}
            aria-label={paused ? "继续推进" : "暂停推进"} onClick={onTogglePause}>
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
        )}
      </span>
    </div>
  );
}
