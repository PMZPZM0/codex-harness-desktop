/**
 * 计划条目的解析 / 序列化（纯函数，零依赖）。
 *
 * 为什么独立成模块（本项目惯例，同 `image-src.mjs` / `enhance-hints.mjs`）：
 * 预检要能**直接跑真断言**（`await import("../src/lib/plan-steps.mjs")`），而不是 grep 源码文本 ——
 * 「查标识符存在」是假绿高发区（记忆里记着这条）。
 *
 * 数据来源：引擎用 `turn/plan/updated` 发**结构化**计划（`plan: [{ step, status }]`），
 * 事件层拍平成 markdown（`- [ ] 步骤` / `- [x] 步骤`）存进 item.text；这里把它解析回条目，
 * 供「计划可编辑构件」编辑，再序列化交回。
 */

/**
 * @typedef {{ text: string; done: boolean }} PlanStep
 */

/**
 * 解析计划文本。
 * 兼容三种写法：`- [ ] x`（任务列表，引擎用的就是这种）、`- x` / `* x`、`1. x`。
 * 第一条条目**之前**的普通行视为前置说明（intro，原样保留、不参与编辑）；
 * 条目**之后**的普通行并入最后一条（避免用户看不见它 —— 丢掉内容比格式难看严重得多）。
 *
 * @param {string} text
 * @returns {{ intro: string; steps: PlanStep[] }}
 */
export function parsePlan(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  /** @type {string[]} */
  const intro = [];
  /** @type {PlanStep[]} */
  const steps = [];
  let seenStep = false;
  for (const line of lines) {
    const task = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (task) { steps.push({ text: task[2].trim(), done: task[1].toLowerCase() === "x" }); seenStep = true; continue; }
    if (bullet) { steps.push({ text: bullet[1].trim(), done: false }); seenStep = true; continue; }
    if (ordered) { steps.push({ text: ordered[1].trim(), done: false }); seenStep = true; continue; }
    if (!seenStep) { intro.push(line); continue; }
    if (line.trim()) {
      const last = steps[steps.length - 1];
      steps[steps.length - 1] = { ...last, text: `${last.text} ${line.trim()}`.trim() };
    }
  }
  return { intro: intro.join("\n").trim(), steps };
}

/**
 * 序列化回 markdown —— 这就是发回给模型的内容。
 * 空文本条目会被调用方先过滤掉（见 PlanEditor），这里不做静默丢弃：静默丢条目会让用户以为改丢了。
 *
 * @param {string} intro
 * @param {PlanStep[]} steps
 * @returns {string}
 */
export function serializePlan(intro, steps) {
  const body = steps.map((step) => `- [${step.done ? "x" : " "}] ${String(step.text ?? "").trimEnd()}`).join("\n");
  return intro ? `${intro}\n\n${body}` : body;
}
