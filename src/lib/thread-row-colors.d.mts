export type RowColorPaletteEntry = { id: string; label: string; value: string };

export declare const ROW_COLORS: RowColorPaletteEntry[];

export declare function getThreadRowColors(): { colors: Record<string, string>; version: number };

export declare function subscribeThreadRowColors(listener: () => void): () => void;

export declare function setThreadRowColor(threadId: string, color: string): void;
