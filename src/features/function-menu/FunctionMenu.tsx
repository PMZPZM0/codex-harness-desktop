import { createPortal } from "react-dom";
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
  type FunctionMenuItemId,
  type FunctionMenuLocation,
} from "./menu-model.mjs";
import {
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

function MenuItemButton({ id, onDone, dragging, dropBefore, onDragStart, onDragEnd, onDragOver, onDrop }: {
  id: FunctionMenuItemId;
  onDone?: () => void;
  dragging?: boolean;
  dropBefore?: boolean;
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd?: (event: DragEvent<HTMLButtonElement>) => void;
  onDragOver?: (event: DragEvent<HTMLButtonElement>) => void;
  onDrop?: (event: DragEvent<HTMLButtonElement>) => void;
}) {
  const meta = FUNCTION_MENU_META[id];
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
      onClick={() => { runFunctionMenuAction(id); onDone?.(); }}
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
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const [dragId, setDragId] = useState<FunctionMenuItemId | null>(null);
  const [dropBefore, setDropBefore] = useState<FunctionMenuItemId | null>(null);
  const [moreDrop, setMoreDrop] = useState(false);
  if (config.location !== location) return null;
  const visible = visibleFunctionMenuItems(config);
  const overflow = overflowFunctionMenuItems(config);
  const other: FunctionMenuLocation = location === "top" ? "bottom" : "top";
  const resetDrag = () => { setDragId(null); setDropBefore(null); setMoreDrop(false); };
  const dropVisible = (before: FunctionMenuItemId | null) => {
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
        {visible.map((id) => (
          <MenuItemButton
            key={id}
            id={id}
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
        ))}
        {extMenu.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="sidebar-tab sidebar-cap-row"
            title={entry.label}
            onClick={() => {
              if (entry.action.type === "url") void window.codex.openExternal(entry.action.target);
              else if (entry.action.type === "settings") openSettingsFromFunctionMenu(entry.action.target);
            }}
          >
            <Puzzle size={15} className="ic-cyan" /><span>{entry.label}</span><ChevronRight size={13} className="sidebar-cap-chevron" />
          </button>
        ))}
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
        <MorePopover anchor={moreRef.current} overflow={overflow} otherLocation={other} onClose={() => setMoreOpen(false)} />
      )}
    </div>
  );
}

