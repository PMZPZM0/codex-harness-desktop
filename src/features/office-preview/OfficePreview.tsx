/**
 * 右栏 Office 内嵌预览（11-02）：docx 段落 / xlsx 表格 / pptx 分页文本。
 * ⛔ 不是像素级还原：只把内容读出来，版式交给「默认应用」。
 */
import { FileText, Presentation, Table2 } from "lucide-react";
import type { OfficePreviewData } from "../../lib/office-preview.mjs";

export function OfficePreview({ data }: { data: OfficePreviewData }) {
  if (data.kind === "doc") {
    return (
      <div className="office-preview office-doc">
        <div className="office-preview-head"><FileText size={13} />文档 · {data.paragraphs.length} 段</div>
        <div className="office-doc-body">
          {data.paragraphs.map((text, i) => <p key={i}>{text}</p>)}
        </div>
        {data.truncated ? <p className="office-preview-note">内容较长，只展示前面一部分；完整版式请用默认应用打开。</p> : null}
      </div>
    );
  }
  if (data.kind === "sheet") {
    const [head, ...body] = data.rows;
    const cols = Math.max(1, data.cols);
    return (
      <div className="office-preview office-sheet">
        <div className="office-preview-head"><Table2 size={13} />{data.sheetName} · {data.rows.length} 行</div>
        <div className="office-sheet-scroll">
          <table>
            <thead><tr>{Array.from({ length: cols }, (_, i) => <th key={i}>{head?.[i] ?? ""}</th>)}</tr></thead>
            <tbody>{body.map((row, r) => <tr key={r}>{Array.from({ length: cols }, (_, c) => <td key={c}>{row[c] ?? ""}</td>)}</tr>)}</tbody>
          </table>
        </div>
        {data.truncated ? <p className="office-preview-note">只展示第一张工作表的前 300 行 / 40 列。</p> : null}
      </div>
    );
  }
  return (
    <div className="office-preview office-slides">
      <div className="office-preview-head"><Presentation size={13} />演示文稿 · {data.slides.length} 页</div>
      <div className="office-slides-list">
        {data.slides.map((slide, i) => (
          <article className="office-slide" key={slide.name}>
            <span className="office-slide-no">{i + 1}</span>
            <div>
              <strong>{slide.title || "（本页无标题）"}</strong>
              {slide.lines.length ? <ul>{slide.lines.map((line, j) => <li key={j}>{line}</li>)}</ul> : null}
            </div>
          </article>
        ))}
      </div>
      {data.truncated ? <p className="office-preview-note">最多展示前 50 页。</p> : null}
    </div>
  );
}
