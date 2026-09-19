// 输入框草稿按会话持久化（09-19 用户：「输入框里的内容不能在切换会话和关闭应用的时候丢失」）。
// 口径：每个会话一个草稿键（threadId → composer-draft-<id>，无会话=欢迎页 → composer-draft-new）；
// 空内容 = 删除键（发送成功/新建后 setPrompt("") 自动清草稿）；100KB 上限防撑爆 localStorage；
// 任何 localStorage 异常（隐私模式 / 配额满）静默降级——草稿是锦上添花，绝不阻塞输入。
const PREFIX = "composer-draft-";
const MAX_LEN = 100 * 1024;
const hasLS = () => typeof localStorage !== "undefined";
export function draftKeyFor(threadId) {
  return PREFIX + (threadId || "new");
}
export function loadDraft(threadId) {
  try {
    if (!hasLS()) return "";
    const value = localStorage.getItem(draftKeyFor(threadId));
    return value && value.length <= MAX_LEN ? value : "";
  } catch {
    return "";
  }
}
export function saveDraft(threadId, text) {
  try {
    if (!hasLS()) return;
    const key = draftKeyFor(threadId);
    const t = String(text ?? "");
    if (!t) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, t.length > MAX_LEN ? t.slice(0, MAX_LEN) : t);
  } catch {
    /* 隐私模式 / 配额满：静默降级 */
  }
}
