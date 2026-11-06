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
import { useLayoutEffect, useRef, useState } from "react";
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
        return (
          <PendingSteerRow key={id || `pending-${entries.indexOf(entry)}`} id={id} entry={entry}
            canWithdraw={retractable.includes(id)} handlers={handlers} onWithdraw={onWithdraw} />
        );
      })}
    </div>
  );
}

/**
 * 一条「待并入」：撤回药丸要贴在**气泡左缘**，而不是「消息栈」左缘。
 * 短消息时栈的宽度由上面那行名字（`.user-head`）决定，气泡在栈里右对齐 ⇒ 药丸贴着栈左缘
 * 就会离气泡一大截（11-06 用户截图「中间还是这么大空白」）。
 * ⇒ 量出「气泡左缘 − 栈左缘」，用负 margin 把药丸往右拉到气泡边上（自适应，不写死像素）。
 */
function PendingSteerRow({ id, entry, canWithdraw, handlers, onWithdraw }: {
  id: string; entry: any; canWithdraw: boolean; handlers: SteerHandlers; onWithdraw: (id: string) => void;
}) {
  const itemRef = useRef<HTMLDivElement>(null);
  const [pull, setPull] = useState(0);
  useLayoutEffect(() => {
    const item = itemRef.current;
    if (!item) return;
    const measure = () => {
      const stack = item.querySelector(".user-message-stack");
      const bubble = item.querySelector(".message.user-message");
      if (!stack || !bubble) return;
      const delta = Math.round(bubble.getBoundingClientRect().left - stack.getBoundingClientRect().left);
      setPull(delta > 0 ? delta : 0);
    };
    measure();
    // 只观察消息栈：它的宽度不依赖药丸，不会自己触发自己（消息重渲染/换行时才需要重量）
    const stack = item.querySelector(".user-message-stack");
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (ro && stack) ro.observe(stack);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [canWithdraw, entry]);
  return (
    <div className="pending-steer-item" ref={itemRef} data-pending-steer={canWithdraw ? "armed" : "sending"}>
      {/* 图标在**这条用户消息左侧同一行**（11-05「不会放用户消息前面吗」→ 11-06「放顶上多难看」），
          再按量出来的差值贴到气泡左缘（11-06「中间还是这么大空白」）。 */}
      {canWithdraw && (
        <button type="button" className="pending-steer-withdraw" style={pull ? { marginRight: -pull } : undefined}
          title="撤回：这条还没交给模型，撤回后它不会看到" onClick={() => onWithdraw(id)}>
          <Undo2 size={12} />撤回
        </button>
      )}
      <ItemView item={{ id: `pending-steer-${id}`, type: "userMessage", content: Array.isArray(entry?.input) ? entry.input : [] }} pending
        onCopy={handlers.onCopy} onQuote={handlers.onQuote} onImageCopy={handlers.onImageCopy} onOpenFile={handlers.onOpenFile} />
    </div>
  );
}
