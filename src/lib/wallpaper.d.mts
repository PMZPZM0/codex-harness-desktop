/** 应用壁纸配置（外观设置「壁纸」段的数据面）：持久化 localStorage + CustomEvent 通知。 */
export const WALLPAPER_KEY: string;
export const WALLPAPER_EVENT: string;
export const WALLPAPER_MODES: string[];
export const WALLPAPER_PATTERNS: { id: string; name: string; tile: string }[];
export function normalizeWallpaper(raw: unknown): { mode: string; pattern: string; opacity: number; image: string };
export function readWallpaper(): { mode: string; pattern: string; opacity: number; image: string };
export function saveWallpaper(next: unknown): { mode: string; pattern: string; opacity: number; image: string };
export function subscribeWallpaper(onChange: (cfg: { mode: string; pattern: string; opacity: number; image: string }) => void): () => void;
export function patternMask(patternId: string): string;
