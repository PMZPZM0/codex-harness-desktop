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
