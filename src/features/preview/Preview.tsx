/** 图片预览 / 搜索预览 / 粘贴文本编辑（从 src/App.tsx 原样搬来，内容未改）。域公开面见 ./index.ts */
import { imageDisplaySrc } from "../../lib/image-src.mjs";
import { openImageLightbox, registerClosePastedText, notifyToast } from "../../lib/ui-channels";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { ZoomOut, ZoomIn, Copy, FolderOpen, ExternalLink, X, MessageSquare, Archive, Clock3, Zap, User, Table2 } from "lucide-react";
import { SearchPreviewTarget } from "../../components/IndexLibrary";
import { Spinner } from "../../components/CardShell";
import { resolveImagePath } from "../../lib/resolve-image-path";
import { parseMarkdownTables, renderMarkdownTables } from "../../lib/md-table.mjs";
import { MdTableView } from "./MdTableEditor";

/** 文件弹窗编辑的读写通道（09-26）：会话工作区文件走 fs:read/fs:write（可信根校验在主进程）；
 *  不传 = 粘贴文本默认通道（pasted-text:read/update，只限粘贴文本目录）。 */
export type TextEditorTransport = {
  read: (path: string) => Promise<string | null>;
  save: (path: string, content: string) => Promise<void>;
};

export function PastedTextEditor({ path, name, onClose, transport }: { path: string; name: string; onClose: () => void; transport?: TextEditorTransport }) {
  const [state, setState] = useState<{ loading: boolean; editable: boolean; content: string; error?: string }>({ loading: true, editable: false, content: "" });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const result = transport
          ? { editable: true, content: await transport.read(path) }
          : await window.codex.readPastedText(path);
        if (!alive) return;
        if (!result?.editable) { setState({ loading: false, editable: false, content: "" }); return; }
        const content = result.content ?? "";
        setState({ loading: false, editable: true, content, ...(result.content == null ? { error: "文件已不存在（可能被清理）" } : {}) });
        // 聚焦并全选不利于"接着改"，只把光标放到末尾
        requestAnimationFrame(() => { const el = boxRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
      } catch (error: any) {
        if (alive) setState({ loading: false, editable: false, content: "", error: String(error?.message ?? error) });
      }
    })();
    return () => { alive = false; };
  }, [path]);

  const save = useCallback(async (content: string, { silent = false } = {}) => {
    setSaving(true);
    try {
      if (transport) await transport.save(path, content);
      else await window.codex.updatePastedText(path, content);
      // ⛔ 已保存内容必须同步回编辑态（review 09-26）：表格视图下存的是回写后的全文
      //    （contentNow），不同步的话切回文本视图看到的是编辑前旧文，再一保存就丢表格编辑。
      //    矩阵也按新全文重建，保证后续编辑与块结构对齐。
      setState((current) => ({ ...current, content }));
      setTableEdits(parseMarkdownTables(content).blocks.map((b) => b.rows.map((r) => r.slice())));
      setDirty(false);
      setSavedAt(Date.now());
      if (!silent) showToastEverywhere("已保存修改", name);
    } catch (error: any) {
      showToastEverywhere("保存失败", String(error?.message ?? error));
    } finally {
      setSaving(false);
    }
  }, [path, name]);

  const close = useCallback(() => { onClose(); }, [onClose]);

  // ── 双视图（09-26「像 WorkBuddy 那样编辑 md」）：md 里检出 GFM 表格时提供可视化表格编辑 ──
  //   「表格」视图只编辑表格矩阵；保存/切回文本时用 renderMarkdownTables **只回写表格块、
  //   其余原文逐字保留**（纯函数有行为断言）。文本视图照旧整体编辑。
  const tableBlocks = useMemo(() => parseMarkdownTables(state.content).blocks, [state.content]);
  const [view, setView] = useState<"text" | "table">("text");
  const [tableEdits, setTableEdits] = useState<string[][][]>([]);
  const hasTables = state.editable && tableBlocks.length > 0;
  // 当前生效全文：表格视图且矩阵已初始化时 = 回写后的全文；否则就是文本框内容
  const contentNow = useMemo(() => {
    if (view !== "table" || tableEdits.length === 0) return state.content;
    try { return renderMarkdownTables(state.content, tableEdits); } catch { return state.content; }
  }, [view, tableEdits, state.content]);
  const switchView = useCallback((next: "text" | "table") => {
    if (next === "table") setTableEdits(parseMarkdownTables(state.content).blocks.map((b) => b.rows.map((r) => r.slice())));
    else if (view === "table" && tableEdits.length > 0) {
      // table → text：把表格编辑落进全文再展示（没保存就切换也不许丢编辑，review 09-26）
      setState((current) => ({ ...current, content: contentNow }));
      setTableEdits([]);
    }
    setView(next);
  }, [state.content, view, tableEdits, contentNow]);

  // 关窗前保存：把"最后一次内容"交给 save 用（表格视图下取回写后的全文）
  const closeWithSave = useCallback(async () => {
    if (state.editable && dirty) { await save(contentNow, { silent: true }); showToastEverywhere("已保存修改", name); }
    close();
  }, [state.editable, contentNow, dirty, save, close, name]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      // ⛔ Escape **不在这里处理**：本仓库有一个统一的全局 Escape 管线（App 里那份 closers 列表，
      //    见「所有 overlay 的 Esc 关闭」），本窗口已注册进去（`requestClosePastedText`）。
      //    自带一份会让两条链各关一次；而且实测"CDP 注入的按键在 textarea 聚焦时投递不可靠"，
      //    走统一管线才能稳定被触发。这里只留 Ctrl/Cmd+S（保存不关窗）。
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(contentNow); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, contentNow]);

  // 交给全局 Escape 管线调用（关窗即存）。卸载时清掉，避免关闭后仍被回调。
  useEffect(() => {
    registerClosePastedText(() => { void closeWithSave(); });
    return () => { registerClosePastedText(null); };
  }, [closeWithSave]);

  const lineCount = state.content ? state.content.split("\n").length : 0;
  return (
    <div className="pasted-text-modal" role="dialog" aria-label={name} onMouseDown={(event) => { if (event.target === event.currentTarget) void closeWithSave(); }}>
      <div className="pasted-text-panel">
        <div className="pasted-text-head">
          <span className="pasted-text-title" title={path}>{name}</span>
          <span className="pasted-text-meta">
            {state.loading ? "读取中…" : `${lineCount} 行 · ${state.content.length} 字`}
            {dirty ? " · 未保存" : savedAt ? " · 已保存" : ""}
          </span>
          {hasTables && (
            <button type="button" className="pasted-text-viewtoggle" title={view === "table" ? "切换到原始文本" : "表格可视化编辑"} onClick={() => switchView(view === "table" ? "text" : "table")}>
              <Table2 size={13} />{view === "table" ? "文本" : "表格"}
            </button>
          )}
          <button type="button" className="pasted-text-save" disabled={saving || !state.editable} onClick={() => void save(contentNow)}>
            {saving ? "保存中…" : "保存"}
          </button>
          <button type="button" className="pasted-text-close" title="关闭 (Esc)" onClick={() => void closeWithSave()}><X size={15} /></button>
        </div>
        {state.error ? <p className="pasted-text-error">{state.error}</p> : null}
        {view === "table" && hasTables ? (
          <div className="pasted-text-body pasted-text-tablebody">
            <MdTableView text={state.content} edits={tableEdits} onEditsChange={(next) => { setTableEdits(next); setDirty(true); }} />
          </div>
        ) : (
          <textarea
            ref={boxRef}
            className="pasted-text-body"
            value={state.content}
            readOnly={!state.editable}
            spellCheck={false}
            onChange={(event) => { setState((current) => ({ ...current, content: event.target.value })); setDirty(true); }}
            placeholder={state.loading ? "" : "（内容为空）"}
          />
        )}
        <p className="pasted-text-hint">
          编辑后点「保存」或直接关闭窗口（会自动保存）。Ctrl/Cmd+S 保存不关窗，Esc 关闭。
          {hasTables ? " 表格视图下只回写表格，其余内容不动。" : ""}
        </p>
      </div>
    </div>
  );
}

