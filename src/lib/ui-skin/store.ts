/**
 * 控件皮肤 · 绑定存储（localStorage + 订阅）
 *
 * 结构：{ [slotId]: elementId }，elementId = "<cat>/<id>"（catalog.gen.ts 里的唯一键）。
 * ⛔ 存 elementId 而不是正文：正文在库里，换皮肤=换引用；库升级不影响已绑定。
 */

const KEY = "ui-skin-bindings-v1";

export type UiSkinBindings = Record<string, string>;

let cache: UiSkinBindings | null = null;
const listeners = new Set<() => void>();

function read(): UiSkinBindings {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) || "{}") as UiSkinBindings;
  } catch {
    cache = {};
  }
  return cache!;
}

function write(next: UiSkinBindings) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 无 localStorage（测试环境）忽略 */
  }
  for (const fn of listeners) fn();
}

export function getBinding(slotId: string): string | null {
  return read()[slotId] ?? null;
}

export function setBinding(slotId: string, elementId: string | null) {
  const next = { ...read() };
  if (elementId) next[slotId] = elementId;
  else delete next[slotId];
  write(next);
}

/** React 订阅（配合 useState/useSyncExternalStore 均可）。返回退订函数。 */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 供 e2e：一次性读全部绑定。 */
export function allBindings(): UiSkinBindings {
  return { ...read() };
}
