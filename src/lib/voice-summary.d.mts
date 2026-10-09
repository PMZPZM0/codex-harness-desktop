/** 类型声明（与 voice-summary.mjs 一一对应；.mjs 侧是真身，类型只在这里声明）。 */

/** 句级切分（中文 / 英文句末标点 + 分号；不切小数点）。 */
export declare function splitSentences(text: string): string[];
