/** compaction-records.mjs 的类型面（宿主侦测「引擎真压缩」记录的渲染层镜像，10-07）。 */
export type CompactionRecord = { turnId: string; at: number };
export function noteCompactionRecord(threadId: string, turnId: string, at?: number): void;
export function compactionRecordFor(threadId: string): CompactionRecord | null;
/** useSyncExternalStore 订阅面：记录变化 ⇒ 时间线立刻重渲染。 */
export function subscribeCompactions(listener: () => void): () => void;
export function compactionVersion(): number;
