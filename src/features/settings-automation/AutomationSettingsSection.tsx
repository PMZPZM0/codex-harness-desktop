/**
 * 设置页 · automation（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX 与原块逐字一致（仅去掉外层缩进）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 */
import { Globe2, ShieldCheck, Workflow } from "lucide-react";

export type AutomationSettingsSectionProps = { setSettingsPage: any };

export function AutomationSettingsSection(props: AutomationSettingsSectionProps) {
  const { setSettingsPage } = props;
  return (
    <>
      (
                    <section className="settings-section stack">
                      <div className="settings-copy"><h2>自动化</h2><p>浏览器、桌面与 RPA 三类自动化能力的总入口。</p></div>
                      <div className="hub-card-grid">
                        <button className="hub-card" onClick={() => setSettingsPage("browser")}>
                          <span className="hub-card-icon"><Globe2 size={20} /></span>
                          <strong>浏览器自动化</strong>
                          <p>内置浏览器面板与 playwright-cli / CloakBrowser 工具链；默认起始页设置在这里。</p>
                        </button>
                        <button className="hub-card" onClick={() => setSettingsPage("computer")}>
                          <span className="hub-card-icon"><ShieldCheck size={20} /></span>
                          <strong>桌面自动化</strong>
                          <p>审批与沙箱策略，nuphus MCP 桌面工具（截屏、键鼠、窗口、OCR）。</p>
                        </button>
                        <button className="hub-card" onClick={() => setSettingsPage("rpa")}>
                          <span className="hub-card-icon"><Workflow size={20} /></span>
                          <strong>RPA 自动化</strong>
                          <p>Codex 自主沉淀流程配方，下次一句话直接复现；任务清单自主维护。</p>
                        </button>
                      </div>
                    </section>
                  )
    </>
  );
}
