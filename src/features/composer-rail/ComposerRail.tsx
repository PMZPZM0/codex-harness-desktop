/**
 * ComposerRail（10-27）：输入框**左侧**的那条竖条 + 弹层。
 *
 * 用户原话：「在输入框左边这个地方，线上中间加一个小粗条，做好展开折叠两种状态反馈，
 * 点击展开竖着的小窗口，自适应展示位置，不要主界面小窗口展示不出来，注意多窗口自适应展示弹窗
 * 别被切掉了，跟输入框一样高，宽度就一个图标宽度，最上面一个收藏夹图标…第二个密码本…
 * 第三个开发日记…表情包图标…这个小贴条可以跨会话展示，所有会话点击展示都一样，
 * 使用UI技能完成这个是默认隐藏的，点击小粗条自适应位置展示」。
 * 追加：「这个小粗条弹窗记得留好IPC接口…方便后续拓展和用户拓展」。
 *
 * 结构：
 *   折叠 = 一根本 6px 的圆角粗条（骑在输入框左边线外侧，垂直居中）
 *   展开 = 26px 一列图标、与输入框同高（内置四个 + 用户扩展项）
 * 面板来源：`extensions:catalog`（主进程）—— ⛔ 面板清单**不在组件里写死**，
 *   用户往 `userData/extensions.json` 里加一条就多一个入口（封闭动作集：url / settings / text）。
 * 弹层：portal 到 body，按**实测矩形**定位，右开优先、放不下翻左、上下夹进视口。
 * 跨会话：挂在输入框上 ⇒ 每个会话同一个组件；展开状态存 localStorage，所有会话一致。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bookmark, ExternalLink, Keyboard, KeyRound, NotebookPen, Puzzle, Smile, X } from "lucide-react";
import type { HarnessAppApi } from "../app-state";
import { FavoritesSettingsSection } from "../settings-favorites";
import { PasswordBookPanel } from "./PasswordBookPanel";
import { DevJournalPanel } from "./DevJournalPanel";
import { MoodStickersPanel } from "./MoodStickersPanel";

/** 内置面板（IPC 拿不到目录时的兜底；正常情况以主进程 `extensions:catalog` 为准）。 */
const FALLBACK_PANELS: RailPanelSpec[] = [
  { id: "favorites", label: "收藏夹", icon: "bookmark", kind: "builtin", order: 10 },
  { id: "passwords", label: "密码本", icon: "key", kind: "builtin", order: 20 },
  { id: "journal", label: "开发日记", icon: "notebook", kind: "builtin", order: 30 },
  { id: "stickers", label: "心情表情", icon: "smile", kind: "builtin", order: 40 },
  { id: "shortcuts", label: "快捷键", icon: "keyboard", kind: "builtin", order: 50 },
];

const ICONS: Record<string, typeof Bookmark> = {
  bookmark: Bookmark,
  key: KeyRound,
  notebook: NotebookPen,
  smile: Smile,
  keyboard: Keyboard,
};

/* 10-28 用户令：「这四个按键都做成弹窗…这个弹窗可以应用居中，不用非要贴这里，展示太少了，
   弹窗都太小了，看的东西很少，做成弹窗居中，适当大一点弹窗，不要内联弹窗」
   ⇒ 四个面板统一走**居中弹窗**（`.modal-backdrop` + `.composer-rail-modal`），
     尺寸与位置交给 CSS（这里不再按面板逐个算宽高，也不再有"贴边/翻边"）。 */

