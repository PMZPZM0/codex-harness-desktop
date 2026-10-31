/**
 * 会话笔名的**渲染层 store**（10-31 用户令）。
 *
 * 真相源在主进程（`session-alias.json` + `session-alias:*` 通道），这里只是**一份快照 + 订阅**：
 *   · 侧栏每行据此显示笔名（主会话 = 「XX主管」，子会话 = 自己的两字名）；
 *   · 主进程改名后广播 `harness:event { type: "aliases-changed", snapshot }` ⇒ 这里整份替换
 *     ⇒ 所有订阅者（侧栏、上级气泡）**当场**跟着变，不用轮询、不用重开会话。
 *
 * ⛔ 为什么不塞进 bag：笔名是"跨板块共享的只读快照"，走 store 比往 bag 加字段更省
 *    （bag 新字段要同时改 `bag-types.ts` 与各 seg 的 return，容易漂）。
 */
import { supervisorIdOf } from "../../lib/session-names.mjs";

let state = { aliases: {} };
const listeners = new Set();

function emit() { for (const fn of listeners) fn(); }

export function setAliasSnapshot(next) {
  state = { aliases: next && typeof next === "object" ? next : {} };
  emit();
}

export function getAliasState() { return state; }

export function subscribeAliases(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 某会话的展示 ID：主管 ⇒「青崖主管」；子会话 ⇒ 自己的两字笔名（没有就空串）。 */
export function aliasLabelOf(aliasesState, threadId) {
  const record = aliasesState?.aliases?.[String(threadId ?? "")];
  if (!record?.alias) return "";
  return record.supervisorThreadId ? record.alias : supervisorIdOf(record.alias);
}

/** 某会话的上级主管 ID（子会话才有）：`青崖主管`。 */
export function supervisorLabelOfAliases(aliasesState, threadId) {
  const record = aliasesState?.aliases?.[String(threadId ?? "")];
  const parent = record?.supervisorThreadId ? aliasesState?.aliases?.[record.supervisorThreadId] : null;
  return parent?.alias ? supervisorIdOf(parent.alias) : "";
}

/** 已被占用的笔名（改名校验用；含自己的旧名时调用方自行剔除）。 */
export function usedAliasesOf(aliasesState) {
  return Object.values(aliasesState?.aliases ?? {}).map((record) => record?.alias).filter(Boolean);
}
