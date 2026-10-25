/** 宿主注入消息的保留标记（实现见 host-queue.mjs）。 */
export declare const HOST_QUEUE_PREFIX: string;
export declare const GROUP_EVENT_TAG: string;
export declare function queueItemText(item: { input?: any[] } | null | undefined): string;
export declare function isHostQueueText(text: string | null | undefined): boolean;
export declare function isWatchdogSpamText(text: string | null | undefined): boolean;
export declare function hostQueueMessageId(tag?: string): string;
export declare function isHostQueueItem(item: { clientUserMessageId?: string; id?: string; input?: any[] } | null | undefined): boolean;
