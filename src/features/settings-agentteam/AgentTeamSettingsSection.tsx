/**
 * 设置页 · agentteam（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX 与原块逐字一致（仅去掉外层缩进）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 */
import { Bot, LayoutGrid, SquareTerminal, Users } from "lucide-react";

export type AgentTeamSettingsSectionProps = { setSettingsPage: any };

export function AgentTeamSettingsSection(props: AgentTeamSettingsSectionProps) {
  const { setSettingsPage } = props;
  return (
    <>
                    <section className="settings-section stack">
                      <div className="hub-card-grid hub-card-grid-3">
                        <button className="hub-card" onClick={() => setSettingsPage("agents")}>
                          <span className="hub-card-icon"><Bot size={20} /></span>
                          <strong>子智能体</strong>
                          <p>自定义角色，经统一调度工具 agent_invoke（kind=subagent）调用——子智能体默认可用，建好即可派活。</p>
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
                        {/* ★ 10-31 用户令：「把 cli 智能体入口放到设置-专家/专家团里面」——
                            它与专家 / 子智能体同为可 @ 派活的调度对象，从「开发工具」挪到这里。 */}
                        <button className="hub-card" onClick={() => setSettingsPage("cli-agents")}>
                          <span className="hub-card-icon"><SquareTerminal size={20} /></span>
                          <strong>CLI 智能体</strong>
                          <p>接入本机命令行 AI（Claude Code / Qwen Code / QwenPaw / iFlow / Kimi 等），一键安装后 @ 直接派活。</p>
                        </button>
                      </div>
                    </section>
    </>
  );
}
