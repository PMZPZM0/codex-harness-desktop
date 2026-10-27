/** 输入区（composer）（从 src/App.tsx 原样搬来，内容未改）。域公开面见 ./index.ts */
import { useLayoutEffect, useState, useRef, useEffect, useMemo } from "react";
import type { KeyboardEvent } from "react";
import { promptImagePaths } from "../../lib/prompt-images";
import { promptFilePaths, shouldSavePastedTextAsFile } from "../../lib/composer-attachments.mjs";
import { ChevronDown, Eye, Video, Search, Image, FileCode2, Settings2 } from "lucide-react";
import { rebuildComposerDom } from "../../lib/rebuild-composer-dom";
import { serializeComposerDom } from "../../lib/serialize-composer-dom";
import { basename } from "../../lib/basename";
import { isImagePath } from "../../lib/is-image-path";
import { isMacPlatform } from "../../lib/is-mac-platform";
import { useCenteredPopoverLeft } from "../../lib/use-centered-popover";

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

export type ComposerMenuOption = { value: string; title: string; desc?: string; badges?: { text: string; kind?: "vision" | "video" }[]; credits?: string; monogram?: string; tone?: string };

/** 上游倍率 "x0.21" → "0.21x"；保留上游小数位（0.258 不能四舍五入成 0.26）。 */
function creditLabel(raw?: string): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return text;
  const trimmed = match[0].includes(".") ? match[0].replace(/0+$/, "").replace(/\.$/, "") : match[0];
  return `${trimmed}x`;
}

export function ComposerMenu({ icon, label, options, value, onChange, disabled, title, width, tone, toneOf, onOpen }: { icon: any; label: string; options: ComposerMenuOption[]; value: string; onChange: (value: string) => void; disabled?: boolean; title?: string; width?: number; tone?: "danger"; toneOf?: (option: ComposerMenuOption) => string | undefined; onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const popLeft = useCenteredPopoverLeft(open, triggerRef, popRef);
  /* ⛔⛔ 10-27 用户令：「这个模型弹窗要自适应位置展示全，不要滚轮」
     第二句补充：「模型下拉框显示是在应用窄界面的时候，展示不全，出现滚轮」。
     病因两条：① CSS 把弹层钉在 `max-height:360px` + `overflow-y:auto` ⇒ 模型一多就滚；
              ② 弹层**恒定向上展开**，窄/矮窗口里上方没那么多空间，也不换边。
     ⇒ 打开时实测触发器上下两侧的真实可用高度：**挑空间大的一侧**展开，
       并把 max-height 设成那一侧的空间 —— 装得下就整份铺开（不出滚动条），
       真装不下才滚（那是物理空间不够，不是设计选择）。⛔ 别写死像素值：窗口尺寸随时变。
     ⛔ 窗口尺寸变化要重算（窄界面下拖动/分屏正是这条要覆盖的场景）。 */
  const [popPlace, setPopPlace] = useState<{ side: "up" | "down"; maxHeight: number }>({ side: "up", maxHeight: 0 });
  useLayoutEffect(() => {
    if (!open) { setPopPlace({ side: "up", maxHeight: 0 }); return; }
    const measure = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const above = rect.top - 12;                                    // 8px 间距 + 4px 余量
      const below = window.innerHeight - rect.bottom - 12;
      const side: "up" | "down" = above >= below ? "up" : "down";
      setPopPlace({ side, maxHeight: Math.max(160, Math.floor(side === "up" ? above : below)) });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: globalThis.MouseEvent) => { if (!wrapRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const current = options.find((option) => option.value === value);
  const Icon = icon;
  return (
    <div className={`composer-menu ${open ? "open" : ""}`} ref={wrapRef}>
      <button ref={triggerRef} type="button" className={`composer-setting ${tone === "danger" ? "danger" : ""}`} disabled={disabled} title={title ?? label} onClick={() => setOpen((currentOpen) => { const next = !currentOpen; if (next) onOpen?.(); return next; })}>
        <Icon size={14} />
        <span>{current?.title ?? label}</span>
        <ChevronDown size={12} className={`menu-caret ${open ? "up" : ""}`} />
      </button>
      {open && (
        <div ref={popRef} className="composer-menu-pop" role="listbox" aria-label={label} style={{ ...(width ? { width } : {}), ...(popLeft != null ? { left: popLeft } : {}), ...(popPlace.maxHeight ? { maxHeight: popPlace.maxHeight } : {}), ...(popPlace.side === "down" ? { top: "calc(100% + 8px)", bottom: "auto" } : {}) }}>
          {options.map((option) => {
            const itemTone = toneOf?.(option) ?? option.tone;
            /* ⛔ 10-27 用户令：「这个权限选项弹窗展示紧凑一点，两边空白太多了」。
               病根：权限那三条既没有色调圆点也没有字母方块，却照样渲染了 20px 的
               `.menu-item-icon` 空槽 + 8px gap ⇒ 每行左侧白站 28px，右边还有内边距，
               看着就是"两边空白"。⇒ **没有图标内容就不占位**（模型行有 tone/字母，照旧）。 */
            const hasIcon = Boolean(itemTone || option.monogram || option.value === "__model_settings__");
            return (
              <button type="button" role="option" aria-selected={option.value === value} key={option.value} data-value={option.value} className={option.value === value ? "active" : ""} onClick={() => { onChange(option.value); setOpen(false); }}>
                {hasIcon && <span className={`menu-item-icon${itemTone ? ` tone-dot tone-${itemTone}` : ""}${option.monogram ? " model-monogram" : ""}`}>{option.monogram ?? (option.value === "__model_settings__" ? <Settings2 size={14} /> : null)}</span>}
                <span className="menu-item-text"><strong>{option.title}</strong>{option.desc && option.desc !== option.title ? <small>{option.desc}</small> : null}</span>
                {option.badges?.length ? <span className="menu-item-badges">{option.badges.map((badge) => <em key={badge.text} className={badge.kind ? `badge-${badge.kind}` : undefined}>{badge.kind === "vision" ? <Eye size={10} /> : badge.kind === "video" ? <Video size={10} /> : null}{badge.text}</em>)}</span> : null}
                {option.credits ? <span className="menu-item-credit" title="上游积分倍率">{creditLabel(option.credits)}</span> : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
