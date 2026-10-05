/**
 * memory-ui 公开面。⛔ 跨域只许从这里 import（与其它域一致）。
 *
 * 分层（10-05 用户要求「组件分层清晰、模块间低耦合」）：
 *   types.ts       类型契约层（判别联合）—— ⛔ 零运行时
 *   primitives.tsx 基础组件层（Section/Badge/State/List）—— ⛔ 零业务知识
 *   views.tsx      七类记忆的差异化视图 —— ⛔ 只管"有数据时怎么画"
 *   MemoryWorkbench.tsx 外壳（取数 + 分发 + 主题）—— ⛔ 唯一碰 IPC 的地方
 *
 * ⛔ 加第八类记忆只改三处：types.ts 的 MemoryKind + MemorySourceMap、views.tsx 加视图、
 *   MemoryWorkbench 的 TABS。**其余文件不用动**。
 */
export { MemoryWorkbench, useMemorySources, type MemorySources } from "./MemoryWorkbench";
export {
  MemorySection, MemoryState, MemorySkeleton, MemoryBadge, MemoryTag, MemoryWeight, MemoryTime, MemoryList,
} from "./primitives";
export {
  PyramidView, McpBackendView, ActorMemoryView, TeamMemoryView, DispatchedTimelineView, MemoryEntryRow,
} from "./views";
export {
  MEMORY_KIND_META, SCOPE_META,
  type MemoryKind, type AnyMemory, type MemorySourceMap, type MemoryEntry,
  type PyramidMemory, type McpBackendMemory, type ActorMemory, type DispatchedSession,
  type LoadState,
} from "./types";
