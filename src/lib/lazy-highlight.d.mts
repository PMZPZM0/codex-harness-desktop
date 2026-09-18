/** 代码块懒高亮（见 lazy-highlight.mjs） */

export declare const LAZY_HIGHLIGHT_MIN_CHARS: number;

export declare function deservesLazyHighlight(code: string | null | undefined): boolean;

export declare function plainCodeStyles(themeStyle: Record<string, unknown> | null | undefined): {
  pre: Record<string, unknown>;
  code: Record<string, unknown>;
};
