/** rebuildComposerDom（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { splitAttachmentSegments } from "./composer-attachments.mjs";

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
