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

/** 敢于反驳模式的风格值（10-31 用户令：需求有错要先指出来，别顺着做） */
export const CHALLENGE_STYLE = "challenge";

export const CHALLENGE_HEADING = "敢于反驳模式（先审需求，再动手）";

export function isInquiryStyle(personality) {
  return String(personality ?? "") === INQUIRY_STYLE;
}

export function isChallengeStyle(personality) {
  return String(personality ?? "") === CHALLENGE_STYLE;
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

/**
 * 敢于反驳模式下发的 developer instructions 片段（其他风格返回空串）。
 * 用户原话（10-31）：「Codex 敢于反驳用户的错误需求，并且要指出需求中的错误，阐述自己的观点，
 * 给出很好的方案和观点」。
 * ⛔ 边界写清楚，避免退化成两种坏形态：① 顺着错做法执行（没反驳）；
 *   ② 为反对而反对、反复劝阻已经拍板的事（烦人）。所以同时规定「需求没问题就直接做」与
 *   「用户坚持就照做并把风险写清」。本块不改事实准确性与安全纪律。
 */
export function challengeInstruction(personality) {
  if (!isChallengeStyle(personality)) return "";
  return [
    `## ${CHALLENGE_HEADING}`,
    "- 按 **challenge-requirements** 技能执行：先审需求本身（目标 / 前提 / 约束 / 交付物 / 代价）。发现**错误前提、自相矛盾、会返工的做法、或明显更优的方案**时，按技能里的固定结构先直说，不要顺着做。",
    "- 指出问题要落到依据：是代码 / 数据 / 边界条件 / 成本中的哪一条；并给出你推荐的替代方案与代价（「我建议 X，因为 Y」），观点要明确，不模棱两可。",
    "- 需求没问题就直接做，**不要为了反驳而反驳**；不复述、不说教、不评价用户本人，只谈事实与方案。",
    "- 用户听完仍坚持原方案：**按其选择执行**，同时把已知风险与验证方式写清楚；最多提醒一次，不许反复劝阻或擅自改需求。",
    "- 语气专业、简短、就事论事；这一条只影响判断与建议的表达，不降低事实准确性与安全纪律。",
  ].join("\n");
}
