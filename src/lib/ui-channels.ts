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
export type MediaPreviewTarget = {
  source: string;
  kind?: "video" | "audio" | "model";
  title?: string;
  poster?: string;
  autoPlay?: boolean;
};
type MediaPreviewFn = (target: MediaPreviewTarget) => void;

let lightbox: LightboxFn | null = null;
let openPastedText: OpenPastedTextFn | null = null;
let openFileText: OpenPastedTextFn | null = null;
let toast: ToastFn | null = null;
let closePastedText: ClosePastedTextFn | null = null;
let resolvePath: ResolvePathFn | null = null;
let lookupFile: LookupFileFn | null = null;
let fileMissing: FileMissingFn | null = null;
let mediaPreview: MediaPreviewFn | null = null;

/** 登记「打开大图浮层」的实现（宿主启动时注入；传 null 解绑）。 */
export function registerImageLightbox(fn: LightboxFn | null): void { lightbox = fn; }
/** 请求打开大图浮层；没人登记时静默（⛔ 不抛错，别让预览链断掉）。 */
export function openImageLightbox(path: string, alt: string): void { lightbox?.(path, alt); }

/** 登记「打开粘贴文本编辑器」的实现（宿主注入；null 解绑）。 */
export function registerOpenPastedTextEditor(fn: OpenPastedTextFn | null): void { openPastedText = fn; }
/** 请求打开粘贴文本编辑器；未登记时静默。 */
export function openPastedTextEditor(path: string, name: string): void { openPastedText?.(path, name); }

/** 会话工作区文件的弹窗编辑（09-26 文件卡片右键「编辑」）：同一 pastedText 槽位渲染，kind 区分读写通道 */
export function registerOpenFileTextEditor(fn: OpenPastedTextFn | null): void { openFileText = fn; }
/** 请求用文本编辑器打开某个文件；未登记时静默。 */
export function openFileTextEditor(path: string, name: string): void { openFileText?.(path, name); }

/** 登记全局 toast 的实现（宿主注入；null 解绑）。 */
export function registerToast(fn: ToastFn | null): void { toast = fn; }
/** 弹一条 toast（标题 + 可选正文）；未登记时静默。 */
export function notifyToast(title: string, text?: string): void { toast?.(title, text); }

/** 登记「关闭粘贴文本编辑器」的实现（宿主注入；null 解绑）。 */
export function registerClosePastedText(fn: ClosePastedTextFn | null): void { closePastedText = fn; }
/** 请求关闭粘贴文本编辑器；未登记时什么都不做。 */
export function requestClosePastedText(): void { closePastedText?.(); }

/** 登记「把相对路径解析成绝对路径」的实现（宿主注入；null 解绑）。 */
export function registerResolveFilePath(fn: ResolvePathFn | null): void { resolvePath = fn; }
/** 解析路径为绝对路径；没登记时原样返回（⛔ 不猜目录）。 */
export function resolveFilePath(path: string): string { return resolvePath ? resolvePath(path) : path; }

/** 登记「按文件名查已知路径」的实现（宿主注入；null 解绑）。 */
export function registerLookupKnownFile(fn: LookupFileFn | null): void { lookupFile = fn; }
/** 按文件名查已知路径；没登记或查不到返回 null。 */
export function lookupKnownFile(name: string): string | null { return lookupFile ? lookupFile(name) : null; }

/** 登记「文件缺失提示」的实现（宿主注入；null 解绑）。 */
export function registerFileMissing(fn: FileMissingFn | null): void { fileMissing = fn; }
/** 上报一次「文件不存在 / 打不开」；未登记时静默。 */
export function notifyFileMissing(message: string): void { fileMissing?.(message); }

/** 视频 / 音频 / 3D 预览（10-20）：基座组件（文件卡、附件 chip）只发请求，
 *  真正的弹窗由 MediaPreviewBridge 在 feature 层挂载 —— 避免 shared → features 反向依赖。 */
export function registerMediaPreview(fn: MediaPreviewFn | null): void { mediaPreview = fn; }
/** 请求打开媒体预览浮层；未登记时静默。 */
export function openMediaPreview(target: MediaPreviewTarget): void { mediaPreview?.(target); }
