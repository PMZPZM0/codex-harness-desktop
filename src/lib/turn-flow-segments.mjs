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

/** 头像 / 「正在处理 N 秒」挂哪一段：**第一个真的会渲染卡片**的段。
 *  ⛔ 不能写成「第一个有 user 或 items 的段」（10-31 审查实测）：
 *     `USER1 → USER2 → tool…`（两条相邻用户消息，第一条还没产出任何输出，正是"刚排队就点立即"的形态）
 *     时，首段只有 user、没有 items，而组件**只给有 items 或最后一段渲染卡片** ⇒ 头像与计时整轮都不出现。
 *  ⇒ 优先挂第一个有 items 的段；一段 items 都没有（全空）时挂最后一段（组件必渲染它）。 */
/**
 * **当前这一帧该不该走分段渲染**（11-01 用户令）。
 * 运行中：分段（看清"我这句后面跟的是哪段输出"）；
 * 回合结束 / 用户点停止：**不分段** —— 整轮回到"用户消息全在上、过程与答复在下"，
 * 插队几条都长一个样。⛔ 结束态还分段 = 消息被永久劈开在过程之间（用户截图正是这个）。
 */
export function shouldSegmentNow(segs, running) {
  return Boolean(running) && shouldFlowSegment(segs);
}

export function headSegmentIndex(segs) {
  const list = Array.isArray(segs) ? segs : [];
  const withItems = list.findIndex((seg) => (seg?.items?.length ?? 0) > 0);
  if (withItems >= 0) return withItems;
  return list.length ? list.length - 1 : 0;
}
