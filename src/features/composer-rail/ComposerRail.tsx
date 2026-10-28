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
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnchorPopover } from "../../components/AnchorPopover";
import { Bookmark, ChevronRight, ExternalLink, KeyRound, NotebookPen, Puzzle, Smile, X } from "lucide-react";
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
];

const ICONS: Record<string, typeof Bookmark> = {
  bookmark: Bookmark,
  key: KeyRound,
  notebook: NotebookPen,
  smile: Smile,
};

const PANEL_SIZE: Record<string, { w: number; h: number }> = {
  favorites: { w: 460, h: 560 },
  passwords: { w: 430, h: 560 },
  journal: { w: 460, h: 580 },
  stickers: { w: 360, h: 420 },
};
const DEFAULT_SIZE = { w: 380, h: 360 };

export function ComposerRail({ app }: { app: HarnessAppApi }) {
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem("composer-rail-open") === "1"; } catch { return false; }
  });
  const [panels, setPanels] = useState<RailPanelSpec[]>(FALLBACK_PANELS);
  const [panelId, setPanelId] = useState<string | null>(null);
  /** 贴边按钮：auto → 右 → 左 → 右 …（真翻边，不是重算同一个位置） */
  const [prefer, setPrefer] = useState<"auto" | "right" | "left">("auto");
  const railRef = useRef<HTMLDivElement>(null);
  /** 用户已经手动开合过：回灌不许再覆盖他的操作 */
  const userTouchedRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

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
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

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
    <div className={`composer-rail${open ? " is-open" : ""}`} ref={railRef} onMouseEnter={() => setBump((value) => value + 1)}>
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
          {panels.map((entry) => {
            const Icon = ICONS[String(entry.icon ?? "")] ?? (entry.kind === "external" ? Puzzle : Bookmark);
            const isPanel = entry.kind === "builtin" || entry.action?.type === "text";
            return (
              <button
                key={entry.id}
                type="button"
                className={`composer-rail-icon${panelId === entry.id ? " is-active" : ""}`}
                aria-pressed={isPanel ? panelId === entry.id : undefined}
                aria-label={entry.label}
                title={entry.label}
                onClick={() => (isPanel ? setPanelId((current) => (current === entry.id ? null : entry.id)) : runExternal(entry))}
              >
                <Icon size={16} />
              </button>
            );
          })}
        </div>
      )}

      {active && (
        <AnchorPopover
          open
          anchor={railRef.current}
          ignoreRef={railRef}
          onClose={() => setPanelId(null)}
          axis="x"
          align="center"
          prefer={prefer}
          width={PANEL_SIZE[active.id]?.w ?? DEFAULT_SIZE.w}
          height={PANEL_SIZE[active.id]?.h ?? DEFAULT_SIZE.h}
          className="composer-rail-panel"
          ariaLabel={active.label}
        >
          <header className="crp-head">
            <span className="crp-title">{(() => { const Icon = ICONS[String(active.icon ?? "")] ?? (active.kind === "external" ? Puzzle : Bookmark); return <Icon size={15} />; })()}{active.label}</span>
            <span className="crp-head-actions">
              <button type="button" className="icon-button" title="重新贴边（换到另一边）" aria-label="重新贴边" onClick={() => setPrefer((current) => (current === "right" ? "left" : "right"))}><ChevronRight size={14} /></button>
              <button type="button" className="icon-button" title="关闭 (Esc)" aria-label="关闭" onClick={() => setPanelId(null)}><X size={15} /></button>
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
        </AnchorPopover>
      )}
    </div>
  );
}
