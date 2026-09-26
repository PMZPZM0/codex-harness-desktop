/**
 * UI 通道注册表（09-21 从 App.tsx 收敛而来）
 *
 * 背景：模块级组件（图片灯箱 / 粘贴文本 chip / 内联文件卡…）在 App 主体之外，
 * 拿不到 App 内部的 setState。原先的做法是在 App.tsx 里放一批
 * `let xxx: Fn | null = null`，由 App 的 useEffect 赋值、组件里 `xxx?.()` 调用。
 * 问题：① 这些是可变模块级全局变量，谁都能改；② 一旦搬进独立模块，
 * ESM 里 import 进来的绑定**不能赋值**（TS2632）⇒ 代码根本搬不走。
 *
 * 收敛方案：通道归这个模块所有，对外只暴露「注册 / 调用」两件事 ——
 *   - App 主体挂载时 register*（卸载时 register*(null)）；
 *   - 模块级组件直接调用同名函数（内部已做空值保护，语义与原来的 `?.()` 完全一致）。
 * 以后新增同类通道：在这里加一对 register/调用即可，不必再散落全局变量。
 */

type LightboxFn = (path: string, alt: string) => void;
type OpenPastedTextFn = (path: string, name: string) => void;
type ToastFn = (title: string, text?: string) => void;
type ClosePastedTextFn = () => void;
type ResolvePathFn = (path: string) => string;
type LookupFileFn = (name: string) => string | null;
type FileMissingFn = (message: string) => void;

let lightbox: LightboxFn | null = null;
let openPastedText: OpenPastedTextFn | null = null;
let openFileText: OpenPastedTextFn | null = null;
let toast: ToastFn | null = null;
let closePastedText: ClosePastedTextFn | null = null;
let resolvePath: ResolvePathFn | null = null;
let lookupFile: LookupFileFn | null = null;
let fileMissing: FileMissingFn | null = null;

export function registerImageLightbox(fn: LightboxFn | null): void { lightbox = fn; }
export function openImageLightbox(path: string, alt: string): void { lightbox?.(path, alt); }

export function registerOpenPastedTextEditor(fn: OpenPastedTextFn | null): void { openPastedText = fn; }
export function openPastedTextEditor(path: string, name: string): void { openPastedText?.(path, name); }

/** 会话工作区文件的弹窗编辑（09-26 文件卡片右键「编辑」）：同一 pastedText 槽位渲染，kind 区分读写通道 */
export function registerOpenFileTextEditor(fn: OpenPastedTextFn | null): void { openFileText = fn; }
export function openFileTextEditor(path: string, name: string): void { openFileText?.(path, name); }

export function registerToast(fn: ToastFn | null): void { toast = fn; }
export function notifyToast(title: string, text?: string): void { toast?.(title, text); }

export function registerClosePastedText(fn: ClosePastedTextFn | null): void { closePastedText = fn; }
export function requestClosePastedText(): void { closePastedText?.(); }

export function registerResolveFilePath(fn: ResolvePathFn | null): void { resolvePath = fn; }
export function resolveFilePath(path: string): string { return resolvePath ? resolvePath(path) : path; }

export function registerLookupKnownFile(fn: LookupFileFn | null): void { lookupFile = fn; }
export function lookupKnownFile(name: string): string | null { return lookupFile ? lookupFile(name) : null; }

export function registerFileMissing(fn: FileMissingFn | null): void { fileMissing = fn; }
export function notifyFileMissing(message: string): void { fileMissing?.(message); }
