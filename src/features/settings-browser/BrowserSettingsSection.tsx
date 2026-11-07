/**
 * 设置页 · 自动化 → 浏览器（11-06 重排展示）。
 *
 * 原来是一段长文字 + 一张工具卡；现在拆成两张卡：
 *  ① 默认起始页（输入 + 保存）；
 *  ② 浏览器自动化（三条要点说清「看页面 / 自动化优先级 / 没装时回落」，再列工具卡）。
 * ⛔ 文案口径不变（与 automation-policy 同源）：Ego Lite 优先、未装回落 browse-skills。
 */
import { Check, Globe2 } from "lucide-react";

export type BrowserSettingsSectionProps = { browserHome: any; setBrowserHome: any; setBrowserDraft: any; setNotice: any; toolsStatus: any; ToolCard: any };

export function BrowserSettingsSection(props: BrowserSettingsSectionProps) {
  const { browserHome, setBrowserHome, setBrowserDraft, setNotice, toolsStatus, ToolCard } = props;
  const browserTools = (toolsStatus || []).filter((tool: any) => tool.scope === "browser");
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
        <div className="settings-card-head"><Globe2 size={14} />浏览器自动化<span className="settings-card-head-hint">Codex 引擎可直接调用，PATH 与 NODE_PATH 已注入</span></div>
        <div className="settings-card-body">
          <ul className="auto-bullets">
            <li><b>看页面</b><span>右栏浏览器面板用内置 Chromium 视图，不改本机默认浏览器。</span></li>
            <li><b>自动化优先</b><span><code>ego-browser</code>（Ego Lite）：每个 Codex 会话一个独立 <code>codex-&lt;会话ID&gt;</code> Space，多会话并行、共享登录态。</span></li>
            <li><b>没装 Ego Lite</b><span>自动回落 <code>nuphus-call browser_*</code>（browse-skills，驱动默认浏览器）。Ego Lite 不随包内置，到「开发工具」页跳官方安装器。</span></li>
          </ul>
          <div className="tool-card-grid">
            {browserTools.map((tool: any) => <ToolCard tool={tool} key={tool.id} />)}
          </div>
          <p className="settings-card-hint">浏览器自动化不需要额外安装：Ego Lite 在「开发工具」页跳官方安装器，未装时自动回落 browse-skills。</p>
        </div>
      </div>
    </section>
  );
}
