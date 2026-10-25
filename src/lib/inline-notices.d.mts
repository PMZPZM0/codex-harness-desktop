/** 会话级「待注入告知」队列的类型声明（实现：inline-notices.mjs）。 */

export const INLINE_NOTICE_MARK: string;
export const INLINE_NOTICE_END: string;
export function queueInlineNotice(threadId: string, text: string): boolean;
export function takeInlineNotices(threadId: string): string[];
export function peekInlineNoticeCount(threadId: string): number;
export function formatInlineNotice(text: string): string;
export function _resetInlineNotices(): void;
