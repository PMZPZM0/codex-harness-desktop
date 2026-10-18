/** HTML 实时预览 · 渲染层单例类型（基座）。 */
export type HtmlPreviewTarget = { path: string; url: string; at: number };
export type HtmlPreviewEvent = HtmlPreviewTarget & { reason: "open" | "changed" | "clear" };

export declare function setHtmlPreview(target: { path?: string; url?: string } | null): void;
export declare function notifyHtmlPreviewChanged(path: string): void;
export declare function getHtmlPreview(): HtmlPreviewTarget | null;
export declare function subscribeHtmlPreview(fn: (event: HtmlPreviewEvent | null) => void): () => void;