function showToastEverywhere(title: string, text?: string) {
  notifyToast(title, text);
}

export function ImagePreview({ path, alt, onCopy }: { path: string; alt: string; onCopy?: () => void }) {
  return <img className="message-image" src={imageDisplaySrc(path)} alt={alt} onClick={() => openImageLightbox(path, alt)} onContextMenu={(event) => { if (!onCopy) return; event.preventDefault(); onCopy(); }} />;
}

export function ImageLightbox({ path, alt, onClose, onCopy }: { path: string; alt: string; onClose: () => void; onCopy?: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; baseX: number; baseY: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const clampZoom = (value: number) => Math.min(6, Math.max(1, value));
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const endDrag = () => { dragRef.current = null; setDragging(false); };
  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-label={alt}>
      <div className="lightbox-toolbar" onClick={(event) => event.stopPropagation()}>
        <button title="缩小" onClick={() => setZoom((current) => clampZoom(current - 0.25))}><ZoomOut size={15} /></button>
        <button className="lightbox-zoom" title="点击重置" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}>{Math.round(zoom * 100)}%</button>
        <button title="放大" onClick={() => setZoom((current) => clampZoom(current + 0.25))}><ZoomIn size={15} /></button>
        {onCopy && <button title="复制图片" onClick={onCopy}><Copy size={15} /></button>}
        {(() => {
          const local = resolveImagePath(path);
          return local
            ? <button title="在文件夹中显示" onClick={() => void window.codex.shellReveal(local)}><FolderOpen size={15} /></button>
            : path.startsWith("http")
              ? <button title="在浏览器中打开" onClick={() => void window.codex.openExternal(path)}><ExternalLink size={15} /></button>
              : null;
        })()}
        <button title="关闭 (Esc)" onClick={onClose}><X size={15} /></button>
      </div>
      <div
        className={`lightbox-body${dragging ? " dragging" : ""}`}
        onClick={(event) => { if (event.target === event.currentTarget) onClose(); else event.stopPropagation(); }}
        onDoubleClick={() => { setZoom((current) => (current > 1 ? 1 : 2.5)); setOffset({ x: 0, y: 0 }); }}
        onMouseDown={(event) => { if (zoom <= 1) return; event.preventDefault(); dragRef.current = { x: event.clientX, y: event.clientY, baseX: offset.x, baseY: offset.y }; setDragging(true); }}
        onMouseMove={(event) => { const drag = dragRef.current; if (drag) setOffset({ x: drag.baseX + (event.clientX - drag.x), y: drag.baseY + (event.clientY - drag.y) }); }}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onWheel={(event) => setZoom((current) => clampZoom(current * (event.deltaY < 0 ? 1.15 : 0.87)))}
      >
        <img src={imageDisplaySrc(path)} alt={alt} draggable={false} style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }} />
      </div>
    </div>
  );
}

