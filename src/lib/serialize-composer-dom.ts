/** serializeComposerDom（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { attachmentToken } from "./composer-attachments.mjs";

export function serializeComposerDom(root: HTMLElement): string {
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { out += node.textContent ?? ""; return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    // ⛔ 附件 chip 的往返：图片 → [图片:path]、文件 → [文件:path]（属性是统一的
    //    data-attach-kind / data-attach-path，见 createInlineAttachmentChip）
    const kind = el.getAttribute("data-attach-kind");
    const attachPath = el.getAttribute("data-attach-path");
    if (kind && attachPath != null) {
      out += attachmentToken(kind === "file" ? "file" : "image", attachPath);
      return;
    }
    if (el.tagName === "BR") { out += "\n"; return; }
    for (const child of Array.from(el.childNodes)) walk(child);
    if (el.tagName === "DIV" || el.tagName === "P") out += "\n";
  };
  for (const child of Array.from(root.childNodes)) walk(child);
  return out.replace(/\n$/, "");
}
