/**
 * 回合内「用户消息分段」的**纯函数**（10-31 用户令：插队/排队并进来的消息，
 * 后续 codex 消息必须在**这条用户消息下面**）。
 *
 * 背景（真机 rollout 实测的 item 顺序）：
 *   `USER1 → tool → tool → USER2 → tool → answer`
 * 也就是说，`turn/steer`（排队「立即」/ 回合未结束时的合并发送）把用户消息**插在回合中段**。
 * 旧渲染把回合内**所有**用户消息搬到卡片顶上（`plainUserItems.map` 在最前）⇒ 插队消息跳到最上面、
 * 后续内容全堆在它上面（用户两轮点名，附 WorkBuddy 对照截图）。
 *
 * 口径：
 *   · 以**每条普通用户消息**为边界切段 —— 段内 items 保持流中顺序，**不排序、不归并**；
 *   · 群广播（宿主注入的 `[群事件] …`）不是用户说的话，**不切段**（它由悬浮播报承担）；
 *   · 压缩项不参与（压缩线由 timeline 层归位）；
 *   · 首段 `user: null` 装「第一条用户消息之前」的响应项（正常回合这段是空的）。
 *
 * ⛔ 判据只看「本回合有几条普通用户消息」（`shouldFlowSegment`），⛔ 不要写成
 *   「首条用户消息之前已有响应项 —— 上一版就是这么写的，真实数据上恒假、分段永远不跑。
 */

/**
 * @param {Array<{ type?: string, [key: string]: unknown }>} items 回合内的 items（流中顺序）
 * @param {{ isCompaction?: (item: any) => boolean,
 *           isGroupEvent?: (text: string) => boolean,
 *           textOf?: (item: any) => string }} [opts]
 * @returns {{ user: any, items: any[] }[]} 切好的段（首段 user 恒为 null）
 */
export function splitFlowSegments(items, opts = {}) {
  const isCompaction = opts.isCompaction ?? (() => false);
  const isGroupEvent = opts.isGroupEvent ?? (() => false);
  const textOf = opts.textOf ?? (() => "");
  const segs = [{ user: null, items: [] }];
  for (const item of Array.isArray(items) ? items : []) {
    if (isCompaction(item)) continue;
    if (item?.type === "userMessage") {
      if (isGroupEvent(textOf(item))) continue;
      segs.push({ user: item, items: [] });
      continue;
    }
    segs[segs.length - 1].items.push(item);
  }
  return segs;
}

/** 走不走分段渲染：**≥2 条普通用户消息**才算插队/并进；单条维持旧渲染（气泡在卡片上方）。 */
export function shouldFlowSegment(segs) {
  return (Array.isArray(segs) ? segs : []).filter((seg) => seg?.user).length > 1;
}

/** 头像 / 「正在处理 N 秒」挂哪一段：第一段**真的会渲染内容**的（首段常常是空段）。 */
export function headSegmentIndex(segs) {
  return (Array.isArray(segs) ? segs : []).findIndex((seg) => seg?.user || (seg?.items?.length ?? 0) > 0);
}
