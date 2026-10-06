// 回合文件变更报告仓库（.mjs）的类型声明
export declare function getTurnFileChanges(turnId: string | undefined): { path: string; status: string; added: number; deleted: number; diff: string }[];
export declare function getTurnLiveFileChanges(turnId: string | undefined): { path: string; status: string; added: number; deleted: number }[];
export declare function subscribeTurnFileChanges(fn: (turnId: string) => void): () => void;