function MorePopover({ anchor, overflow, otherLocation, onClose }: {
  anchor: HTMLElement;
  overflow: FunctionMenuItemId[];
  otherLocation: FunctionMenuLocation;
  onClose: () => void;
}) {
  /* 10-27 架构审查 P1-3：定位/点外关闭/Esc/跟随滚动统一交给 AnchorPopover（本文件不再自己量）。 */
  return (
    <AnchorPopover open anchor={anchor} onClose={onClose} axis="y" align="start" prefer="auto" width={232} className="function-menu-popover" role="menu" ariaLabel="更多拓展功能">
      {overflow.length > 0 ? overflow.map((id) => {
        const meta = FUNCTION_MENU_META[id];
        const Icon = meta.Icon;
        return <button key={id} type="button" role="menuitem" className="function-menu-popover-item" onClick={() => { runFunctionMenuAction(id); onClose(); }}>
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
  const [dragId, setDragId] = useState<FunctionMenuItemId | null>(null);
  const [dropHint, setDropHint] = useState<{ list: "visible" | "overflow"; before: FunctionMenuItemId | null } | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const visible = visibleFunctionMenuItems(config);
  const overflow = overflowFunctionMenuItems(config);

  /* ── 自定义入口（10-29 用户：「设置界面里面的每个选项都可以加到这里来」）──
     数据落在 userData/extensions.json（主进程唯一真相源），保存后 bump revision 重拉目录。 */
  const customRevision = useCustomMenuRevision();
  const targets = useFunctionMenuSettingsTargets();
  const [extMenu, setExtMenu] = useState<MenuEntrySpec[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => { void window.codex.extensionsCatalog?.().then((catalog) => setExtMenu(catalog?.menu ?? [])).catch(() => undefined); }, [customRevision]);
  const rawEntry = (entry: MenuEntrySpec) => ({ id: String(entry.id).replace(/^ext_/, ""), label: entry.label, icon: entry.icon, order: entry.order, action: entry.action });
  const saveMenu = async (next: MenuEntrySpec[]) => {
    try {
      await window.codex.extensionsMenuSet({ entries: next.map(rawEntry) });
      bumpCustomMenuRevision();
    } catch { /* 写盘失败：保留旧目录，下次打开还能再试 */ }
  };
  const removeCustom = (entry: MenuEntrySpec) => void saveMenu(extMenu.filter((item) => item.id !== entry.id));
  const addTarget = (page: string, label: string) => {
    const id = "set_" + page;
    if (extMenu.some((item) => item.id === "ext_" + id)) return;
    void saveMenu([...extMenu, { id, label, order: 90, action: { type: "settings", target: page } }]);
  };
  const targetLabel = (page: string) => targets.find((item) => item.page === page)?.label ?? page;
  const groups = targets.reduce<Record<string, { page: string; label: string }[]>>((acc, item) => {
    (acc[item.group] ||= []).push({ page: item.page, label: item.label });
    return acc;
  }, {});

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => { try { previous?.focus?.(); } catch { /* 元素已卸载 */ } };
  }, []);

  const resetDrag = () => { setDragId(null); setDropHint(null); };

  const drop = (list: "visible" | "overflow", before: FunctionMenuItemId | null) => {
    const id = dragId;
    if (id && id !== before) moveFunctionMenuItemInMenu(id, list, before);
    resetDrag();
  };

  const onRowDrop = (event: DragEvent, list: "visible" | "overflow", before: FunctionMenuItemId) => {
    event.preventDefault();
    event.stopPropagation();
    drop(list, before);
  };

  const renderRow = (id: FunctionMenuItemId, list: "visible" | "overflow") => {
    const meta = FUNCTION_MENU_META[id];
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
        </span>
      </div>
    );
  };

  const col = (list: "visible" | "overflow", ids: FunctionMenuItemId[], title: string, hint: string) => (
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

        <section className="fm-custom" aria-label="自定义入口">
          <header>
            <h3>自定义入口<small>{extMenu.length}</small></h3>
            <p>从设置页挑一项加到「功能入口」（固定排在菜单末尾；内置入口的排序与「更多」分组不受影响）。</p>
          </header>
          {extMenu.length > 0 && (
            <div className="fm-custom-list">
              {extMenu.map((entry) => (
                <div className="fm-custom-row" key={entry.id}>
                  <Puzzle size={13} className="ic-cyan" />
                  <span className="fm-custom-name">{entry.label}</span>
                  <em>{entry.action.type === "settings" ? targetLabel(entry.action.target) : entry.action.type === "url" ? entry.action.target : "说明"}</em>
                  <button type="button" title="移除这个入口" aria-label={"移除" + entry.label} onClick={() => removeCustom(entry)}><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          )}
          <button type="button" className="secondary-setting fm-custom-add" onClick={() => setPickerOpen((open) => !open)}>
            <Plus size={13} />{pickerOpen ? "收起设置页清单" : "添加设置页"}
          </button>
          {pickerOpen && (
            <div className="fm-custom-picker">
              {Object.entries(groups).map(([group, items]) => (
                <div className="fm-custom-group" key={group}>
                  <span className="fm-custom-group-title">{group}</span>
                  <div className="fm-custom-chips">
                    {items.map((item) => {
                      const added = extMenu.some((entry) => entry.id === "ext_set_" + item.page);
                      return (
                        <button key={item.page} type="button" className={added ? "added" : ""} disabled={added} onClick={() => addTarget(item.page, item.label)}>
                          {item.label}{added ? " ✓" : ""}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <footer className="fm-editor-foot">
          <button type="button" className="secondary-setting" onClick={resetFunctionMenuLayoutToDefault}>恢复默认</button>
          <button type="button" className="primary-setting" onClick={closeFunctionMenuEditor}>完成</button>
        </footer>
      </div>
    </div>
  );
}
