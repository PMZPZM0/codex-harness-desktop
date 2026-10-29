// src/lib/thread-runtime.d.mts —— 类型声明（tsconfig 的 allowJs 关闭，.mjs 需手写声明）
// ⛔ 改 src/lib/*.mjs 的导出或字段时**必须同步改这里**：allowJs=false 时 TS 只认这份手写声明，
//    .mjs 里写了而这里没写 = 类型报错「has no exported member」（09-15 踩过）。

/** 调度许可（10-29 起）：本会话允许 Codex 调度哪些类别的对象。
 *  专家 / 子智能体默认 true；专家团默认 false（需显式开启）。⛔ 总开关 `enabled` 已删除。 */
export interface DispatchConfig {
  expert: boolean;
  team: boolean;
  subagent: boolean;
}

export interface ThreadRuntime {
  model: string;
  effort: string;
  sandbox: string;
  approval: string;
  dispatch: DispatchConfig;
  rev: number;
}

export declare const RUNTIME_PREFIX: string;
export declare const LEGACY_PREFIX: { model: string; effort: string; permissions: string };

export declare function runtimeKey(threadId: string): string;
export declare function emptyDispatch(): DispatchConfig;
export declare function normalizeDispatch(raw: unknown): DispatchConfig;
export declare function dispatchSignature(raw: unknown): string;
export declare function emptyRuntime(): ThreadRuntime;
export declare function normalizeRuntime(raw: unknown): ThreadRuntime;

export declare function migrateRuntime(input: {
  runtime?: unknown;
  model?: unknown;
  effort?: unknown;
  permissions?: unknown;
}): ThreadRuntime;

export declare function patchRuntime(
  current: ThreadRuntime | null | undefined,
  patch: (Partial<Pick<ThreadRuntime, "model" | "effort" | "sandbox" | "approval">> & { dispatch?: DispatchConfig }) | null | undefined
): { runtime: ThreadRuntime; changed: boolean };

export declare function runtimeSignature(runtime: unknown): string;

export declare const OWN_WRITE_TTL_MS: number;

export interface OwnEchoEntry {
  signature: string;
  at: number;
}

export declare function rememberOwnWrite(
  store: Map<string, OwnEchoEntry> | null | undefined,
  threadId: string,
  runtime: unknown,
  now?: number
): Map<string, OwnEchoEntry> | null | undefined;

export declare function isOwnEcho(
  store: Map<string, OwnEchoEntry> | null | undefined,
  threadId: string,
  runtime: unknown,
  now?: number
): boolean;

export declare function legacyMirror(runtime: ThreadRuntime | null | undefined): {
  model: string;
  effort: string;
  permissions: string;
};