export function SearchPreviewModal({ target, onClose, onOpenThread, onOpenSettings, onCopyThreadId }: {
  target: SearchPreviewTarget;
  onClose: () => void;
  onOpenThread: (id: string) => void;
  onOpenSettings: (page: string) => void;
  onCopyThreadId?: (id: string) => void;
}) {
  const [loading, setLoading] = useState(target.kind === "thread");
  const [preview, setPreview] = useState<{ name: string; updatedAt: number; cwd: string; archived: boolean; messages: { role: "user" | "assistant"; text: string }[]; truncated: number; truncatedMessages: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (target.kind !== "thread") { setLoading(false); return; }
    let live = true;
    setLoading(true);
    setFailed(false);
    window.codex.previewConversation(target.id)
      .then((data) => { if (live) { setPreview(data); if (!data) setFailed(true); } })
      .catch(() => { if (live) setFailed(true); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [target]);

  const headIcon = target.kind === "thread" ? <MessageSquare size={15} /> : target.kind === "memory" ? <Archive size={15} /> : target.kind === "task" ? <Clock3 size={15} /> : <Zap size={15} />;
  const headLabel = target.kind === "thread" ? "会话全文" : target.kind === "memory" ? "记忆全文" : target.kind === "task" ? "定时任务" : "技能详情";
  let titleText = target.kind === "thread" ? target.title : target.kind === "memory" ? (target.content.split("\n")[0].trim().slice(0, 80) || "(空记忆)") : target.name;
  return (
    <div className="modal-backdrop agent-ask-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="search-preview-modal" role="dialog" aria-modal="true" aria-label={headLabel}>
        <header>
          <span className={`search-preview-kind search-preview-kind-${target.kind}`}>{headIcon}{headLabel}</span>
          <strong className="search-preview-title" title={titleText}>{titleText}</strong>
          {target.kind === "thread" && onCopyThreadId && (
            <button className="icon-button" title="复制会话 ID（粘贴到其他会话发送即可引用这条会话）" onClick={() => onCopyThreadId(target.id)}><Copy size={16} /></button>
          )}
          <button className="icon-button relay-modal-close" title="关闭" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="search-preview-body">
          {target.kind === "thread" && (loading ? (
            <div className="search-preview-loading"><Spinner />正在读取会话原档…</div>
          ) : failed || !preview ? (
            <div className="index-empty">
              <MessageSquare size={22} />
              <strong>未能读取该会话</strong>
              <p>本机没有找到该会话的 rollout 原档，点击下方「打开会话」可直接查看（会跳转到对话界面）。</p>
            </div>
          ) : (
            <>
              <p className="search-preview-meta">
                {preview.name} · {preview.messages.length} 条消息 · {preview.archived ? "已归档 · " : ""}{preview.updatedAt ? new Date(preview.updatedAt).toLocaleString("zh-CN", { hour12: false }) : ""}
              </p>
              {preview.messages.length === 0 ? (
                <div className="index-empty"><MessageSquare size={22} /><strong>这个会话还没有可见消息</strong><p>可能是刚创建、尚未对话的空会话。</p></div>
              ) : (
                <div className="search-preview-conversation">
                  {preview.messages.map((message, index) => (
                    <div className={`search-preview-msg ${message.role === "user" ? "user" : "assistant"}`} key={index}>
                      <span className="search-preview-role">{message.role === "user" ? "User" : "Assistant"}</span>
                      <div className="search-preview-text">{message.text}</div>
                    </div>
                  ))}
                </div>
              )}
              {(preview.truncatedMessages > 0 || preview.truncated > 0) && (
                <p className="search-preview-truncated">会话较长，预览已截断：{preview.truncatedMessages > 0 ? `${preview.truncatedMessages} 条消息未显示 · ` : ""}{preview.truncated > 0 ? `${preview.truncated} 条超长消息被裁剪` : ""}。要看完整内容请打开会话。</p>
              )}
            </>
          ))}
          {target.kind === "memory" && (
            <>
              <p className="search-preview-meta">{target.category || "未分类"} · {target.sourceThreadId ? `来自会话 ${target.sourceThreadId.slice(0, 8)}` : "手动保存"}</p>
              <div className="search-preview-raw">{target.content}</div>
            </>
          )}
          {target.kind === "task" && (
            <div className="search-preview-task">
              <div className="search-preview-raw">{target.prompt}</div>
              <dl>
                {target.schedule ? <div><dt>执行计划</dt><dd>{target.schedule}</dd></div> : null}
                <div><dt>状态</dt><dd>{target.enabled === false ? "已停用" : "已启用"}</dd></div>
              </dl>
            </div>
          )}
          {target.kind === "skill" && (
            <div className="search-preview-raw">{target.description || "（该技能没有附加说明，可在技能页查看详情）"}</div>
          )}
        </div>
        <footer>
          <span className="search-preview-foot-note">{target.kind === "thread" ? "只读预览 · 不影响当前对话" : ""}</span>
          <div>
            {target.kind === "thread" && <button className="primary-setting" onClick={() => { onOpenThread(target.id); }}><MessageSquare size={14} />打开会话继续</button>}
            {target.kind === "task" && <button className="primary-setting" onClick={() => { onOpenSettings("schedule"); }}><Clock3 size={14} />去自动化管理</button>}
            {target.kind === "skill" && <button className="primary-setting" onClick={() => { onOpenSettings("skills"); }}><Zap size={14} />去技能管理</button>}
          </div>
        </footer>
      </section>
    </div>
  );
}
