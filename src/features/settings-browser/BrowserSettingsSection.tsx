/**
 * 设置页 · browser（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX 与原块逐字一致（仅去掉外层缩进）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 */
import { Check, Globe2 } from "lucide-react";

export type BrowserSettingsSectionProps = { browserHome: any; setBrowserHome: any; setBrowserDraft: any; setNotice: any; toolsStatus: any; ToolCard: any };

export function BrowserSettingsSection(props: BrowserSettingsSectionProps) {
  const { browserHome, setBrowserHome, setBrowserDraft, setNotice, toolsStatus, ToolCard } = props;
  return (
    <>
      <section className="settings-section stack">
                    <div className="settings-grid">
                      <label className="wide"><span>默认起始页</span><div className="input-button"><input value={browserHome} onChange={(event) => setBrowserHome(event.target.value)} placeholder="https://" /><button className="secondary-setting" onClick={() => { localStorage.setItem("browser-home", browserHome.trim()); setBrowserDraft(browserHome.trim()); setNotice("浏览器默认页已保存"); }}><Check size={14} />保存</button></div></label>
                    </div>
                    <div className="settings-actions"><span>面板空态会使用默认起始页作为建议地址；右侧浏览器面板使用内置浏览器视图（Chromium）用于看页面。浏览器自动化优先 Ego Lite（「设置 → 开发工具」安装，每个 Codex 会话一个独立 Space）；未安装时回落 browse-skills（nuphus 默认浏览器）。</span></div>
                    <div className="settings-subhead"><Globe2 size={13} />浏览器自动化工具<span className="settings-subhead-hint">Codex 引擎可直接调用，PATH 与 NODE_PATH 已注入</span></div>
                    <div className="tool-card-grid">
                      {toolsStatus.filter((tool: any) => tool.scope === "browser").map((tool: any) => <ToolCard tool={tool} key={tool.id} />)}
                      {!toolsStatus.length && <p className="muted">正在读取工具状态…</p>}
                    </div>
                    <p className="muted">默认用内置浏览器视图看页面；自动化优先走 <code>ego-browser</code>（每个 Codex 会话一个 <code>codex-&lt;会话ID&gt;</code> TaskSpace，多会话并行），未安装时回落 <code>nuphus-call browser_*</code> 驱动默认浏览器（browse-skills）。Ego Lite 不随应用内置，在「开发工具」页跳官方安装器。</p>
                  </section>
    </>
  );
}
