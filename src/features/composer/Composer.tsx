/** 输入区（composer）（从 src/App.tsx 原样搬来，内容未改）。域公开面见 ./index.ts */
import { useLayoutEffect, useState, useRef, useEffect, useMemo } from "react";
import type { KeyboardEvent } from "react";
import { promptImagePaths } from "../../lib/prompt-images";
import { promptFilePaths, shouldSavePastedTextAsFile } from "../../lib/composer-attachments.mjs";
import { ChevronDown, Eye, Video, CircleCheck, Search, Image, FileCode2 } from "lucide-react";
import { rebuildComposerDom } from "../../lib/rebuild-composer-dom";
import { serializeComposerDom } from "../../lib/serialize-composer-dom";
import { basename } from "../../lib/basename";
import { isImagePath } from "../../lib/is-image-path";
import { isMacPlatform } from "../../lib/is-mac-platform";

export function ThreadFilePicker({ query, onQuery, candidates, onPick, onClose }: { query: string; onQuery: (value: string) => void; candidates: { path: string; source: string }[]; onPick: (path: string) => void; onClose: () => void }) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const seen = new Set<string>();
    return candidates.filter((entry) => {
      if (seen.has(entry.path)) return false;
      seen.add(entry.path);
      return !q || entry.path.toLowerCase().includes(q) || basename(entry.path).toLowerCase().includes(q);
    }).slice(0, 30);
  }, [candidates, query]);
  return (
    <>
      <div className="submenu-search"><Search size={13} /><input autoFocus value={query} onChange={(event) => onQuery(event.target.value)} placeholder="搜索对话中的文件" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }} /></div>
      <div className="submenu-list">
        {filtered.map((entry) => (
          <button type="button" key={entry.path} title={entry.path} onClick={() => onPick(entry.path)}>
            {isImagePath(entry.path) ? <Image size={14} /> : <FileCode2 size={14} />}
            <span className="thread-file-name">{basename(entry.path)}</span>
            <small>{entry.source}</small>
          </button>
        ))}
        {!filtered.length && <p className="submenu-empty">{query.trim() ? "没有匹配的文件" : "当前会话还没有出现过文件"}</p>}
      </div>
    </>
  );
}

