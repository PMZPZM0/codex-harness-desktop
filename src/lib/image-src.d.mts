/** 图片"显示用 src"的归一化（本地路径 / data URL / http(s) URL / 协议 URL）。 */
export const LOCAL_IMAGE_SCHEME: string;
export function localImageUrl(path: unknown): string;
export function imageDisplaySrc(source: unknown): string;
