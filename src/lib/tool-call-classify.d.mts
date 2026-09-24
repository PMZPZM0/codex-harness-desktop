/** tool-call-classify.mjs 的类型声明（TS7016：.mjs 需配 .d.mts） */
import type { FoldUnit } from "./turn-fold";
import type { ThreadItem } from "./thread-item";

export const STATS_MAX_PARTS: number;
export const TOOL_CALL_BUCKET_ORDER: string[];

export function toolCallBucket(item: ThreadItem): string | null;

export function summarizeToolCalls(units: (FoldUnit | ThreadItem)[]): {
  text: string;
  calls: number;
  files: number;
  buckets: { bucket: string; count: number }[];
};
