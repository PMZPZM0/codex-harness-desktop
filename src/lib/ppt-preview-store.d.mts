/** ppt-preview-store 的类型声明（.mjs 实现见同名文件）。 */
export type SlidePage = { index: number; title?: string; bullets?: string[]; notes?: string; image?: string };
export type SlideDeck = { id: string; title: string; total: number; pages: SlidePage[]; sourcePath?: string; updatedAt: number };

export function subscribeSlideDeck(listener: (deck: SlideDeck | null) => void): () => void;
export function getSlideDeck(): SlideDeck | null;
export function startSlideDeck(input?: { id?: string; title?: string; total?: number; sourcePath?: string }): SlideDeck;
export function upsertSlidePage(page: { index?: number; title?: string; bullets?: string[]; notes?: string; image?: string; total?: number }): SlideDeck;
export function finishSlideDeck(): SlideDeck | null;
export function clearSlideDeck(): void;
export function renderSlideHtml(deck: SlideDeck | null): string;
export function setSlidePreviewUrl(url: string): void;
export function getSlidePreviewUrl(): string;
export function subscribeSlideReload(listener: (url: string) => void): () => void;
export function notifySlideReload(): void;
