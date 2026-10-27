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
import { AppSelect } from "../../components/AppSelect";
import { useEffect, useMemo, useState } from "react";
import { Archive, Bookmark, Check, CheckSquare, ClipboardCopy, FileText, Image, Link2, Pencil, Plus, Search, Send, Trash2 } from "lucide-react";

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

const KIND_META: Record<FavoriteKind, { label: string; icon: typeof Bookmark }> = {
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
      {/* 10-27 用户令：「文字赘述过多，简洁一点…多个选项的改成选择下拉框，
          批量管理 删除清空、新建，跟搜索框放一排，下面其他赘述不需要写」——
          ⇒ 页头说明、独立批量条、页脚说明全部删除；分类芯片收成下拉；
            搜索 / 分类 / 批量 / 新建压在**一行**。 */}
      <div className="fav-bar">
        <span className="fav-search"><Search size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题 / 内容 / 标签" aria-label="搜索收藏" /></span>
        <AppSelect
          className="fav-kind-select"
          value={kind}
          onChange={(value) => setKind(value as KindFilter)}
          ariaLabel="按类型筛选"
          options={(["all", "text", "image", "file", "link"] as KindFilter[]).map((value) => ({
            value,
            label: `${value === "all" ? "全部" : KIND_META[value].label} ${value === "all" ? favorites.length : favorites.filter((item) => item.kind === value).length}`,
          }))}
        />
        {list.length > 0 && (
          <button type="button" className={`fav-selectall${activeSelection.length === list.length ? " active" : ""}`} title={activeSelection.length === list.length ? "取消全选" : "全选"} aria-label="全选" onClick={toggleAll}>
            <CheckSquare size={14} />
          </button>
        )}
        {activeSelection.length > 0 && (
          <>
            <AppSelect
              className="fav-scope-select"
              value={scope}
              onChange={(value) => setScope(value as MemoryLayerScope)}
              ariaLabel="加入记忆写到哪一层"
              title="加入记忆写到哪一层"
              options={(Object.keys(SCOPE_LABEL) as MemoryLayerScope[]).map((value) => ({ value, label: SCOPE_LABEL[value] }))}
            />
            <button type="button" className="fav-act" disabled={busy} onClick={() => void batchMemory()} title="把选中的收藏追加到所选记忆层"><Archive size={13} />加入记忆</button>
            <button type="button" className="fav-act danger" disabled={busy} onClick={() => void batchRemove()}><Trash2 size={13} />删除 {activeSelection.length}</button>
          </>
        )}
        <span className="fav-spacer" />
        {confirmClear ? (
          <>
            <button type="button" className="fav-act danger" disabled={busy} onClick={async () => { await onRemove(favorites.map((item) => item.id)); setSelected([]); setConfirmClear(false); await onRefresh(); }}>确认清空 {favorites.length}？</button>
            <button type="button" className="fav-act" onClick={() => setConfirmClear(false)}>取消</button>
          </>
        ) : favorites.length > 0 ? (
          <button type="button" className="fav-act danger ghost" disabled={busy} onClick={() => setConfirmClear(true)}><Trash2 size={13} />清空</button>
        ) : null}
        <button type="button" className="fav-act primary" onClick={() => setDraftOpen((open) => !open)}><Plus size={13} />新建</button>
      </div>

      {draftOpen && (
        <div className="fav-draft">
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} placeholder="粘贴要收藏的内容；整条路径按「文件」、http(s) 按「链接」收藏" aria-label="新建收藏内容" />
          <div className="fav-draft-actions">
            <button type="button" className="fav-act" onClick={() => { setDraft(""); setDraftOpen(false); }}>取消</button>
            <button type="button" className="fav-act primary" disabled={!draft.trim()} onClick={() => void saveDraft()}><Check size={13} />保存为{KIND_META[kindOfInput(draft)].label}</button>
          </div>
        </div>
      )}

      {!list.length && (
        <p className="fav-empty">
          {favorites.length ? "没有匹配的收藏" : "还没有收藏。消息右下角点 ☆ 即可收藏，或用「新建」手写一条。"}
        </p>
      )}

      <div className="fav-list">
        {list.map((item) => {
          const meta = KIND_META[item.kind] ?? KIND_META.text;
          const Icon = meta.icon;
          const checked = activeSelection.includes(item.id);
          return (
            <div className={`fav-item ${checked ? "selected" : ""}`} key={item.id}>
              <label className="fav-check"><input type="checkbox" checked={checked} onChange={() => toggleOne(item.id)} aria-label="选择这条收藏" /></label>
              <div className="fav-item-body">
                <div className="fav-item-head">
                  <Icon size={13} />
                  <strong title={item.title}>{item.title || item.content.slice(0, 40)}</strong>
                  <small>{meta.label} · {agoLabel(item.createdAt)}</small>
                </div>
                <p className="fav-item-text" title={item.content}>{item.content.replace(/\s+/g, " ").slice(0, 220)}</p>
                {(item.note || item.tags.length > 0) && (
                  <p className="fav-item-note">
                    {item.note ? item.note : null}
                    {item.note && item.tags.length ? " · " : null}
                    {item.tags.length ? item.tags.join(" · ") : null}
                  </p>
                )}
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
                <button type="button" title="插入到输入框" aria-label="插入到输入框" onClick={() => onInsert(item)}><ClipboardCopy size={13} /></button>
                <button type="button" title="一键发送" aria-label="一键发送" onClick={() => onSend(item)}><Send size={13} /></button>
                <button type="button" title="加入 Agent 记忆" aria-label="加入 Agent 记忆" onClick={() => void onToMemory([item.id], scope !== "user" && !workspace ? "user" : scope)}><Archive size={13} /></button>
                <button type="button" title="编辑" aria-label="编辑" onClick={() => setEditing({ id: item.id, title: item.title, note: item.note ?? "", tags: item.tags.join(" ") })}><Pencil size={13} /></button>
                <button type="button" className="danger" title="删除这条收藏" aria-label="删除这条收藏" onClick={async () => { await onRemove([item.id]); setSelected((current) => current.filter((id) => id !== item.id)); await onRefresh(); }}><Trash2 size={13} /></button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
