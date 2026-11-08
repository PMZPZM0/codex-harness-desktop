// 群聊过程块「有新事件」计数器（.mjs）的类型声明
export declare function bumpTeamProcessTick(threadId: unknown): void;
export declare function getTeamProcessTick(threadId: unknown): number;
export declare function subscribeTeamProcessTicks(fn: () => void): () => void;
