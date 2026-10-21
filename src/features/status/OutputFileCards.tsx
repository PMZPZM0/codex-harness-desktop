/**
 * 回合「本轮产物」文件卡（10-22，按 Qoder 的 outputFiles 逆向结果做的）。
 *
 * Qoder 的做法（REA 读取 app.asar/out/renderer）：
 *   · 每轮最多 7 张卡，超出折叠成「显示其余 N 个文件」；
 *   · 每张卡 = 文件图标 + 文件名 + 类型 + 「打开方式」下拉（在右侧栏查看 / 新窗口 / 默认应用）；
 *   · 默认打开方式来自设置 `assistantOutputFileDefaultOpenTarget`；点卡片按默认方式打开；
 *   · 卡片另有「…」菜单（复制绝对/相对路径、在文件管理器中显示）与悬停预览。
 * 这里按同一结构实现；「新窗口」在桌面版没有独立预览窗，落成「在编辑器打开」（诚实命名）。
 */
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Copy, FolderOpen, MoreHorizontal } from "lucide-react";
import { FileTypeIcon, fileExtOf } from "../../components/FileTypeIcon";
import { openRightFile } from "../../lib/right-file.mjs";

export type OutputFile = { path: string; added: number; deleted: number };

type OpenMode = "workspace" | "editor" | "system";
const MODE_KEY = "output-file-open-target";
const MAX_VISIBLE = 7;

const MODE_LABEL: Record<OpenMode, string> = {
  workspace: "在右侧栏",
  editor: "在编辑器打开",
  system: "默认应用",
};

function readMode(): OpenMode {
  try {
    const value = localStorage.getItem(MODE_KEY);
    if (value === "editor" || value === "system" || value === "workspace") return value;
  } catch { /* 隐私模式/存储不可用按默认 */ }
  return "workspace";
}

function splitPath(path: string): { name: string; dir: string } {
  const norm = String(path || "").replaceAll("\\", "/");
  const cut = norm.lastIndexOf("/");
  return { name: cut >= 0 ? norm.slice(cut + 1) : norm, dir: cut >= 0 ? norm.slice(0, cut) : "" };
}

export function OutputFileCards({ files, onOpenEditor }: { files: OutputFile[]; onOpenEditor?: (path: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<OpenMode>(readMode);
  const [menu, setMenu] = useState<{ path: string; kind: "mode" | "more"; left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);

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

  if (!files.length) return null;
  const visible = expanded ? files : files.slice(0, MAX_VISIBLE);
  const hidden = files.length - visible.length;

  const chooseMode = (next: OpenMode, path?: string) => {
    setMode(next);
    try { localStorage.setItem(MODE_KEY, next); } catch { /* 存不了只影响下次默认 */ }
    setMenu(null);
    if (path) openWith(path, next);
  };
  const openWith = (path: string, target: OpenMode = mode) => {
    if (target === "editor" && onOpenEditor) { onOpenEditor(path); return; }
    if (target === "system") { try { void window.codex.shellOpen?.(path); } catch { /* 无默认关联程序 */ } return; }
    openRightFile(path);
  };
  const openMenu = (event: ReactMouseEvent<HTMLButtonElement>, path: string, kind: "mode" | "more") => {
    event.stopPropagation();
    anchorRef.current = event.currentTarget;
    const rect = event.currentTarget.getBoundingClientRect();
    const width = kind === "mode" ? 168 : 180;
    const height = kind === "mode" ? 128 : 92;
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    const top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - height - 8));
    setMenu({ path, kind, left, top });
  };

  return (
    <section className="turn-output-files" aria-label="本轮产物" data-testid="turn-output-files">
      {visible.map((file) => {
        const { name, dir } = splitPath(file.path);
        const ext = fileExtOf(file.path).toUpperCase();
        return (
          <div
            className="turn-output-card"
            key={file.path}
            role="button"
            tabIndex={0}
            data-testid="turn-output-card"
            title={`${mode === "workspace" ? "在右侧栏预览" : MODE_LABEL[mode]}：${file.path}`}
            onClick={() => openWith(file.path)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openWith(file.path); }
            }}
          >
            <FileTypeIcon path={file.path} size={17} className="turn-output-icon" />
            <div className="turn-output-main">
              <b>{name}</b>
              <span title={dir}>{dir || "工作区根目录"}</span>
            </div>
            {ext && <span className="turn-output-type">{ext}</span>}
            <span className="turn-output-stats"><i>+{file.added}</i><em>-{file.deleted}</em></span>
            <div className="turn-output-actions" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
              <button type="button" className="turn-output-mode" title="选择打开方式" onClick={(event) => openMenu(event, file.path, "mode")}>
                {MODE_LABEL[mode]}<ChevronDown size={11} />
              </button>
              <button type="button" className="turn-output-more" title="更多文件操作" onClick={(event) => openMenu(event, file.path, "more")}>
                <MoreHorizontal size={14} />
              </button>
            </div>
          </div>
        );
      })}
      {hidden > 0 && (
        <button type="button" className="turn-output-disclosure" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          <ChevronDown size={13} className={expanded ? "open" : ""} />
          {expanded ? "收起文件" : `显示其余 ${hidden} 个文件`}
        </button>
      )}
      {menu && createPortal(
        <div ref={menuRef} className="turn-output-menu" style={{ left: menu.left, top: menu.top }} role="menu">
          {menu.kind === "mode" ? (["workspace", "editor", "system"] as OpenMode[]).map((value) => (
            <button type="button" role="menuitemradio" aria-checked={mode === value} key={value} onClick={() => chooseMode(value, menu.path)}>
              <span>{MODE_LABEL[value]}</span>
              {mode === value ? <Check size={12} /> : null}
            </button>
          )) : (
            <>
              <button type="button" role="menuitem" onClick={() => { try { void navigator.clipboard?.writeText(menu.path); } catch { /* 剪贴板不可用 */ } setMenu(null); }}>
                <Copy size={12} /><span>复制路径</span>
              </button>
              <button type="button" role="menuitem" onClick={() => { try { void window.codex.revealInFolder(menu.path); } catch { /* 文件可能已删 */ } setMenu(null); }}>
                <FolderOpen size={12} /><span>在文件夹中显示</span>
              </button>
            </>
          )}
        </div>,
        document.body,
      )}
    </section>
  );
}
