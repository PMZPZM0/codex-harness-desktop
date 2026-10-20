export type MediaKind = "video" | "audio" | "model" | "";

export const MEDIA_SCHEME: string;
export const VIDEO_EXTENSIONS: readonly string[];
export const AUDIO_EXTENSIONS: readonly string[];
export const MODEL_EXTENSIONS: readonly string[];

export function extensionOf(value: unknown): string;
export function mediaKindOf(value: unknown): MediaKind;
export function isVideoPath(value: unknown): boolean;
export function isAudioPath(value: unknown): boolean;
export function isModelPath(value: unknown): boolean;
export function isHlsSource(value: unknown): boolean;
export function isRemoteMediaSource(value: unknown): boolean;
export function mediaDisplaySrc(source: unknown): string;
export function collectMediaPaths(value: unknown, limit?: number): Array<{ path: string; kind: Exclude<MediaKind, ""> }>;
