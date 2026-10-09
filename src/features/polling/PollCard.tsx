/**
 * 轮询卡（10-09 建）：对话流里**独立的一张卡**，承载「模型在等异步任务结果」这段过程。
 *
 * ⛔⛔ 为什么不塞进 thinking 板块：思考是模型的**内部推导**，轮询是**外部世界的等待**——
 *    两者都会"卡住不动"，但用户要的东西完全不同：思考要能折起来别占地方，轮询要能看见
 *    「查了几次 / 多久了 / 现在到哪一步 / 我去按停」。混在一起就只能二选一地糊掉一半。
 *
 * 形态（与 thinking 卡同一套：紧凑单行为默认态，点开才展开）：
 *   · 行内：状态徽标 + 任务名 + 「已轮询 N 次 · 每 X · 已耗时 Y」+ 当前进展 + 折叠箭头；
 *   · 展开：每轮记录（时刻 / 第几轮 / 结果或错误摘要）+ 终态结论（成功产物 / 失败原因 /
 *     超时说明 / 已中止）；
 *   · 轮询中额外给「中止」按钮（⛔ 终态不给 —— 点一个已经结束的任务没有意义）。
 *
 * ⛔ 计时每秒刷一次只在 polling 期间挂定时器：历史会话里几十张结束态的卡各挂一个
 *    interval 是纯浪费（且会让 React 一直有活干）。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, CircleCheck, CircleStop, Clock3, LoaderCircle, RefreshCw, X } from "lucide-react";
import { formatPollClock, pollMetricText, pollStatusLabel, pollStatusTone, roundSummaryText } from "../../lib/poll-config.mjs";
import { abortPollTask, type PollTask } from "../../polling/poll-store";
import { useCardOpen } from "../../components/CardShell";

/** 终态结论那一行的文案（⛔ 只说事实 + 下一步，不编造原因）。 */
function conclusionOf(task: PollTask): { icon: ReactNode; text: string } | null {
  if (task.status === "success") {
    return { icon: <CircleCheck size={13} />, text: task.result ? `已完成：${task.result}` : "已完成" };
  }
  if (task.status === "failed") {
    return { icon: <X size={13} />, text: `失败：${task.error ?? "厂商未给原因"}（已按上限重试过，再试请重新提交任务）` };
  }
  if (task.status === "timeout") {
    return { icon: <Clock3 size={13} />, text: `${task.error ?? "超过超时上限"}。任务可能还在厂商那边跑着 —— 之后再查一次同一个任务即可，不会被重复提交` };
  }
  if (task.status === "aborted") {
    return { icon: <CircleStop size={13} />, text: "你中止了这次轮询。任务本身还在厂商那边，之后可以再查一次" };
  }
  return null;
}

export function PollCard({ task }: { task: PollTask }) {
  const tone = pollStatusTone(task.status);
  const polling = task.status === "polling";
  // 运行中自动展开（用户要看进展），结束即自动收起；⛔ 用户点过就以用户的选择为准
  const { open, toggle } = useCardOpen(polling);
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [polling]);

  const conclusion = conclusionOf(task);
  const rounds = task.rounds.slice().reverse();   // 最近一轮在最上面（用户关心的是"现在怎么样"）
  const stop = () => {
    abortPollTask(task.id);
    // 通知主进程别再等了（失败也不影响：用户看到的"已中止"以本地为准）
    void window.codex.pollAbort({ taskId: task.id }).catch(() => undefined);
  };

  return (
    <div className={`poll-card poll-t-${tone}${open ? " open" : ""}`} id={`poll-${task.id}`} ref={rootRef} role="group" aria-label={`轮询任务 ${task.title}`}>
      <div className="poll-head-row">
        <button type="button" className="poll-head" onClick={toggle} aria-expanded={open} title={open ? "收起轮询记录" : "展开每一轮的记录"}>
          <span className="poll-icon" aria-hidden="true">
            {polling ? <LoaderCircle size={13} className="spin" /> : tone === "ok" ? <CircleCheck size={13} /> : tone === "err" ? <X size={13} /> : tone === "warn" ? <Clock3 size={13} /> : <CircleStop size={13} />}
          </span>
          <span className="poll-verb">{task.title || "后台任务"}</span>
          <span className="poll-status">{pollStatusLabel(task.status)}</span>
          <span className="poll-metrics">{pollMetricText(task, now)}</span>
          {task.progress && <span className="poll-progress" title={task.progress}>{task.progress}</span>}
          <ChevronDown size={13} className="poll-caret" />
        </button>
        {polling && (
          <button type="button" className="poll-stop" onClick={stop} title="立即停止轮询（任务本身不会被撤销）">
            <CircleStop size={11} />中止
          </button>
        )}
      </div>
      {open && (
        <div className="poll-body">
          {task.detail && <div className="poll-detail">{task.detail}</div>}
          {conclusion && (
            <div className={`poll-conclusion poll-t-${tone}`}>
              {conclusion.icon}
              <span>{conclusion.text}</span>
            </div>
          )}
          {task.status === "failed" && task.maxRetry > 0 && (
            // 重试是**自动**做的，这里只说明做过几次 —— 别写成"点这里重试"（没有那个按钮就是假功能）
            <div className="poll-hint"><RefreshCw size={11} />期间出错会自动重试，最多 {task.maxRetry} 次（间隔按指数退避拉长）</div>
          )}
          {rounds.length === 0 ? (
            <div className="poll-hint"><AlertTriangle size={11} />还没有发出查询</div>
          ) : (
            <ol className="poll-rounds">
              {rounds.map((round) => (
                <li key={`${task.id}-${round.n}`} className={round.ok ? "poll-round ok" : "poll-round err"}>
                  <span className="poll-round-clock">{formatPollClock(round.at)}</span>
                  <span className="poll-round-n">#{round.n}</span>
                  <span className="poll-round-text" title={roundSummaryText(round)}>{roundSummaryText(round)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
