// 类型声明：speak-text.mjs 是运行时实现，tsconfig 关着 allowJs，故类型单独声明。
// 改实现时同步这里（预检的纯逻辑断言跑真实实现，漏改会立刻红）。

/** 去掉 emoji 与零宽符号 */
export declare function stripNoiseSymbols(text: string): string;

/** 整数 → 中文读数（0..999999999999） */
export declare function numberToChinese(value: number | string): string;

/** 数字 / 日期 / 时间 / 百分数中文化（紧贴标识符的数字不转换） */
export declare function normalizeNumbers(text: string): string;

/** 单段文本 → 口播文本（无跨句状态）；空串表示这段不必合成 */
export declare function toSpeakableText(raw: string): string;

export interface SpeakFilterOptions {
  /** 代码块占位提示；传空串 = 代码块彻底静默 */
  codeNotice?: string;
  /** 表格占位提示；传空串 = 表格彻底静默 */
  tableNotice?: string;
}

export interface SpeakFilter {
  /** 断句器吐出来的一句 → 可朗读文本（空串 = 跳过这一句） */
  push(chunk: string): string;
  reset(): void;
  readonly inCodeBlock: boolean;
}

/** 跨句过滤器：代码围栏 / 表格整段丢弃，状态跨句保持（每回合建一个） */
export declare function createSpeakFilter(options?: SpeakFilterOptions): SpeakFilter;
