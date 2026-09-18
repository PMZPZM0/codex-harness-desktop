/** 语法高亮元素树缓存（见 code-highlight-cache.mjs） */

export function highlightCacheKey(input: {
  language?: string | null;
  code?: string | null;
  theme?: string | null;
  lineNumbers?: boolean;
  wrapLongLines?: boolean;
}): string;

export interface HighlightCache {
  shouldCache(code: string): boolean;
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  readonly size: number;
  stats(): { size: number; totalChars: number; hits: number; misses: number; maxEntries: number; maxTotalChars: number; minCodeChars: number; maxCodeChars: number };
  clear(): void;
}

export function createHighlightCache(options?: {
  maxEntries?: number;
  maxTotalChars?: number;
  minCodeChars?: number;
  maxCodeChars?: number;
}): HighlightCache;
