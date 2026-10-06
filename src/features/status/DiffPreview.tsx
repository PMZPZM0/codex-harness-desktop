/**
 * diff 预览正文（10-06 夜二改，用户对照 Qoder：「他这种预览后，我鼠标放上去，还可以左右滚动
 * 和上下滚动，我们现在的 diff 预览好丑」）：
 *   · 双行号槽（旧侧 / 新侧）+ 增删符号 + 彩色行底 —— 取代原来裸的 diff 文本块；
 *   · `overflow: auto` 两轴滚动（行 `white-space: pre` 不折行 ⇒ 长行天然出横向滚动条）；
 *   · 行号/配色只做外观，数据来自纯函数 parseDiffLines（src/lib/diff-view.mjs）。
 * 悬停弹层与审查弹窗都用它（一份实现，别复制第二份）。
 */
import { memo, useMemo } from "react";
import { parseDiffLines } from "../../lib/diff-view.mjs";
import { useCodeSettings, codeFontSize } from "../../lib/code-settings";
import { codeFontStack } from "../../lib/code-themes";

export const DiffPreviewBody = memo(function DiffPreviewBody({ text, maxHeight, className }: { text: string; maxHeight: number; className?: string }) {
  const settings = useCodeSettings();
  const rows = useMemo(() => parseDiffLines(text), [text]);
  return (
    <div
      className={`diffp ${className ?? ""}`.trim()}
      style={{ maxHeight, fontSize: codeFontSize(settings.fontScale), fontFamily: codeFontStack(settings.font) }}
      data-diff-rows={rows.length}
    >
      <div className="diffp-inner">
        {rows.map((row, index) => (
          <div key={index} className={`diffp-line ${row.kind}`}>
            <span className="diffp-no">{row.oldNo ?? ""}</span>
            <span className="diffp-no">{row.newNo ?? ""}</span>
            <span className="diffp-sign" aria-hidden>{row.kind === "add" ? "+" : row.kind === "del" ? "-" : ""}</span>
            <code>{row.text || " "}</code>
          </div>
        ))}
      </div>
    </div>
  );
});
