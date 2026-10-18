/**
 * HTML 实时预览 · 渲染层单例（基座模块，10-18）。
 *
 * 职责：记住「当前正在预览哪个 HTML 文件」，以及把主进程的 html-preview:changed
 * 变成一次「重载」通知。BrowserPane（基座组件）与 html-preview 域都从这里订阅。
 *
 * ⛔ 放在 `src/lib/` 而不是域内：`src/components/BrowserPane.tsx` 属于基座，**不许反向 import 域**
 *    （守卫【130】）；基座里已经有 turn-file-changes.mjs 这类模块级单例，同款。
 * ⛔ 不让 AppView / bag 再存一份预览路径（两份必然漂移）。
 */
const listeners = new Set();
let current = null;

function notify(reason) {
  for (const fn of listeners) {
    try { fn(current ? { ...current, reason } : null); } catch { /* 订阅者异常互不影响 */ }
  }
}

/** 开始预览某个文件（path + file:// URL）。 */
export function setHtmlPreview(target) {
  const path = String(target?.path ?? "").trim();
  if (!path) { current = null; notify("clear"); return; }
  current = { path, url: String(target?.url ?? ""), at: Date.now() };
  notify("open");
}

/** 文件内容变了：只通知同一个文件（别的文件不误伤）。 */
export function notifyHtmlPreviewChanged(path) {
  const target = String(path ?? "");
  if (!current || !target || current.path !== target) return;
  current = { ...current, at: Date.now() };
  notify("changed");
}

export function getHtmlPreview() {
  return current;
}

export function subscribeHtmlPreview(fn) {
  if (typeof fn !== "function") return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}
