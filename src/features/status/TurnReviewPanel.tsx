/**
 * 右栏「审阅」面板（10-18 用户对照 Qoder：「已修改的文件加一个可以点击，然后右边展示右边这样的」+
 * 「看截图，把功能加齐全，然后图一样子文件折叠展开」）。
 *
 * 版式按 Qoder 的连续审阅（max 64 文件 / 5000 改动行，超过后退回单文件 + 上一个/下一个）：
 *   · 左栏：筛选文件… / 收起全部文件夹 / 目录树（文件夹与文件都可折叠）；
 *   · 右栏：**这一轮所有文件的 diff 逐块堆叠**，每块头部可折叠；点目录树里的文件滚到对应块；
 *   · 三点菜单：堆叠/拆分、隐藏仅空白变更、自动换行（与 Qoder 同四项；都有真行为，不做摆设）。
 * 数据仍来自汇总卡 prime/点文件写入的 `turn-review-store`；⛔ 不重新读盘、不重新算 diff。
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Columns2,
  Copy,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  ListFilter,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Rows3,
  Search,
  WrapText,
  X,
} from "lucide-react";
import { FileTypeIcon } from "../../components/FileTypeIcon";
import { getTurnReview, selectTurnReviewFile, subscribeTurnReview } from "../../lib/turn-review-store.mjs";
import { buildTurnReviewTree, collectTurnReviewFolders, relativeTurnReviewPath } from "../../lib/turn-review-tree.mjs";
import { filterWhitespaceOnlyRows, parseDiffLines } from "../../lib/diff-view.mjs";
import { DiffPreviewBody } from "./DiffPreview";

type ReviewFile = {
  path: string;
  added: number;
  deleted: number;
  diff: string;
  deletedFile?: boolean;
  newFile?: boolean;
};
type ViewMode = "stacked" | "split";

/* Qoder 同款阈值：超过就切单文件模式（连续渲染几十个大 diff 会把右栏拖死）。 */
const MAX_CONTINUOUS_FILES = 64;
const MAX_CONTINUOUS_LINES = 5000;

function readPreference(key: string, fallback: string) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writePreference(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* 隐私模式等，忽略 */ }
}

function markOf(file: ReviewFile) {
  return file.deletedFile ? "D" : file.newFile ? "A" : "M";
}

function ReviewFileSection({
  file,
  workspace,
  active,
  selected,
  collapsed,
  viewMode,
  wrap,
  hideWhitespaceOnly,
  copied,
  sectionRef,
  onToggle,
  onCopy,
  onOpen,
}: {
  file: ReviewFile;
  workspace?: string;
  active: boolean;
  selected: boolean;
  collapsed: boolean;
  viewMode: ViewMode;
  wrap: boolean;
  hideWhitespaceOnly: boolean;
  copied: boolean;
  sectionRef: (el: HTMLElement | null) => void;
  onToggle: () => void;
  onCopy: () => void;
  onOpen: () => void;
}) {
  const relative = relativeTurnReviewPath(file.path, workspace) || file.path;
  const rows = useMemo(() => {
    if (!active) return [];
    const parsed = parseDiffLines(file.diff);
    return hideWhitespaceOnly ? filterWhitespaceOnlyRows(parsed) : parsed;
  }, [active, file.diff, hideWhitespaceOnly]);
  const hasVisibleChanges = rows.some((row) => row.kind === "add" || row.kind === "del");
  const hiddenByWhitespace = Boolean(file.diff.trim()) && hideWhitespaceOnly && !hasVisibleChanges;
  return (
    <section
      ref={sectionRef}
      className={`turn-review-file-section ${selected ? "is-active" : ""}`}
      data-review-path={file.path}
    >
      <header className="turn-review-file-head">
        <button type="button" className="turn-review-file-toggle" aria-expanded={!collapsed}
          title={collapsed ? `展开 ${relative} 的变更` : `收起 ${relative} 的变更`} onClick={onToggle}>
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          <FileTypeIcon path={file.path} size={13} />
          <code className="turn-review-file-path" title={file.path}>{relative}</code>
          <span className={`turn-review-mark ${file.deletedFile ? "del" : file.newFile ? "add" : "mod"}`}>{markOf(file)}</span>
          <span className="turn-review-total"><b>+{file.added}</b> <i>-{file.deleted}</i></span>
        </button>
        <div className="turn-review-file-actions">
          <button type="button" title={copied ? "已复制文件路径" : "复制文件路径"} aria-label="复制文件路径" onClick={onCopy}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
          <button type="button" title={file.deletedFile ? "文件已删除，无法打开" : "打开文件"} aria-label="打开文件"
            disabled={file.deletedFile} onClick={onOpen}>
            <ExternalLink size={13} />
          </button>
        </div>
      </header>
      {!collapsed && (
        !active
          ? <div className="turn-review-inactive-hint">切到「审阅」后展开 diff</div>
          : hiddenByWhitespace
            ? <div className="turn-review-empty-diff">这个文件只有空白变更，已按「隐藏仅空白变更」过滤。</div>
            : file.diff.trim()
              ? <div className="turn-review-diff-body"><DiffPreviewBody text={file.diff} maxHeight={100000} view={viewMode === "split" ? "split" : "unified"} wrap={wrap} ignoreWhitespaceOnly={hideWhitespaceOnly} /></div>
              : <div className="turn-review-empty-diff">这个文件没有可展示的 diff（可能是二进制、纯删除/新增，或会话记录只存了路径与统计）。</div>
      )}
    </section>
  );
}

