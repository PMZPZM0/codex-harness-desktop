/** 前端开发（域 id 仍为 `ui-sketch`）会话单例的类型面（真相源在 sketch-session.mjs，本文件只是它的声明）。 */
import type { SketchDiag, SketchDoc } from "./sketch-doc.mjs";

export const SKETCH_READY_TIMEOUT_MS: number;
export const SKETCH_REPLY_TIMEOUT_MS: number;

export function attachSketchFrame(win: Window | null): void;
export function detachSketchFrame(): void;
export function feedSketchMessage(data: unknown): void;
export function isSketchReady(): boolean;
export function waitSketchReady(timeoutMs?: number): Promise<void>;
export function requestSketchDoc(): Promise<{ doc: SketchDoc | null; diag: SketchDiag | null }>;
export function applySketchDoc(doc: unknown): Promise<{ ok: boolean; doc: SketchDoc | null; error: string }>;
