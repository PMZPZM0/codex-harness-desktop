import { createPortal } from "react-dom";
import { AddPagesDialog } from "./AddPagesDialog";
import { AnchorPopover } from "../../components/AnchorPopover";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentType, type DragEvent } from "react";
import { Puzzle,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  GripVertical,
  Heart,
  KeyRound,
  LayoutGrid,
  MoreHorizontal,
  Pencil,
  Plus,
  Rocket,
  Sparkles,
  Star,
  Trash2,
  Users,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import {
  overflowFunctionMenuItems,
  visibleFunctionMenuItems,
  type FunctionMenuEntryId,
  type FunctionMenuItemId,
  type FunctionMenuLocation,
} from "./menu-model.mjs";
import {
  appendFunctionMenuItems,
  bumpCustomMenuRevision,
  closeFunctionMenuEditor,
  dismissFunctionMenuTour,
  getFunctionMenuTour,
  moveFunctionMenuItemInMenu,
  nudgeFunctionMenuItemInMenu,
  openFunctionMenuEditor,
  resetFunctionMenuLayoutToDefault,
  runFunctionMenuAction,
  setFunctionMenuLocation,
  openSettingsFromFunctionMenu,
  removeFunctionMenuItems,
  subscribeFunctionMenuTour,
  toggleFunctionMenuItemOverflow,
  useCustomMenuRevision,
  useFunctionMenuConfig,
  useFunctionMenuEditorOpen,
  useFunctionMenuSettingsTargets,
} from "./store";

type IconProps = { size?: number; className?: string };
type MenuMeta = { label: string; title: string; Icon: ComponentType<IconProps>; tone: string };

export const FUNCTION_MENU_META: Record<FunctionMenuItemId, MenuMeta> = {
  schedule: { label: "自动化", title: "按时间自动运行任务", Icon: Clock3, tone: "ic-amber" },
  frontend: { label: "前端开发", title: "前端 UI · 组件库：查看教程与入口", Icon: LayoutGrid, tone: "ic-blue" },
  extensions: { label: "拓展", title: "技能 · 插件 · MCP：查看教程与入口", Icon: Zap, tone: "ic-pink" },
  team: { label: "团队", title: "子智能体 · 专家 · 专家团：查看教程与入口", Icon: Users, tone: "ic-violet" },
  devtools: { label: "开发工具", title: "开发工具：运行时安装 · 飞书 CLI · 手机控制 · 声明式插件", Icon: Wrench, tone: "ic-green" },
  favorites: { label: "收藏夹", title: "收藏夹：收藏的消息、文件与片段", Icon: Star, tone: "ic-amber" },
  identity: { label: "个性化&记忆", title: "人格市场 · 记忆中心 · 知识库：查看教程与入口", Icon: Heart, tone: "ic-amber" },
  login: { label: "登录管理", title: "登录管理：GPT 订阅 · 中转站账户 · 云账号", Icon: KeyRound, tone: "ic-green" },
  newbie: { label: "新手教程", title: "新手教程：分步教你用起来", Icon: Rocket, tone: "ic-cyan" },
};

function MenuItemButton({ id, meta, onActivate, onDone, dragging, dropBefore, onDragStart, onDragEnd, onDragOver, onDrop }: {
  id: string;
  meta: MenuMeta;
  onActivate: () => void;
  onDone?: () => void;
  dragging?: boolean;
  dropBefore?: boolean;
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd?: (event: DragEvent<HTMLButtonElement>) => void;
  onDragOver?: (event: DragEvent<HTMLButtonElement>) => void;
  onDrop?: (event: DragEvent<HTMLButtonElement>) => void;
}) {
  const Icon = meta.Icon;
  return (
    <button
      type="button"
      className={`sidebar-tab sidebar-cap-row ${dragging ? "dragging" : ""} ${dropBefore ? "drop-before" : ""}`}
      title={meta.title}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={() => { onActivate(); onDone?.(); }}
    >
      <Icon size={15} className={meta.tone} /><span>{meta.label}</span><ChevronRight size={13} className="sidebar-cap-chevron" />
    </button>
  );
}

/** 一条拓展功能菜单（10-25 前叫「功能入口」）。top = 搜索任务下面，bottom = 侧栏底部；两个位置共用同一份排序/更多配置。
 *  侧栏里的入口可直接拖动排序 / 拖进「更多」，落手即写回共享配置。 */
export function FunctionMenu({ location }: { location: FunctionMenuLocation }) {
  const config = useFunctionMenuConfig();
  const [moreOpen, setMoreOpen] = useState(false);
  /* 10-27 用户：「功能入口菜单也留好IPC接口」—— 用户扩展项来自 extensions:catalog。
     10-29：扩展项支持 settings 动作（自定义添加设置页），保存后靠 revision 重拉目录。 */
  const customRevision = useCustomMenuRevision();
  const [extMenu, setExtMenu] = useState<MenuEntrySpec[]>([]);
  useEffect(() => { void window.codex.extensionsCatalog?.().then((catalog) => setExtMenu(catalog?.menu ?? [])).catch(() => undefined); }, [customRevision]);
  /* 自定义项与内置项**同一份 order/overflow**（10-30 用户：别在下面另起一块）；目录里新增的
     id 若还没进配置，补进主列表末尾，保证「加了就能看到、能拖、能收进更多」。 */
  const extMetaOf = (id: string) => {
    const entry = extMenu.find((item) => item.id === id);
    return entry ? ({ label: entry.label, title: "自定义入口：点一下跳到对应设置页", Icon: Puzzle, tone: "ic-cyan" } as MenuMeta) : null;
  };
  const metaOf = (id: FunctionMenuEntryId) => (FUNCTION_MENU_META as Record<string, MenuMeta>)[String(id)] ?? extMetaOf(String(id));
  const activate = (id: FunctionMenuEntryId) => {
    const entry = extMenu.find((item) => item.id === id);
    if (!entry) { runFunctionMenuAction(String(id) as FunctionMenuItemId); return; }
    if (entry.action.type === "settings") openSettingsFromFunctionMenu(entry.action.target);
    else if (entry.action.type === "url") void window.codex.openExternal(entry.action.target);
  };
  /* 目录里已有、但配置里还没登记的扩展项：补进主列表末尾（老用户升级 / 手改 extensions.json）。 */
  useEffect(() => {
    if (!extMenu.length) return;
    const missing = extMenu.map((entry) => entry.id).filter((id) => !config.order.includes(id));
    if (missing.length) appendFunctionMenuItems(missing);
  }, [extMenu, config.order]);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const [dragId, setDragId] = useState<FunctionMenuEntryId | null>(null);
  const [dropBefore, setDropBefore] = useState<FunctionMenuEntryId | null>(null);
  const [moreDrop, setMoreDrop] = useState(false);
  if (config.location !== location) return null;
  const visible = visibleFunctionMenuItems(config);
  const overflow = overflowFunctionMenuItems(config);
  const other: FunctionMenuLocation = location === "top" ? "bottom" : "top";
  const resetDrag = () => { setDragId(null); setDropBefore(null); setMoreDrop(false); };
  const dropVisible = (before: FunctionMenuEntryId | null) => {
    if (dragId && dragId !== before) moveFunctionMenuItemInMenu(dragId, "visible", before);
    resetDrag();
  };
  const dropMore = () => {
    if (dragId) moveFunctionMenuItemInMenu(dragId, "overflow", null);
    resetDrag();
  };
  return (
    <div className={`function-menu function-menu-sidebar function-menu-${location}`}>
      <div className="function-menu-items" role="group" aria-label="拓展功能">
        {visible.map((id) => {
          const meta = metaOf(id);
          if (!meta) return null;
          return (
          <MenuItemButton
            key={id}
            id={String(id)}
            meta={meta}
            onActivate={() => activate(id)}
            dragging={dragId === id}
            dropBefore={dropBefore === id && dragId !== id}
            onDragStart={(event) => { setDragId(id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", id); }}
            onDragEnd={resetDrag}
            onDragOver={(event) => {
              if (!dragId || dragId === id) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDropBefore(id);
              setMoreDrop(false);
            }}
            onDrop={(event) => { event.preventDefault(); event.stopPropagation(); dropVisible(id); }}
          />
          );
        })}
        <button
          ref={moreRef}
          type="button"
          className={`sidebar-tab sidebar-cap-row function-menu-more ${moreDrop ? "drop-into" : ""}`}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          title="更多：拖动入口到这里可收进「更多」 / 编辑菜单 / 切换显示位置"
          onDragOver={(event) => {
            if (!dragId) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDropBefore(null);
            setMoreDrop(true);
          }}
          onDrop={(event) => { event.preventDefault(); event.stopPropagation(); dropMore(); }}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <MoreHorizontal size={15} />
          <span>更多</span>
          {overflow.length > 0 && <em className="function-menu-more-badge">{overflow.length}</em>}
          <ChevronRight size={13} className="sidebar-cap-chevron" />
        </button>
      </div>
      {moreOpen && moreRef.current && (
        <MorePopover anchor={moreRef.current} overflow={overflow} extMenu={extMenu} onActivate={activate} otherLocation={other} onClose={() => setMoreOpen(false)} />
      )}
    </div>
  );
}

function MorePopover({ anchor, overflow, extMenu, onActivate, otherLocation, onClose }: {
  anchor: HTMLElement;
  overflow: FunctionMenuEntryId[];
  extMenu: MenuEntrySpec[];
  onActivate: (id: FunctionMenuEntryId) => void;
  otherLocation: FunctionMenuLocation;
  onClose: () => void;
}) {
  const metaOf = (id: FunctionMenuEntryId) => (FUNCTION_MENU_META as Record<string, MenuMeta>)[String(id)]
    ?? (extMenu.some((entry) => entry.id === id) ? { label: extMenu.find((entry) => entry.id === id)!.label, title: "自定义入口", Icon: Puzzle, tone: "ic-cyan" } as MenuMeta : null);
  /* 10-27 架构审查 P1-3：定位/点外关闭/Esc/跟随滚动统一交给 AnchorPopover（本文件不再自己量）。 */
  return (
    <AnchorPopover open anchor={anchor} onClose={onClose} axis="y" align="start" prefer="auto" width={232} className="function-menu-popover" role="menu" ariaLabel="更多拓展功能">
      {overflow.length > 0 ? overflow.map((id) => {
        const meta = metaOf(id);
        if (!meta) return null;
        const Icon = meta.Icon;
        return <button key={id} type="button" role="menuitem" className="function-menu-popover-item" onClick={() => { onActivate(id); onClose(); }}>
          <Icon size={14} className={meta.tone} /><span>{meta.label}</span>
        </button>;
      }) : <p className="function-menu-popover-empty">把不常用的入口拖进「更多」后会出现在这里</p>}
      <div className="function-menu-popover-sep" />
      <button type="button" role="menuitem" className="function-menu-popover-item" onClick={() => { onClose(); openFunctionMenuEditor(); }}>
        <Pencil size={14} /><span>编辑菜单…</span>
      </button>
      {otherLocation && (
        <button type="button" role="menuitem" className="function-menu-popover-item" onClick={() => { onClose(); setFunctionMenuLocation(otherLocation); }}>
          {otherLocation === "top" ? <ArrowUpToLine size={14} /> : <ArrowDownToLine size={14} />}
          <span>{otherLocation === "top" ? "移到拓展功能下面" : "移到侧栏底部"}</span>
        </button>
      )}
    </AnchorPopover>
  );
}

/** 首次悬停教程（每个展示位置一次）。Qoder 同款：先看一次怎么编辑，再自己玩。 */
export function FunctionMenuTourHost() {
  const request = useSyncExternalStore(subscribeFunctionMenuTour, getFunctionMenuTour, () => null);
  /* 10-27 P1-3：位置/关闭统一交给 AnchorPopover（本文件第三处手写定位也一并收掉）。 */
  if (!request) return null;
  return (
    <AnchorPopover open anchor={request.anchor} onClose={dismissFunctionMenuTour} axis="y" align="start" prefer="auto" width={300} className="function-menu-tour" ariaLabel="拓展功能使用提示">
      <div className="function-menu-tour-head">
        <span className="function-menu-tour-icon"><Sparkles size={14} /></span>
        <b>让拓展功能更顺手</b>
        <button type="button" aria-label="关闭提示" onClick={dismissFunctionMenuTour}><X size={13} /></button>
      </div>
      <div className="function-menu-tour-demo" aria-hidden="true">
        <span>自动化</span><span>团队</span><span className="more">更多 <ChevronDown size={10} /></span>
      </div>
      <p>点「更多 → 编辑菜单」可以拖动排序，把不常用的入口拖进「更多」收起。</p>
      <p>也可以在 <b>设置 → 外观</b> 里切换「搜索任务下面 / 侧栏底部」。</p>
      <div className="function-menu-tour-actions">
        <button type="button" className="primary-setting" onClick={() => { dismissFunctionMenuTour(); openFunctionMenuEditor(); }}>编辑菜单</button>
        <button type="button" className="secondary-setting" onClick={dismissFunctionMenuTour}>知道了</button>
      </div>
    </AnchorPopover>
  );
}

/** 编辑菜单弹窗宿主：全局只挂一份，任何入口都能打开。 */
export function FunctionMenuEditorHost() {
  const open = useFunctionMenuEditorOpen();
  if (!open) return null;
  return createPortal(<FunctionMenuEditor />, document.body);
}

function FunctionMenuEditor() {
  const config = useFunctionMenuConfig();
  const [dragId, setDragId] = useState<FunctionMenuEntryId | null>(null);
  const [dropHint, setDropHint] = useState<{ list: "visible" | "overflow"; before: FunctionMenuEntryId | null } | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const visible = visibleFunctionMenuItems(config);
  const overflow = overflowFunctionMenuItems(config);

  /* ── 自定义入口（10-29 用户：「设置界面里面的每个选项都可以加到这里来」）──
     数据落在 userData/extensions.json（主进程唯一真相源），保存后 bump revision 重拉目录。 */
  const customRevision = useCustomMenuRevision();
  const targets = useFunctionMenuSettingsTargets();
  const [extMenu, setExtMenu] = useState<MenuEntrySpec[]>([]);
  const [pagesOpen, setPagesOpen] = useState(false);
  useEffect(() => { void window.codex.extensionsCatalog?.().then((catalog) => setExtMenu(catalog?.menu ?? [])).catch(() => undefined); }, [customRevision]);
  const rawEntry = (entry: MenuEntrySpec) => ({ id: String(entry.id).replace(/^ext_/, ""), label: entry.label, icon: entry.icon, order: entry.order, action: entry.action });
  const saveMenu = async (next: MenuEntrySpec[]) => {
    try {
      const saved = await window.codex.extensionsMenuSet({ entries: next.map(rawEntry) });
      if (!saved?.ok) return false; /* 主进程拒收（非数组 / 校验全失败）：保持旧目录，不假装成功 */
      bumpCustomMenuRevision();
      return true;
    } catch { return false; /* 写盘失败：保留旧目录，下次打开还能再试 */ }
  };
  /* 删除 = 目录里删 + 从 order/overflow 摘掉（否则重启后靠「目录补进主列表」又长回来）。 */
  const removeCustom = async (entry: MenuEntrySpec) => {
    const ok = await saveMenu(extMenu.filter((item) => item.id !== entry.id));
    if (ok) removeFunctionMenuItems([entry.id]);
  };
  const extMetaOf = (id: string) => {
    const entry = extMenu.find((item) => item.id === id);
    return entry ? ({ label: entry.label, title: "自定义入口：点一下跳到对应设置页", Icon: Puzzle, tone: "ic-cyan" } as MenuMeta) : null;
  };
  const metaOf = (id: FunctionMenuEntryId) => (FUNCTION_MENU_META as Record<string, MenuMeta>)[String(id)] ?? extMetaOf(String(id));
  const targetLabel = (page: string) => targets.find((item) => item.page === page)?.label ?? page;
  /* 默认入口已覆盖的设置页：再加一遍会出现两个「收藏夹 / 开发工具」（10-30 审查）。 */
  const DEFAULT_MENU_PAGES = new Set(["devtools", "favorites"]);
  const CUSTOM_MENU_LIMIT = 40;
  const groups = targets.reduce<Record<string, { page: string; label: string }[]>>((acc, item) => {
    (acc[item.group] ||= []).push({ page: item.page, label: item.label });
    return acc;
  }, {});
  /* 已占用的页面：内置默认两项 + 已加的自定义项（弹窗里置灰，避免重复）。 */
  const takenPages = new Set<string>([
    ...DEFAULT_MENU_PAGES,
    ...extMenu.map((entry) => String(entry.id).replace(/^ext_set_/, "")).filter((page) => extMenu.some((entry) => entry.id === "ext_set_" + page)),
  ]);
  const addTargets = async (pages: { page: string; label: string }[]) => {
    const next = [...extMenu];
    const added: string[] = [];
    for (const item of pages) {
      if (next.length >= CUSTOM_MENU_LIMIT) break;
      const id = "set_" + item.page;
      if (next.some((entry) => entry.id === "ext_" + id)) continue;
      next.push({ id, label: item.label, order: 90, action: { type: "settings", target: item.page } });
      added.push("ext_" + id);
    }
    if (!added.length) return;
    const ok = await saveMenu(next);
    if (ok) appendFunctionMenuItems(added as FunctionMenuEntryId[]);
  };

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => { try { previous?.focus?.(); } catch { /* 元素已卸载 */ } };
  }, []);

  const resetDrag = () => { setDragId(null); setDropHint(null); };

  const drop = (list: "visible" | "overflow", before: FunctionMenuEntryId | null) => {
    const id = dragId;
    if (id && id !== before) moveFunctionMenuItemInMenu(id, list, before);
    resetDrag();
  };

  const onRowDrop = (event: DragEvent, list: "visible" | "overflow", before: FunctionMenuEntryId) => {
    event.preventDefault();
    event.stopPropagation();
    drop(list, before);
  };

  const renderRow = (id: FunctionMenuEntryId, list: "visible" | "overflow") => {
    const meta = metaOf(id);
    if (!meta) return null;
    const Icon = meta.Icon;
    const isDropBefore = dropHint?.list === list && dropHint.before === id;
    return (
      <div
        key={id}
        className={`fm-edit-row ${dragId === id ? "dragging" : ""} ${isDropBefore ? "drop-before" : ""}`}
        draggable
        onDragStart={(event) => { setDragId(id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", id); }}
        onDragEnd={resetDrag}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropHint({ list, before: id }); }}
        onDrop={(event) => onRowDrop(event, list, id)}
      >
        <span className="fm-edit-grip" aria-hidden="true"><GripVertical size={14} /></span>
        <Icon size={14} className={meta.tone} />
        <span className="fm-edit-label">{meta.label}</span>
        <span className="fm-edit-actions">
          <button type="button" title="上移" aria-label={`${meta.label}上移`} onClick={() => nudgeFunctionMenuItemInMenu(id, -1)}><ArrowUp size={13} /></button>
          <button type="button" title="下移" aria-label={`${meta.label}下移`} onClick={() => nudgeFunctionMenuItemInMenu(id, 1)}><ArrowDown size={13} /></button>
          <button type="button" title={list === "visible" ? "收进更多" : "移回菜单"} aria-label={list === "visible" ? `${meta.label}收进更多` : `${meta.label}移回菜单`}
            onClick={() => toggleFunctionMenuItemOverflow(id, list === "visible")}>
            {list === "visible" ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
          </button>
          {String(id).startsWith("ext_") && (
            <button type="button" title="移除这个自定义入口" aria-label={`移除${meta.label}`}
              onClick={() => { const entry = extMenu.find((item) => item.id === id); if (entry) void removeCustom(entry); }}>
              <Trash2 size={13} />
            </button>
          )}
        </span>
      </div>
    );
  };

  const col = (list: "visible" | "overflow", ids: FunctionMenuEntryId[], title: string, hint: string) => (
    <section
      className={`fm-edit-col ${dropHint?.list === list && dropHint.before === null ? "drop-at-end" : ""}`}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropHint({ list, before: null }); }}
      onDrop={(event) => { event.preventDefault(); drop(list, null); }}
    >
      <header><h3>{title}<small>{ids.length}</small></h3><p>{hint}</p></header>
      <div className="fm-edit-list">
        {ids.map((id) => renderRow(id, list))}
        {!ids.length && <div className="fm-edit-empty">{list === "visible" ? "入口都收进「更多」了 —— 至少留一个更方便" : "把入口拖到这里，或点行尾的 ›"}</div>}
      </div>
    </section>
  );

  return (
    <div className="modal-backdrop function-menu-editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeFunctionMenuEditor(); }}
      onKeyDown={(event) => { if (event.key === "Escape") closeFunctionMenuEditor(); }}>
      <div className="function-menu-editor" role="dialog" aria-modal="true" aria-label="编辑拓展功能">
        <header className="fm-editor-head">
          <div><h2>编辑拓展功能</h2><p>拖动排序；拖到右边「更多」即收起。两种展示位置共用这一套。</p></div>
          <button ref={closeRef} type="button" className="fm-editor-close" aria-label="关闭" onClick={closeFunctionMenuEditor}><X size={16} /></button>
        </header>

        <div className="fm-location-grid" role="group" aria-label="功能入口显示位置">
          <button type="button" className={`fm-location-card ${config.location === "top" ? "on" : ""}`} aria-pressed={config.location === "top"}
            onClick={() => setFunctionMenuLocation("top")}>
            <ArrowUpToLine size={16} /><span><b>侧栏顶部</b><small>「新会话 / 搜索任务」下面（常驻不折叠）</small></span>{config.location === "top" && <Check size={14} />}
          </button>
          <button type="button" className={`fm-location-card ${config.location === "bottom" ? "on" : ""}`} aria-pressed={config.location === "bottom"}
            onClick={() => setFunctionMenuLocation("bottom")}>
            <ArrowDownToLine size={16} /><span><b>侧栏底部</b><small>用户名上方（默认，可折叠）</small></span>{config.location === "bottom" && <Check size={14} />}
          </button>
        </div>

        <div className="fm-editor-grid">
          {col("visible", visible, "菜单里", "显示在主导航上的入口")}
          {col("overflow", overflow, "更多", "收进「更多」二级菜单的入口")}
        </div>

        

        <footer className="fm-editor-foot">
          <button type="button" className="secondary-setting fm-custom-add" disabled={extMenu.length >= CUSTOM_MENU_LIMIT}
            title={extMenu.length >= CUSTOM_MENU_LIMIT ? "自定义入口最多 " + CUSTOM_MENU_LIMIT + " 个" : "从设置页挑要加到功能入口的页面"}
            onClick={() => setPagesOpen(true)}>
            <Plus size={14} />添加设置页
          </button>
          <button type="button" className="secondary-setting" onClick={resetFunctionMenuLayoutToDefault}>恢复默认</button>
          <button type="button" className="primary-setting" onClick={closeFunctionMenuEditor}>完成</button>
        </footer>
      </div>
    </div>
  );
}
