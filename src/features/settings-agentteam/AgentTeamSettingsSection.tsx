/**
 * 设置页 · agentteam（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX 与原块逐字一致（仅去掉外层缩进）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 */
import { PageInfo } from "../../components/SettingsHead";
import { Bot, LayoutGrid, Users } from "lucide-react";

export type AgentTeamSettingsSectionProps = { setSettingsPage: any };

export function AgentTeamSettingsSection(props: AgentTeamSettingsSectionProps) {
  const { setSettingsPage } = props;
  return (
    <>
      (
                    <section className="settings-section stack">
                      <div className="settings-copy"><h2>专家和专家团<PageInfo text={<>单体专家与多角色团队的总入口。</>} helpKey="agentteam" label="专家/专家团" /></h2></div>
                      <div className="hub-card-grid hub-card-grid-3">
                        <button className="hub-card" onClick={() => setSettingsPage("agents")}>
                          <span className="hub-card-icon"><Bot size={20} /></span>
                          <strong>子智能体</strong>
                          <p>自定义角色，注册为 subagent_invoke 函数，Codex 在对话中直接调用。</p>
                        </button>
                        <button className="hub-card" onClick={() => setSettingsPage("expert-center")}>
                          <span className="hub-card-icon"><LayoutGrid size={20} /></span>
                          <strong>专家中心</strong>
                          <p>全部专家按领域分类陈列，一眼看清谁能干什么；点卡直达一对一会话。</p>
                        </button>
                        <button className="hub-card" onClick={() => setSettingsPage("teams")}>
                          <span className="hub-card-icon"><Users size={20} /></span>
                          <strong>专家团</strong>
                          <p>主理人按 SOP 编排成员协作，独立会话产出，最终汇总交付。</p>
                        </button>
                      </div>
                    </section>
                  )
    </>
  );
}
