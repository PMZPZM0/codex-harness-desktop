/**
 * 「当前时间」注入块（09-23，对标 WorkBuddy 5.1.1「助理对话每轮自动注入当前时间」）。
 *
 * 为什么需要：模型的时间感来自训练数据，涉及「现在 / 今天 / 昨天 / 最近」的问题要么拒答要么瞎猜。
 * 我们在每轮用户消息里**附一个隐藏块**告诉它当前时间（与既有 `[Harness 相关记忆，仅供参考]`
 * 同一套约定：模型看得见，气泡/标题里被 harness-block-strip 剥掉）。
 *
 * ⛔ 为什么不塞进 developer_instructions（config.toml）：
 *   ① 那份文本是**写盘**的，`boot.ts` 会拿它做 `instructionsOutdated` 比对 —— 放一个每次都变的值
 *      会让"指令过期"恒真，每轮/每次启动都重写 config.toml；
 *   ② 就算写了，时间也**冻在写盘那一刻**（可能几周前），比不注入更糟：模型会当真。
 *   附着在**当轮消息**上才是既准确又不影响提示词前缀缓存的形态。
 *
 * 纯函数（可传 date）⇒ 可被 check-preflight 直接跑断言。
 */

const WEEKDAYS_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function pad(n) {
  return String(n).padStart(2, "0");
}

/** `2026-09-23 10:47（周三）` —— 本地时区（用户与模型看到的"现在"必须一致）。 */
export function nowText(date = new Date()) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}（${WEEKDAYS_ZH[d.getDay()]}）`;
}

/** 注入块全文（含首尾空行，直接拼在用户消息末尾）。 */
export function nowBlock(date = new Date()) {
  return `\n\n[当前时间]\n${nowText(date)}\n（涉及"现在/今天/昨天/最近"的判断以这里为准，不要凭训练数据猜日期）\n[时间结束]\n`;
}
