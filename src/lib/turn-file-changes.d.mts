// 回合文件变更报告仓库（.mjs）的类型声明
export declare function getTurnFileChanges(turnId: string | undefined): { path: string; status: string; added: number; deleted: number; diff: string }[];
/* diff 可选：**live 轻扫不带 diff 内容**（只有行数），最终报告才带伪 diff —— 消费方按空串处理 */
export declare function getTurnLiveFileChanges(turnId: string | undefined): { path: string; status: string; added: number; deleted: number; diff?: string }[];
/** 某线程运行中的实时累计改动（群聊流式卡用；收尾报告到达即清场） */
export declare function getThreadLiveFileChanges(threadId: string | undefined): { path: string; status: string; added: number; deleted: number; diff?: string }[];
/** 登记「宿主工具直接生成的文件」（生图 / 修图）：引擎不会为宿主写盘发 fileChange。
 *  ⛔ .mjs 与 .d.mts 必须同步加导出 —— 只改 .mjs 时 tsc 会报「has no exported member」（11-21 实际踩到）。 */
export declare function noteGeneratedFiles(turnId: string | undefined, paths: string[] | undefined): void;
export declare function subscribeTurnFileChanges(fn: (turnId: string) => void): () => void;
