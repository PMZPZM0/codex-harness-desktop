/**
 * 文件引用卡（10-22，Qoder 式）—— 消息正文末尾的「涉及到的文件」用这一张。
 *
 * 与回合「本轮产物」卡同一套外观：图标 + 文件名 + 路径 + 类型 + 打开方式下拉 + `…`。
 * ⛔ 默认打开方式 = 右侧栏预览（用户截图点名的旧芯片就是这里，原来默认弹居中编辑器）；
 *    需要居中编辑或系统默认应用时从下拉里选。
 */
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Copy, FolderOpen, MoreHorizontal } from "lucide-react";
import { FileTypeIcon, fileExtOf } from "./FileTypeIcon";
import { openRightFile } from "../lib/right-file.mjs";

export type FileOpenMode = "workspace" | "editor" | "system";
const MODE_KEY = "output-file-open-target";
const MODE_LABEL: Record<FileOpenMode, string> = {
  workspace: "在右侧栏",
  editor: "在编辑器打开",
  system: "默认应用",
};

function readMode(): FileOpenMode {
  try {
    const value = localStorage.getItem(MODE_KEY);
    if (value === "editor" || value === "system" || value === "workspace") return value;
  } catch { /* 隐私模式 */ }
  return "workspace";
}

function splitPath(path: string): { name: string; dir: string } {
  const norm = String(path || "").replaceAll("\\", "/");
  const cut = norm.lastIndexOf("/");
  return { name: cut >= 0 ? norm.slice(cut + 1) : norm, dir: cut >= 0 ? norm.slice(0, cut) : "" };
}

export function FileRefCard({
  path,
  leading,
  onOpen,
  onOpenEditor,
  onContextMenu,
  added,
  deleted,
  title,
}: {
  path: string;
  leading?: ReactNode;
  /** 图片/音视频等特殊类型：完全交给调用方（灯箱/播放器），不显示打开方式下拉 */
  onOpen?: () => void;
  onOpenEditor?: (path: string) => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  added?: number;
  deleted?: number;
  title?: string;
}) {
  const [mode, setMode] = useState<FileOpenMode>(readMode);
  const [menu, setMenu] = useState<{ kind: "mode" | "more"; left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const { name, dir } = splitPath(path);
  const ext = fileExtOf(path).toUpperCase();

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const openWith = (target: FileOpenMode = mode) => {
    if (onOpen) { onOpen(); return; }
    if (target === "editor" && onOpenEditor) { onOpenEditor(path); return; }
    if (target === "system") { try { void window.codex.shellOpen?.(path); } catch { /* 无关联程序 */ } return; }
    openRightFile(path);
  };
  const openMenu = (event: ReactMouseEvent<HTMLButtonElement>, kind: "mode" | "more") => {
    event.stopPropagation();
    anchorRef.current = event.currentTarget;
    const rect = event.currentTarget.getBoundingClientRect();
    const width = kind === "mode" ? 168 : 180;
    const height = kind === "mode" ? 128 : 92;
    setMenu({ kind, left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)), top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - height - 8)) });
  };

  return (
    <div
      className="turn-output-card file-ref-card"
      role="button"
      tabIndex={0}
      title={title || `${MODE_LABEL[mode]}：${path}`}
      onClick={() => openWith()}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openWith(); } }}
      onContextMenu={onContextMenu}
    >
      {leading ?? <FileTypeIcon path={path} size={17} className="turn-output-icon" />}
      <div className="turn-output-main">
        <b>{name}</b>
        <span title={dir}>{dir || path}</span>
      </div>
      {ext && <span className="turn-output-type">{ext}</span>}
      {added != null || deleted != null ? (
        <span className="turn-output-stats"><i>+{added ?? 0}</i><em>-{deleted ?? 0}</em></span>
      ) : null}
      {onOpen ? null : (
        <div className="turn-output-actions" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
          <button type="button" className="turn-output-mode" title="选择打开方式" onClick={(event) => openMenu(event, "mode")}>
            {MODE_LABEL[mode]}<ChevronDown size={11} />
          </button>
          <button type="button" className="turn-output-more" title="更多文件操作" onClick={(event) => openMenu(event, "more")}>
            <MoreHorizontal size={14} />
          </button>
        </div>
      )}
      {menu && createPortal(
        <div ref={menuRef} className="turn-output-menu" style={{ left: menu.left, top: menu.top }} role="menu">
          {menu.kind === "mode" ? (["workspace", "editor", "system"] as FileOpenMode[]).map((value) => (
            <button type="button" role="menuitemradio" aria-checked={mode === value} key={value} onClick={() => {
              setMode(value);
              try { localStorage.setItem(MODE_KEY, value); } catch { /* 存不了只影响下次默认 */ }
              setMenu(null);
              openWith(value);
            }}>
              <span>{MODE_LABEL[value]}</span>
              {mode === value ? <Check size={12} /> : null}
            </button>
          )) : (
            <>
              <button type="button" role="menuitem" onClick={() => { try { void navigator.clipboard?.writeText(path); } catch { /* 剪贴板不可用 */ } setMenu(null); }}>
                <Copy size={12} /><span>复制路径</span>
              </button>
              <button type="button" role="menuitem" onClick={() => { try { void window.codex.revealInFolder(path); } catch { /* 文件可能已删 */ } setMenu(null); }}>
                <FolderOpen size={12} /><span>在文件夹中显示</span>
              </button>
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
