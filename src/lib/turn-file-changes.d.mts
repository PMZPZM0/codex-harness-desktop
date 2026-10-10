// 回合文件变更报告仓库（.mjs）的类型声明
export declare function getTurnFileChanges(turnId: string | undefined): { path: string; status: string; added: number; deleted: number; diff: string }[];
/* diff 可选：**live 轻扫不带 diff 内容**（只有行数），最终报告才带伪 diff —— 消费方按空串处理 */
export declare function getTurnLiveFileChanges(turnId: string | undefined): { path: string; status: string; added: number; deleted: number; diff?: string }[];
export declare function subscribeTurnFileChanges(fn: (turnId: string) => void): () => void;
