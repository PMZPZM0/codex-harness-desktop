export type ToolCallDedupe = {
  /** 同一个 id 只真正执行一次；重复到达复用同一份结果并返回 true（调用方需补发响应）。id 为空时不去重。 */
  run<T>(id: string | number | undefined | null, task: () => Promise<T> | T): Promise<boolean>;
  size(): number;
  clear(): void;
};

/** 结果保留时长（默认 30 分钟）：引擎重发可能晚到几分钟 */
export declare const TOOL_CALL_TTL_MS: number;
export declare function createToolCallDedupe(opts?: { ttlMs?: number }): ToolCallDedupe;