export function TurnReviewPanel({ workspace, active = true, onOpenFile }: { workspace?: string; active?: boolean; onOpenFile?: (path: string) => void }) {
  const state = useSyncExternalStore(subscribeTurnReview, getTurnReview, () => null);
  const [query, setQuery] = useState("");
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(() => new Set());
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(() => new Set());
  const [viewMode, setViewMode] = useState<ViewMode>(() => (readPreference("turn-review:view", "stacked") === "split" ? "split" : "stacked"));
  const [wrap, setWrap] = useState(() => readPreference("turn-review:wrap", "0") === "1");
  const [hideWhitespaceOnly, setHideWhitespaceOnly] = useState(() => readPreference("turn-review:hide-whitespace", "0") === "1");
  const [treeVisible, setTreeVisible] = useState(() => readPreference("turn-review:tree", "1") !== "0");
  const [menuOpen, setMenuOpen] = useState(false);
  const [copiedPath, setCopiedPath] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const lastTurnRef = useRef("");
  const focusKeyRef = useRef("");
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => writePreference("turn-review:view", viewMode), [viewMode]);
  useEffect(() => writePreference("turn-review:wrap", wrap ? "1" : "0"), [wrap]);
  useEffect(() => writePreference("turn-review:hide-whitespace", hideWhitespaceOnly ? "1" : "0"), [hideWhitespaceOnly]);
  useEffect(() => writePreference("turn-review:tree", treeVisible ? "1" : "0"), [treeVisible]);

  /* 新的一轮到达 ⇒ 清筛选、展开全部文件夹与文件块（先让用户看到这轮改了哪些文件）。 */
  useEffect(() => {
    const turnId = state?.turnId ?? "";
    if (!turnId || turnId === lastTurnRef.current) return;
    lastTurnRef.current = turnId;
    setQuery("");
    setCollapsedDirs(new Set());
    setCollapsedFiles(new Set());
    focusKeyRef.current = "";
    paneRef.current?.scrollTo({ top: 0 });
  }, [state?.turnId]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  useEffect(() => () => { if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current); }, []);

  const files: ReviewFile[] = state?.files ?? [];
  const normalizedQuery = query.trim().toLowerCase();
  const filteredFiles = useMemo(() => {
    if (!normalizedQuery) return files;
    return files.filter((file) => relativeTurnReviewPath(file.path, workspace).toLowerCase().includes(normalizedQuery));
  }, [files, normalizedQuery, workspace]);
  const tree = useMemo(() => buildTurnReviewTree(filteredFiles, workspace), [filteredFiles, workspace]);
  const allFolders = useMemo(() => collectTurnReviewFolders(tree), [tree]);
  const allFoldersCollapsed = allFolders.length > 0 && allFolders.every((dir) => collapsedDirs.has(dir));
  const total = files.reduce((sum, file) => ({ added: sum.added + file.added, deleted: sum.deleted + file.deleted }), { added: 0, deleted: 0 });
  const singleFileMode = files.length > MAX_CONTINUOUS_FILES || total.added + total.deleted > MAX_CONTINUOUS_LINES;
  const selected = files.find((file) => file.path === state?.selectedPath) ?? files[0];
  const selectedIndex = Math.max(0, files.findIndex((file) => file.path === selected?.path));
  const previousFile = selectedIndex > 0 ? files[selectedIndex - 1] : null;
  const nextFile = selectedIndex < files.length - 1 ? files[selectedIndex + 1] : null;
  const renderFiles = singleFileMode ? (selected ? [selected] : []) : files;
  const allFilesCollapsed = renderFiles.length > 0 && renderFiles.every((file) => collapsedFiles.has(file.path));

  const toggleDir = (path: string) => setCollapsedDirs((current) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  const toggleAllFolders = () => setCollapsedDirs(allFoldersCollapsed ? new Set() : new Set(allFolders));
  const toggleFile = (path: string) => setCollapsedFiles((current) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  const toggleAllFiles = () => setCollapsedFiles(allFilesCollapsed ? new Set() : new Set(renderFiles.map((file) => file.path)));
  const selectFile = useCallback((path: string) => {
    selectTurnReviewFile(path);
    setCollapsedFiles((current) => {
      if (!current.has(path)) return current;
      const next = new Set(current);
      next.delete(path);
      return next;
    });
    requestAnimationFrame(() => sectionRefs.current.get(path)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }, []);
  const copyPath = useCallback((path: string) => {
    void window.codex.writeClipboard(path).then((ok) => {
      if (ok === false) return;
      setCopiedPath(path);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopiedPath((current) => (current === path ? "" : current)), 1500);
    }).catch(() => undefined);
  }, []);
  const setSectionRef = useCallback((path: string) => (el: HTMLElement | null) => {
    if (el) sectionRefs.current.set(path, el);
    else sectionRefs.current.delete(path);
  }, []);

  const focusKey = `${state?.turnId ?? ""}:${state?.selectedPath ?? ""}:${renderFiles.length}`;
  useEffect(() => {
    if (!active || !state || focusKey === focusKeyRef.current) return;
    focusKeyRef.current = focusKey;
    const el = sectionRefs.current.get(state.selectedPath);
    if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [active, state, focusKey]);

  if (!state || !files.length) {
    return (
      <section className="turn-review-panel is-empty">
        <FileText size={34} />
        <strong>还没有选中的文件</strong>
        <p>在对话里的「已更改 N 个文件」汇总卡上点一个文件，这里会显示整轮文件的完整 diff。</p>
      </section>
    );
  }

  const isFolderCollapsed = (path: string) => !normalizedQuery && collapsedDirs.has(path);
  const renderTree = (node: ReturnType<typeof buildTurnReviewTree>, depth: number) => (
    <>
      {node.dirs.map((dir) => {
        const collapsed = isFolderCollapsed(dir.path);
        return (
          <Fragment key={`d:${dir.path}`}>
            <button type="button" className="turn-review-folder" style={{ paddingLeft: 6 + depth * 12 }}
              aria-expanded={!collapsed} title={dir.path} onClick={() => toggleDir(dir.path)}>
              {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              {collapsed ? <Folder size={13} /> : <FolderOpen size={13} />}
              <span>{dir.name}</span>
            </button>
            {!collapsed && renderTree(dir, depth + 1)}
          </Fragment>
        );
      })}
      {node.files.map((file) => (
        <button type="button" key={`f:${file.path}`}
          className={`turn-review-file ${file.path === selected?.path ? "active" : ""}`}
          style={{ paddingLeft: 6 + depth * 12 + 14 }}
          title={`${file.path}（+${file.added} -${file.deleted}）`}
          onClick={() => selectFile(file.path)}>
          <FileTypeIcon path={file.path} size={13} />
          <code>{file.name}</code>
          <span className={`turn-review-mark ${file.deletedFile ? "del" : file.newFile ? "add" : "mod"}`}>{markOf(file)}</span>
        </button>
      ))}
    </>
  );

  return (
    <section className={`turn-review-panel ${treeVisible ? "" : "no-tree"}`}>
      <header className="turn-review-head">
        <div className="turn-review-head-main">
          <FileText size={14} /><strong>最新回合</strong><span className="turn-review-count">{files.length} 个文件</span>
        </div>
        <div className="turn-review-head-right">
          <span className="turn-review-total"><b>+{total.added}</b> <i>-{total.deleted}</i></span>
          {!singleFileMode && renderFiles.length > 1 && (
            <button type="button" className={`turn-review-icon ${allFilesCollapsed ? "active" : ""}`}
              title={allFilesCollapsed ? "展开全部文件变更" : "收起全部文件变更"}
              aria-label={allFilesCollapsed ? "展开全部文件变更" : "收起全部文件变更"} onClick={toggleAllFiles}>
              {allFilesCollapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
            </button>
          )}
          <button type="button" className={`turn-review-icon ${treeVisible ? "active" : ""}`}
            title={treeVisible ? "隐藏文件列表" : "显示文件列表"} aria-label={treeVisible ? "隐藏文件列表" : "显示文件列表"}
            onClick={() => setTreeVisible((value) => !value)}>
            {treeVisible ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
          </button>
          <div className="turn-review-menu-wrap" ref={menuRef}>
            <button type="button" className={`turn-review-icon ${menuOpen ? "active" : ""}`} title="更多审阅操作"
              aria-label="更多审阅操作" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <div className="turn-review-menu" role="menu">
                <div className="turn-review-menu-label">视图</div>
                <button type="button" role="menuitemradio" aria-checked={viewMode === "stacked"}
                  onClick={() => { setViewMode("stacked"); setMenuOpen(false); }}>
                  <Rows3 size={14} /><span>堆叠</span>{viewMode === "stacked" && <Check size={13} />}
                </button>
                <button type="button" role="menuitemradio" aria-checked={viewMode === "split"}
                  onClick={() => { setViewMode("split"); setMenuOpen(false); }}>
                  <Columns2 size={14} /><span>拆分</span>{viewMode === "split" && <Check size={13} />}
                </button>
                <div className="turn-review-menu-sep" />
                <button type="button" role="menuitemcheckbox" aria-checked={hideWhitespaceOnly}
                  onClick={() => { setHideWhitespaceOnly((value) => !value); setMenuOpen(false); }}>
                  <ListFilter size={14} /><span>{hideWhitespaceOnly ? "显示仅空白变更" : "隐藏仅空白变更"}</span>{hideWhitespaceOnly && <Check size={13} />}
                </button>
                <button type="button" role="menuitemcheckbox" aria-checked={wrap}
                  onClick={() => { setWrap((value) => !value); setMenuOpen(false); }}>
                  <WrapText size={14} /><span>{wrap ? "关闭自动换行" : "启用自动换行"}</span>{wrap && <Check size={13} />}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {treeVisible && (
        <aside className="turn-review-tree-pane">
          <label className="turn-review-filter"><Search size={12} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选文件…" spellCheck={false} aria-label="筛选文件" />
            {query && <button type="button" className="turn-review-filter-clear" aria-label="清空筛选" onClick={() => setQuery("")}><X size={11} /></button>}
          </label>
          <div className="turn-review-tree-actions">
            <span>{filteredFiles.length}/{files.length} 个文件</span>
            {allFolders.length > 0 && (
              <button type="button" className="turn-review-collapse-all" onClick={toggleAllFolders}>{allFoldersCollapsed ? "展开全部文件夹" : "收起全部文件夹"}</button>
            )}
          </div>
          <div className="turn-review-files turn-review-tree" role="tree">
            {filteredFiles.length ? renderTree(tree, 0) : <p className="turn-review-no-match">没有匹配的文件</p>}
          </div>
        </aside>
      )}

      <div className="turn-review-diff" ref={paneRef}>
        {singleFileMode && (
          <div className="turn-review-large-diff">
            <span>这轮改动较多（{files.length} 个文件 / {total.added + total.deleted} 行），已切换为单文件模式。</span>
            <div>
              <button type="button" disabled={!previousFile} title="上一个文件" aria-label="上一个文件" onClick={() => previousFile && selectFile(previousFile.path)}><ArrowUp size={13} /></button>
              <button type="button" disabled={!nextFile} title="下一个文件" aria-label="下一个文件" onClick={() => nextFile && selectFile(nextFile.path)}><ArrowDown size={13} /></button>
            </div>
          </div>
        )}
        {renderFiles.map((file) => (
          <ReviewFileSection
            key={file.path}
            file={file}
            workspace={workspace}
            active={active}
            selected={file.path === selected?.path}
            collapsed={collapsedFiles.has(file.path)}
            viewMode={viewMode}
            wrap={wrap}
            hideWhitespaceOnly={hideWhitespaceOnly}
            copied={copiedPath === file.path}
            sectionRef={setSectionRef(file.path)}
            onToggle={() => toggleFile(file.path)}
            onCopy={() => copyPath(file.path)}
            onOpen={() => { if (!file.deletedFile) onOpenFile?.(file.path); }}
          />
        ))}
      </div>
    </section>
  );
}
