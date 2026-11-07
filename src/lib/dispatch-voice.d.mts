/** `dispatch-voice.mjs` 的类型声明（⛔ 规则只在 .mjs 里，这里只描述形状）。 */

/** 专家团主理人（团队会话）任务说明 */
export const LEAD_TASK_NOTE: string;
/** 专家团成员任务说明 */
export const MEMBER_TASK_NOTE: string;
/** 普通被调度方（专家 / 子智能体 / CLI）任务说明 */
export const SUBCONV_NOTE: string;
/** 中枢群群成员（一句话） */
export const GROUP_MEMBER_NOTE: string;
/** 转述/派活的写法（含正例） */
export const HANDOFF_STYLE_NOTE: string;

/** 机器标记（@image#1:… / [图片:…] / [文件:…]）→ 人话；⛔ 不碰正文其余部分 */
export function humanizeRefs(text: unknown): string;
