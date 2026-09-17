/** Codex 的身份（名字 + 头像）—— 消息渲染与用户中心共用的单一真相源。
 *
 *  为什么用模块级 store 而不是逐层传 props：assistant 消息在 `ItemView`/`renderItem` 里渲染，
 *  那条调用链上每一条消息都要用到它，层层透传会污染十几个组件的签名；而它只在用户改设置时变化
 *  一次（极低频），正是外部 store 的典型场景。
 *
 *  名字：存 personalization.assistantName（主进程落盘，并会写进 AGENTS.md 让引擎知道自己叫什么）。
 *  头像：存 localStorage —— 与「用户头像」同一机制（UserCenter 也是 localStorage + 回调）；
 *  不放进 personalization.json 是因为头像是 base64 图片，会把那个 JSON 撑大几十倍。
 */

/** Codex 名字的默认值（用户没取名时展示这个）。 */
export const CODEX_DEFAULT_NAME = "Codex";
export const CODEX_AVATAR_KEY = "codex-avatar";

// ⛔ 类型定义（CodexAvatarSpec / CodexIdentity）**只能**放在同目录 codex-identity.d.mts。
//    .mjs 是纯 JS，写了 `export type` 会让 rolldown 直接 PARSE_ERROR（本轮与 enhance-hints.mjs 各踩一次）。

let identity = { name: CODEX_DEFAULT_NAME, avatar: { type: "default", value: "" } };
// ⛔ 不能写 new Set<() => void>()：泛型是 TS 专有语法，在 .mjs 里会被当成比较运算 →
//    rolldown 报 "Empty parenthesized expression"（本轮踩到）。
const listeners = new Set();

/** 供 useSyncExternalStore 订阅。 */
export function subscribeCodexIdentity(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 供 useSyncExternalStore 取值（必须返回稳定引用：没变就返回同一个对象）。 */
export function getCodexIdentity() {
  return identity;
}

/** 更新身份。相同值不通知（避免无意义重渲染）。 */
export function setCodexIdentity(next) {
  const merged = {
    name: (next.name ?? identity.name).trim() || CODEX_DEFAULT_NAME,
    avatar: next.avatar ?? identity.avatar,
  };
  if (merged.name === identity.name && merged.avatar.type === identity.avatar.type && merged.avatar.value === identity.avatar.value) return;
  identity = merged;
  for (const listener of listeners) listener();
}

/** 从 localStorage 读取 Codex 头像（读失败一律回默认头像，不让界面因为坏数据崩）。 */
export function readStoredCodexAvatar() {
  try {
    const raw = localStorage.getItem(CODEX_AVATAR_KEY);
    if (!raw) return { type: "default", value: "" };
    const parsed = JSON.parse(raw);
    const type = parsed?.type === "image" ? "image" : "default";
    const value = typeof parsed?.value === "string" ? parsed.value : "";
    return type === "image" && value ? { type: "image", value } : { type: "default", value: "" };
  } catch {
    return { type: "default", value: "" };
  }
}

/** 持久化 Codex 头像。 */
export function storeCodexAvatar(spec) {
  try { localStorage.setItem(CODEX_AVATAR_KEY, JSON.stringify(spec)); } catch { /* 隐私模式等：本次会话仍生效 */ }
}
