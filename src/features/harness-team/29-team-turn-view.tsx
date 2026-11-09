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
export function TeamTurnView({ threadId, at, bodyText, usage, onOpenFile, onOpenReview, onQuote, onOpenThread, fallback, extraFooter }: {
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
}) {
  const fresh = Date.now() - Number(at) < 120_000;
  const { turn } = useTeamTurn(threadId, at, bodyText, false, fresh);
  const handlers = useMemo<FoldHandlers>(() => ({
    onCopy: (text) => { void copyTextToClipboard(text).catch(() => undefined); },
    onQuote: (text) => onQuote(text),
    onImageCopy: (path) => { void copyTextToClipboard(path).catch(() => undefined); },
    onFork: () => undefined,
    onEdit: () => undefined,
    onOpenFile: (path) => onOpenFile(path),
    ...(onOpenThread ? { onOpenThread } : {}),
  }), [onOpenFile, onQuote, onOpenThread]);
  const view = useMemo(
    () => (turn ? ({ ...turn, items: (turn.items ?? []).filter((item) => item && item.type !== "userMessage") } as Turn) : null),
    [turn],
  );
  if (!view) return <>{fallback ?? null}</>;
  return (
    <TurnView
      turn={view}
      threadId={threadId}
      usage={usage}
      handlers={handlers}
      isLastTurn={false}
      onOpenReview={onOpenReview}
      extraFooter={extraFooter}
    />
  );
}
