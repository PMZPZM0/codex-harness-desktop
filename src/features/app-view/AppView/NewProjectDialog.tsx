/**
 * 新建项目弹窗（10-25 用户令，对照 ZCode）：居中大模态 + 竖排三选项（图标 + 标题 + 描述）。
 *
 *   ① 打开现有文件夹 —— 系统「选择文件夹」框；
 *   ② 新建文件夹 —— 先选父目录，再输入文件夹名，主进程创建；
 *   ③ 输入路径 —— 粘贴绝对路径，校验已存在（不替用户创建）。
 * 落地走主进程 dialog:project-dir（可信根同口径）；onCreate 回调与侧栏 chooseWorkspace 同通道消费。
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FolderOpen, FolderPlus, Keyboard, X, Loader2, ChevronRight } from "lucide-react";

type Option = { id: "open" | "new" | "path"; title: string; desc: string; Icon: typeof FolderOpen };
const OPTIONS: Option[] = [
  { id: "open", title: "打开现有文件夹", desc: "选择电脑上已有的文件夹作为项目地址", Icon: FolderOpen },
  { id: "new", title: "新建文件夹", desc: "选一个位置，创建新的项目文件夹", Icon: FolderPlus },
  { id: "path", title: "输入路径", desc: "直接粘贴项目文件夹的绝对路径", Icon: Keyboard },
];

export function NewProjectDialog({ open, onClose, onCreate }: {
  open: boolean;
  onClose: () => void;
  onCreate: (dir: string) => void;
}) {
  const [mode, setMode] = useState<"choose" | "new" | "path">("choose");
  const [parentDir, setParentDir] = useState("");
  const [folderName, setFolderName] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const firstRef = useRef<HTMLButtonElement>(null);
  /* ⛔ mode 不进 effect 依赖：切表单时 effect 重跑会把状态重置回 "choose"
     （10-25 实测症状：「新建文件夹/输入路径」点击闪一下就没了）。Esc 用 ref 读当前 mode。 */
  const modeRef = useRef(mode);
  modeRef.current = mode;
  /* ⛔ onClose 也走 ref：侧栏传的是内联箭头函数，每次渲染都是新引用 ——
     留在依赖里会让本 effect 随侧栏任何 state 变化重跑、表单被自动重置回 choose
     （10-25 实测「进表单啥也没干就自动返回」的第二根因，与 mode 同型）。 */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    setMode("choose"); setParentDir(""); setFolderName(""); setPathInput(""); setError(""); setBusy(false);
    const prev = document.activeElement as HTMLElement | null;
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); if (modeRef.current === "choose") onCloseRef.current(); else { setMode("choose"); setError(""); } } };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); prev?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const pickAndUse = async () => {
    setBusy(true); setError("");
    try {
      const dir: string | null = await window.codex.chooseDirectory();
      if (dir) onCreate(dir);
    } catch (e: any) { setError(String(e?.message ?? e)); }
    finally { setBusy(false); }
  };

  const pickParent = async () => {
    setBusy(true); setError("");
    try {
      const dir: string | null = await window.codex.chooseDirectory();
      if (dir) setParentDir(dir);
    } catch (e: any) { setError(String(e?.message ?? e)); }
    finally { setBusy(false); }
  };

  const createFolder = async () => {
    const name = folderName.trim();
    if (!parentDir) { setError("先选择一个位置（父目录）"); return; }
    if (!name || /[\\/:*?"<>|]/.test(name)) { setError("文件夹名不能为空，且不能包含 \\ / : * ? \" < > |"); return; }
    setBusy(true); setError("");
    try {
      const r: any = await window.codex.projectDir({ parent: parentDir, name });
      if (!r?.ok) { setError(r?.error || "创建失败"); return; }
      onCreate(String(r.dir));
    } catch (e: any) { setError(String(e?.message ?? e)); }
    finally { setBusy(false); }
  };

  const usePath = async () => {
    const p = pathInput.trim();
    if (!p) { setError("请输入项目目录的绝对路径"); return; }
    /* ⛔ 跨平台绝对路径（10-26 mac 适配审计抓到的真缺口）：原来只认 `C:\…` 盘符，
       mac 上粘贴 `/Users/me/proj` 会被判"不是绝对路径"，新建项目直接走不通。
       · Windows：盘符 `C:\` / `C:/`，或 UNC `\\server\share`
       · mac / Linux：以 `/` 开头（`~/…` 不算绝对路径 —— 交给主进程去展开/报错） */
    const isAbsolute = /^[a-zA-Z]:[\\/]/.test(p) || /^\\\\/.test(p) || p.startsWith("/");
    if (!isAbsolute) { setError("需要绝对路径（如 /Users/你/项目 或 D:\\我的项目）"); return; }
    setBusy(true); setError("");
    try {
      const r: any = await window.codex.projectDir({ path: p });
      if (!r?.ok) { setError(r?.error || "路径不可用"); return; }
      onCreate(String(r.dir));
    } catch (e: any) { setError(String(e?.message ?? e)); }
    finally { setBusy(false); }
  };

  return createPortal(
    <div className="modal-backdrop new-project-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="new-project-modal" role="dialog" aria-modal="true" aria-label="新建项目">
        <header className="np-head">
          <div>
            <strong>新建项目</strong>
            <span>{mode === "choose" ? "选择一种方式开始" : mode === "new" ? "在选定的位置创建文件夹" : "粘贴已存在的文件夹路径"}</span>
          </div>
          <button className="icon-button" title="关闭" onClick={onClose} disabled={busy}><X size={16} /></button>
        </header>

        {mode === "choose" && (
          <div className="np-options" role="menu">
            {OPTIONS.map(({ id, title, desc, Icon }, index) => (
              <button key={id} ref={index === 0 ? firstRef : undefined} className="np-option" role="menuitem"
                onClick={() => {
                  if (id === "open") void pickAndUse();
                  else { setMode(id); setError(""); }
                }}>
                <span className="np-option-icon"><Icon size={20} /></span>
                <span className="np-option-text">
                  <strong>{title}</strong>
                  <small>{desc}</small>
                </span>
                <ChevronRight size={15} className="np-option-chevron" />
              </button>
            ))}
          </div>
        )}

        {mode === "new" && (
          <div className="np-form">
            <label className="np-form-field">
              <span>位置</span>
              <button className="np-parent-btn" disabled={busy} onClick={() => void pickParent()} title="选择父目录">
                {busy ? <Loader2 size={14} className="authx-spin" /> : <FolderOpen size={14} />}
                <b className="np-parent-path" title={parentDir}>{parentDir || "点击选择位置…"}</b>
              </button>
            </label>
            <label className="np-form-field">
              <span>文件夹名</span>
              <input className="np-form-input" value={folderName} spellCheck={false} autoFocus
                placeholder="例如 my-project" onChange={(e) => setFolderName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void createFolder(); }} />
            </label>
            <div className="np-form-actions">
              <button className="secondary-setting" disabled={busy} onClick={() => { setMode("choose"); setError(""); }}>返回</button>
              <button className="primary-setting" disabled={busy || !parentDir || !folderName.trim()} onClick={() => void createFolder()}>
                {busy ? <><Loader2 size={14} className="authx-spin" />正在创建…</> : <><FolderPlus size={14} />创建项目</>}
              </button>
            </div>
          </div>
        )}

        {mode === "path" && (
          <div className="np-form">
            <label className="np-form-field">
              <span>项目路径（需已存在）</span>
              <input className="np-form-input" value={pathInput} spellCheck={false} autoFocus
                placeholder="D:\\我的项目" onChange={(e) => setPathInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void usePath(); }} />
            </label>
            <div className="np-form-actions">
              <button className="secondary-setting" disabled={busy} onClick={() => { setMode("choose"); setError(""); }}>返回</button>
              <button className="primary-setting" disabled={busy || !pathInput.trim()} onClick={() => void usePath()}>
                {busy ? <><Loader2 size={14} className="authx-spin" />正在检查…</> : <><Keyboard size={14} />使用这个路径</>}
              </button>
            </div>
          </div>
        )}

        {busy && mode === "choose" && <div className="np-busy"><Loader2 size={14} className="authx-spin" />正在打开系统对话框…</div>}
        {error && <p className="np-error">{error}</p>}
      </div>
    </div>,
    document.body,
  );
}
