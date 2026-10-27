// 回合文件动作归类（.mjs）的类型声明
export type FileAction = { path: string; name: string };
export declare function pathsIn(text: string, limit?: number): string[];
export declare function fileActionsOf(input?: {
  items?: any[];
  turns?: any[];
  turnId?: string | null;
  liveChanges?: { path: string; status?: string }[];
}): { read: FileAction[]; edited: FileAction[]; modified: FileAction[] };
