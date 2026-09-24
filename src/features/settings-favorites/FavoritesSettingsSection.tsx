/**
 * 设置页 · 收藏夹（09-24）。
 *
 * 用户需求：「设置中新增一个独立界面用于管理收藏内容 …… 支持批量管理 …… 收藏的内容也可直接加入 Agent 记忆中」。
 *
 * 结构：搜索/筛选 → 批量栏（全选 / 加入记忆 / 删除）→ 新建 → 列表（单条：插入、发送、加入记忆、编辑、删除）。
 *
 * 设计要点：
 *   · **真相源在主进程**（`userData/favorites.json`）：本页所有写操作都拿到全量列表后整体替换，
 *     不自己维护「删除了哪些」的增量状态（增量对不上就会出现幽灵条目）；
 *   · 「插入输入框 / 一键发送」复用 app 层同一对动作（与加号菜单一份实现），
 *     所以两处行为不会跑偏（发送的「输入框已有草稿就不覆盖」规则同理）；
 *   · 加入记忆给用户选**写哪一层**（项目记忆 / 用户档案 / 项目背景 / 纪律），
 *     默认项目记忆、没有工作区时自动退回用户档案（写项目层会直接被主进程拒绝）；
 *   · 清空全部是**二次确认**（第一次点变成「确认清空 N 条？」，第二次才执行）——
 *     收藏是用户手攒的、删了没法从会话复原。
 */
import { useEffect, useMemo, useState } from "react";
import { Archive, Bookmark, Check, ClipboardCopy, FileText, Image, Link2, Pencil, Plus, Search, Send, Star, Trash2, TriangleAlert, X } from "lucide-react";

export type FavoritesSettingsSectionProps = {
  favorites: FavoriteItem[];
  busy: boolean;
  workspace: string;
  onInsert: (item: FavoriteItem) => void;
  onSend: (item: FavoriteItem) => void;
  onAdd: (input: Partial<FavoriteItem>) => Promise<FavoriteItem | null>;
  onUpdate: (id: string, patch: Partial<FavoriteItem>) => Promise<void>;
  onRemove: (ids: string[]) => Promise<number>;
  onRefresh: () => Promise<FavoriteItem[]>;
  onToMemory: (ids: string[], scope: MemoryLayerScope) => Promise<FavoritesToMemoryResult>;
  onNotice: (text: string) => void;
  onToast: (title: string, text?: unknown) => void;
};

type KindFilter = "all" | FavoriteKind;

const KIND_META: Record<FavoriteKind, { label: string; icon: typeof Star }> = {
  text: { label: "片段", icon: Bookmark },
  image: { label: "截图", icon: Image },
  file: { label: "文件", icon: FileText },
  link: { label: "链接", icon: Link2 },
};

const SCOPE_LABEL: Record<MemoryLayerScope, string> = {
  project: "项目记忆",
  user: "用户档案（跨项目）",
  background: "项目背景",
  lessons: "纪律与踩坑",
};

