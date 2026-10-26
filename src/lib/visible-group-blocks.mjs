/**
 * 群广播「到底展示不展示」的**唯一判据**（10-26）。
 *
 * 为什么单独一个模块（⛔ 别把它塞进 group-event-text.mjs）：那个文件是"纯解析、零依赖"，
 *   `scripts/verify-injection-strip.mjs` 直接 import 它跑真实样本 —— 加依赖会把那条回归弄脏。
 *   这里只做一件事：把「解析出的块」与「宿主侧的刷屏名单」拼成可见性判定，
 *   给**渲染层**（群汇报卡）与**刻度尺**共用 —— 两处各写一份正则，迟早漂。
 *
 * 语义（与 GroupFeed 完全一致）：
 *   · `visibleGroupBlocks(text)` 返回 null = 这段文本根本不是群事件；
 *   · 返回空数组 = 是群事件，但**一条能展示的块都没有**（全是已废弃的刷屏通知）⇒ 界面不渲染。
 */
import { parseGroupEvents } from "./group-event-text.mjs";
import { isWatchdogSpamText } from "./host-queue.mjs";

/** 这条块是否属于「用户要求不再展示」的通知（预算 80%/用尽、停滞看门狗、待审看门狗）。 */
export function isHiddenNoticeBlock(block) {
  return Boolean(block) && block.type === "notice" && isWatchdogSpamText(String(block.text ?? ""));
}

/** 群事件文本 → 实际会渲染的块；非群事件返回 null。 */
export function visibleGroupBlocks(text) {
  const blocks = parseGroupEvents(text);
  if (!blocks) return null;
  return blocks.filter((block) => !isHiddenNoticeBlock(block));
}
