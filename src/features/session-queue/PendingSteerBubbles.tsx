/**
 * 插队消息在对话里的「待并入」气泡（11-05 用户令）：
 *   「插队消息发出去，可以撤回的时候，在用户消息下面加一个可以撤回图标，不能撤回[的时候]自己就不显示了」
 *
 * 位置与形态：就用真实用户消息的那套渲染（`ItemView` 的 userMessage 分支，与乐观气泡同源），
 * 挂在消息流末尾；下面只挂一枚「撤回」图标 —— 条目还在 `armed` 态（没交给引擎）才显示，
 * 一旦进入 `sending`（steer 已在飞）图标自己消失，因为那时候已经撤不回了（引擎没有撤回接口）。
 *
 * ⛔ 排队面板同时要把这条隐藏（`pendingSteerVisibleIds`）：同一条消息在对话和排队面板各挂一份，
 *   就是用户点过无数次的「两处重复」。
 */
import { Undo2 } from "lucide-react";
import { pendingSteerIds, usePendingSteerEntries } from "../../lib/pending-steer.mjs";
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
        const canWithdraw = retractable.includes(id);
        return (
          <div className="pending-steer-item" key={id || `pending-${entries.indexOf(entry)}`} data-pending-steer={canWithdraw ? "armed" : "sending"}>
            {/* 图标放在**这条用户消息前面**（11-05 用户实测「丑死了，不会放用户消息前面吗」）：
                与气泡同侧（右对齐）一枚小药丸，消息本体保持原样、不加虚线框。 */}
            {canWithdraw && (
              <button type="button" className="pending-steer-withdraw" title="撤回：这条还没交给模型，撤回后它不会看到" onClick={() => onWithdraw(id)}>
                <Undo2 size={12} />撤回
              </button>
            )}
            <ItemView item={{ id: `pending-steer-${id}`, type: "userMessage", content: Array.isArray(entry?.input) ? entry.input : [] }} pending
              onCopy={handlers.onCopy} onQuote={handlers.onQuote} onImageCopy={handlers.onImageCopy} onOpenFile={handlers.onOpenFile} />
          </div>
        );
      })}
    </div>
  );
}
