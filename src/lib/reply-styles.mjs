/**
 * 回复风格档位（唯一真相源）。
 *
 * ⛔⛔ 11-08 用户：「回复风格不止三个吧」——画像引导里只列了 3 档（务实/友好/默认），
 *   而个性化页与用户中心各有 6 档，且**三处各写一份**：引导那份少了 需求询问 / 敢于反驳 / 直击本质，
 *   用户在引导里根本选不到这三种。⇒ 收敛成这一份，三处都从这里取。
 *
 * ⛔ `value` 是落档用的 id（写进用户档案的 `style` 字段）；`title` 是中文名，也用作
 *   `replyStyle` 字段的值（历史数据就是存中文，⛔ 别改成存 id —— 会让老档案读不出来）。
 */
export const REPLY_STYLES = [
  { value: "inquiry", title: "需求询问", desc: "动手前先问清目标 / 边界 / 验收，问完再做" },
  { value: "challenge", title: "敢于反驳", desc: "需求有错先指出，给依据与更优方案；你坚持就照做并写清风险" },
  { value: "essence", title: "直击本质", desc: "点名的手段若绕路，先给更上游的做法与代价对照" },
  { value: "pragmatic", title: "务实", desc: "直接给结论和代码，少铺垫" },
  { value: "friendly", title: "友好", desc: "解释更详细，主动交代思路与取舍" },
  { value: "none", title: "默认", desc: "跟随模型默认风格，不额外注入语气指令" },
];

/** 按 id 取中文名；不认识的一律回「默认」（界面上永远有字可显示）。 */
export function replyStyleTitleOf(value) {
  return REPLY_STYLES.find((item) => item.value === String(value ?? ""))?.title ?? "默认";
}

/** 按中文名（老档案里存的就是中文）反查 id；不认识的回 ""。 */
export function replyStyleIdOf(title) {
  const hit = REPLY_STYLES.find((item) => item.title === String(title ?? "").trim());
  return hit ? hit.value : "";
}
