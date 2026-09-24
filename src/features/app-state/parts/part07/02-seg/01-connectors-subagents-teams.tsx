/**
 * usePart07b1 —— usePart07b 按序切分出的第 1 段（纯搬迁、零改写）。
 * 域：连接器与 MCP 开关 · 子代理 · 专家团 — 团队会话 · 技能导入 · 粘贴图片
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import "@xterm/xterm/css/xterm.css";
import type { Bag } from "../../bag-types";

export function usePart07b1(bag: Bag) {
  // 单卡开关：停用后该 MCP 整段从引擎 config.toml 移除，启用时写回，配置与密钥始终保留
  async function setConnectorEnabled(connector: ConnectorEntry, enabled: boolean) {
    bag.setConnectorStatusBusy(connector.id);
    try {
      await window.codex.setConnectorsEnabled([connector.id], enabled);
      bag.setConnectors(await window.codex.listConnectors());
      await bag.refreshSettingsResources();
      bag.setNotice(`${connector.name} 已${enabled ? "启用" : "停用"}，引擎已重启`);
    } catch (error: any) { bag.setNotice(`切换连接器状态失败：${error.message}`); }
    finally { bag.setConnectorStatusBusy(null); }
  }
bag.setConnectorEnabled = setConnectorEnabled as typeof bag.setConnectorEnabled;

  async function batchSetConnectorsEnabled(ids: string[], enabled: boolean) {
    if (!ids.length) return;
    bag.setConnectorBatchBusy(enabled ? "enable" : "disable");
    try {
      await window.codex.setConnectorsEnabled(ids, enabled);
      bag.setConnectors(await window.codex.listConnectors());
      bag.setConnectorChecked([]);
      await bag.refreshSettingsResources();
      bag.setNotice(`已批量${enabled ? "启用" : "停用"} ${ids.length} 个连接器，引擎已重启`);
    } catch (error: any) { bag.setNotice(`批量操作失败：${error.message}`); }
    finally { bag.setConnectorBatchBusy(null); }
  }
bag.batchSetConnectorsEnabled = batchSetConnectorsEnabled as typeof bag.batchSetConnectorsEnabled;

  /**
   * app-server MCP 状态卡的启停。走 mcp-servers:set-enabled 统一入口：
   * 名字能匹配到连接器的改 connectors.json，其余（内置 nuphus 等）改覆盖表，
   * 两种情况都由主进程重写 config.toml 并重启引擎。
   */
  async function setMcpServerEnabled(name: string, enabled: boolean) {
    // 受总闸托管的 MCP（nuphus）关闭时拦截，统一从「常规」页桌面自动化开关走
    if (bag.guardGroupOff({ kind: "mcp", name }, `MCP「${name}」`, enabled)) return;
    bag.setMcpServerStatusBusy(name);
    try {
      await window.codex.setMcpServersEnabled([name], enabled);
      bag.setMcpOverrides(await window.codex.readMcpServerOverrides());
      if (bag.connectors.some((connector) => connector.id === name)) bag.setConnectors(await window.codex.listConnectors());
      await bag.refreshSettingsResources();
      bag.setNotice(`${name} 已${enabled ? "启用" : "停用"}，引擎已重启`);
    } catch (error: any) { bag.setNotice(`切换 MCP 状态失败：${error.message}`); }
    finally { bag.setMcpServerStatusBusy(null); }
  }
bag.setMcpServerEnabled = setMcpServerEnabled as typeof bag.setMcpServerEnabled;

  async function batchSetMcpServersEnabled(ids: string[], enabled: boolean) {
    const targets = ids.filter((id) => !bag.guardGroupOff({ kind: "mcp", name: id }, `MCP「${id}」`, enabled));
    if (!targets.length) return;
    bag.setMcpServerBatchBusy(enabled ? "enable" : "disable");
    try {
      await window.codex.setMcpServersEnabled(targets, enabled);
      bag.setMcpOverrides(await window.codex.readMcpServerOverrides());
      bag.setConnectors(await window.codex.listConnectors());
      bag.setMcpServerChecked([]);
      await bag.refreshSettingsResources();
      bag.setNotice(`已批量${enabled ? "启用" : "停用"} ${targets.length} 个 MCP 服务，引擎已重启`);
    } catch (error: any) { bag.setNotice(`批量操作失败：${error.message}`); }
    finally { bag.setMcpServerBatchBusy(null); }
  }
