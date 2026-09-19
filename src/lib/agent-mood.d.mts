// 类型声明：agent-mood.mjs 是运行时实现，tsconfig 关着 allowJs，故类型单独声明。
// 改实现时同步这里（预检【57】的纯函数断言会跑真实实现，漏改会立刻红）。

/** 会话状态（心情 / 精力 / 默契）。所有数值都有界，坏值由 normalizeMood 归一。 */
export interface MoodState {
  /** -1..1 心情好坏（连续失败压下去，顺利/被夸抬上来） */
  valence: number;
  /** 0..1 精力（连败会掉，用户着急时会短时上调：要更专注、更快给结论） */
  energy: number;
  /** 0..1 默契（随成功互动缓慢累积，随时间衰减） */
  rapport: number;
  /** 该会话累计回合数 */
  turns: number;
  okStreak: number;
  failStreak: number;
  /** 上次更新的时间戳（毫秒）；0 = 从未有过状态 */
  updatedAt: number;
}

/** 语气档（本功能的产品语义全部集中在这里） */
export interface MoodTone {
  key: "steady" | "brisk" | "sober" | "terse";
  label: string;
  tone: string;
}

export declare const MOOD_HEADING: string;
export declare const MOOD_BASELINE: { valence: number; energy: number; rapport: number };
export declare const MOOD_SIGNALS: string[];

export declare function emptyMood(): MoodState;
export declare function normalizeMood(raw: unknown): MoodState;

/** 时间衰减：每 30 分钟朝基线收敛 30%，最多 5 档。 */
export declare function decayMood(raw: unknown, now?: number): MoodState;

/** 按信号更新（turn-ok / turn-fail / user-warm / user-frustrated）。 */
export declare function applyMoodSignal(raw: unknown, signal: string, now?: number): MoodState;

/** 先衰减再吃信号（推荐调用方式）。 */
export declare function advanceMood(raw: unknown, signal: string, now?: number): MoodState;

export declare function rapportBand(raw: unknown): "fresh" | "warm" | "close";

/** 状态 → 语气档。 */
export declare function moodTone(raw: unknown): MoodTone;

/** 生成对模型可见的「会话状态」块（无状态时返回空串）。 */
export declare function moodBlock(raw: unknown, now?: number): string;

/** 剥离历史注入块（幂等；连组合分隔符一并剥掉）。 */
export declare function stripMoodBlock(text: string): string;

/** 组合最终下发的 developer instructions：基线在前、状态块在后。 */
export declare function composeMoodInstructions(base: string, block: string): string;

/** 下发去重签名（只含语气档 + 默契档，不含浮点）。 */
export declare function moodSignature(raw: unknown): string;

/** 用户消息里的语气信号（关键词判定，无命中返回空串）。 */
export declare function userSignalOf(text: string): string;
