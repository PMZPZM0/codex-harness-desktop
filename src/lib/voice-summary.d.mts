/** `voice-summary.mjs` 的类型面（与实现同目录同名的 .d.mts，见 src/lib/*.d.mts 既有范式）。 */

/** 汇总默认上限（字符） */
export declare const SUMMARY_MAX_CHARS: number;
/** 汇总开场白（唯一真相源） */
export declare const SUMMARY_PREFIX: string;
/** 整段是代码时改念这一句 */
export declare const SUMMARY_EMPTY_NOTICE: string;

/** 句级切分（中文/英文句末标点 + 分号，不切小数点） */
export declare function splitSentences(text: string): string[];

/**
 * 把最终回复压成「可朗读的汇总」。
 * `text` 为空串 = 清洗后没什么可念的（调用方决定是否念 SUMMARY_EMPTY_NOTICE）。
 */
export declare function summarizeForSpeech(
  finalText: string,
  options?: { maxChars?: number; prefix?: string }
): { text: string; sentences: number; kept: number; truncated: boolean };
