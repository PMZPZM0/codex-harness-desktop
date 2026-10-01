/**
 * 控件皮肤 · 状态存储 v2（localStorage + 订阅）
 *
 * v2 模型（2026-10-01，替代 v1 单品绑定）：
 *   { activePack: "<packId>" | null, overrides: { [slotId]: elementId } }
 *   - activePack：激活的风格套装（同作者 toggle+loader，风格统一）——**全局统一生效**；
 *   - overrides：单品覆盖（工坊高级区手选，仅覆盖单个槽位）。
 *   解析顺序：overrides[slot] → pack.items[slot] → null（默认样式）。
 *   ⛔ 激活/切换套装时清空 overrides：套装的意义就是「全部统一」，混着单品覆盖必然又乱。
 *
 * elementId = "<cat>/<id>"（catalog.gen.ts 里的唯一键）；v1 旧数据直接废弃不迁移
 * （v1 的单品散绑正是「同屏五花八门」的根源）。
 */
import { UI_SKIN_PACKS, type UiSkinPack } from "./packs.gen";

const KEY = "ui-skin-state-v2";
const LEGACY_KEY = "ui-skin-bindings-v1";

export type UiSkinState = { activePack: string | null; overrides: Record<string, string> };

let cache: UiSkinState | null = null;
const listeners = new Set<() => void>();

function read(): UiSkinState {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null") as UiSkinState | null;
    cache = raw && typeof raw === "object" ? { activePack: raw.activePack ?? null, overrides: raw.overrides ?? {} } : { activePack: null, overrides: {} };
  } catch {
    cache = { activePack: null, overrides: {} };
  }
  return cache!;
}

function write(next: UiSkinState) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 无 localStorage（测试环境）忽略 */
  }
  for (const fn of listeners) fn();
}

/** 激活套装的 pack 对象（未激活或 id 失效 ⇒ null）。 */
export function getActivePack(): UiSkinPack | null {
  const st = read();
  return st.activePack ? UI_SKIN_PACKS.find((p) => p.id === st.activePack) ?? null : null;
}

/** 激活套装（null = 回默认）。同轮清空单品覆盖。 */
export function setActivePack(packId: string | null) {
  write({ activePack: packId, overrides: {} });
}

/** 单品覆盖某槽位（工坊高级区）；null = 撤销该槽位覆盖（回落套装/默认）。 */
export function setBinding(slotId: string, elementId: string | null) {
  const st = read();
  const overrides = { ...st.overrides };
  if (elementId) overrides[slotId] = elementId;
  else delete overrides[slotId];
  write({ ...st, overrides });
}

/** 槽位最终生效的 elementId（套装优先级低于单品覆盖）。 */
export function getBinding(slotId: string): string | null {
  const st = read();
  if (st.overrides[slotId]) return st.overrides[slotId];
  return getActivePack()?.items[slotId] ?? null;
}

/** React 订阅。返回退订函数。 */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 供 e2e：一次性读全部**解析后**绑定。 */
export function allBindings(): Record<string, string> {
  const st = read();
  const out: Record<string, string> = {};
  const pack = getActivePack();
  if (pack) for (const [slotId, el] of Object.entries(pack.items)) out[slotId] = el;
  for (const [slotId, el] of Object.entries(st.overrides)) out[slotId] = el;
  return out;
}

// v1 旧数据清理（一次性；放在模块体——首次 import 即执行）
try {
  localStorage.removeItem(LEGACY_KEY);
} catch {
  /* 忽略 */
}
