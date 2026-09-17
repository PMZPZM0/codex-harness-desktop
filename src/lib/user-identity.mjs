/** 「你」（用户）的身份（名字 + 头像）—— 用户消息头部与左下角账户共用一份。
 *
 *  与 codex-identity.mjs 同构（同一套理由：消息渲染链上每处都要用到，逐层传 props 会污染十几个
 *  组件的签名；而它只在用户改设置时变一次，是外部 store 的典型场景）。
 *
 *  与 Codex 侧的差别：这里**不自己读存储** —— 名字的权威源是 personalization.json 的 nickname
 *  （App 启动后异步回读覆盖 localStorage 缓存），头像在 localStorage "user-profile"
 *  （`{ nickname, avatarType, avatar }`），两者 App 都已经持有 state（`username` / `userAvatar`）。
 *  store 只做分发，避免两个地方各读一份数据、得出不一致的值。
 */

/** 头像三态：image（data:/http 图片）、emoji（表情字符）、none（回落到名字首字）。 */
let identity = { name: "", avatar: { type: "none", value: "" } };
// ⛔ 不能写 new Set<() => void>()：泛型是 TS 专有语法，在 .mjs 里会被当成比较运算
//    → rolldown 报 "Empty parenthesized expression"（codex-identity.mjs 踩过）。
const listeners = new Set();

/** 供 useSyncExternalStore 订阅。 */
export function subscribeUserIdentity(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 供 useSyncExternalStore 取值（必须返回稳定引用：没变就返回同一个对象）。 */
export function getUserIdentity() {
  return identity;
}

/** 更新身份。相同值不通知（避免无意义重渲染）。 */
export function setUserIdentity(next) {
  const merged = {
    name: String(next.name ?? identity.name).trim(),
    avatar: next.avatar ?? identity.avatar,
  };
  if (merged.name === identity.name && merged.avatar.type === identity.avatar.type && merged.avatar.value === identity.avatar.value) return;
  identity = merged;
  for (const listener of listeners) listener();
}
