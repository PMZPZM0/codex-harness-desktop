/** ipc-error.mjs 的类型声明（TS7016：.mjs 需配 .d.mts） */

/** 已知 IPC 错误码（与 preload 的 normalizeIpcError 对应） */
export const IPC_ERROR_CODES: string[];

/** 从 thrown 值解析 IPC 错误码；不是 IPC 错误返回 null */
export function ipcErrorCodeOf(error: unknown): string | null;

/** 从 IPC 错误解析通道名（如 "ssh:delete"）；解析不到返回空串 */
export function ipcErrorChannelOf(error: unknown): string;

/** 友好中文说明；未知码返回空串 */
export function ipcErrorHintOf(error: unknown): string;
