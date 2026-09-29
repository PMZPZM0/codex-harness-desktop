import { useMemo, useState } from "react";
import { Check, Clapperboard, FolderOpen, LayoutGrid, Pencil, Plus, Trash2, X } from "lucide-react";
import { readBoard, storyboardFilePath, type BoardMeta, type StoryboardMeta } from "./drama-storage";

/**
 * 项目管理面板（09-28 立，09-29 加分镜表）。
 *
 * 两类「项目」都在这里管：
 *   · **画布**（board）：一套卡片与连线 = 一个项目；列表带产物统计（图 / 视频 / 配音）
 *   · **分镜表**（storyboard）：唯一真源（镜头卡改了会回写它、引擎读的也是它）；列表带场次·镜头数
 * 动作：切换 / 重命名（只改显示标题，引用键 name 不动）/ 删除（二次确认 + 级联清理）/ 打开数据文件夹。
 *
 * ⛔⛔ 必须是**画布内渲染**，不能 portal 到 body（09-29 用户截图：「项目管理弹窗在 AI 画布
 *   弹窗下面」—— 画布根是 z-index:90 的整屏浮层，portal 到 body 的节点 z-index 缺省 = 0，
 *   必然被画布盖住；画布根还有 backdrop-filter 会额外创建 containing block）。
 *   ⛔ 分镜表**不能改 name**：画布卡片 payload.board、BoardMeta.board、工作区文件名都按它引用。
 */

type Stats = { images: number; videos: number; audios: number };
type Tab = "boards" | "stories";

function statsOf(name: string): Stats {
  try {
    const { snapshot } = readBoard(name);
    let images = 0, videos = 0, audios = 0;
    for (const node of snapshot.nodes || []) {
      // ⛔ snapshot 里的节点是序列化形态（payload 直接在节点上）；.data 是 React Flow 包装层
      const p = ((node as any).payload || (node as any).data?.payload || {}) as Record<string, any>;
      if (p.video) videos++;
      else if (p.audio) audios++;
      else if (p.path || p.first_frame || p.ref) images++;
    }
    return { images, videos, audios };
  } catch {
    return { images: 0, videos: 0, audios: 0 };
  }
}

function timeLabel(ts: number): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(ts).toLocaleDateString("zh-CN");
}

/** 通用行内动作条（重命名 / 删除）—— 画布与分镜表共用一套交互 */
function RowActions({ name, title, deletable, onRename, onDelete }: {
  name: string; title: string; deletable: boolean;
  onRename: () => void; onDelete: () => void;
}) {
  return (
    <div className="drama-projects-actions" onClick={(e) => e.stopPropagation()}>
      <button className="icon-button" title={`重命名「${title}」`} onClick={onRename}><Pencil size={13} /></button>
      <button
        className="icon-button"
        title={deletable ? `删除「${title}」` : "当前项不能删除 —— 先切到其它项"}
        style={deletable ? undefined : { opacity: .35, cursor: "default" }}
        onClick={() => { if (deletable) onDelete(); }}
      ><Trash2 size={13} /></button>
    </div>
  );
}

