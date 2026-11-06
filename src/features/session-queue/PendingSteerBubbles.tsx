/**
 * 插队消息在对话里的「待并入」气泡（11-05 用户令）：
 *   「插队消息发出去，可以撤回的时候，在用户消息下面加一个可以撤回图标，不能撤回[的时候]自己就不显示了」
 *
 * 位置与形态：就用真实用户消息的那套渲染（`ItemView` 的 userMessage 分支，与乐观气泡同源），
 * 挂在消息流末尾；同一行左侧挂一枚「撤回」药丸 —— 条目还在 `armed` 态（没交给引擎）才显示，
 * 一旦进入 `sending`（steer 已在飞）图标自己消失，因为那时候已经撤不回了（引擎没有撤回接口）。
 *
 * ⛔ 排队面板同时要把这条隐藏（`pendingSteerVisibleIds`）：同一条消息在对话和排队面板各挂一份，
 *   就是用户点过无数次的「两处重复」。
 */
import { Undo2 } from "lucide-react";
import { pendingSteerIds, usePendingSteerEntries } from "../../lib/pending-steer.mjs";
import type { QueueItem } from "../../lib/queue-item";
import { ItemView } from "./ItemView";

type SteerHandlers = { onCopy: (text: string) => void; onQuote: (text: string) => void; onImageCopy?: (path: string) => void; onOpenFile?: (path: string) => void };

export function PendingSteerBubbles({ threadId, handlers, onWithdraw }: { threadId: string; handlers: SteerHandlers; onWithdraw: (id: string) => void }) {
  // ⛔ 两个读取都必须在组件顶层：usePendingSteerEntries 是 hook，写进 map/回调就是 React #310 白屏
  const entries = usePendingSteerEntries(threadId);
  const retractable = pendingSteerIds(threadId);
  if (!entries.length) return null;
  return (
    <div className="pending-steer-stack">
      {entries.map((entry) => {
        const id = String(entry?.id ?? "");
        return (
          <PendingSteerRow key={id || `pending-${entries.indexOf(entry)}`} id={id} entry={entry}
            canWithdraw={retractable.includes(id)} handlers={handlers} onWithdraw={onWithdraw} />
        );
      })}
    </div>
  );
}

/**
 * 一条「待并入」：撤回药丸走 `UserMessageView` 的 `leadingAction`，与气泡在**同一弹性行**里
 * （药丸靠右、气泡紧跟其后，固定 8px 间距）—— 不再量「气泡左缘 − 栈左缘」再用负 margin 拉，
 * 那个补丁在短消息 / 名字宽度变化时会算偏，用户 11-06 实测「中间缝隙太大」。
 */
function PendingSteerRow({ id, entry, canWithdraw, handlers, onWithdraw }: {
  id: string; entry: QueueItem; canWithdraw: boolean; handlers: SteerHandlers; onWithdraw: (id: string) => void;
}) {
  return (
    <div className="pending-steer-item" data-pending-steer={canWithdraw ? "armed" : "sending"}>
      <ItemView item={{ id: `pending-steer-${id}`, type: "userMessage", content: Array.isArray(entry?.input) ? entry.input : [] }} pending
        leadingAction={canWithdraw ? (
          <button type="button" className="pending-steer-withdraw" title="撤回：这条还没交给模型，撤回后它不会看到" onClick={() => onWithdraw(id)}>
            <Undo2 size={12} />撤回
          </button>
        ) : undefined}
        onCopy={handlers.onCopy} onQuote={handlers.onQuote} onImageCopy={handlers.onImageCopy} onOpenFile={handlers.onOpenFile} />
    </div>
  );
}
