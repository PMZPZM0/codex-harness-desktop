/** reply-style.mjs 的类型声明（10-27：回复风格里的「需求询问」自定义模式） */

export const INQUIRY_STYLE: "inquiry";
export const INQUIRY_HEADING: string;

/** 是否处于「需求询问」模式 */
export function isInquiryStyle(personality: unknown): boolean;

/** 引擎侧 personality（只认官方三档 pragmatic / friendly，其余一律 null） */
export function enginePersonality(personality: unknown): "pragmatic" | "friendly" | null;

/** 需求询问模式要下发的 developer instructions 片段（其他风格为空串） */
export function inquiryInstruction(personality: unknown): string;

/* 10-31：回复风格新增「敢于反驳」—— 实现已在 reply-style.mjs（f5a97a8ed），
   声明漏在这里 ⇒ 三仓 `tsc -b` 全报 TS2305。下面四条与实现逐字对齐，⛔ 别再漏。 */
export const CHALLENGE_STYLE: "challenge";
export const CHALLENGE_HEADING: string;

/** 是否处于「敢于反驳」模式 */
export function isChallengeStyle(personality: unknown): boolean;

/** 敢于反驳模式要下发的 developer instructions 片段（其他风格为空串） */
export function challengeInstruction(personality: unknown): string;
