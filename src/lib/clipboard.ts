/**
 * 复制文本到剪贴板（从 src/App.tsx 原样搬来，实现未改一字）。
 *
 * 三级兜底：主进程 IPC → navigator.clipboard → execCommand。
 * 搬到 lib 的原因：中转站面板与 App 其它 6 处都要用，不能一边一份。
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (text == null) return;
  try {
    await window.codex.writeClipboard(text);
    return;
  } catch { /* IPC 不可用，走浏览器路径 */ }
  if (typeof navigator.clipboard?.writeText === "function") {
    try { await navigator.clipboard.writeText(text); return; } catch { /* 落 execCommand */ }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    if (!document.execCommand("copy")) throw new Error("execCommand('copy') 返回 false");
  } finally {
    ta.remove();
  }
}
