/** 应用壁纸配置（外观设置「壁纸」段的数据面）：持久化 localStorage + CustomEvent 通知。 */
export const WALLPAPER_KEY: string;
export const WALLPAPER_EVENT: string;
export const WALLPAPER_MODES: string[];
export const WALLPAPER_PRESETS: { id: string; name: string; day: string; night: string }[];
export function isPresetImage(image: unknown): boolean;
export function presetById(id: string): { id: string; name: string; day: string; night: string } | null;
export function normalizeWallpaper(raw: unknown): { mode: string; image: string };
export function readWallpaper(): { mode: string; image: string };
export function saveWallpaper(next: unknown): { mode: string; image: string };
export function subscribeWallpaper(onChange: (cfg: { mode: string; image: string }) => void): () => void;