bag.batchSetMcpServersEnabled = batchSetMcpServersEnabled as typeof bag.batchSetMcpServersEnabled;

  /**
   * 给某个 MCP 服务器的某个工具设置权限档位（deny 拒绝 / ask 询问 / allow 放行）。
   * mode 传 null 清除该规则。走 mcp-servers:set-tool-permission，主进程重写
   * config.toml 的 [permissions.*] 段并重启引擎（复刻 WorkBuddy 工具级权限模型）。
   */
  async function setMcpToolPermission(server: string, tool: string, mode: "deny" | "ask" | "allow" | null) {
    bag.setMcpServerStatusBusy(server);
    try {
      const result = await window.codex.setMcpToolPermission(server, tool, mode);
      if (result?.reason === "unknown-server") { bag.setNotice(`「${server}」尚未被引擎识别，无法配置工具权限`); return; }
      bag.setMcpToolPermissions(await window.codex.readMcpToolPermissions());
      await bag.refreshSettingsResources();
      bag.setNotice(mode ? `「${server}.${tool}」已设为「${mode === "deny" ? "拒绝" : mode === "ask" ? "询问" : "放行"}」，引擎已重启` : `已清除「${server}.${tool}」的权限规则`);
    } catch (error: any) { bag.setNotice(`设置工具权限失败：${error.message}`); }
    finally { bag.setMcpServerStatusBusy(null); }
  }
bag.setMcpToolPermission = setMcpToolPermission as typeof bag.setMcpToolPermission;

  async function refreshSubAgents() {
    try { bag.setSubAgents(await window.codex.listSubAgents()); }
    catch (error: any) { bag.setNotice(`读取子智能体失败：${error.message}`); }
  }
bag.refreshSubAgents = refreshSubAgents as typeof bag.refreshSubAgents;

  async function saveSubAgent(draft: SubAgentEntry) {
    try {
      await window.codex.saveSubAgent(draft);
      await bag.refreshSubAgents();
      bag.setSubAgentEditorOpen(false);
      bag.setSubAgentDraft(null);
      bag.setNotice(draft.id ? "子智能体已更新" : `子智能体「${draft.name}」已创建，Codex 可以调用它干活了`);
    } catch (error: any) { bag.setNotice(`保存子智能体失败：${error.message}`); }
  }
bag.saveSubAgent = saveSubAgent as typeof bag.saveSubAgent;

  async function toggleSubAgentEnabled(agent: SubAgentEntry) {
    try {
      await window.codex.saveSubAgent({ ...agent, enabled: !agent.enabled });
      await bag.refreshSubAgents();
      bag.setNotice(`子智能体「${agent.name}」已${agent.enabled ? "停用" : "启用"}`);
    } catch (error: any) { bag.setNotice(`切换失败：${error.message}`); }
  }
bag.toggleSubAgentEnabled = toggleSubAgentEnabled as typeof bag.toggleSubAgentEnabled;

  async function deleteSubAgent(id: string) {
    try {
      await window.codex.removeSubAgent(id);
      await bag.refreshSubAgents();
      bag.setNotice("子智能体已删除");
    } catch (error: any) { bag.setNotice(`删除失败：${error.message}`); }
  }
bag.deleteSubAgent = deleteSubAgent as typeof bag.deleteSubAgent;

  function openNewSubAgent() {
    bag.setSubAgentDraft({ id: "", name: "", description: "", systemPrompt: "请按你的角色完成任务并返回结构化结果。", effort: "high", inheritModel: true, inheritSandbox: true, inheritApproval: true, enabled: true, createdAt: "", updatedAt: "" });
    bag.setSubAgentEditorOpen(true);
  }
bag.openNewSubAgent = openNewSubAgent as typeof bag.openNewSubAgent;

  function openEditSubAgent(agent: SubAgentEntry) {
    bag.setSubAgentDraft({ ...agent });
    bag.setSubAgentEditorOpen(true);
  }
bag.openEditSubAgent = openEditSubAgent as typeof bag.openEditSubAgent;

  // —— 专家团（Team 型专家）操作 ——
  async function refreshExpertTeams() {
    try { bag.setExpertTeams(await window.codex.listExpertTeams()); }
    catch (error: any) { bag.setNotice(`读取专家团失败：${error.message}`); }
  }
