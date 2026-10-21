/**
 * 新手引导 · 侧栏常驻入口 + 「迷你设置」弹窗（2026-10-07 立）。
 *
 * 用户需求：侧栏底部加一个常驻板块（会话列表之下、账户行之上 —— 截图红框处），点击后弹窗，
 * 左选项 / 右内容 = 迷你版设置界面；内容 = 模型配置 / 开发工具 / 人格市场三个**设置页映射** + 置底的
 * 版本更新日志；留好 UI 拓展接口（加一节 = sections.tsx 数组加一项，见其头注）。
 *
 * ── 行为约定 ─────────────────────────────────────────────────────────────
 *   · 「打开设置」= 关弹窗 + `onOpenSettings(page)`（设置页 id 的真相源是 settingsNav，守卫比对）；
 *   · 版本日志数据 = `whatsnew:history`（⛔ 单一真相源，本组件不抄任何版本数据）；
 *   · 关闭三路：✕ / 点遮罩 / Esc（与本仓既有弹窗同口径）。
 * ⛔ 本板块**不进 bag**：自包含、局部 state（同 codex-official-market / component-library 的样板），
 *   免得给 1,400 项的 bag 再添字段。
 */
import { Fragment, useCallback, useEffect, useState } from "react";
import { ArrowRight, ExternalLink, Lightbulb, LoaderCircle, Rocket, X } from "lucide-react";
import { GUIDE_SECTIONS, type GuideSection, type GuideTier } from "./sections";
import { GuideFigureView } from "./figures";

type HistoryEntry = { version: string; date: string; items: { t: string; d?: string }[]; releaseUrl: string };
type HistoryState = { status: "idle" | "loading" | "ok" | "error"; entries: HistoryEntry[]; error?: string };

/** 左导航分组（10-18 用户：「分新手和高级教程」）；更新日志不参与分组，单独置底。 */
const GUIDE_TIERS: { id: GuideTier; label: string }[] = [
  { id: "beginner", label: "新手教程" },
  { id: "advanced", label: "高级教程" },
];

/**
 * @param open / onOpenChange **受控打开**（10-21 侧栏重排）：传了 `open` 就**不再渲染内置入口行** ——
 *   入口由调用方自己画（侧栏底部「新手教程」一行，与其它导航项同款）。
 *   ⛔ 不传 = 老行为（自带一行「新手引导」入口），别的调用方不用改。
 */
