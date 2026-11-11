/**
 * 异步执行反馈板块 · 唯一渲染口（11-11 立）
 *
 * 用户令：「加一个异步执行反馈效果板块」。解决的是真机那次「一直卡着空转」：
 * 主理人调 team_phase_invoke 后，群里只有它自己那张「深度思考中」，
 * 用户无法区分"在等成员"和"卡死"。成员卡是分散在消息流里的，
 * 这里给一个**汇总视图**：这一批派了几件、谁在跑、谁交回了、还要多久、整体进度。
 *
 * ⛔ 只展示事实（来自 group-async-run 事件），⛔ 不自己起轮询 / 不猜状态 / 不补假进度。
 * ⛔ 展开态是本地 state；关掉群弹窗再打开会按最新事件重建。
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useAsyncRunState, type AsyncRunPhase, type AsyncRunRow } from "./useAsyncRunState";

const PHASE_LABEL: Record<AsyncRunPhase, string> = {
  queued: "排队中",
  running: "执行中",
  done: "已交回",
  failed: "未交回",
};

function elapsedOf(row: AsyncRunRow, now: number): string {
  const from = row.startedAt ?? row.queuedAt;
  const to = row.finishedAt ?? now;
  const sec = Math.max(0, Math.round((to - from) / 1000));
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${String(sec % 60).padStart(2, "0")}s`;
}

/** 两个作用域共用一个板块：群聊传 groupId，外面会话（主对话里派团）传 threadId。
 *  ⛔ 不要各写一套 —— 事件、归约、样式都在本板块里，扩展点只有 useAsyncRunState 的两处。 */
export function AsyncRunPanel({ groupId, threadId }: { groupId?: string; threadId?: string }) {
  const batch = useAsyncRunState({ groupId, threadId });
  const [expanded, setExpanded] = useState(true);
  const [dismissedAt, setDismissedAt] = useState(0);
  /* ⛔ 外面会话没有 batch 事件（派活走渲染层同步应答）⇒ 首批 running 事件就是一批，
     total 跟着 rows 长，这张卡照样能显示"谁在跑 / 谁交回了"。 */
  if (!batch || !batch.rows.length) return null;
  /* 整批收口后可以关掉；新一批事件会带新的 startedAt ⇒ 自动重新出现。 */
  if (dismissedAt >= batch.startedAt) return null;
  const now = Date.now();
  const finished = batch.rows.filter((row) => row.phase === "done" || row.phase === "failed").length;
  const running = batch.rows.filter((row) => row.phase === "running").length;
  const settled = Boolean(batch.settledAt);
  const percent = Math.min(100, Math.round((finished / Math.max(1, batch.total)) * 100));

  return (
    <section className={`async-run-panel${settled ? " is-settled" : ""}`} role="status" aria-label="异步执行反馈">
      <header className="async-run-panel__head">
        <button
          type="button"
          className="async-run-panel__toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <strong>{settled ? "异步执行 · 已收口" : "异步执行 · 进行中"}</strong>
        </button>
        <span className="async-run-panel__count">
          {finished}/{batch.total} 已交回{running ? ` · ${running} 人在跑` : ""}
        </span>
        <span className="async-run-panel__elapsed">{elapsedOf({ ...batch.rows[0], queuedAt: batch.startedAt, startedAt: batch.startedAt, finishedAt: batch.settledAt }, now)}</span>
        {settled && (
          <button type="button" className="async-run-panel__close" title="关掉这张卡" onClick={() => setDismissedAt(Date.now())}>
            <X size={13} />
          </button>
        )}
      </header>
      <div className="async-run-panel__track" aria-hidden>
        <span style={{ width: `${percent}%` }} />
      </div>
      {expanded && (
        <ul className="async-run-panel__rows">
          {batch.rows.map((row) => (
            <li key={row.memberId} className={`is-${row.phase}`}>
              <span className="async-run-panel__dot" aria-hidden />
              <span className="async-run-panel__name" title={row.memberId}>{row.name}</span>
              <span className="async-run-panel__phase">{PHASE_LABEL[row.phase]}</span>
              <span className="async-run-panel__time">{elapsedOf(row, now)}</span>
            </li>
          ))}
        </ul>
      )}
      {!settled && (
        <p className="async-run-panel__hint">成员产出会各自以本人署名发进群；全部交回后主理人继续验收。</p>
      )}
      {settled && batch.failed > 0 && (
        <p className="async-run-panel__hint is-warn">有 {batch.failed} 件没交回，主理人会按群里实际产出继续推进。</p>
      )}
    </section>
  );
}
