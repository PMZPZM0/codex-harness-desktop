/** 宿主注入消息的保留标记（实现见 host-queue.mjs）。 */
export declare const HOST_QUEUE_PREFIX: string;
export declare function hostQueueMessageId(tag?: string): string;
export declare function isHostQueueItem(item: { clientUserMessageId?: string; id?: string } | null | undefined): boolean;
