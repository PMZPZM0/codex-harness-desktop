/** memory-scope-rules.mjs 的类型声明（TS7016：.mjs 需配 .d.mts） */

export type MemoryScopeKind = "cross-project" | "project" | "session";
export type MemoryInjectTier = "first" | "resident" | "last" | "never";

export interface MemoryFileRule {
  /** 文件落点（如 `project/MEMORY.md`、`lessons/*.md`）—— 旧版层号表已删除，以文件为准 */
  target: string;
  name: string;
  scope: MemoryScopeKind;
  /** 存储范围：存在哪、几份 */
  store: string;
  /** 共享边界：谁能读到 */
  sharedWith: string;
  /** 隔离原则：谁读不到 */
  isolatedFrom: string;
  /** 注入优先级档 */
  inject: MemoryInjectTier;
  /** 引用 / 继承：内容从哪来（上游） */
  inheritsFrom: string;
  /** 同步 / 去向：满了或过时去哪（下游） */
  syncsTo: string;
}

export interface MemorySessionScope {
  id: string;
  label: string;
  owner: string;
  note: string;
}

export declare const MEMORY_SCOPE_LABEL: Record<MemoryScopeKind, string>;
export declare const MEMORY_SCOPE_HINT: Record<MemoryScopeKind, string>;
export declare const MEMORY_INJECT_LABEL: Record<MemoryInjectTier, string>;
export declare const MEMORY_FILE_RULES: readonly MemoryFileRule[];
export declare const MEMORY_SESSION_SCOPES: readonly MemorySessionScope[];
export declare function filesByScope(scope: MemoryScopeKind): MemoryFileRule[];
export declare function filesByInject(tier: MemoryInjectTier): MemoryFileRule[];
