/** 群聊会话 resume 失败分类（busy / missing / transient）。 */

export function classifyTalkResumeFailure(message: unknown): "busy" | "missing" | "transient";
