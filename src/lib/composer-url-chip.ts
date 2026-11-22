/**
 * 输入框里的链接芯片（DOM 原子节点，contenteditable=false）。
 *
 * 用户 11-21（截图）：粘贴 GitHub 链接后「芯片 + 原文」重复展示 ——
 * 「直接展示上面那个不行吗」。⇒ URL 粘贴/输入后就地变成这一颗芯片，序列化回 URL，不再保留原文。
 * 主对话与群聊共用；点击走系统默认浏览器。
 */
import { extractHttpUrls, githubLinkLabel, isGithubUrl } from "./composer-links.mjs";

const GITHUB_ICON = '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';
const LINK_ICON = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/></svg>';

/** 是否「整段就是一个 HTTP(S) 链接」（粘贴时据此换成芯片）。 */
export function isSingleHttpUrl(text: string): boolean {
  const value = String(text ?? "").trim();
  const urls = extractHttpUrls(value);
  return urls.length === 1 && urls[0] === value;
}

/** 生成链接芯片：GitHub 默认显示仓库名 + 标志；`compact=false` 时显示完整 URL（群输入框用，保持光标偏移与序列化等长）。点击用默认浏览器打开。 */
export function createComposerUrlChip(url: string, compact = true): HTMLElement {
  const github = isGithubUrl(url);
  const chip = document.createElement("span");
  chip.className = `composer-url-chip-inline${github ? " is-github" : ""}`;
  chip.setAttribute("contenteditable", "false");
  chip.setAttribute("data-composer-url", url);
  chip.title = `点击在默认浏览器中打开（退格可删除）：${url}`;
  chip.innerHTML = `<span class="composer-url-chip-icon">${github ? GITHUB_ICON : LINK_ICON}</span><span class="composer-url-chip-name"></span>`;
  chip.querySelector(".composer-url-chip-name")!.textContent = compact && github ? githubLinkLabel(url) : url;
  chip.addEventListener("click", () => { try { void window.codex.openExternal(url); } catch { /* URL 不可打开 */ } });
  return chip;
}

/** 在光标处插入链接芯片（没有有效选区就追加到末尾），返回是否插入。 */
export function insertComposerUrlChip(root: HTMLElement | null, url: string, compact = true): boolean {
  if (!root) return false;
  const chip = createComposerUrlChip(url, compact);
  const selection = window.getSelection();
  let range: Range | null = null;
  if (selection?.rangeCount && root.contains(selection.anchorNode)) range = selection.getRangeAt(0);
  if (range) {
    range.deleteContents();
    range.insertNode(chip);
    range.setStartAfter(chip);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  } else {
    root.appendChild(chip);
  }
  return true;
}
