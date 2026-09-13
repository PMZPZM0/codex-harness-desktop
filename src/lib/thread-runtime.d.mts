// src/lib/thread-runtime.d.mts —— 类型声明（tsconfig 的 allowJs 关闭，.mjs 需手写声明）
export interface ThreadRuntime {
  model: string;
  effort: string;
  sandbox: string;
  approval: string;
  rev: number;
}

export declare const RUNTIME_PREFIX: string;
export declare const LEGACY_PREFIX: { model: string; effort: string; permissions: string };

export declare function runtimeKey(threadId: string): string;
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
  patch: Partial<Pick<ThreadRuntime, "model" | "effort" | "sandbox" | "approval">> | null | undefined
): { runtime: ThreadRuntime; changed: boolean };

export declare function runtimeSignature(runtime: ThreadRuntime | null | undefined): string;

export declare function legacyMirror(runtime: ThreadRuntime | null | undefined): {
  model: string;
  effort: string;
  permissions: string;
};
