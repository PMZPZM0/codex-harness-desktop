/**
 * 会话级「待注入告知」队列（10-26 用户令：「调度已开启，也改成开启后跟着会话下一条消息内置注入」）。
 *
 * 背景：调度开关变化时，应用原来会**单独发一轮**给模型（`pendingCommandTextRef` + `send()`），
 * 于是会话里凭空多出一条用户气泡「【调度已开启】本会话已启用…」——用户视角是"我又没说话，怎么
 * 冒出来一条我说的消息"。他要的是：开关变了先记下，等用户**下一句话**时一起带进去，不单独显示。
 *
 * 用法（两处）：
 *   · 生产端（part06 的 applyDispatch）：`queueInlineNotice(threadId, text)`，不再 send；
 *   · 消费端（part08 send）：`takeInlineNotices(threadId).map(formatInlineNotice)` 拼到正文最前。
 * 显示层：`harness-block-strip` 按 MARK/END 整段剥掉（模型看得到、气泡里看不到）。
 *
 * ⛔ 按 threadId 分桶：用户可能在 IPC 往返期间切会话，单桶会把 A 的告知带进 B。
 * ⛔ 取出即清空（`take`）：同一段告知只能注入一次，否则每轮重复喂给模型（烧上下文）。
 */
export const INLINE_NOTICE_MARK = "<!--harness-notice-->";
export const INLINE_NOTICE_END = "<!--/harness-notice-->";

/** threadId → 待注入的告知文本（按插入顺序）。 */
const queues = new Map();

/** 记一条待注入告知；返回是否记账成功（空文本 / 空会话 id 直接忽略）。 */
export function queueInlineNotice(threadId, text) {
  const id = String(threadId ?? "").trim();
  const body = String(text ?? "").trim();
  if (!id || !body) return false;
  const list = queues.get(id) ?? [];
  list.push(body);
  queues.set(id, list);
  return true;
}

/** 取出并清空该会话的全部待注入告知（消费端每轮调用一次）。 */
export function takeInlineNotices(threadId) {
  const id = String(threadId ?? "").trim();
  const list = queues.get(id);
  if (!list || !list.length) return [];
  queues.delete(id);
  return list;
}

/** 只看不取（UI 想提示"有 N 条随下一条消息生效"时用）。 */
export function peekInlineNoticeCount(threadId) {
  const list = queues.get(String(threadId ?? "").trim());
  return list ? list.length : 0;
}

/** 包成可被显示层整段剥离的块（前后各留空行，避免和正文粘在一起）。 */
export function formatInlineNotice(text) {
  const body = String(text ?? "").trim();
  if (!body) return "";
  return `\n\n${INLINE_NOTICE_MARK}\n${body}\n${INLINE_NOTICE_END}`;
}

/** 测试/调试用：清空全部（不参与业务）。 */
export function _resetInlineNotices() {
  queues.clear();
}