export function NewbieGuide({ onOpenSettings, open: openProp, onOpenChange }: {
  onOpenSettings?: (page: string) => void;
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
}) {
  const [openState, setOpenState] = useState(false);
  const controlled = typeof openProp === "boolean";
  const open = controlled ? openProp : openState;
  const setOpen = (next: boolean) => {
    if (controlled) onOpenChange?.(next);
    else setOpenState(next);
  };
  const [activeId, setActiveId] = useState(GUIDE_SECTIONS[0]?.id ?? "start");
  const [history, setHistory] = useState<HistoryState>({ status: "idle", entries: [] });

  const active: GuideSection | undefined = GUIDE_SECTIONS.find((section) => section.id === activeId) ?? GUIDE_SECTIONS[0];

  /* 版本日志**按需拉取** + 缓存：打开日志节才请求一次；失败可见（同组件库的错误可见口径）。 */
  const loadHistory = useCallback(() => {
    setHistory((current) => (current.status === "loading" || current.status === "ok" ? current : { ...current, status: "loading" }));
    void window.codex.whatsNewHistory().then((result: any) => {
      const entries = Array.isArray(result?.entries) ? result.entries : [];
      setHistory({ status: "ok", entries });
    }).catch((error: any) => {
      setHistory({ status: "error", entries: [], error: String(error?.message ?? error) });
    });
  }, []);
  useEffect(() => {
    if (open && active?.changelog && history.status === "idle") loadHistory();
  }, [open, active?.changelog, history.status, loadHistory]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const jump = (page: string) => {
    setOpen(false);
    onOpenSettings?.(page);
  };

  return (
    <>
      {/* 侧栏常驻入口（非受控时才画；受控形态由侧栏底部导航组提供「新手教程」一行） */}
      {!controlled && (
        <button type="button" className="guide-entry" onClick={() => setOpen(true)} title="新手教程：第一次用点这里">
          <Rocket size={15} />
          <span className="guide-entry-label">新手教程</span>
          <span className="guide-entry-sub">第一次用？</span>
        </button>
      )}
      {open && (
        <div
          className="modal-backdrop guide-backdrop"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}
        >
          <div className="guide-modal" role="dialog" aria-modal="true" aria-label="新手引导">
            <aside className="guide-nav">
              <div className="guide-nav-head"><Rocket size={15} /><strong>新手引导</strong></div>
              {GUIDE_TIERS.map((tier) => {
                const items = GUIDE_SECTIONS.filter((section) => section.tier === tier.id);
                if (!items.length) return null;
                return (
                  <Fragment key={tier.id}>
                    <div className="guide-nav-group">{tier.label}</div>
                    {items.map((section) => (
                      <button
                        key={section.id}
                        type="button"
                        className={`guide-nav-item ${section.id === active?.id ? "active" : ""}`}
                        onClick={() => setActiveId(section.id)}
                      >
                        <section.icon size={15} />
                        <span>{section.label}</span>
                      </button>
                    ))}
                  </Fragment>
                );
              })}
              {GUIDE_SECTIONS.some((section) => !section.tier) && <div className="guide-nav-sep" aria-hidden />}
              {GUIDE_SECTIONS.filter((section) => !section.tier).map((section) => (
                <button
                  key={section.id}
                  type="button"
                  className={`guide-nav-item ${section.id === active?.id ? "active" : ""}`}
                  onClick={() => setActiveId(section.id)}
                >
                  <section.icon size={15} />
                  <span>{section.label}</span>
                </button>
              ))}
            </aside>
            <section className="guide-body">
              <header className="guide-body-head">
                <div className="guide-body-title">
                  <h3>{active?.title}</h3>
                  {active?.tier && (
                    <span className={`guide-tier-pill is-${active.tier}`}>{active.tier === "beginner" ? "新手" : "高级"}</span>
                  )}
                </div>
                <button type="button" className="guide-close" title="关闭" aria-label="关闭" onClick={() => setOpen(false)}><X size={16} /></button>
              </header>
              {active?.changelog ? (
                <div className="guide-changelog">
                  {history.status === "loading" && <div className="guide-status"><LoaderCircle size={14} className="spin" />正在读取版本记录…</div>}
                  {history.status === "error" && (
                    <div className="guide-status guide-status-error">
                      读取失败：{history.error}
                      <button type="button" className="guide-retry" onClick={loadHistory}>重试</button>
                    </div>
                  )}
                  {history.status === "ok" && history.entries.map((entry) => (
                    <article className="guide-release" key={entry.version}>
                      <div className="guide-release-head">
                        <b>v{entry.version}</b>
                        <span>{entry.date}</span>
                        {entry.releaseUrl && (
                          <button type="button" className="guide-release-link" title="在 GitHub 查看完整说明"
                            onClick={() => void window.codex.openExternal(entry.releaseUrl)}>
                            查看完整说明<ExternalLink size={11} />
                          </button>
                        )}
                      </div>
                      <ul>
                        {entry.items.map((item, index) => (
                          <li key={index}><b>{item.t}</b>{item.d ? <span>{item.d}</span> : null}</li>
                        ))}
                      </ul>
                    </article>
                  ))}
                  {history.status === "ok" && history.entries.length === 0 && <div className="guide-status">这个版本还没有写更新记录。</div>}
                </div>
              ) : (
                <>
                  <p className="guide-intro">{active?.intro}</p>
                  {/* 10-18：图示 + 文字（用户：「画图+字结合起来」）—— 图是数据驱动的示意图，见 figures.tsx */}
                  <GuideFigureView figure={active?.figure} />
                  <ol className="guide-steps">
                    {active?.steps.map((step, index) => (
                      <li key={index}>
                        <span className="guide-step-index">{index + 1}</span>
                        <div><b>{step.t}</b>{step.d ? <small>{step.d}</small> : null}</div>
                      </li>
                    ))}
                  </ol>
                  {active?.tip && (
                    <aside className="guide-tip">
                      <Lightbulb size={14} />
                      <div><b>{active.tip.t}</b>{active.tip.d ? <small>{active.tip.d}</small> : null}</div>
                    </aside>
                  )}
                  {active?.action && (
                    <button type="button" className="guide-action" onClick={() => jump(active.action!.page)}>
                      {active.action.label}<ArrowRight size={14} />
                    </button>
                  )}
                </>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}
