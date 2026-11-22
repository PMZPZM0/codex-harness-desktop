/** 全局文件右键菜单事件箱：任何文件 chip（正文 / 输入框 / 消息附件）都发到这里，宿主统一渲染。 */
let current = null;
const listeners = new Set();

export function openFileContextMenu(menu) {
  current = menu && menu.path ? { ...menu, at: Date.now() } : null;
  for (const fn of listeners) { try { fn(current); } catch { /* 订阅者互不影响 */ } }
}

export function closeFileContextMenu() {
  current = null;
  for (const fn of listeners) { try { fn(current); } catch { /* 同上 */ } }
}

export function getFileContextMenu() { return current; }

export function subscribeFileContextMenu(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
