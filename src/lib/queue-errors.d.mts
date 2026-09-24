/** 队列启动类 RPC 的「伪失败」判据（引擎已自行启动那条排队消息并出队）。
 *  成因与判据说明见同名 .mjs。 */
export declare function isQueueAlreadyStartedError(message: unknown): boolean;
