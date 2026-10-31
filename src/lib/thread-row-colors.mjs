/** 会话行自定义底色（10-31 用户令）：
 *  「加一个会话选项颜色修改功能，修改后，会话选项颜色做两种，未选中浅色常驻，选中后颜色稍微深一点」。
 *  ⛔ 只存展示数据（localStorage，按 threadId），不参与引擎配置；色板复用自定义标签的同一套
 *     （`TAG_COLORS` 单一真相源，别再抄第二份色值）。
 *  ⛔ 跨窗口：每个渲染进程一份快照，写入前重读盘上最新值再合并这一条（同 entity-tags 的理由）。 */
import { TAG_COLORS } from "./entity-tags.mjs";

const KEY = "thread-row-colors-v1";

export const ROW_COLORS = TAG_COLORS;

function readMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [id, value] of Object.entries(raw)) {
      if (!id || typeof value !== "string") continue;
      if (/^#[0-9a-f]{6}$/i.test(value)) out[id] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map) {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* 隐私模式忽略 */ }
  return map;
}

let snapshot = { colors: {}, version: 0 };
let loaded = false;
const listeners = new Set();

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  snapshot = { ...snapshot, colors: readMap() };
}

function emit(colors) {
  snapshot = { colors, version: snapshot.version + 1 };
  for (const listener of listeners) listener();
}

export function getThreadRowColors() {
  ensureLoaded();
  return snapshot;
}

export function subscribeThreadRowColors(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 设置 / 清除（传空串）一行会话的底色。 */
export function setThreadRowColor(threadId, color) {
  ensureLoaded();
  const id = String(threadId ?? "");
  if (!id) return;
  const onDisk = readMap();
  const next = String(color ?? "");
  if (/^#[0-9a-f]{6}$/i.test(next)) onDisk[id] = next;
  else delete onDisk[id];
  emit(writeMap(onDisk));
}
