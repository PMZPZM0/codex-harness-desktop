/** reasoning-part-merge.mjs 的类型声明（TS7016：.mjs 需配 .d.mts） */
export function mergeReasoningPartIndex(
  parts: (string | undefined)[],
  index: number,
  field: "summary" | "content",
  delta: string,
  minChars: number,
): number;
