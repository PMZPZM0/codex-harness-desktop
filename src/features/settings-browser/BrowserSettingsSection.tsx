/**
 * 设置页 · 自动化 → 浏览器（11-06 重排，11-07 视觉升级）。
 *
 * 用户 11-07：「这个卡片做好看一点啊，这么杂乱的文字注释，把联动的展示做出来」——
 * 原来三行「标签 + 长句」+ 脚注读起来像说明书；现在改成**能力链路条 + 三张能力卡**：
 *   · 顶部一眼看清当前走哪条链路（Ego Lite 已装 / 未装回落 browse-skills）；
 *   · 三张卡各管一件事（看页面 / 自动化优先 / 没装时回落），带状态胶囊，
 *     Ego Lite 未安装时给「去开发工具」入口；
 *   · 文案仍然与 automation-policy 同源：Ego Lite 优先、未装回落 browse-skills。
 */
import { useEffect, useState } from "react";
import { ArrowUpRight, Check, ChevronRight, Globe2, Monitor, Route, Sparkles } from "lucide-react";

export type BrowserSettingsSectionProps = {
  browserHome: any;
  setBrowserHome: any;
  setBrowserDraft: any;
  setNotice: any;
  toolsStatus: any;
  ToolCard: any;
  /** 跳「设置 → 开发工具」（Ego Lite 的安装/查看入口）。 */
  onOpenDevtools?: () => void;
};

export function BrowserSettingsSection(props: BrowserSettingsSectionProps) {
  const { browserHome, setBrowserHome, setBrowserDraft, setNotice, toolsStatus, ToolCard, onOpenDevtools } = props;
  const browserTools = (toolsStatus || []).filter((tool: any) => tool.scope === "browser");
  /* 真实安装态：不再是死文案 —— 装没装直接显示在链路上（用户令「把联动的展示做出来」）。 */
  const [ego, setEgo] = useState<{ installed: boolean; version: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void window.codex.egoStatus()
      .then((status) => { if (alive) setEgo({ installed: Boolean(status?.installed), version: String(status?.version ?? "") }); })
      .catch(() => { if (alive) setEgo({ installed: false, version: "" }); });
    return () => { alive = false; };
  }, []);
  const installed = ego?.installed === true;
  const checking = ego === null;
  /* 主进程给的 version 形如 `ego-browser 0.6.2.8`；卡里已在代码块写了名字，这里只留版本号。 */
  const egoVersion = String(ego?.version ?? "").replace(/^ego-browser\s*/i, "").trim();
  const egoTag = checking ? "检测中" : installed ? "已安装" : "未安装";
  const egoTagTone = checking ? "" : installed ? " is-ok" : " is-warn";

  return (
    <section className="settings-section stack">
      <div className="settings-card">
        <div className="settings-card-head"><Globe2 size={14} />默认起始页<span className="settings-card-head-hint">面板空态用它做建议地址</span></div>
        <div className="settings-card-body">
          <div className="settings-grid">
            <label className="wide"><span>地址</span><div className="input-button"><input value={browserHome} onChange={(event) => setBrowserHome(event.target.value)} placeholder="https://" /><button className="secondary-setting" onClick={() => { localStorage.setItem("browser-home", browserHome.trim()); setBrowserDraft(browserHome.trim()); setNotice("浏览器默认页已保存"); }}><Check size={14} />保存</button></div></label>
          </div>
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-card-head"><Sparkles size={14} />浏览器自动化<span className="settings-card-head-hint">引擎可直接调用 · 环境已注入</span></div>
        <div className="settings-card-body">
          {/* 当前链路：装了就 Ego Lite 打亮，没装就把回落打亮 —— 一眼看出现在用哪条。 */}
          <div className="browser-chain" aria-label="当前浏览器自动化链路">
            <span className="browser-chain-label">当前链路</span>
            <span className={`browser-chain-node${installed ? " is-on" : ""}`}>Ego Lite<span className="browser-chain-tag">{checking ? "检测中" : installed ? "使用中" : "未安装"}</span></span>
            <ChevronRight size={13} className="browser-chain-arrow" />
            <span className={`browser-chain-node${checking || installed ? "" : " is-on"}`}>browse-skills<span className="browser-chain-tag">{checking ? "待命" : installed ? "待命" : "回落中"}</span></span>
          </div>

          <div className="browser-cap-grid">
            <article className="browser-cap-card">
              <div className="browser-cap-head">
                <span className="browser-cap-icon is-blue"><Monitor size={15} /></span>
                <strong>看页面</strong>
                <em className="browser-cap-tag">内置</em>
              </div>
              <p>右栏浏览器面板用内置 Chromium 视图，不改本机默认浏览器。</p>
            </article>

            <article className={`browser-cap-card${installed ? " is-on" : ""}`}>
              <div className="browser-cap-head">
                <span className="browser-cap-icon is-violet"><Sparkles size={15} /></span>
                <strong>自动化优先</strong>
                <em className={`browser-cap-tag${egoTagTone}`}>{egoTag}</em>
              </div>
              <p><code>ego-browser</code>{installed && egoVersion ? <span className="browser-cap-ver"> v{egoVersion}</span> : null}：每个 Codex 会话一个独立 Space，多会话并行、共享登录态。</p>
              {onOpenDevtools && (
                <button type="button" className="browser-cap-action" onClick={onOpenDevtools}>
                  {installed ? "去开发工具查看" : "去开发工具安装"}<ArrowUpRight size={12} />
                </button>
              )}
            </article>

            <article className={`browser-cap-card${checking || installed ? "" : " is-on"}`}>
              <div className="browser-cap-head">
                <span className="browser-cap-icon is-amber"><Route size={15} /></span>
                <strong>没装时回落</strong>
                <em className="browser-cap-tag">{checking ? "待命" : installed ? "待命" : "当前启用"}</em>
              </div>
              <p><code>nuphus-call browser_*</code>（browse-skills）驱动默认浏览器，不需要额外安装。</p>
            </article>
          </div>

          {browserTools.length > 0 && (
            <div className="tool-card-grid">
              {browserTools.map((tool: any) => <ToolCard tool={tool} key={tool.id} />)}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