function kindOfInput(text: string): FavoriteKind {
  const value = text.trim();
  if (/^https?:\/\//i.test(value)) return "link";
  if (/\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i.test(value) && !/\s/.test(value)) return "image";
  if (/^[A-Za-z]:[\\/]/.test(value) || /^\//.test(value)) return "file";
  return "text";
}

function agoLabel(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const days = Math.floor((Date.now() - time) / 86_400_000);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 30) return `${days} 天前`;
  return new Date(time).toLocaleDateString("zh-CN");
}

export function FavoritesSettingsSection(props: FavoritesSettingsSectionProps) {
  const { favorites, busy, workspace, onInsert, onSend, onAdd, onUpdate, onRemove, onRefresh, onToMemory, onNotice } = props;
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [scope, setScope] = useState<MemoryLayerScope>("project");
  const [draft, setDraft] = useState("");
  const [draftOpen, setDraftOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string; title: string; note: string; tags: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  /* 挂载时拉一次（主进程是真相源，镜像可能落后：另一个窗口改过、或本页上次打开后又新增）。
     只拉不写 ⇒ 幂等，重复挂载无副作用。 */
  useEffect(() => { void onRefresh(); }, []);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return favorites
      .filter((item) => (kind === "all" ? true : item.kind === kind))
      .filter((item) => !q
        || item.title.toLowerCase().includes(q)
        || item.content.toLowerCase().includes(q)
        || (item.note ?? "").toLowerCase().includes(q)
        || item.tags.some((tag) => tag.toLowerCase().includes(q)));
  }, [favorites, kind, query]);

  // 选中的 id 必须**跟着列表收敛**：删完之后残留的幽灵 id 会让下一次批量操作命中不存在的对象
  const alive = new Set(favorites.map((item) => item.id));
  const activeSelection = selected.filter((id) => alive.has(id));

  const toggleOne = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  const toggleAll = () => setSelected(activeSelection.length === list.length ? [] : list.map((item) => item.id));

  async function batchRemove() {
    if (!activeSelection.length) return;
    const removed = await onRemove(activeSelection);
    if (removed) { setSelected([]); await onRefresh(); }
  }

  async function batchMemory() {
    if (!activeSelection.length) return;
    const effectiveScope: MemoryLayerScope = scope !== "user" && !workspace ? "user" : scope;
    if (effectiveScope !== scope) onNotice("当前没有项目工作区，已改为写入「用户档案」");
    await onToMemory(activeSelection, effectiveScope);
  }

  async function saveDraft() {
    const text = draft.trim();
    if (!text) return;
    const item = await onAdd({ kind: kindOfInput(text), content: text });
    if (item) { setDraft(""); setDraftOpen(false); await onRefresh(); }
  }

  async function saveEdit() {
    if (!editing) return;
    await onUpdate(editing.id, {
      title: editing.title,
      note: editing.note,
      tags: editing.tags.split(/[,，\s]+/).map((tag) => tag.trim()).filter(Boolean),
    });
    setEditing(null);
  }

  return (
    <section className="settings-section stack favorites-settings">
      <header className="settings-block-head">
        <Star size={16} />
        <div>
          <h3>收藏夹 <span className="fav-count">{favorites.length}</span></h3>
          <p className="muted">
            收藏对你有用的回答片段、链接或文件；在输入框的 <b>+ → 收藏夹</b> 里可以一键插入或直接发送，也能写进 Agent 记忆。
          </p>
        </div>
      </header>

      <div className="fav-toolbar">
        <div className="fav-search"><Search size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题 / 内容 / 备注 / 标签" /></div>
        <div className="fav-kinds">
          {(["all", "text", "image", "file", "link"] as KindFilter[]).map((value) => (
            <button key={value} type="button" className={kind === value ? "active" : ""} onClick={() => setKind(value)}>
              {value === "all" ? "全部" : KIND_META[value].label}
              <em>{value === "all" ? favorites.length : favorites.filter((item) => item.kind === value).length}</em>
            </button>
          ))}
        </div>
      </div>

      <div className="fav-batch">
        <label className="fav-check"><input type="checkbox" checked={list.length > 0 && activeSelection.length === list.length} onChange={toggleAll} /><span>全选（{list.length}）</span></label>
        <span className="fav-selected">已选 <b>{activeSelection.length}</b> 条</span>
        <select value={scope} onChange={(event) => setScope(event.target.value as MemoryLayerScope)} title="加入记忆时写到哪一层">
          {(Object.keys(SCOPE_LABEL) as MemoryLayerScope[]).map((value) => <option key={value} value={value}>{SCOPE_LABEL[value]}</option>)}
        </select>
        <button type="button" disabled={!activeSelection.length || busy} onClick={() => void batchMemory()}><Archive size={13} />加入 Agent 记忆</button>
        <button type="button" className="danger" disabled={!activeSelection.length || busy} onClick={() => void batchRemove()}><Trash2 size={13} />删除选中</button>
        <span className="fav-spacer" />
        <button type="button" onClick={() => setDraftOpen((open) => !open)}><Plus size={13} />新建收藏</button>
        {confirmClear ? (
          <>
            <button type="button" className="danger" disabled={busy} onClick={async () => { await onRemove(favorites.map((item) => item.id)); setSelected([]); setConfirmClear(false); await onRefresh(); }}>确认清空 {favorites.length} 条？</button>
            <button type="button" onClick={() => setConfirmClear(false)}><X size={13} />取消</button>
          </>
        ) : (
          <button type="button" className="danger ghost" disabled={!favorites.length || busy} onClick={() => setConfirmClear(true)}>清空全部</button>
        )}
      </div>

      {draftOpen && (
        <div className="fav-draft">
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} placeholder="粘贴要收藏的内容（链接、代码、结论…）；整条绝对路径会按「文件」收藏" />
          <div className="fav-draft-actions">
            <span className="muted">将收藏为：<b>{KIND_META[kindOfInput(draft)].label}</b></span>
            <button type="button" disabled={!draft.trim()} onClick={() => void saveDraft()}><Check size={13} />保存</button>
            <button type="button" onClick={() => { setDraft(""); setDraftOpen(false); }}>取消</button>
          </div>
        </div>
      )}

      {!list.length && (
        <p className="fav-empty">
          {favorites.length
            ? "没有匹配的收藏"
            : "还没有收藏。在任意消息右下角点 ☆ 即可收藏；也可以用上面的「新建收藏」手写一条。"}
        </p>
      )}

      <div className="fav-list">
        {list.map((item) => {
          const meta = KIND_META[item.kind] ?? KIND_META.text;
          const Icon = meta.icon;
          const checked = activeSelection.includes(item.id);
          return (
            <div className={`fav-item ${checked ? "selected" : ""}`} key={item.id}>
              <label className="fav-check"><input type="checkbox" checked={checked} onChange={() => toggleOne(item.id)} /></label>
              <div className="fav-item-body">
                <div className="fav-item-head">
                  <Icon size={13} />
                  <strong title={item.title}>{item.title || item.content.slice(0, 40)}</strong>
                  <small>{meta.label} · {agoLabel(item.createdAt)}{item.useCount > 0 ? ` · 用过 ${item.useCount} 次` : ""}</small>
                </div>
                <p className="fav-item-text" title={item.content}>{item.content.replace(/\s+/g, " ").slice(0, 220)}</p>
                {item.note && <p className="fav-item-note">备注：{item.note}</p>}
                {item.tags.length > 0 && <div className="fav-tags">{item.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
                {item.source?.threadName && <small className="fav-source">来自会话：{item.source.threadName}</small>}
                {editing?.id === item.id && (
                  <div className="fav-edit">
                    <input value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} placeholder="标题" />
                    <input value={editing.note} onChange={(event) => setEditing({ ...editing, note: event.target.value })} placeholder="备注（可选）" />
                    <input value={editing.tags} onChange={(event) => setEditing({ ...editing, tags: event.target.value })} placeholder="标签，空格或逗号分隔" />
                    <div className="fav-edit-actions">
                      <button type="button" onClick={() => void saveEdit()}><Check size={13} />保存</button>
                      <button type="button" onClick={() => setEditing(null)}>取消</button>
                    </div>
                  </div>
                )}
              </div>
              <div className="fav-item-actions">
                <button type="button" title="插入到输入框" onClick={() => onInsert(item)}><ClipboardCopy size={13} /></button>
                <button type="button" title="一键发送" onClick={() => onSend(item)}><Send size={13} /></button>
                <button type="button" title="加入 Agent 记忆" onClick={() => void onToMemory([item.id], scope !== "user" && !workspace ? "user" : scope)}><Archive size={13} /></button>
                <button type="button" title="编辑" onClick={() => setEditing({ id: item.id, title: item.title, note: item.note ?? "", tags: item.tags.join(" ") })}><Pencil size={13} /></button>
                <button type="button" className="danger" title="删除这条收藏" onClick={async () => { await onRemove([item.id]); setSelected((current) => current.filter((id) => id !== item.id)); await onRefresh(); }}><Trash2 size={13} /></button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="fav-foot muted">
        <TriangleAlert size={12} />
        收藏保存在本机 <code>userData/favorites.json</code>；「加入 Agent 记忆」只<b>追加</b>到所选层，单条最长 300 字（避免撑爆记忆注入预算）。
      </p>
    </section>
  );
}