export function DramaProjectsPanel({ boards, current, stories, currentStory, workspace, onClose, onSwitch, onRename, onDelete, onNew, onStorySwitch, onStoryRename, onStoryDelete, onStoryNew }: {
  boards: BoardMeta[];
  /** 当前画布名 */
  current: string;
  stories: StoryboardMeta[];
  /** 当前分镜表名 */
  currentStory: string;
  workspace?: string;
  onClose: () => void;
  onSwitch: (name: string) => void;
  /** 改显示标题（name 引用键不变） */
  onRename: (name: string, title: string) => void;
  onDelete: (name: string) => void;
  onNew: () => void;
  onStorySwitch: (name: string) => void;
  onStoryRename: (name: string, title: string) => void;
  onStoryDelete: (name: string) => void;
  onStoryNew: () => void;
}) {
  const [tab, setTab] = useState<Tab>("boards");
  const [editing, setEditing] = useState<string | null>(null); // `<tab>:<name>`
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  const boardRows = useMemo(() => boards.map((b) => ({ ...b, stats: statsOf(b.name) })), [boards]);

  const dataDir = workspace ? `${workspace.replace(/[\\/]+$/, "")}\\.drama-canvas` : "";
  const storyDir = `${dataDir}\\storyboards`;

  /** 打开分镜表文件所在处：文件在就直接定位它，不在（还没落盘）就退到目录 */
  const revealStory = (name: string) => {
    if (!workspace) return;
    void window.codex.revealInFolder(storyboardFilePath(workspace, name))
      .catch(() => window.codex.revealInFolder(storyDir).catch(() => {}));
  };

  const editingKey = (group: Tab, name: string) => `${group}:${name}`;

  const editor = (group: Tab, name: string, _defaultValue: string, commit: (title: string) => void) => (
    <div className="drama-projects-item is-renaming" key={editingKey(group, name)}>
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim()) { commit(draft.trim()); setEditing(null); }
          if (e.key === "Escape") setEditing(null);
        }}
        placeholder="名称（仅显示名，不影响引用）"
      />
      <button className="drama-canvas-btn" onClick={() => { if (draft.trim()) { commit(draft.trim()); setEditing(null); } }}><Check size={12} />确定</button>
      <button className="drama-canvas-btn is-ghost" onClick={() => setEditing(null)}>取消</button>
    </div>
  );

  const confirmRow = (group: Tab, name: string, label: string, note: string, run: () => void) => (
    <div className="drama-projects-item is-confirm" key={editingKey(group, name)}>
      <span>删除「{label}」？{note}</span>
      <button className="drama-canvas-btn is-danger" onClick={() => { run(); setConfirming(null); }}><Trash2 size={12} />确认删除</button>
      <button className="drama-canvas-btn is-ghost" onClick={() => setConfirming(null)}>取消</button>
    </div>
  );

  return (
    <div className="drama-canvas-modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="drama-canvas-modal drama-projects" role="dialog" aria-label="项目管理" onClick={(event) => event.stopPropagation()}>
        <header>
          <b>项目管理</b>
          <span>{boards.length} 个画布 · {stories.length} 张分镜表</span>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={14} /></button>
        </header>

        {/* 两个分区：画布（卡片与连线）/ 分镜表（唯一真源） */}
        <div className="drama-projects-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "boards"} className={tab === "boards" ? "is-active" : ""} onClick={() => { setTab("boards"); setConfirming(null); }}>
            <LayoutGrid size={13} />画布<span className="drama-projects-tabnum">{boards.length}</span>
          </button>
          <button role="tab" aria-selected={tab === "stories"} className={tab === "stories" ? "is-active" : ""} onClick={() => { setTab("stories"); setConfirming(null); }}>
            <Clapperboard size={13} />分镜表<span className="drama-projects-tabnum">{stories.length}</span>
          </button>
        </div>

        <div className="drama-projects-list">
          {tab === "boards" ? boardRows.map((row) => {
            const isCurrent = row.name === current;
            const key = editingKey("boards", row.name);
            if (editing === key) return editor("boards", row.name, row.title || row.name, (t) => onRename(row.name, t));
            if (confirming === key) return confirmRow("boards", row.name, row.title || row.name, "画布卡片与连线会一并删除（分镜表保留）。", () => onDelete(row.name));
            return (
              <div className={`drama-projects-item${isCurrent ? " is-current" : ""}`} key={key} role="button" tabIndex={0}
                onClick={() => { if (!isCurrent) { onSwitch(row.name); onClose(); } }}
                onKeyDown={(e) => { if (e.key === "Enter" && !isCurrent) { onSwitch(row.name); onClose(); } }}>
                <div className="drama-projects-main">
                  <b>{row.title || row.name}{isCurrent ? <em className="drama-projects-now">当前</em> : null}</b>
                  <small>{row.nodes} 卡片 · 图 {row.stats.images} · 视频 {row.stats.videos} · 配音 {row.stats.audios} · {timeLabel(row.updatedAt)}</small>
                </div>
                <RowActions name={row.name} title={row.title || row.name} deletable={!isCurrent}
                  onRename={() => { setEditing(key); setDraft(row.title || row.name); setConfirming(null); }}
                  onDelete={() => { setConfirming(key); setEditing(null); }} />
              </div>
            );
          }) : stories.map((row) => {
            const isCurrent = row.name === currentStory;
            const key = editingKey("stories", row.name);
            if (editing === key) return editor("stories", row.name, row.title || row.name, (t) => onStoryRename(row.name, t));
            if (confirming === key) return confirmRow("stories", row.name, row.title || row.name, "已展开到画布的卡片会保留并解绑，工作区里的表文件一并删除。", () => onStoryDelete(row.name));
            return (
              <div className={`drama-projects-item${isCurrent ? " is-current" : ""}`} key={key} role="button" tabIndex={0}
                onClick={() => { if (!isCurrent) { onStorySwitch(row.name); onClose(); } }}
                onKeyDown={(e) => { if (e.key === "Enter" && !isCurrent) { onStorySwitch(row.name); onClose(); } }}>
                <div className="drama-projects-main">
                  <b>{row.title || row.name}{isCurrent ? <em className="drama-projects-now">当前</em> : null}</b>
                  <small>
                    {row.scenes} 场 · {row.shots} 镜
                    {row.file ? " · 工作区已落盘" : workspace ? " · 尚未落盘" : ""}
                    {" · "}{timeLabel(row.updatedAt)}
                  </small>
                </div>
                <div className="drama-projects-actions" onClick={(e) => e.stopPropagation()}>
                  {workspace ? <button className="icon-button" title="打开工作区里的表文件" onClick={() => revealStory(row.name)}><FolderOpen size={13} /></button> : null}
                  <button className="icon-button" title={`重命名「${row.title || row.name}」`} onClick={() => { setEditing(key); setDraft(row.title || row.name); setConfirming(null); }}><Pencil size={13} /></button>
                  <button className="icon-button" title={`删除「${row.title || row.name}」`} onClick={() => { setConfirming(key); setEditing(null); }}><Trash2 size={13} /></button>
                </div>
              </div>
            );
          })}
          {(tab === "boards" ? boardRows : stories).length === 0 && (
            <div className="drama-projects-empty">还没有{tab === "boards" ? "画布" : "分镜表"} —— 点下方「新建{tab === "boards" ? "画布" : "分镜表"}」开始。</div>
          )}
        </div>

        <footer>
          {tab === "boards"
            ? <button className="drama-canvas-btn" onClick={() => { onNew(); onClose(); }}><Plus size={12} />新建画布</button>
            : <button className="drama-canvas-btn" onClick={() => { onStoryNew(); onClose(); }}><Plus size={12} />新建分镜表</button>}
          {workspace
            ? <button className="drama-canvas-btn is-ghost" title="在资源管理器中打开画布数据目录（含生成产物与分镜表文件）" onClick={() => { void window.codex.revealInFolder(dataDir).catch(() => {}); }}><FolderOpen size={12} />打开数据文件夹</button>
            : <small className="drama-projects-hint">未选择工作文件夹 —— 生成产物与分镜表不会落盘</small>}
        </footer>
      </div>
    </div>
  );
}
