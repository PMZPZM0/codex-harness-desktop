/**
 * 群聊 · 回合视图（11-09 用户令：「图二效果一模一样，我要，你直接把主对话的那一套接过来」）
 *
 * ⛔ 不另写一套排版：直接渲染主对话的 `TurnView` —— 深度思考 / 过程步骤 / 正文 / 文件卡 / 页脚
 *    全部与主对话同一份实现（用户对照主对话框截图点名）。
 * ⛔ 只把回合里的 `userMessage` 摘掉：群子会话里那条是宿主注入的 SYSTEM TASK 壳，
 *    群里已经有一条真正的用户消息，再渲染一遍就是"两条我说的话"。
 * ⛔ 数据与过程块/汇总卡共用 `useTeamTurn`（同一份 IPC 结果，不重复拉）。
 */
import { useMemo, type ReactNode } from "react";
import { TurnView } from "../session-turn";
import type { FoldHandlers } from "../session-queue";
import type { Turn } from "../../lib/turn";
import { useTeamTurn } from "./09-team-process";
import { copyTextToClipboard } from "../../lib/clipboard";

/** 群里的一个回合 = 主对话一整轮（正文逐条上屏 → 收尾后整轮折叠可展开 + 文件卡 + 页脚）。 */
export function TeamTurnView({ threadId, at, bodyText, usage, onOpenFile, onOpenReview, onQuote, onOpenThread, fallback, extraFooter, running = false, live = false }: {
  threadId: string;
  at: number;
  bodyText: string;
  usage?: unknown;
  onOpenFile: (path: string) => void;
  onOpenReview?: () => void;
  onQuote: (text: string) => void;
  onOpenThread?: (id: string) => void;
  /** 回合还没拉回来时先显示群自己的正文（@ 可点），拉到后无缝换成 TurnView。 */
  fallback?: ReactNode;
  /** 群特有的页脚项（追问 / 来源会话）：接在主对话页脚**同一行**（⛔ 不另起一行留白）。 */
  extraFooter?: ReactNode;
  /** 运行中：与主对话同一套（⛔ 不再走 TeamProcess 那套自绘过程块）。 */
  running?: boolean;
  /** 运行中要按事件重拉（收尾态用一次性拉取）。 */
  live?: boolean;
}) {
  const fresh = Date.now() - Number(at) < 120_000;
  const { turn } = useTeamTurn(threadId, at, bodyText, live, fresh);
  const handlers = useMemo<FoldHandlers>(() => ({
    onCopy: (text) => { void copyTextToClipboard(text).catch(() => undefined); },
    onQuote: (text) => onQuote(text),
    onImageCopy: (path) => { void copyTextToClipboard(path).catch(() => undefined); },
    onFork: () => undefined,
    onEdit: () => undefined,
    onOpenFile: (path) => onOpenFile(path),
    ...(onOpenThread ? { onOpenThread } : {}),
  }), [onOpenFile, onQuote, onOpenThread]);
  /* ⛔⛔ 11-09 用户（两张截图对照）：「运行结束效果是对的，运行中就不对」「给我做到跟主对话框一模一样，
     不管运行中还是运行结束都复用过来」。
     ⇒ 运行中同样走主对话 TurnView。但有个数据差异必须先补：**回合快照里的 item 不带 status**
     （electron 建回合时只写 id/type/text），而 TurnView 里 ReasoningCard 的判据是
     `turnActive && (itemRunning || (!status && !durationMs))` —— 没有 status 就永远落进兜底分支，
     整轮的 turnActive 会复制给每一张思考卡 ⇒ 思考完了还一直亮。
     这里按顺序补齐：**只有最后一项可能是进行中**，它前面的一定已经结束（后面还有东西）。
     ⛔ 不要把这层补丁挪进 ReasoningCard —— 主对话靠引擎事件给 status，那边不需要也不该背这个兜底。 */
  const view = useMemo(() => {
    if (!turn) return null;
    const items = (turn.items ?? []).filter((item) => item && item.type !== "userMessage");
    const normalized = running
      ? items.map((item, index) => (index === items.length - 1 || item.status ? item : { ...item, status: "completed" }))
      : items;
    return { ...turn, items: normalized } as Turn;
  }, [turn, running]);
  if (!view) return <>{fallback ?? null}</>;
  return (
    <TurnView
      turn={view}
      threadId={threadId}
      usage={usage}
      handlers={handlers}
      /* ⛔⛔ 11-09 回归修复（审查抓到）：运行中改走 TurnView 后，推理浮窗的 host 选择器丢了 ——
         原来由 `TeamProcess` 传给 ItemView。不显式传会回落到主对话的 `.reasoning-float-host`，
         浮窗被群窗/设置弹层压住（正是 11-08 审查修过的那条）。⇒ 沿 TurnView → TurnFoldStream 透传。 */
      reasoningFloatHost=".team-reasoning-float-host"
      isLastTurn={running}
      onOpenReview={onOpenReview}
      extraFooter={extraFooter}
    />
  );
}