export function ComposerRail({ app }: { app: HarnessAppApi }) {
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem("composer-rail-open") === "1"; } catch { return false; }
  });
  const [panels, setPanels] = useState<RailPanelSpec[]>(FALLBACK_PANELS);
  const [panelId, setPanelId] = useState<string | null>(null);
  /* 10-28 用户：「加一个拖动顺序功能」—— 拖拽只改**渲染顺序**并落 app-settings，
     ⛔ 不去改主进程 extensions.json（那是扩展目录的真相源，内置项的 order 也是它的语义）。 */
  const [order, setOrder] = useState<string[]>([]);
  const dragIdRef = useRef<string | null>(null);
  /** 用户已经手动开合过：回灌不许再覆盖他的操作 */
  const userTouchedRef = useRef(false);
  /** 居中弹窗容器：打开时把焦点收进来（键盘用户 Tab 不会从背后开始）。 */
  const modalRef = useRef<HTMLElement>(null);
  /** 打开弹窗之前焦点在哪：关闭时还回去（否则焦点掉到 body，键盘用户要从头 Tab）。 */
  const returnFocusRef = useRef<HTMLElement | null>(null);

  /* Esc / Tab 都在这里处理（capture 阶段）：
     · Esc 只关这一层 —— `stopPropagation()` 防止同一次按键连带关掉背后的浮层/设置；
     · Tab 在弹窗内**首尾循环** —— 已经声明 `aria-modal="true"`，就必须把焦点圈住，
       否则 Tab 会跑到背后输入框里，声明与行为不一致（键盘用户会迷路）。 */
  useEffect(() => {
    const panel = modalRef.current;
    if (!panel) {
      /* 关闭态：把焦点还给打开它的那颗图标（只在"曾经打开过"时做，避免首帧抢焦点）。 */
      returnFocusRef.current?.focus?.();
      returnFocusRef.current = null;
      return;
    }
    /* ⛔ 只在第一次打开时记录：面板之间切换（A → B）时旧面板已卸载，此刻 activeElement 是 body，
       若每次都覆盖就会把"该还给谁"丢失，关闭后焦点落到 body。 */
    if (!returnFocusRef.current) returnFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setPanelId(null);
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((el) => el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const current = document.activeElement as HTMLElement | null;
      if (!event.shiftKey && current === last) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && (current === first || current === panel)) { event.preventDefault(); last.focus(); }
    };
    window.addEventListener("keydown", onKey, true);
    panel.focus();
    return () => window.removeEventListener("keydown", onKey, true);
  }, [panelId]);

  /* 目录：内置 + 用户扩展（userData/extensions.json）。失败就用兜底，绝不让竖条消失。 */
  useEffect(() => {
    let alive = true;
    void window.codex.extensionsCatalog?.().then((catalog) => {
      if (alive && Array.isArray(catalog?.rail) && catalog.rail.length) setPanels(catalog.rail);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  /* 10-27 审查：展开态按本仓既有约定**双写**（localStorage 只是缓存，app-settings 才是重启后的回灌源）
     —— 之前只写 localStorage，清缓存/换数据目录就静默回到折叠。 */
  useEffect(() => {
    let alive = true;
    void window.codex.readAppSettings?.().then((settings) => {
      if (!alive || userTouchedRef.current) return;
      if (typeof settings?.composerRailOpen === "boolean") setOpen(settings.composerRailOpen);
      if (Array.isArray(settings?.composerRailOrder)) setOrder(settings.composerRailOrder);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  /** 用户顺序优先；order 里没有的（新加的内置项 / 用户扩展项）保持目录原顺序排在后面。 */
  const orderedPanels = useMemo(() => {
    if (!order.length) return panels;
    const rank = new Map(order.map((id, index) => [id, index]));
    return [...panels].sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  }, [panels, order]);

  /** 把 fromId 拖到 toId 的位置；结果立即落盘（双写：state 供本次渲染，app-settings 供重启）。 */
  const moveIcon = useCallback((fromId: string, toId: string) => {
    if (!fromId || !toId || fromId === toId) return;
    const ids = orderedPanels.map((entry) => entry.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setOrder(ids);
    void window.codex.saveAppSettings?.({ composerRailOrder: ids })?.catch(() => undefined);
  }, [orderedPanels]);

  const active = panels.find((entry) => entry.id === panelId) ?? null;

  /* 10-27 用户：「这个一直展示不会自动隐藏，10秒后自动隐藏，打开了这些按键的里面的弹窗
     就暂时不触发自动隐藏」⇒ 展开后 10s 自动收回；**有面板打开时不收**；
     鼠标进竖条 / 移动一次重新计时（不然手刚伸过去就消失了）。 */
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (!open || panelId) return;
    const timer = window.setTimeout(() => {
      setOpen(false);
      try { localStorage.setItem("composer-rail-open", "0"); } catch { /* 隐私模式 */ }
      void window.codex.saveAppSettings?.({ composerRailOpen: false })?.catch(() => undefined);
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [open, panelId, bump]);

  const toggleOpen = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      userTouchedRef.current = true;
      try { localStorage.setItem("composer-rail-open", next ? "1" : "0"); } catch { /* 隐私模式 */ }
      void window.codex.saveAppSettings?.({ composerRailOpen: next })?.catch(() => undefined);
      if (!next) setPanelId(null);
      return next;
    });
  }, []);

  /** 用户扩展项：按封闭动作集执行（⛔ 不执行命令）。 */
  const runExternal = useCallback((entry: RailPanelSpec) => {
    const action = entry.action;
    if (!action) return;
    if (action.type === "url") { void window.codex.openExternal(action.target); return; }
    if (action.type === "settings") { app.setSettingsPage?.(action.target as any); app.setSettingsOpen?.(true); return; }
    setPanelId(entry.id);
  }, [app]);

  return (
    <div className={`composer-rail${open ? " is-open" : ""}`} onMouseEnter={() => setBump((value) => value + 1)}>
      <button
        type="button"
        className="composer-rail-toggle"
        aria-expanded={open}
        aria-label={open ? "收起快捷条" : "展开快捷条：收藏夹 / 密码本 / 开发日记 / 心情表情"}
        title={open ? "收起快捷条" : "展开快捷条"}
        onClick={toggleOpen}
      >
        <span className="composer-rail-grip" aria-hidden />
      </button>

      {open && (
        <div className="composer-rail-icons" role="toolbar" aria-label="输入框快捷条">
          {orderedPanels.map((entry) => {
            const Icon = ICONS[String(entry.icon ?? "")] ?? (entry.kind === "external" ? Puzzle : Bookmark);
            const isPanel = entry.kind === "builtin" || entry.action?.type === "text";
            return (
              <button
                key={entry.id}
                type="button"
                /* 拖动排序（10-28）：拖动只换位置，不触发面板；配合下面的 onDrop 落盘。 */
                draggable
                onDragStart={() => { dragIdRef.current = entry.id; }}
                onDragEnd={() => { dragIdRef.current = null; }}
                onDragOver={(event) => { event.preventDefault(); }}
                onDrop={(event) => { event.preventDefault(); const from = dragIdRef.current; dragIdRef.current = null; if (from) moveIcon(from, entry.id); }}
                className={`composer-rail-icon${panelId === entry.id ? " is-active" : ""}`}
                aria-pressed={isPanel ? panelId === entry.id : undefined}
                aria-label={entry.label}
                title={`${entry.label}（可拖动排序）`}
                onClick={() => {
                  /* ⛔ 快捷键不是 rail 内联面板（内容太大、要搜索/逐条改键）：直接开全局弹窗。
                     与「设置 → 控制台 → 键盘快捷键」是同一个组件 ⇒ 两处永远一致。 */
                  if (entry.id === "shortcuts") { setPanelId(null); app.setShortcutsOpen?.(true); return; }
                  if (isPanel) setPanelId((current) => (current === entry.id ? null : entry.id));
                  else runExternal(entry);
                }}
              >
                <Icon size={18} />
              </button>
            );
          })}
        </div>
      )}

      {active && createPortal(
        <div
          className="modal-backdrop composer-rail-backdrop"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setPanelId(null); }}
        >
          <section
            className="composer-rail-panel"
            role="dialog"
            aria-modal="true"
            aria-label={active.label}
            tabIndex={-1}
            ref={modalRef}
          >
            <header className="crp-head">
              <span className="crp-title">{(() => { const Icon = ICONS[String(active.icon ?? "")] ?? (active.kind === "external" ? Puzzle : Bookmark); return <Icon size={16} />; })()}{active.label}</span>
              <span className="crp-head-actions">
                <button type="button" className="icon-button" title="关闭（Esc）" aria-label="关闭" onClick={() => setPanelId(null)}><X size={16} /></button>
              </span>
            </header>
            <div className="crp-body">
            {active.id === "favorites" && (
              <FavoritesSettingsSection
                favorites={app.favorites}
                busy={app.favoritesBusy}
                workspace={app.workspace}
                onInsert={app.insertFavorite}
                onSend={app.sendFavorite}
                onAdd={app.addFavoriteItem}
                onUpdate={app.updateFavoriteItem}
                onRemove={app.removeFavoriteItems}
                onRefresh={app.refreshFavorites}
                onToMemory={app.favoriteToMemory}
                onNotice={app.setNotice}
                onToast={app.showToast}
              />
            )}
            {active.id === "passwords" && <PasswordBookPanel onToast={app.showToast} onNotice={app.setNotice} />}
            {active.id === "journal" && <DevJournalPanel onInsert={(text) => app.setPrompt((current) => (current.trim() ? `${current}\n\n${text}` : text))} />}
            {active.id === "stickers" && <MoodStickersPanel onDone={() => setPanelId(null)} onInsert={(text) => app.setPrompt((current: string) => (current.trim() ? `${current} ${text}` : text))} />}
            {active.kind === "external" && (
              <div className="crp-external">
                {active.action?.type === "text" ? <p>{active.action.body}</p> : (
                  <button type="button" className="secondary-setting" onClick={() => runExternal(active)}><ExternalLink size={13} />打开</button>
                )}
              </div>
            )}
          </div>
          </section>
        </div>,
        document.body,
      )}
    </div>
  );
}
