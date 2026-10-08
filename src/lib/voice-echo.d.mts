// 类型声明：voice-echo.mjs 是运行时实现，tsconfig 关着 allowJs，故类型单独声明。
// 改实现时同步这里（守卫跑的是真实实现，漏改会立刻红）。

/** 播报结束后仍按「回声」判定的尾巴窗口（毫秒） */
export declare const ECHO_TAIL_MS: number;
/** 参与「包含关系」判定的最短字符数 */
export declare const ECHO_MIN_CHARS: number;
/** 判定为回声的相似度阈值（Dice 系数，0..1） */
export declare const ECHO_SIMILARITY: number;

/** 去掉空白与标点符号并小写（用于相似度比较） */
export declare function normalizeForEcho(text: string): string;

/** 字符二元组 Dice 系数（0..1） */
export declare function echoSimilarity(a: string, b: string): number;

export interface SelfEchoInput {
  /** 刚识别出来的文本（ASR final） */
  heard?: string;
  /** 本轮正在朗读的文本 */
  spoken?: string;
  /** 是否正在播报 */
  speaking?: boolean;
  /** 距上一次播报结束过了多少毫秒 */
  msSinceSpoken?: number;
}

/** true = 判为外放回声，不要当作用户的话提交 */
export declare function isLikelySelfEcho(input: SelfEchoInput): boolean;
