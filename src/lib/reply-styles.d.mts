/** `reply-styles.mjs` 的类型声明（与实现一一对应；⛔ 规则只在 .mjs 里，这里只描述形状）。 */

export interface ReplyStylePreset {
  /** 落档用 id（写进用户档案的 `style` 字段） */
  value: "inquiry" | "challenge" | "essence" | "pragmatic" | "friendly" | "none";
  /** 中文名（也用作 `replyStyle` 字段的值：历史档案存的就是中文） */
  title: string;
  /** 一句话说明（界面 title 悬停 / 引导卡片副标题） */
  desc: string;
}

export declare const REPLY_STYLES: ReplyStylePreset[];
export declare const REPLY_STYLE_VALUES: string[];
export declare function replyStyleTitleOf(value: unknown): string;
export declare function replyStyleIdOf(title: unknown): string;
