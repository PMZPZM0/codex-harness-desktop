/**
 * 设置页 · computer（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX 与原块逐字一致（仅去掉外层缩进）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 */
import { PageInfo } from "../../components/SettingsHead";
import { Monitor } from "lucide-react";

export type ComputerSettingsSectionProps = { approvalPolicy: any; sandbox: any; changeApproval: any; changeSandbox: any; personality: any; changePersonality: any; toolsStatus: any; ToolCard: any };

export function ComputerSettingsSection(props: ComputerSettingsSectionProps) {
  const { approvalPolicy, sandbox, changeApproval, changeSandbox, personality, changePersonality, toolsStatus, ToolCard } = props;
  return (
    <>
      <section className="settings-section stack">
                    <div className="settings-copy"><h2>电脑控制<PageInfo text={<>审批与沙箱决定 Codex 能对这台电脑做什么；完全访问会关闭审批询问。</>} /></h2></div>
                    <div className="settings-grid three">
                      <label><span>审批</span><select value={approvalPolicy} disabled={sandbox === "danger-full-access"} onChange={(event) => changeApproval(event.target.value)}><option value="on-request">按需询问</option><option value="untrusted">仅可信命令</option><option value="never">从不询问</option></select></label>
                      <label><span>沙箱</span><select value={sandbox} onChange={(event) => changeSandbox(event.target.value)}><option value="workspace-write">工作区可写</option><option value="read-only">只读</option><option value="danger-full-access">完全访问</option></select></label>
                      <label><span>风格</span><select value={personality} onChange={(event) => changePersonality(event.target.value)}><option value="pragmatic">务实</option><option value="friendly">友好</option><option value="none">默认</option></select></label>
                    </div>
                    <div className="settings-actions"><span>任务运行中可随时在输入框上方快捷切换。权限调低不会削弱引擎能力：越界操作会走审批卡，批准后继续执行。</span></div>
                    <div className="settings-subhead"><Monitor size={13} />桌面自动化工具<span className="settings-subhead-hint">已注册为 Codex MCP 服务器，38 个桌面/浏览器工具</span></div>
                    <div className="tool-card-grid">
                      {toolsStatus.filter((tool: any) => tool.scope === "computer").map((tool: any) => <ToolCard tool={tool} key={tool.id} />)}
                      {!toolsStatus.length && <p className="muted">正在读取工具状态…</p>}
                    </div>
                    <p className="muted">引擎通过 <code>nuphus</code> MCP 工具直接操作真实屏幕：截屏看界面、激活窗口、移动鼠标、敲键盘、读写剪贴板、本地 OCR，以及通过 CDP 驱动 Chrome。危险操作带有确认标注。</p>
                  </section>
    </>
  );
}
