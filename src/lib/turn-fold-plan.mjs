// src/lib/turn-fold-plan.mjs
//
// 「完成态过程折叠」的纯逻辑：决定哪些单元收进折叠组、哪些作为正文锚点留在外面。
//
// 为什么单独放 .mjs（而不是留在 App.tsx 或 turn-fold.ts）：
//   tsconfig 关着 allowJs —— 渲染层 import `.mjs` 走同名 `.d.mts` 拿类型，
//   预检（纯 node）则能**直接 import 真实现**跑行为断言，一份实现两处用，不复制粘贴。
//   这与 src/lib/model-scope.mjs 是同一套做法。
//
// 由来（09-12 用户反馈「折叠消息把 codex 最后汇报的也折叠进去了」）：
//   实测某会话 rollout 的条目序列是
//     … AgentMessage(712字) → DynamicToolCall → Reasoning → AgentMessage(80字)
//   而「最终答复 = 最后一条有正文的消息」只会挑中那条 **80 字的收尾**；
//   旧的完成态又把「除最后一条正文以外的全部内容」塞进一个折叠组
//   → 真正的**汇报本身（712 字）被当成过程收了起来**，用户点开才看得到。
//   规则改成：**长正文是正文，短正文（一两句过渡/收尾）才算过程**。

/** 长正文阈值：≥ 这个字数的 agentMessage 一律当正文锚点，永不折叠。 */
export const FOLD_BODY_ANCHOR_CHARS = 200;

/** 取 agentMessage 的正文文本（其它类型一律空串） */
function bodyTextOf(item) {
  return item && item.type === "agentMessage" ? String(item.text ?? "").trim() : "";
}

/**
 * 完成态折叠计划：输入单元序列（按引擎事件顺序）与最终答复的 item id，
 * 输出渲染计划数组（顺序与输入一致）：
 *   { kind: "fold", units } —— 连续的过程单元 → 收进一个折叠组
 *   { kind: "body", unit }  —— 正文锚点 → 内联常驻在折叠组外
 *
 * 正文锚点的判据（三条，任一命中即锚点）：
 *   ① **就是用户消息**（userMessage）—— 用户中途插进来的消息（队列「立即」/ steer）必须原样
 *      留在外面、按流序显示。用户 09-13 定稿：「折叠还是一样的原理，过程都折叠，展示总结，
 *      用户中间发的消息不折叠进去」：折叠只收过程（工具/思考/过渡正文），用户消息永远不是过程；
 *   ② 就是最终答复（finalAgentId）—— 哪怕它很短，收尾那一条也要看得见；
 *   ③ 正文长度 ≥ FOLD_BODY_ANCHOR_CHARS —— 长正文本身就是结论/汇报，不该被折叠吞掉。
 */
export function planCompletedFold(units, finalAgentId) {
  const list = Array.isArray(units) ? units : [];
  const isAnchor = (unit) => {
    // ① 用户消息永不折叠
    if (unit?.item?.type === "userMessage") return true;
    if (!unit || unit.item?.type !== "agentMessage") return false;
    if (finalAgentId && unit.item.id === finalAgentId) return true;
    return bodyTextOf(unit.item).length >= FOLD_BODY_ANCHOR_CHARS;
  };
  const plan = [];
  let buffer = [];
  const flush = () => {
    if (buffer.length) plan.push({ kind: "fold", units: buffer });
    buffer = [];
  };
  for (const unit of list) {
    if (isAnchor(unit)) {
      flush();
      plan.push({ kind: "body", unit });
    } else {
      buffer.push(unit);
    }
  }
  flush();
  return plan;
}
