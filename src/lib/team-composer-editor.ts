/**
 * 群输入框的行内提及编辑器（11-08 用户：「加上头像」「输入框里面自动变成图二这种」）。
 *
 * 为什么不用 textarea + 覆盖层：头像会给 chip 加宽，覆盖层与 textarea 的字形/光标就会错位。
 * 这里改成和主对话同一个模型 —— `contenteditable` + 真 chip 节点：
 *   · chip 是 `contenteditable=false` 的原子节点（头像 + `@名字`），光标只能落在它两侧；
 *   · 序列化回纯文本时 chip → `@名字`（值模型与 `mentionTargetsInText` 完全同源）；
 *   · 外部改值（发送清空 / 面板插人）通过 `renderEditor` 重建，光标由调用方指定。
 * ⛔ 纯 DOM 工具，不依赖 React；头像样式由调用方给（避免在这里复制头像判定）。
 */

const CHIP_CLASS = "team-composer__at-chip";
const AVATAR_CLASS = "team-composer__at-avatar";

/** 名字 → 头像样式（view 侧用现有头像纯函数算好，⛔ 这里不重复头像判定）。 */
export type MentionAvatar = {
  imgSrc?: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  initial?: string;
};

/** 命令面（父层调用）：聚焦 / 插人 / 外部改值并落光标。 */
export type TeamEditorApi = {
  focus: () => void;
  insertMention: (name: string) => void;
  setTextAndCaret: (text: string, caret: number) => void;
};

function buildChip(name: string, avatar?: MentionAvatar): HTMLElement {
  const chip = document.createElement("span");
  chip.className = CHIP_CLASS;
  chip.setAttribute("contenteditable", "false");
  chip.setAttribute("data-mention", name);
  const face = document.createElement("span");
  face.className = AVATAR_CLASS;
  face.setAttribute("aria-hidden", "true");
  if (avatar?.imgSrc) {
    const img = document.createElement("img");
    img.src = avatar.imgSrc;
    img.alt = "";
    face.appendChild(img);
  } else if (avatar?.backgroundImage) {
    face.style.backgroundImage = avatar.backgroundImage;
    face.style.backgroundSize = avatar.backgroundSize ?? "300% 300%";
    face.style.backgroundPosition = avatar.backgroundPosition ?? "0% 0%";
  } else {
    face.textContent = String(avatar?.initial ?? name).slice(0, 1);
  }
  chip.appendChild(face);
  chip.appendChild(document.createTextNode(`@${name}`));
  return chip;
}

/** 正文（纯文本，`@名字` 为提及）→ DOM（文本 + chip）。 */
export function renderEditor(
  root: HTMLElement,
  value: string,
  names: string[],
  avatars: Record<string, MentionAvatar> = {},
  segments?: Array<{ text: string; mention?: boolean }>,
): void {
  root.textContent = "";
  const list = segments ?? [{ text: String(value ?? "") }];
  for (const seg of list) {
    if (seg.mention) {
      const name = seg.text.replace(/^@/, "");
      root.appendChild(buildChip(name, avatars[name]));
      continue;
    }
    seg.text.split("\n").forEach((line, index) => {
      if (index > 0) root.appendChild(document.createElement("br"));
      if (line) root.appendChild(document.createTextNode(line));
    });
  }
  /* ⛔ 末尾补一个零宽字符：否则最后一个节点是 chip 时光标没法落到它后面。 */
  root.appendChild(document.createTextNode("\u200b"));
}

/** DOM → 纯文本（chip → `@名字`，br/div → 换行）。 */
export function editorValue(root: HTMLElement): string {
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent ?? "").replace(/\u200b/g, "");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const mention = el.getAttribute?.("data-mention");
    if (mention) { out += `@${mention}`; return; }
    if (el.tagName === "BR") { out += "\n"; return; }
    for (const child of Array.from(el.childNodes)) walk(child);
    /* ⛔ 11-08 审查确认：浏览器回车产生的空行是 `<div><br></div>`，BR 已经贡献了一个换行，
       DIV 再补一个 ⇒ 空行翻倍、连续回车越打越长。末子是 BR 时不再补。 */
    if (el.tagName === "DIV" || el.tagName === "P") {
      const last = el.lastChild;
      const lastIsBr = Boolean(last && last.nodeType === Node.ELEMENT_NODE && (last as HTMLElement).tagName === "BR");
      if (!lastIsBr) out += "\n";
    }
  };
  for (const child of Array.from(root.childNodes)) walk(child);
  return out.replace(/\n$/, "");
}

/** 光标 → 纯文本偏移（chip 按 `@名字` 的长度计）。 */
export function editorCaret(root: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return editorValue(root).length;
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(root);
  try { range.setEnd(selection.getRangeAt(0).endContainer, selection.getRangeAt(0).endOffset); } catch { return editorValue(root).length; }
  return range.toString().replace(/\u200b/g, "").length;
}

/** 把光标落到纯文本偏移处。 */
export function setEditorCaret(root: HTMLElement, offset: number): void {
  let remaining = Math.max(0, offset);
  let node: Node | null = null;
  let nodeOffset = 0;
  const walk = (current: Node): boolean => {
    if (current.nodeType === Node.TEXT_NODE) {
      const text = (current.textContent ?? "").replace(/\u200b/g, "");
      if (remaining <= text.length) { node = current; nodeOffset = remaining; return true; }
      remaining -= text.length;
      return false;
    }
    if (current.nodeType !== Node.ELEMENT_NODE) return false;
    const el = current as HTMLElement;
    if (el.getAttribute?.("data-mention")) {
      const len = `@${el.getAttribute("data-mention")}`.length;
      if (remaining <= len) { node = el.parentNode; nodeOffset = Array.from(el.parentNode?.childNodes ?? []).indexOf(el) + 1; return true; }
      remaining -= len;
      return false;
    }
    for (const child of Array.from(current.childNodes)) if (walk(child)) return true;
    return false;
  };
  for (const child of Array.from(root.childNodes)) if (walk(child)) break;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  if (node) {
    try { range.setStart(node, nodeOffset); } catch { range.selectNodeContents(root); range.collapse(false); }
  } else {
    range.selectNodeContents(root);
    range.collapse(false);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** 在光标处插入一个提及 chip（带头像），返回新文本与光标偏移。 */
export function insertMentionAtCaret(root: HTMLElement, name: string, avatar?: MentionAvatar): { text: string; caret: number } {
  const before = editorValue(root);
  const caret = editorCaret(root);
  const beforeText = before.slice(0, caret);
  const afterText = before.slice(caret);
  const lead = beforeText && !/\s$/.test(beforeText) ? " " : "";
  const nextText = `${beforeText}${lead}@${name} ${afterText}`;
  return { text: nextText, caret: beforeText.length + lead.length + name.length + 2 };
}
