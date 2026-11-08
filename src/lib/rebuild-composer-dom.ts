/** rebuildComposerDom（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { splitAttachmentSegments } from "./composer-attachments.mjs";

/** 按输入值重建输入框 DOM：纯文本按行断行、附件段生成 chip（粘贴/回填后结构与手输一致）。 */
export function rebuildComposerDom(root: HTMLElement, value: string, makeChip: (kind: "image" | "file", path: string) => HTMLElement) {
  root.textContent = "";
  for (const seg of splitAttachmentSegments(value)) {
    if (seg.kind !== "text") { root.appendChild(makeChip(seg.kind, seg.path)); continue; }
    seg.text.split("\n").forEach((line, index) => {
      if (index > 0) root.appendChild(document.createElement("br"));
      if (line) root.appendChild(document.createTextNode(line));
    });
  }
}
