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
                    <div className="settings-copy"><h2>浏览器控制</h2><p>内置浏览器面板与自动化浏览器工具链。</p></div>
                    <div className="settings-grid">
                      <label className="wide"><span>默认起始页</span><div className="input-button"><input value={browserHome} onChange={(event) => setBrowserHome(event.target.value)} placeholder="https://" /><button className="secondary-setting" onClick={() => { localStorage.setItem("browser-home", browserHome.trim()); setBrowserDraft(browserHome.trim()); setNotice("浏览器默认页已保存"); }}><Check size={14} />保存</button></div></label>
                    </div>
                    <div className="settings-actions"><span>面板空态会使用默认起始页作为建议地址；右侧浏览器面板默认使用内置浏览器视图（Chromium），需要过反爬站点时可用工具栏的隐身浏览按钮打开 CloakBrowser（未安装会提示到「开发工具」按需下载）。</span></div>
                    <div className="settings-subhead"><Globe2 size={13} />浏览器自动化工具<span className="settings-subhead-hint">Codex 引擎可直接调用，PATH 与 NODE_PATH 已注入</span></div>
                    <div className="tool-card-grid">
                      {toolsStatus.filter((tool: any) => tool.scope === "browser").map((tool: any) => <ToolCard tool={tool} key={tool.id} />)}
                      {!toolsStatus.length && <p className="muted">正在读取工具状态…</p>}
                    </div>
                    <p className="muted">默认用内置浏览器视图与 <code>playwright-cli</code>（open → snapshot → click/type）；有反爬/验证码的站点才用 CloakBrowser（<code>CLOAKBROWSER_ENTRY</code> 动态 import，humanize + geoip），它不随应用内置，需在「开发工具」页按需下载。引擎已内置这两条路径的使用说明。</p>
                  </section>
    </>
  );
}
