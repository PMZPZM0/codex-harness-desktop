/**
 * 新建项目弹窗（10-25 用户令，对照 ZCode 的这一步）：应用内三选项模态。
 *
 * 用户原话：「我点新建项目，直接弹这个（系统目录框）了，我想要跟 ZCode 一样的这一步」。
 *   ① 打开现有文件夹 —— 系统「选择文件夹」框，选中的目录直接登记为新项目；
 *   ② 新建文件夹 —— 先选父目录（系统框），再在弹窗里输入文件夹名，创建后登记为新项目；
 *   ③ 输入路径 —— 手动粘贴绝对路径（已存在的目录直接用；不存在的给出提示，不替用户创建）。
 * ⛔ 路径校验在主进程（chooseDirectory / createScratchDir 同一道可信根），渲染层只做非空与格式预检。
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FolderOpen, FolderPlus, Keyboard, X, Loader2 } from "lucide-react";

export function NewProjectDialog({ open, onClose, onCreate }: {
  open: boolean;
  onClose: () => void;
  /** 落地回调：拿到最终目录路径（与侧栏 chooseWorkspace 同一通道消费）。 */
  onCreate: (dir: string) => void;
}) {
  const [tab, setTab] = useState<"open" | "new" | "path">("open");
  const [parentDir, setParentDir] = useState("");
  const [folderName, setFolderName] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setTab("open"); setParentDir(""); setFolderName(""); setPathInput(""); setError(""); setBusy(false);
    const prev = document.activeElement as HTMLElement | null;
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); prev?.focus?.(); };
  }, [open, onClose]);

  if (!open) return null;

  const pickFolder = async () => {
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
    if (!parentDir) { setError("先选一个父目录"); return; }
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
    if (!/^[a-zA-Z]:[\\/]/.test(p)) { setError("需要 Windows 绝对路径（如 D:\\我的项目）"); return; }
    setBusy(true); setError("");
    try {
      const r: any = await window.codex.projectDir({ path: p });
      if (!r?.ok) { setError(r?.error || "路径不可用"); return; }
      onCreate(String(r.dir));
    } catch (e: any) { setError(String(e?.message ?? e)); }
    finally { setBusy(false); }
  };

  const tabs: [typeof tab, string, typeof FolderOpen][] = [["open", "打开现有文件夹", FolderOpen], ["new", "新建文件夹", FolderPlus], ["path", "输入路径", Keyboard]];

  return createPortal(
    <div className="modal-backdrop new-project-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="new-project-modal" role="dialog" aria-modal="true" aria-label="新建项目">
        <header>
          <strong>新建项目</strong>
          <button className="icon-button" title="关闭" onClick={onClose} disabled={busy}><X size={15} /></button>
        </header>
        <div className="np-tabs" role="tablist">
          {tabs.map(([id, label, Icon]) => (
            <button key={id} ref={id === "open" ? firstRef : undefined} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""}
              onClick={() => { setTab(id); setError(""); }}>
              <Icon size={14} /><span>{label}</span>
            </button>
          ))}
        </div>
        <div className="np-body">
          {tab === "open" && (
            <>
              <p className="np-hint">选择一个已有的文件夹作为新项目的项目地址。</p>
              <button className="primary-setting np-main" disabled={busy} onClick={() => void pickFolder()}>
                {busy ? <><Loader2 size={14} className="authx-spin" />正在打开…</> : <><FolderOpen size={14} />选择文件夹</>}
              </button>
            </>
          )}
          {tab === "new" && (
            <>
              <p className="np-hint">先选父目录，再给新项目文件夹起名（会在父目录下创建）。</p>
              <button className="secondary-setting np-main" disabled={busy} onClick={() => void pickParent()}>
                {busy ? <Loader2 size={14} className="authx-spin" /> : <FolderOpen size={14} />}{parentDir || "选择父目录"}
              </button>
              <input className="account-menu-input np-input" value={folderName} spellCheck={false}
                placeholder="新文件夹名，如 my-project" onChange={(e) => setFolderName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void createFolder(); }} />
              <button className="primary-setting np-main" disabled={busy || !parentDir || !folderName.trim()} onClick={() => void createFolder()}>
                {busy ? <><Loader2 size={14} className="authx-spin" />正在创建…</> : <><FolderPlus size={14} />创建并作为项目</>}
              </button>
            </>
          )}
          {tab === "path" && (
            <>
              <p className="np-hint">直接粘贴项目目录的绝对路径（目录需已存在）。</p>
              <input className="account-menu-input np-input" value={pathInput} spellCheck={false}
                placeholder="D:\\我的项目" onChange={(e) => setPathInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void usePath(); }} />
              <button className="primary-setting np-main" disabled={busy || !pathInput.trim()} onClick={() => void usePath()}>
                {busy ? <><Loader2 size={14} className="authx-spin" />正在检查…</> : <><Keyboard size={14} />使用这个路径</>}
              </button>
            </>
          )}
          {error && <p className="np-error">{error}</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
