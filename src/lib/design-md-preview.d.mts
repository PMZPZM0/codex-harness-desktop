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
