/** 输入框草稿按会话持久化（见 composer-draft.mjs 顶部口径注释）。 */
export function draftKeyFor(threadId: string | null): string;
/** 读取某会话的草稿；无草稿/超长/异常一律返回空串。 */
export function loadDraft(threadId: string | null): string;
/** 保存草稿（空内容 = 删除键）；100KB 截断；异常静默降级。 */
export function saveDraft(threadId: string | null, text: string): void;
