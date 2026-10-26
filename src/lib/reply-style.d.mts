/** reply-style.mjs 的类型声明（10-27：回复风格里的「需求询问」自定义模式） */

export const INQUIRY_STYLE: "inquiry";
export const INQUIRY_HEADING: string;

/** 是否处于「需求询问」模式 */
export function isInquiryStyle(personality: unknown): boolean;

/** 引擎侧 personality（只认官方三档 pragmatic / friendly，其余一律 null） */
export function enginePersonality(personality: unknown): "pragmatic" | "friendly" | null;

/** 需求询问模式要下发的 developer instructions 片段（其他风格为空串） */
export function inquiryInstruction(personality: unknown): string;
