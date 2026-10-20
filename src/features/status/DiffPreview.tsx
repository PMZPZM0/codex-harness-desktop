/**
 * diff 预览正文（10-06 夜二改，用户对照 Qoder：「他这种预览后，我鼠标放上去，还可以左右滚动
 * 和上下滚动，我们现在的 diff 预览好丑」）：
 *   · 双行号槽（旧侧 / 新侧）+ 增删符号 + 彩色行底 —— 取代原来裸的 diff 文本块；
 *   · `overflow: auto` 两轴滚动（行 `white-space: pre` 不折行 ⇒ 长行天然出横向滚动条）；
 *   · 行号/配色只做外观，数据来自纯函数 parseDiffLines（src/lib/diff-view.mjs）。
 * 悬停弹层与审查弹窗都用它（一份实现，别复制第二份）。
 *
 * 10-18 对照 Qoder 审阅页补三档显示开关（行号/配色不动）：
 *   · view="split" 双栏（单边新增/删除自动退回统一视图）；
 *   · wrap 自动换行；
 *   · ignoreWhitespaceOnly 隐藏只改空白的增删对。
 */
import { memo, useMemo } from "react";
import { buildSplitDiffRows, filterWhitespaceOnlyRows, isSingleSidedDiff, parseDiffLines } from "../../lib/diff-view.mjs";
import { useCodeSettings, codeFontSize } from "../../lib/code-settings";
import { codeFontStack } from "../../lib/code-themes";

export const DiffPreviewBody = memo(function DiffPreviewBody({
  text,
  maxHeight,
  className,
  view = "unified",
  wrap = false,
  ignoreWhitespaceOnly = false,
}: {
  text: string;
  maxHeight: number;
  className?: string;
  view?: "unified" | "split";
  wrap?: boolean;
  ignoreWhitespaceOnly?: boolean;
}) {
  const settings = useCodeSettings();
  const rows = useMemo(() => {
    const parsed = parseDiffLines(text);
    return ignoreWhitespaceOnly ? filterWhitespaceOnlyRows(parsed) : parsed;
  }, [text, ignoreWhitespaceOnly]);
  const split = view === "split" && !isSingleSidedDiff(rows);
  const splitRows = useMemo(() => (split ? buildSplitDiffRows(rows) : []), [split, rows]);
  const classes = `diffp ${split ? "diffp-split" : ""} ${wrap ? "is-wrap" : ""} ${className ?? ""}`.replace(/\s+/g, " ").trim();
  const style = { maxHeight, fontSize: codeFontSize(settings.fontScale), fontFamily: codeFontStack(settings.font) };
  if (split) {
    return (
      <div className={classes} style={style} data-diff-rows={rows.length} data-diff-view="split">
        <div className="diffp-inner">
          {splitRows.map((row, index) => {
            if (row.kind !== "pair") {
              return <div key={index} className={`diffp-line ${row.kind}`}><code>{row.text || " "}</code></div>;
            }
            const leftKind = row.left?.kind ?? "empty";
            const rightKind = row.right?.kind ?? "empty";
            return (
              <div key={index} className="diffp-split-row">
                <span className={`diffp-split-cell ${leftKind}`}>
                  <span className="diffp-no">{row.left?.oldNo ?? ""}</span>
                  <span className="diffp-sign" aria-hidden>{leftKind === "del" ? "-" : ""}</span>
                  <code>{row.left?.text || " "}</code>
                </span>
                <span className={`diffp-split-cell ${rightKind}`}>
                  <span className="diffp-no">{row.right?.newNo ?? ""}</span>
                  <span className="diffp-sign" aria-hidden>{rightKind === "add" ? "+" : ""}</span>
                  <code>{row.right?.text || " "}</code>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  return (
    <div className={classes} style={style} data-diff-rows={rows.length} data-diff-view="unified">
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
