// src/lib/reply-style.mjs —— 「回复风格」里那条**不属于引擎语气档**的自定义模式：需求询问
//
// 为什么需要它（10-27 用户令）：
//   「搭配 Grill-me 技能，回复风格加一个需求询问选项，启用这个选项就默认使用了这个技能」
//   引擎 thread/start 的 personality 只认 pragmatic / friendly / none（官方语气档）。
//   需求询问不是语气，而是**开工前的行为**（先问清目标/边界/验收再动手）⇒ 不能塞进 personality 枚举，
//   否则引擎侧要么报错要么静默忽略；正确落点是 developer instructions（每回合随会话作用域下发）。
//
// ⛔ 本模块是纯函数（零依赖），便于守卫直接 import 跑真实现。

/** 需求询问模式的风格值（存 localStorage `default-personality`，与另外三档同源） */
export const INQUIRY_STYLE = "inquiry";

/** 注入块首行标记 —— 与 agent-mood 的 MOOD_HEADING 同样的锚点约定（便于幂等剥离/断言） */
export const INQUIRY_HEADING = "需求询问模式（先问清再动手）";

export function isInquiryStyle(personality) {
  return String(personality ?? "") === INQUIRY_STYLE;
}

/**
 * 引擎只认官方三档 ⇒ 自定义风格下发时按 none（null）处理。
 * ⛔ 三个调用点（thread/start、fork/resume、changePersonality 的 thread/settings/update）
 *   必须都过这个函数，否则「需求询问」会被当作未知 personality 直接发给引擎。
 */
export function enginePersonality(personality) {
  const value = String(personality ?? "");
  return value === "pragmatic" || value === "friendly" ? value : null;
}

/**
 * 需求询问模式下发的 developer instructions 片段（其他风格返回空串）。
 * ⛔ 只改「开工前的确认动作」，不改结论/代码质量；并给出退出条件，
 *   否则模型会把用户已经说清的需求再问一遍（那正是用户最烦的形态）。
 */
export function inquiryInstruction(personality) {
  if (!isInquiryStyle(personality)) return "";
  return [
    `## ${INQUIRY_HEADING}`,
    "- 动手前先按 **grill-me** 技能的做法把需求问清：目标、边界（改哪 / 不改哪）、验收标准。",
    "- 一次只问最关键的 1~3 个问题，并给出你推荐的默认答案；问完就开工。",
    "- 用户已经说清、或明确表示「别问了 / 直接做」时**立刻执行**，不许复述问题。",
    "- 这一条只影响开工前的确认，结论、代码与事实照常。",
  ].join("\n");
}
