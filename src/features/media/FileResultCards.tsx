/**
 * 工具产出的**文档类**卡片（11-02）：在媒体播放卡之外，补 PDF / Word / Excel / PPT / CSV /
 * 压缩包 / 数据文件的产物卡。点卡片在右栏预览（PDF 可直接看，文本/表格可读），
 * 右侧「打开」交给系统默认应用。
 *
 * ⛔ 与 MediaResultCards 分工：媒体（视频/音频/3D）出播放卡，这里只收文档；
 *    两边共用同一段工具输出文本，不会重复出卡。
 */
import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { FileTypeIcon } from "../../components/FileTypeIcon";
import { DOCUMENT_KIND_LABELS, collectDocumentPaths } from "../../lib/document-kind.mjs";
import { resolveFilePath } from "../../lib/ui-channels";
import { openRightFile } from "../../lib/right-file.mjs";

function basenameOf(path: string): string {
  return String(path ?? "").split(/[\\/]/).pop() || String(path ?? "");
}

/** 从回复文本里挑出文件路径渲染成卡片（限条数），点开预览或打开编辑器。 */
export function FileResultCards({ text, limit = 6 }: { text: string; limit?: number }) {
  const candidates = useMemo(() => collectDocumentPaths(text, limit), [text, limit]);
  const [confirmed, setConfirmed] = useState<Array<{ path: string; kind: string; remote: boolean }>>([]);

  useEffect(() => {
    let alive = true;
    setConfirmed([]);
    void (async () => {
      const next: Array<{ path: string; kind: string; remote: boolean }> = [];
      for (const item of candidates) {
        const remote = /^https?:\/\//i.test(item.path);
        if (remote) { next.push({ ...item, remote }); continue; }
        const abs = resolveFilePath(item.path);
        try {
          const result = await window.codex.fileExists(abs);
          if (result?.exists) next.push({ ...item, path: abs, remote });
        } catch { /* 探测失败就不出卡，避免点开报错 */ }
      }
      if (alive) setConfirmed(next);
    })();
    return () => { alive = false; };
  }, [candidates]);

  if (!confirmed.length) return null;
  const preview = (path: string) => openRightFile(path);
  const openExternal = (path: string) => { void Promise.resolve(window.codex.shellOpen?.(path)).catch(() => undefined); };
  return (
    <div className="file-result-strip" aria-label="文档产物">
      {confirmed.map((item, index) => (
        <div
          key={`${item.path}-${index}`}
          className="file-result-card"
          role="button"
          tabIndex={0}
          title={item.path}
          onClick={() => (item.remote ? void window.codex.openExternal(item.path) : preview(item.path))}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            if (item.remote) void window.codex.openExternal(item.path);
            else preview(item.path);
          }}
        >
          <FileTypeIcon path={item.path} size={16} />
          <span className="file-result-main">
            <strong>{basenameOf(item.path)}</strong>
            <small>{DOCUMENT_KIND_LABELS[item.kind] ?? "文件"}{item.remote ? " · 远程" : ""}</small>
          </span>
          {!item.remote && (
            <button
              type="button"
              className="file-result-open"
              title="用系统默认应用打开"
              onClick={(event) => { event.stopPropagation(); openExternal(item.path); }}
            >
              <ExternalLink size={12} />打开
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
