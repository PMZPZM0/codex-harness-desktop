// 群聊过程块「有新事件」计数器（.mjs）的类型声明
export declare function bumpTeamProcessTick(threadId: unknown): void;
export declare function getTeamProcessTick(threadId: unknown): number;
export declare function subscribeTeamProcessTicks(fn: () => void): () => void;

/** 回合收尾计数（汇总卡的回合缓存据此失效重拉） */
export declare function bumpTeamTurnsSettled(threadId: unknown): void;
export declare function getTeamTurnsSettled(threadId: unknown): number;
export declare function subscribeTeamTurnsSettled(fn: () => void): () => void;
