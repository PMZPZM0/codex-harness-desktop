/**
 * MdTableEditor —— md 表格的可视化编辑视图（09-26「像 WorkBuddy 那样编辑 md」）。
 *
 * 定位：PastedTextEditor 弹窗的「表格」视图。解析/回写全部走 `src/lib/md-table.mjs`
 * 纯函数（有行为断言），本组件只管编辑交互——**保证「只动表格块，其余原文逐字保留」**。
 */
import { parseMarkdownTables } from "../../lib/md-table.mjs";
import { X, Plus } from "lucide-react";

/** 单个表格块的编辑矩阵视图。行/列可增删，单元格受控 input。 */
function BlockTable({ rows, onChange }: { rows: string[][]; onChange: (next: string[][]) => void }) {
  const colCount = Math.max(...rows.map((r) => r.length), 1);
  const setCell = (r: number, c: number, value: string) => {
    const next = rows.map((row) => row.slice());
    while (next[r].length < colCount) next[r].push("");
    next[r][c] = value;
    onChange(next);
  };
  const addRow = () => onChange([...rows, new Array(colCount).fill("")]);
  const removeRow = (r: number) => { if (rows.length > 1) onChange(rows.filter((_, index) => index !== r)); };
  const addCol = () => onChange(rows.map((row) => { const next = row.slice(); while (next.length < colCount) next.push(""); next.push(""); return next; }));
  const removeCol = (c: number) => { if (colCount > 1) onChange(rows.map((row) => { const next = row.slice(); while (next.length < colCount) next.push(""); next.splice(c, 1); return next; })); };
  return (
    <div className="md-edit-table-wrap">
      <table className="md-edit-table">
        <thead>
          <tr>
            {Array.from({ length: colCount }, (_, c) => (
              <th key={c}>
                <div className="md-edit-cell-head">
                  <input value={rows[0]?.[c] ?? ""} onChange={(event) => setCell(0, c, event.target.value)} placeholder="表头" />
                  {colCount > 1 && (
                    <button type="button" className="md-edit-col-del" title="删除此列" onClick={() => removeCol(c)}><X size={11} /></button>
                  )}
                </div>
              </th>
            ))}
            <th className="md-edit-op-col" aria-label="操作列" />
          </tr>
        </thead>
        <tbody>
          {rows.slice(1).map((row, r) => (
            <tr key={r + 1}>
              {Array.from({ length: colCount }, (_, c) => (
                <td key={c}>
                  <input value={row?.[c] ?? ""} onChange={(event) => setCell(r + 1, c, event.target.value)} />
                </td>
              ))}
              <td className="md-edit-op-col">
                <button type="button" className="md-edit-row-del" title="删除此行" onClick={() => removeRow(r + 1)}><X size={11} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="md-edit-block-actions">
        <button type="button" onClick={addRow}><Plus size={12} />加一行</button>
        <button type="button" onClick={addCol}><Plus size={12} />加一列</button>
      </div>
    </div>
  );
}

/**
 * 文本的表格视图：text 是弹窗当前内容；edits 与 parse(text).blocks 一一对应（由父组件初始化）。
 * 没有任何表格块时父组件不会切到本视图。
 */
export function MdTableView({ text, edits, onEditsChange }: { text: string; edits: string[][][]; onEditsChange: (next: string[][][]) => void }) {
  const { blocks } = parseMarkdownTables(text);
  if (blocks.length === 0) return <p className="md-edit-empty">没有识别到 md 表格（需要「| --- |」分隔行的 GFM 表格）。</p>;
  return (
    <div className="md-edit-blocks">
      {blocks.map((block, b) => {
        const rows = edits[b] ?? block.rows;
        return (
          <div className="md-edit-block" key={b}>
            {blocks.length > 1 && <p className="md-edit-block-label">表格 {b + 1} / {blocks.length}</p>}
            <BlockTable
              rows={rows}
              onChange={(next) => { const copy = edits.map((m) => m.map((r) => r.slice())); copy[b] = next; onEditsChange(copy); }}
            />
          </div>
        );
      })}
    </div>
  );
}