bag.refreshExpertTeams = refreshExpertTeams as typeof bag.refreshExpertTeams;

  async function saveExpertTeam(draft: ExpertTeamConfig) {
    try {
      await window.codex.saveExpertTeam(draft);
      await bag.refreshExpertTeams();
      bag.setExpertTeamEditorOpen(false);
      bag.setExpertTeamDraft(null);
      bag.setNotice(draft.teamId ? `专家团「${draft.displayName.zh}」已更新` : `专家团「${draft.displayName.zh}」已创建`);
    } catch (error: any) { bag.setNotice(`保存专家团失败：${error.message}`); }
  }
bag.saveExpertTeam = saveExpertTeam as typeof bag.saveExpertTeam;

  async function toggleExpertTeamEnabled(team: ExpertTeamConfig) {
    try {
      await window.codex.saveExpertTeam({ ...team, enabled: !team.enabled });
      await bag.refreshExpertTeams();
      bag.setNotice(`专家团「${team.displayName.zh}」已${team.enabled ? "停用" : "启用"}`);
    } catch (error: any) { bag.setNotice(`切换失败：${error.message}`); }
  }
bag.toggleExpertTeamEnabled = toggleExpertTeamEnabled as typeof bag.toggleExpertTeamEnabled;

  async function deleteExpertTeam(teamId: string) {
    try {
      await window.codex.removeExpertTeam(teamId);
      await bag.refreshExpertTeams();
      bag.setNotice("专家团已删除");
    } catch (error: any) { bag.setNotice(`删除失败：${error.message}`); }
  }
bag.deleteExpertTeam = deleteExpertTeam as typeof bag.deleteExpertTeam;

  async function resetExpertTeams() {
    try {
      const teams = await window.codex.resetExpertTeams();
      bag.setExpertTeams(teams);
      bag.setNotice("已恢复内置示例专家团");
    } catch (error: any) { bag.setNotice(`恢复失败：${error.message}`); }
  }
bag.resetExpertTeams = resetExpertTeams as typeof bag.resetExpertTeams;

  function openNewExpertTeam() {
    const now = new Date().toISOString();
    bag.setExpertTeamDraft({
      teamId: "", displayName: { zh: "", en: "" }, profession: { zh: "", en: "" },
      description: { zh: "", en: "" }, category: "12-IndustryConsultant",
      tags: [{ zh: "", en: "" }, { zh: "", en: "" }, { zh: "", en: "" }],
      quickPrompts: [{ zh: "", en: "" }, { zh: "", en: "" }, { zh: "", en: "" }],
      lead: { id: "", name: "", profession: { zh: "", en: "" }, description: "", systemPrompt: "" },
      members: [], sop: "", enabled: true, createdAt: now, updatedAt: now,
    });
    bag.setExpertTeamEditorOpen(true);
  }
bag.openNewExpertTeam = openNewExpertTeam as typeof bag.openNewExpertTeam;

  function openEditExpertTeam(team: ExpertTeamConfig) {
    bag.setExpertTeamDraft(JSON.parse(JSON.stringify(team)));
    bag.setExpertTeamEditorOpen(true);
  }
bag.openEditExpertTeam = openEditExpertTeam as typeof bag.openEditExpertTeam;

  /** 发起团队会话：一键建线程（带 team_member_invoke 工具）+ 注入团队系统提示发首条任务 */
  /** 为某张专家团卡片单独选择项目地址（发起会话时作为该团队的工作目录） */
  async function chooseTeamCwd(teamId: string) {
    const value = await window.codex.chooseDirectory();
    if (!value) return;
    bag.setTeamCwdMap((current) => ({ ...current, [teamId]: value }));
    bag.setNotice("已为该专家团指定项目地址");
  }
bag.chooseTeamCwd = chooseTeamCwd as typeof bag.chooseTeamCwd;
  return { setConnectorEnabled, batchSetConnectorsEnabled, setMcpServerEnabled, batchSetMcpServersEnabled, setMcpToolPermission, refreshSubAgents, saveSubAgent, toggleSubAgentEnabled, deleteSubAgent, openNewSubAgent, openEditSubAgent, refreshExpertTeams, saveExpertTeam, toggleExpertTeamEnabled, deleteExpertTeam, resetExpertTeams, openNewExpertTeam, openEditExpertTeam, chooseTeamCwd };
}
