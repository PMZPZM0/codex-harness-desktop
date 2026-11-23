// 类型声明：queued-local-input.mjs 是运行时实现，tsconfig 关着 allowJs，故类型单独声明。

/** 记下入队时的原始 input（含 localImage）；clientId / input 为空则忽略。 */
export declare function rememberQueuedInput(clientId: unknown, input: unknown): void;

/** 取回该条目的原始 input；没有记录返回 null（调用方回落到 entry.input）。 */
export declare function localQueuedInput(clientId: unknown): any[] | null;

/** 条目彻底结束（已发出 / 已删除）⇒ 释放内存。 */
export declare function forgetQueuedInput(clientId: unknown): void;
