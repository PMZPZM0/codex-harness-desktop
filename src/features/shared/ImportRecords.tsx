/** 导入记录（从 src/App.tsx 原样搬来，内容未改）。域公开面见 ./index.ts */
import { useState } from "react";
import { Link2, FileUp, ChevronUp } from "lucide-react";
import { readPendingImportStore } from "../../lib/read-pending-import-store";
import { fmtImportNote } from "../../lib/fmt-import-note";

export function ImportedRecordCard({ note, content, pending, onDiscard, kind = "imported", sourceId, onOpenSource }: { note: string; content: string; pending?: boolean; onDiscard?: () => void; kind?: "imported" | "thread"; sourceId?: string; onOpenSource?: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const charCount = content.length;
  const threadReference = kind === "thread";
  const canOpenSource = Boolean(threadReference && sourceId && onOpenSource);
  return (
    <div className={`import-record-card${pending ? " pending" : ""}${threadReference ? " thread-reference" : ""}`}>
      <button type="button" className="import-record-head" aria-expanded={expanded} onClick={() => setExpanded((cur) => !cur)}>
        <span className="import-record-tag">{threadReference ? <Link2 size={11} /> : <FileUp size={11} />}{threadReference ? "引用的会话记录" : pending ? "导入的会话记录（待发送）" : "导入的会话记录"}</span>
        <span className="import-record-note">{note}</span>
        <span className="import-record-actions">
          {canOpenSource && (
            <span
              role="button"
              tabIndex={0}
              className="import-record-open"
              title="打开源会话"
              onClick={(event) => { event.stopPropagation(); onOpenSource?.(sourceId!); }}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onOpenSource?.(sourceId!); } }}
            >打开源会话</span>
          )}
          {pending && onDiscard && (
            <span
              role="button"
              tabIndex={0}
              className="import-record-discard"
              title="放弃导入（不会影响其他会话）"
              onClick={(event) => { event.stopPropagation(); onDiscard(); }}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onDiscard(); } }}
            >移除</span>
          )}
          <span className="import-record-toggle">{expanded ? "收起" : `展开全文 · ${charCount > 999 ? `${(charCount / 1000).toFixed(1)}k` : charCount} 字`}<ChevronUp size={12} className={expanded ? "" : "flip-down"} /></span>
        </span>
      </button>
      {expanded && <div className="import-record-body"><pre>{content}</pre></div>}
      {pending && !expanded && <div className="import-record-hint">还没发送：直接输入问题并发送，这条记录会随你的第一条消息一起交给 AI；可先展开检查内容。</div>}
    </div>
  );
}

export function PendingImportSlot({ threadId, onDiscard }: { threadId: string; onDiscard: () => void }) {
  const [payload] = useState<PendingImportPayload | null>(() => readPendingImportStore()[threadId] ?? null);
  if (!payload) return null;
  return (
    <div className="import-preview-slot">
      <ImportedRecordCard note={fmtImportNote(payload)} content={payload.text} pending onDiscard={onDiscard} />
    </div>
  );
}
