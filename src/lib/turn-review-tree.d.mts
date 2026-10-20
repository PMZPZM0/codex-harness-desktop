/** 回合审阅 · 文件树纯函数类型。 */
export type TurnReviewTreeNode = {
  name: string;
  path: string;
  dirs: TurnReviewTreeNode[];
  files: Array<{ name: string; path: string; added: number; deleted: number; diff: string; deletedFile: boolean; newFile: boolean }>;
};
export declare function relativeTurnReviewPath(filePath: string, workspace?: string): string;
export declare function buildTurnReviewTree(files: Array<Record<string, any>>, workspace?: string): TurnReviewTreeNode;
export declare function collectTurnReviewFolders(node: TurnReviewTreeNode, out?: string[]): string[];
