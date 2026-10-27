/**
 * 右栏「工作区文件」预览（10-22，Qoder 式文件卡联动的落点）。
 *
 * 只读预览：文档排版 / 代码高亮 / 图片 / PDF；二进制给占位并引导「默认应用」。
 * ⛔ 读文件走 `window.codex.readFile`（同一道可信根闸）；⛔ 不在这里做写入/编辑（编辑仍走居中编辑器）。
 */
import { useEffect, useState } from "react";
import { ExternalLink, FileText, FolderOpen, RotateCcw, ChevronsUp, ChevronsDown } from "lucide-react";
import { FileTypeIcon, fileExtOf } from "../../../components/FileTypeIcon";
import { Spinner } from "../../../components/CardShell";
import { Markdown, FilePreviewCode } from "../../markdown";
import { BINARY_EXTENSIONS, IMAGE_EXTENSIONS, decodeText } from "../../../hooks/useFilePreview";
import { toFileUrl } from "../../../lib/file-url.mjs";

type PreviewState = {
  status: "idle" | "loading" | "ok" | "error";
  kind: "text" | "image" | "pdf" | "binary";
  content: string;
  language: string;
  truncated?: boolean;
  error?: string;
};

const IDLE: PreviewState = { status: "idle", kind: "text", content: "", language: "text" };

/* ⛔⛔ 10-27 用户实测：「右侧栏的文件，预览一点，界面就卡卡」——
   右栏是**窄栏**（默认 420px、半屏高度），在这里把整篇文件高亮 + 加行号是纯亏：
   boss-groups.json 这种几万字符的文件一进面板就是上万个 span，滚动/重排全卡。
   ⇒ 三条同时收：① 只预览前 60K 字符（要全文就去「在编辑器打开」，那是整屏的活）；
                ② 超 12K 字符不做语法高亮（纯文本渲染，外观同源、只少 token 上色）；
                ③ 截断时明说"只展示了前面一部分"。 */
const PREVIEW_MAX_CHARS = 60_000;
const PREVIEW_PLAIN_CHARS = 12_000;

function looksBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 4096);
  for (let i = 0; i < limit; i += 1) if (bytes[i] === 0) return true;
  return false;
}

function nameOf(path: string): string {
  return String(path || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}

export function WorkspaceFilePreview({ path, onOpenEditor, expanded, onToggleExpanded }: { path: string; onOpenEditor: (path: string) => void; expanded?: boolean; onToggleExpanded?: () => void }) {
  const [state, setState] = useState<PreviewState>(IDLE);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!path) { setState(IDLE); return; }
    const ext = fileExtOf(path);
    if (IMAGE_EXTENSIONS.has(ext)) { setState({ status: "ok", kind: "image", content: "", language: ext }); return; }
    if (ext === "pdf") { setState({ status: "ok", kind: "pdf", content: "", language: "pdf" }); return; }
    if (BINARY_EXTENSIONS.has(ext)) { setState({ status: "ok", kind: "binary", content: "", language: ext }); return; }
    let cancelled = false;
    setState({ status: "loading", kind: "text", content: "", language: ext || "text" });
    void (async () => {
      try {
        const result = await window.codex.readFile(path);
        const binary = atob(result.dataBase64 ?? "");
        const bytes = Uint8Array.from(binary, (value) => value.charCodeAt(0));
        if (cancelled) return;
        if (looksBinary(bytes)) {
          setState({ status: "ok", kind: "binary", content: "", language: ext });
          return;
        }
        const raw = decodeText(bytes);
        const content = raw.slice(0, PREVIEW_MAX_CHARS);
        setState({ status: "ok", kind: "text", content, language: ext || "text", truncated: raw.length > PREVIEW_MAX_CHARS });
      } catch (error: any) {
        if (cancelled) return;
        const message = String(error?.message ?? error).replace(/^Error invoking remote method '[^']+':\s*/i, "");
        setState({ status: "error", kind: "text", content: "", language: ext, error: message });
      }
    })();
    return () => { cancelled = true; };
  }, [path, retry]);

  const name = path ? nameOf(path) : "";
  const ext = path ? fileExtOf(path) : "";
  return (
    <div className="workspace-file-preview" data-testid="workspace-file-preview">
      <div className="workspace-file-preview-head">
        <FileTypeIcon path={path} size={15} />
        <strong title={path}>{name || "文件预览"}</strong>
        {ext && <span className="workspace-file-preview-ext">{ext.toUpperCase()}</span>}
        <div className="workspace-file-preview-actions">
          {onToggleExpanded && (
            <button
              type="button"
              className="workspace-file-preview-expand"
              title={expanded ? "恢复文件树（预览收回下方，Alt+↓）" : "预览向上展开（收起文件树，Alt+↑）"}
              onClick={onToggleExpanded}
            >
              {expanded ? <ChevronsDown size={12} /> : <ChevronsUp size={12} />}{expanded ? "恢复" : "展开"}
            </button>
          )}
          <button type="button" title="在编辑器打开" disabled={!path} onClick={() => path && onOpenEditor(path)}>在编辑器打开</button>
          <button type="button" title="用系统默认应用打开" disabled={!path} onClick={() => { if (path) void window.codex.shellOpen?.(path); }}>
            <ExternalLink size={12} />默认应用
          </button>
          <button type="button" title="在文件管理器中显示" disabled={!path} onClick={() => { if (path) void window.codex.revealInFolder?.(path); }}>
            <FolderOpen size={12} />定位
          </button>
        </div>
      </div>
      {path && <div className="workspace-file-preview-path" title={path}>{path}</div>}
      <div className="workspace-file-preview-body">
        {state.status === "idle" ? (
          <div className="workspace-file-preview-empty">
            <FileText size={26} />
            <strong>在这里预览文件</strong>
            <span>点上面的文件，或点对话里的文件卡；也可以在下面的项目树里选一个。</span>
          </div>
        ) : state.status === "loading" ? (
          <div className="workspace-file-preview-loading"><Spinner />读取中…</div>
        ) : state.status === "error" ? (
          <div className="workspace-file-preview-empty">
            <strong>无法预览这个文件</strong>
            <span>{state.error || "文件可能已被删除或移动。"}</span>
            <button type="button" onClick={() => setRetry((n) => n + 1)}><RotateCcw size={12} />重试</button>
          </div>
        ) : state.kind === "image" ? (
          <img className="workspace-file-preview-image" src={toFileUrl(path)} alt={name} />
        ) : state.kind === "pdf" ? (
          <iframe className="workspace-file-preview-pdf" src={toFileUrl(path)} title={name} />
        ) : state.kind === "binary" ? (
          <div className="workspace-file-preview-empty">
            <strong>这个格式不能内嵌预览</strong>
            <span>用系统默认应用打开它，或在上面的项目树里换一个文本 / 图片 / PDF 文件。</span>
            <button type="button" onClick={() => void window.codex.shellOpen?.(path)}><ExternalLink size={12} />默认应用打开</button>
          </div>
        ) : /^mdx?$|^markdown$/i.test(state.language) ? (
          <div className="workspace-file-preview-markdown markdown"><Markdown>{state.content}</Markdown></div>
        ) : (
          <FilePreviewCode
            language={state.language}
            content={state.content}
            truncated={state.truncated}
            hint={`右栏只预览前 ${Math.round(PREVIEW_MAX_CHARS / 1000)}K 字符，完整内容请用「在编辑器打开」`}
            plain={state.content.length > PREVIEW_PLAIN_CHARS}
          />
        )}
      </div>
    </div>
  );
}
