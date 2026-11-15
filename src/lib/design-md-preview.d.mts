/** design-md-preview.mjs 的类型面（实现是未检查的 .mjs，见 src/lib/*.mjs 范式）。 */

export type DesignMdColor = { name: string; hex: string };

export type DesignMdParts = {
  /** YAML 头（无则空串） */
  tokens: string;
  /** Markdown 正文（去掉了 YAML 头） */
  body: string;
  /** 十六进制色板（去重，最多 24 个） */
  colors: DesignMdColor[];
};

export declare function splitDesignMd(text: string): DesignMdParts;
export declare function hasSwatches(parts: DesignMdParts | null | undefined): boolean;
export declare function isHexColor(value: string): boolean;

export type DesignMdColorLabel = DesignMdColor & { label: string };
export type DesignMdColorGroup = { key: string; label: string; items: DesignMdColorLabel[] };

export declare function tokenLabelZh(name: string): string;
export declare function groupColors(colors: DesignMdColor[]): DesignMdColorGroup[];

export type DesignMdTypeRow = { name: string; label: string; family: string; size: string; weight: string; lineHeight: string };
export type DesignMdRoundedRow = { name: string; label: string; value: string };
export type DesignMdSpacingRow = { name: string; value: string };
export type DesignMdComponentRow = { name: string; label: string; background: string; text: string; rounded: string; padding: string };
export type DesignMdComponentGroup = { group: string; label: string; items: DesignMdComponentRow[] };
export type DesignMdTokenSummary = {
  fonts: string[];
  typeScale: DesignMdTypeRow[];
  rounded: DesignMdRoundedRow[];
  spacing: DesignMdSpacingRow[];
  components: DesignMdComponentGroup[];
  hiddenComponents: number;
};

export declare function summarizeTokens(tokens: string, options?: { maxComponents?: number }): DesignMdTokenSummary;
