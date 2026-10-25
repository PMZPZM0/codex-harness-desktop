/** 队列启动类 RPC 的「伪失败」判据（引擎已自行启动那条排队消息并出队）。
 *  成因与判据说明见同名 .mjs。 */
export declare function isQueueAlreadyStartedError(message: unknown): boolean;
/** 「线程已有活动或待处理回合」＝良性（引擎那边确实还有回合在跑）。 */
export declare function isQueueBusyError(message: string | null | undefined): boolean;
