/**
 * PetActivity —— 桌面宠物的活动气泡（独立透明窗，`?pet=activity` 进入）。
 *
 * Qoder 同款：宠物只画本体；任务状态单独一块卡片贴在宠物上方：
 *   标题 + 当前状态 + 最近一句/工具 + 回复 / 停止 / 打开。
 * ⛔ 只消费主进程归约好的短字符串（见 electron/features/pet-state.ts），不拿原始引擎事件。
 */
import { useEffect, useState } from "react";
import { ArrowUpRight, CircleStop, CornerDownLeft, LoaderCircle, TriangleAlert, X } from "lucide-react";

type ActivityStatus = "waiting" | "running" | "failed" | "interrupted" | "completed";
type PetActivityItem = {
  threadId: string;
  turnId: string;
  title: string;
  detail: string;
  status: ActivityStatus;
  updatedAt: number;
  canStop: boolean;
  canReply: boolean;
};
type PetSignalLike = {
  activities?: PetActivityItem[];
  attention?: "" | "pending" | "error";
};

const STATUS_LABEL: Record<ActivityStatus, string> = {
  waiting: "等待你的处理",
  running: "正在执行",
  failed: "本轮执行失败",
  interrupted: "本轮已中断",
  completed: "本轮已完成",
};

const EMPTY_SIGNAL: PetSignalLike = { activities: [], attention: "" };

export function PetActivity() {
  const [signal, setSignal] = useState<PetSignalLike>(EMPTY_SIGNAL);
  const [busyId, setBusyId] = useState("");
  const [failedId, setFailedId] = useState("");
  const [replyId, setReplyId] = useState("");
  const [replyText, setReplyText] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    try { document.title = "桌面宠物 · 任务"; } catch { /* 忽略 */ }
    void window.codex.petState()
      .then((state) => { if (alive && state?.signal) setSignal(state.signal as PetSignalLike); })
      .catch(() => undefined);
    const off = window.codex.onPetSignal((next) => {
      if (next && typeof next === "object") setSignal(next as PetSignalLike);
    });
    return () => { alive = false; off(); };
  }, []);

  const activities = (signal.activities ?? []).slice(0, 2);
  if (!activities.length) return <main className="pet-activity-root" aria-live="polite" />;

  const open = (threadId: string) => { void window.codex.petActivityOpen(threadId).catch(() => undefined); };
  const stop = (threadId: string) => {
    setBusyId(threadId);
    setFailedId("");
    void window.codex.petActivityStop(threadId)
      .then((result) => { if (!result?.ok) setFailedId(threadId); })
      .catch(() => setFailedId(threadId))
      .finally(() => setBusyId(""));
  };
  const submitReply = (threadId: string) => {
    const text = replyText.trim();
    if (!text || replyBusy) return;
    setReplyBusy(true);
    setFailedId("");
    void window.codex.petActivityReply(threadId, text)
      .then((result) => {
        if (result?.ok) { setReplyId(""); setReplyText(""); }
        else setFailedId(threadId);
      })
      .catch(() => setFailedId(threadId))
      .finally(() => setReplyBusy(false));
  };

  return (
    <main className="pet-activity-root" aria-live="polite">
      {activities.map((item, index) => {
        const showDetail = Boolean(item.detail) && item.detail !== STATUS_LABEL[item.status];
        const replying = replyId === item.threadId;
        return (
        <article
          key={item.threadId}
          className={`pet-activity-card status-${item.status}`}
          data-stack-index={index}
          onClick={() => open(item.threadId)}
        >
          <header>
            <span className={`pet-activity-dot ${item.status}`} aria-hidden />
            <strong title={item.title}>{item.title}</strong>
            {item.status === "failed" || item.status === "interrupted"
              ? <TriangleAlert size={13} className="pet-activity-warn" aria-hidden />
              : item.status === "running"
                ? <LoaderCircle size={13} className="pet-activity-spin" aria-hidden />
                : null}
          </header>
          <p>
            <span className="pet-activity-status">{STATUS_LABEL[item.status]}</span>
            {showDetail ? <span className="pet-activity-detail" title={item.detail}> · {item.detail}</span> : null}
          </p>
          <footer>
            {replying ? (
              <form className="pet-activity-reply" onClick={(event) => event.stopPropagation()}
                onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); submitReply(item.threadId); }}>
                <input autoFocus value={replyText} onChange={(event) => setReplyText(event.target.value)}
                  placeholder="回复当前任务…" aria-label="回复当前任务" maxLength={32000} disabled={replyBusy} />
                <button type="submit" className="pet-activity-btn send" disabled={!replyText.trim() || replyBusy}
                  title="发送回复" aria-label="发送回复"><CornerDownLeft size={13} /></button>
                <button type="button" className="pet-activity-btn" title="取消回复" aria-label="取消回复"
                  onClick={(event) => { event.stopPropagation(); setReplyId(""); setReplyText(""); }}><X size={13} /></button>
              </form>
            ) : (
              <>
                {failedId === item.threadId && <span className="pet-activity-stop-error">操作失败，请打开会话处理</span>}
                {item.canReply && (
                  <button type="button" className="pet-activity-btn reply" title="在当前任务里回复"
                    onClick={(event) => { event.stopPropagation(); setFailedId(""); setReplyId(item.threadId); setReplyText(""); }}>
                    <CornerDownLeft size={13} /><span>回复</span>
                  </button>
                )}
                {item.canStop && (
                  <button type="button" className="pet-activity-btn stop" disabled={busyId === item.threadId}
                    title={busyId === item.threadId ? "正在停止" : "停止这个任务"}
                    onClick={(event) => { event.stopPropagation(); stop(item.threadId); }}>
                    <CircleStop size={13} /><span>{busyId === item.threadId ? "正在停止" : "停止"}</span>
                  </button>
                )}
                <button type="button" className="pet-activity-btn open" title="打开会话"
                  onClick={(event) => { event.stopPropagation(); open(item.threadId); }}>
                  <ArrowUpRight size={13} /><span>打开</span>
                </button>
              </>
            )}
          </footer>
        </article>
        );
      })}
    </main>
  );
}
