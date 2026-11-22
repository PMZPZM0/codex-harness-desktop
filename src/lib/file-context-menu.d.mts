/** 文件右键菜单事件箱（.mjs）的类型声明。 */
export type FileContextMenuRequest = { x: number; y: number; path: string; name: string; image?: boolean; at?: number };
export declare function openFileContextMenu(menu: FileContextMenuRequest): void;
export declare function closeFileContextMenu(): void;
export declare function getFileContextMenu(): FileContextMenuRequest | null;
export declare function subscribeFileContextMenu(fn: (menu: FileContextMenuRequest | null) => void): () => void;
