/**
 * 设置页 · memory（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX 与原块逐字一致（仅去掉外层缩进）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 */
import { PageInfo } from "../../components/SettingsHead";
import { Archive, BookOpen, Cloud, LayoutGrid, Search } from "lucide-react";
import { MemoryConfigModal } from "../../features/memory";

export type MemoryCenterSectionProps = { memoryEnabled: any; setMemoryEnabled: any; setMemoryCenterTab: any; setMemoryCenterOpen: any; memories: any; memoryGroups: any; memoryLayers: any; memoryMode: any; workspaceMemoryEnabled: any; threads: any; scheduledTasks: any; localSkills: any; memoryStatus: any; memoryConfigOpen: any; memoryGateway: any; setMemoryGateway: any; memoryGatewayAction: any; setMemoryConfigOpen: any; testMemoryGateway: any; saveMemoryGateway: any };

export function MemoryCenterSection(props: MemoryCenterSectionProps) {
  const { memoryEnabled, setMemoryEnabled, setMemoryCenterTab, setMemoryCenterOpen, memories, memoryGroups, memoryLayers, memoryMode, workspaceMemoryEnabled, threads, scheduledTasks, localSkills, memoryStatus, memoryConfigOpen, memoryGateway, setMemoryGateway, memoryGatewayAction, setMemoryConfigOpen, testMemoryGateway, saveMemoryGateway } = props;
  return (
    <>
      <section className="settings-section stack memory-center">
                    <div className="settings-copy channel-heading"><div><h2>记忆<PageInfo text={<>记忆分「常驻记忆」与「记忆条目」两部分：常驻记忆每轮对话自动注入；条目按需召回，按重要度分 P0–P3 管理。</>} /></h2></div><label className="channel-enable"><input type="checkbox" checked={memoryEnabled} onChange={(event) => void setMemoryEnabled(event.target.checked)} /><span>{memoryEnabled ? "已启用" : "已停用"}</span></label></div>

                    <div className="memory-overview">
                      <button className="memory-overview-card" onClick={() => { setMemoryCenterTab("library"); setMemoryCenterOpen(true); }} title="浏览记忆条目">
                        <span className="memory-overview-top"><span className="memory-overview-icon"><Archive size={16} /></span>
                        <span className="memory-overview-body"><strong>记忆条目</strong><small>按重要度与来源会话整理，可逐条查看/置顶/删除</small></span></span>
                        <span className="memory-overview-stat"><b>{memories.length}</b> 条 · {memoryGroups.length} 个会话 · {memoryGroups.reduce((s: any, g: any) => s + g.items.filter((it: any) => (it as any).pinned).length, 0)} 置顶</span>
                      </button>
                      <button className="memory-overview-card" onClick={() => { setMemoryCenterTab("layers"); setMemoryCenterOpen(true); }} title="编辑常驻记忆">
                        <span className="memory-overview-top"><span className="memory-overview-icon"><BookOpen size={16} /></span>
                        <span className="memory-overview-body"><strong>常驻记忆</strong><small>用户档案 · 项目记忆 · 近期日志，每轮对话自动注入</small></span></span>
                        <span className="memory-overview-stat"><b>L0/L1/L2</b> 用户 {memoryLayers?.budget.user ?? 0} 字 · 背景 {memoryLayers?.budget.background ?? 0} 字 · 项目 {memoryLayers?.budget.project ?? 0} 字</span>
                      </button>
                      <button className="memory-overview-card" onClick={() => { setMemoryCenterTab("storage"); setMemoryCenterOpen(true); }} title="选择记忆保存位置">
                        <span className="memory-overview-top"><span className="memory-overview-icon"><Cloud size={16} /></span>
                        <span className="memory-overview-body"><strong>存储与同步</strong><small>记忆保存在本地或云端；工作区记忆跨会话复用</small></span></span>
                        <span className="memory-overview-stat"><b>{memoryMode === "cloud" ? "云端同步" : "本地"}</b>{workspaceMemoryEnabled ? " · 工作区已开启" : ""}</span>
                      </button>
                      <button className="memory-overview-card" onClick={() => { setMemoryCenterTab("search"); setMemoryCenterOpen(true); }} title="跨会话检索历史内容">
                        <span className="memory-overview-top"><span className="memory-overview-icon"><Search size={16} /></span>
                        <span className="memory-overview-body"><strong>全局搜索</strong><small>检索会话、记忆、任务与技能，命中按会话分组、可预览全文</small></span></span>
                        <span className="memory-overview-stat"><b>{threads.length}</b> 会话 · {scheduledTasks.length} 任务 · {localSkills.length} 技能</span>
                      </button>
                    </div>

                    <div className="memory-overview-actions">
                      <button className="primary-setting" onClick={() => { setMemoryCenterTab("library"); setMemoryCenterOpen(true); }}><LayoutGrid size={15} />打开记忆中心</button>
                      <span className="muted">浏览条目、编辑常驻记忆、切换存储都在记忆中心里完成，这里只做总览。</span>
                    </div>

                    {/* 被委派会话的记忆（09-23 加）：子智能体 / 专家 / 专家团主理人 / 成员的委派回合由**主进程**
                        直接 turn/start 发起（不经过渲染层的发送路径）⇒ 此前读不到任何记忆。现在按主会话同口径
                        注入常驻记忆 + 按本次任务召回；口径 / 门禁 / 三条硬约束见 electron/delegate-memory.ts
                        （守卫【125】）。 */}
                    <div className="settings-copy channel-heading"><div><h2>被委派会话的记忆<PageInfo text={<>子智能体 / 专家 / 专家团主理人 / 成员在被发起时，会拿到与主会话同样的常驻记忆（用户档案 · 项目记忆 · 纪律 · 近期日志），并按本次任务召回相关条目。工作区记忆关掉时只注入用户档案、不做召回。这条链路此前是缺的，09-23 补上。</>} /></h2></div></div>
                    <p className="muted">委派会话同样会写入记忆：回合结束时照常捕获进当日日志，检出纠错时另记一条坑。同一成员的成员会话会被复用，所以它自己也记得之前做过什么。</p>
                    {memoryStatus && <p className="settings-status">{memoryStatus}</p>}
                    {memoryConfigOpen && <MemoryConfigModal gateway={memoryGateway} setGateway={setMemoryGateway} action={memoryGatewayAction} onClose={() => setMemoryConfigOpen(false)} onTest={() => void testMemoryGateway()} onSave={() => void saveMemoryGateway()} />}
                  </section>
    </>
  );
}