export function ComposerEditor({ value, placeholder, editorRef, domValueRef, makeChip, onValueInput, onKeyDown, onBlur, onPasteImage, onPasteFiles, onPasteLongText }: {
  value: string;
  placeholder: string;
  editorRef: { current: HTMLDivElement | null };
  domValueRef: { current: string | null };
  makeChip: (kind: "image" | "file", path: string) => HTMLElement;
  onValueInput: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onBlur: () => void;
  onPasteImage: (text: string) => void;
  onPasteFiles: (paths: string[]) => void;
  /** 长文本粘贴：落盘成 .txt 再作为文件 chip 插入（阈值见 shouldSavePastedTextAsFile） */
  onPasteLongText: (text: string) => void;
}) {
  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el || domValueRef.current === value) return;
    rebuildComposerDom(el, value, makeChip);
    domValueRef.current = value;
    // 重建后光标放回末尾（外部置值场景：斜杠命令追加、发送清空等）
    const selection = window.getSelection();
    if (selection && document.activeElement === el) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }, [value, editorRef, domValueRef, makeChip]);
  return (
    <div
      ref={editorRef}
      className="composer-editor"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={placeholder}
      data-placeholder={placeholder}
      onInput={(event) => {
        const el = event.currentTarget;
        let next = serializeComposerDom(el);
        // 全删后可能残留孤立 <br>：清成真正 empty，让 :empty 占位符与发送守卫都成立
        // （图片与文件 chip 都算"有草稿"，两类都要看）
        if (!next.trim() && !promptImagePaths(next).length && !promptFilePaths(next).length) { el.innerHTML = ""; next = ""; }
        domValueRef.current = next;
        onValueInput(next);
      }}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onPaste={(event) => {
        const pasted = [...event.clipboardData.files];
        const imageFile = pasted.find((file) => file.type.startsWith("image/"));
        // 从系统复制的非图片文件（PDF/代码/文档等）：作为附件加入输入框。
        // Electron 渲染层 File 对象带 path（原生扩展），可直接作为附件路径。
        const filePaths = pasted
          .filter((file) => !file.type.startsWith("image/"))
          .map((file) => (file as File & { path?: string }).path)
          .filter((p): p is string => typeof p === "string" && p.length > 0);
        // Windows 上从资源管理器复制文件时 clipboardData.files 常为空（系统剪贴板是
        // CF_HDROP，浏览器不转成 File 列表）——可靠通道是 text/uri-list（file:/// 列表）。
        const uriList = event.clipboardData.getData("text/uri-list");
        const uriPaths: string[] = [];
        if (uriList) {
          for (const raw of uriList.split(/\r?\n/)) {
            const line = raw.trim();
            if (!line) continue;
            try {
              const url = new URL(line);
              if (url.protocol === "file:") {
                // ⛔ 原写法把分隔符**一律**转成反斜杠（Windows 假设）⇒ mac/Linux 上会得到
                //    `\Users\…` 这种不存在的路径（剪贴板粘贴文件直接失效）。
                //    Windows: file:///C:/foo bar.txt → C:\foo bar.txt
                //    mac/Linux: file:///Users/foo.txt → /Users/foo.txt（保持正斜杠）
                const decoded = decodeURIComponent(line.slice("file://".length));
                uriPaths.push(isMacPlatform() ? decoded : decoded.replace(/\//g, "\\").replace(/^\\/, ""));
              }
            } catch { /* 非 URL 行（如注释）跳过 */ }
          }
        }
        const allFilePaths = [...new Set([...filePaths, ...uriPaths])];
        if (allFilePaths.length) {
          event.preventDefault();
          onPasteFiles(allFilePaths);
        } else if (imageFile) {
          event.preventDefault();
          onPasteImage(event.clipboardData.getData("text/plain"));
        } else {
          // 渲染层 files/uri-list 都拿不到：剪贴板可能是文件（Windows CF_HDROP 渲染层不暴露）
          // 也可能是纯文本。先阻止原生，主进程 clipboard.read() 兜底判断文件；
          // 若确认无文件再手动插入纯文本（保持光标位置），保证纯文本粘贴不失效。
          event.preventDefault();
          const plain = event.clipboardData.getData("text/plain");
          void window.codex.readClipboardFiles().then((paths) => {
            if (paths.length) { onPasteFiles(paths); return; }
            // 长文本：落盘成 .txt 并显示为文件 chip（09-18 用户：「复制的内容超过 200 字的时候
            // 把文本直接显示成一个 .txt 文件的方式」）。判据是纯函数，见 composer-attachments.mjs。
            if (shouldSavePastedTextAsFile(plain)) { onPasteLongText(plain); return; }
            if (plain) {
              try { document.execCommand("insertText", false, plain); } catch { /* ignore */ }
              const el = editorRef.current;
              if (el) {
                const next = serializeComposerDom(el);
                if (next !== domValueRef.current) {
                  domValueRef.current = next;
                  onValueInput(next);
                }
              }
            }
          });
        }
      }}
    />
  );
}

export type ComposerMenuOption = { value: string; title: string; desc?: string; badges?: { text: string; kind?: "vision" | "video" }[] };

export function ComposerMenu({ icon, label, options, value, onChange, disabled, title, width, tone, toneOf }: { icon: any; label: string; options: ComposerMenuOption[]; value: string; onChange: (value: string) => void; disabled?: boolean; title?: string; width?: number; tone?: "danger"; toneOf?: (option: ComposerMenuOption) => string | undefined }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: globalThis.MouseEvent) => { if (!wrapRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);
  const current = options.find((option) => option.value === value);
  const Icon = icon;
  return (
    <div className={`composer-menu ${open ? "open" : ""}`} ref={wrapRef}>
      <button type="button" className={`composer-setting ${tone === "danger" ? "danger" : ""}`} disabled={disabled} title={title ?? label} onClick={() => setOpen((currentOpen) => !currentOpen)}>
        <Icon size={14} />
        <span>{current?.title ?? label}</span>
        <ChevronDown size={12} className={`menu-caret ${open ? "up" : ""}`} />
      </button>
      {open && (
        <div className="composer-menu-pop" role="listbox" aria-label={label} style={width ? { width } : undefined}>
          {options.map((option) => {
            const itemTone = toneOf?.(option);
            return (
              <button type="button" role="option" aria-selected={option.value === value} key={option.value} className={option.value === value ? "active" : ""} onClick={() => { onChange(option.value); setOpen(false); }}>
                <span className={`menu-item-icon${itemTone ? ` tone-dot tone-${itemTone}` : ""}`} />
                <span className="menu-item-text"><strong>{option.title}</strong>{option.desc && option.desc !== option.title ? <small>{option.desc}</small> : null}</span>
                {option.badges?.length ? <span className="menu-item-badges">{option.badges.map((badge) => <em key={badge.text} className={badge.kind ? `badge-${badge.kind}` : undefined}>{badge.kind === "vision" ? <Eye size={10} /> : badge.kind === "video" ? <Video size={10} /> : null}{badge.text}</em>)}</span> : null}
                {/* 勾选挪到最右侧：左侧图标位让给「供应商色调圆点」，跨供应商的模型一眼看出是哪家 */}
                {option.value === value ? <CircleCheck size={14} className="menu-item-check" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
