import { useMemo, useState } from "react";
import { Check, FolderOpen, Pencil, Plus, Trash2, X } from "lucide-react";
import { readBoard, type BoardMeta } from "./drama-storage";

/**
 * 项目管理面板（09-28 用户：「AI画布里面加一个项目管理功能」）。
 *
 * 画布的「项目」= 一张板（board）。此前只有一个 AppSelect 下拉做切换，删也只能删当前板，
 * 没有总览 —— 这个面板把项目管理聚成一屏：
 *   · 列表：标题 / 卡片数 / 产物统计（图·视频·音频，从各板快照统计）/ 更新时间 / 当前标记
 *   · 动作：点击切换、重命名（改显示标题）、删除（非当前板）、打开工作区文件夹
 *
 * ⛔⛔ 必须是**画布内渲染**，不能 portal 到 body（09-29 用户截图：「项目管理弹窗在 AI 画布
 *   弹窗下面」—— 画布根 `.drama-canvas-backdrop` 是 z-index:90 的整屏浮层，portal 到 body 的
 *   节点 z-index 缺省 = 0，必然被画布盖住。同类坑：画布根还有 backdrop-filter，会额外创建
 *   containing block）。画布内弹层一律用 `.drama-canvas-modal-mask`（fixed + z-index 30，
 *   在画布的 stacking context 内）—— 与命名弹窗 / 确认弹窗完全一致。
 */

type Stats = { images: number; videos: number; audios: number };

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

export function DramaProjectsPanel({ boards, current, workspace, onClose, onSwitch, onRename, onDelete, onNew }: {
  boards: BoardMeta[];
  /** 当前打开的板名 */
  current: string;
  workspace?: string;
  onClose: () => void;
  onSwitch: (name: string) => void;
  /** 改显示标题（name 不变，文件名不动） */
  onRename: (name: string, title: string) => void;
  /** 删除项目（非当前板） */
  onDelete: (name: string) => void;
  /** 走画布既有 naming 流程新建 */
  onNew: () => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  const rows = useMemo(() => boards.map((b) => ({ ...b, stats: statsOf(b.name) })), [boards]);


  return (
    <div className="drama-canvas-modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="drama-canvas-modal is-wide drama-projects" role="dialog" aria-label="项目管理" onClick={(event) => event.stopPropagation()}>
        <header>
          <b>项目管理</b>
          <span>{boards.length} 个项目 · 点击进入</span>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={14} /></button>
        </header>
        <div className="drama-projects-list">
          {rows.map((row) => {
            const isCurrent = row.name === current;
            if (renaming === row.name) {
              return (
                <div className="drama-projects-item is-renaming" key={row.name}>
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && draft.trim()) { onRename(row.name, draft.trim()); setRenaming(null); }
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    placeholder="项目名称"
                  />
                  <button className="drama-canvas-btn" onClick={() => { if (draft.trim()) { onRename(row.name, draft.trim()); setRenaming(null); } }}><Check size={12} />确定</button>
                  <button className="drama-canvas-btn is-ghost" onClick={() => setRenaming(null)}>取消</button>
                </div>
              );
            }
            if (confirming === row.name) {
              return (
                <div className="drama-projects-item is-confirm" key={row.name}>
                  <span>删除「{row.title || row.name}」？画布卡片与连线会一并删除（分镜表保留）。</span>
                  <button className="drama-canvas-btn is-danger" onClick={() => { onDelete(row.name); setConfirming(null); }}><Trash2 size={12} />确认删除</button>
                  <button className="drama-canvas-btn is-ghost" onClick={() => setConfirming(null)}>取消</button>
                </div>
              );
            }
            return (
              <div className={`drama-projects-item${isCurrent ? " is-current" : ""}`} key={row.name} role="button" tabIndex={0}
                onClick={() => { if (!isCurrent) { onSwitch(row.name); onClose(); } }}
                onKeyDown={(e) => { if (e.key === "Enter" && !isCurrent) { onSwitch(row.name); onClose(); } }}>
                <div className="drama-projects-main">
                  <b>{row.title || row.name}{isCurrent ? <em className="drama-projects-now">当前</em> : null}</b>
                  <small>{row.nodes} 卡片 · 图 {row.stats.images} · 视频 {row.stats.videos} · 配音 {row.stats.audios} · {timeLabel(row.updatedAt)}</small>
                </div>
                <div className="drama-projects-actions" onClick={(e) => e.stopPropagation()}>
                  {isCurrent ? null : <button className="icon-button" title="重命名" onClick={() => { setRenaming(row.name); setDraft(row.title || row.name); }}><Pencil size={13} /></button>}
                  {isCurrent
                    ? <button className="icon-button" title="当前项目不能删除 —— 先切换到其它项目" style={{ opacity: .35, cursor: "default" }}><Trash2 size={13} /></button>
                    : <button className="icon-button" title="删除项目" onClick={() => setConfirming(row.name)}><Trash2 size={13} /></button>}
                </div>
              </div>
            );
          })}
          {!rows.length && <div className="drama-projects-empty">还没有项目 —— 点下方「新建项目」开始。</div>}
        </div>
        <footer>
          <button className="drama-canvas-btn" onClick={() => { onNew(); onClose(); }}><Plus size={12} />新建项目</button>
          {workspace
            ? <button className="drama-canvas-btn is-ghost" title="在资源管理器中打开画布数据目录" onClick={() => { void window.codex.revealInFolder(`${workspace.replace(/[\\/]+$/, "")}\\.drama-canvas`).catch(() => {}); }}><FolderOpen size={12} />打开数据文件夹</button>
            : <small className="drama-projects-hint">未选择工作文件夹 —— 生成产物不会落盘，先在会话里选好工作目录</small>}
        </footer>
      </div>
    </div>
  );
}
