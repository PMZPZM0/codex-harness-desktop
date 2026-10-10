// src/lib/turn-fold-plan.mjs
//
// 「完成态过程折叠」的纯逻辑：决定哪些单元收进折叠组、哪些作为正文锚点留在外面。
//
// ⛔⛔ 现行口径（10-10 用户定稿，原话：「不管回合时间多长，运行过程中有多少步骤，
//   在结束的时候，运行过程必须完全折叠进去，只保留汇总结果和汇总消息下面的已修改文件板块」）：
//   **收尾时整个运行过程（工具 / 思考 / 过渡正文 / 长正文，一视同仁）收成折叠组**；
//   留在折叠组外的只有：① 用户消息（含中途插入的 steer，09-13 定稿）；
//   ② 最终汇总结果（finalAgent）。已修改文件板块由调用方插在两者之间（frozenEditRows）。
//
// 演进史（⛔ 别按旧口径"改回来"，每一版都是用户的明确表态）：
//   · 09-12「折叠把最后汇报也收了」→ 当时的修法是「≥200 字的长正文留在外面」（治标：
//     只护住最长的那几段，超长回合的过程仍被切成多段）；
//   · 09-23 试「有正文就是锚点」（每段正文之间的过程各自成块）→ 当天被否（过程被切碎）；
//   · 10-10 用户实测超长回合：**长正文锚点把运行过程切成多段 = 没有折叠整个运行过程**
//     ⇒ 废除长正文锚点，改为"只认汇总结果"。
//   已知并接受的代价：结尾若是「长汇报 → 工具 → 一句话收尾」，那段长汇报也收进折叠组
//   （点开可见；汇总结果 = 最后那条仍在外面）。再改这条必须先问用户。

/** 取 agentMessage 的正文文本（其它类型一律空串） */
function bodyTextOf(item) {
  return item && item.type === "agentMessage" ? String(item.text ?? "").trim() : "";
}

/**
 * 完成态折叠计划：输入单元序列与最终答复的 item id，输出渲染计划（顺序与输入一致）：
 *   { kind: "fold", units } —— 连续的过程单元 → 收进折叠组
 *   { kind: "body", unit }  —— 锚点 → 常驻在折叠组外（用户消息 / 最终汇总结果）
 */
export function planCompletedFold(units, finalAgentId) {
  const list = Array.isArray(units) ? units : [];
  const isUser = (unit) => unit?.item?.type === "userMessage";
  const isAgentWithBody = (unit) => unit?.item?.type === "agentMessage" && Boolean(bodyTextOf(unit.item));
  // 最终汇总：优先按 id 匹配；id 对不上（上游快照丢 id 的既有形态）→ 以最后一条有正文的消息兜底
  let finalIndex = -1;
  if (finalAgentId) {
    for (let index = list.length - 1; index >= 0; index--) {
      if (list[index]?.item?.id === finalAgentId && isAgentWithBody(list[index])) { finalIndex = index; break; }
    }
  }
  if (finalIndex < 0) {
    for (let index = list.length - 1; index >= 0; index--) {
      if (isAgentWithBody(list[index])) { finalIndex = index; break; }
    }
  }
  const plan = [];
  let buffer = [];
  const flush = () => { if (buffer.length) plan.push({ kind: "fold", units: buffer }); buffer = []; };
  list.forEach((unit, index) => {
    if (isUser(unit) || index === finalIndex) { flush(); plan.push({ kind: "body", unit }); }
    else buffer.push(unit);
  });
  flush();
  return plan;
}
