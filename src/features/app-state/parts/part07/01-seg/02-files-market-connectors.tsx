/**
 * usePart07a2 —— usePart07a 按序切分出的第 2 段（纯搬迁、零改写）。
 * 域：斜杠命令/评审/工作区 — 图片与文件选择 · 市场技能与插件 · 连接器与 MCP
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import "@xterm/xterm/css/xterm.css";
import { SKILLHUB_MCP_CATALOG, SKILLHUB_MCP_CATEGORIES, skillhubMcpDetailUrl, type SkillHubMcpEntry } from "../../../../../lib/skillhub-mcp";
import type { Bag } from "../../bag-types";

export function usePart07a2(bag: Bag) {
  async function chooseImages() {
    const value = await window.codex.chooseImages();
    if (value?.length) bag.insertComposerImages(value);
  }
bag.chooseImages = chooseImages as typeof bag.chooseImages;



  async function chooseFiles() {
    const value = await window.codex.chooseFiles();
    // 09-18：文件改为插进输入框的内联 chip（不再挂在输入框上方的 strip 里）
    if (value?.length) bag.insertComposerFiles(value);
  }
bag.chooseFiles = chooseFiles as typeof bag.chooseFiles;



  async function refreshMarketSkills(category = bag.skillHubCategory, query = bag.skillHubSearch, page = bag.marketPage) {
    bag.setMarketLoading(true);
    try {
      // category 直接传 SkillHub 榜单名（总排行/近期最热/最新上传/官方精选），主进程映射 section
      const result = await window.codex.listMarketSkills({ category, page, pageSize: bag.marketPageSize, query });
      bag.setMarketSkills(result.items);
      bag.setMarketTotal(result.total);
      bag.setMarketPage(result.page);
    } catch (error: any) { bag.setNotice(`技能市场读取失败：${error.message}`); }
    finally { bag.setMarketLoading(false); }
  }
bag.refreshMarketSkills = refreshMarketSkills as typeof bag.refreshMarketSkills;



  async function refreshMarketPlugins(category = bag.pluginMarketCategory, query = bag.pluginMarketSearch, page = bag.pluginMarketPage) {
    bag.setPluginMarketLoading(true);
    try {
      const result = await window.codex.listMarketPlugins({ category, query, page, pageSize: bag.pluginMarketPageSize });
      bag.setPluginMarketItems(result.items);
      bag.setPluginMarketTotal(result.total);
      bag.setPluginMarketPage(result.page);
    } catch (error: any) { bag.setNotice(`插件市场读取失败：${error.message}`); }
    finally { bag.setPluginMarketLoading(false); }
  }
bag.refreshMarketPlugins = refreshMarketPlugins as typeof bag.refreshMarketPlugins;



  /** 「插件」页的**唯一**刷新入口（09-18 用户：「插件市场有两个刷新按键…保留上面的，里面不要」）。
   *  原先两个同款 🔄 挨着放：标题行那个刷页面资源（技能/钩子/已装插件/记忆/任务/MCP），
   *  市场工具栏那个只刷市场列表（当前分类/搜索/页码）——功能不重复但用户分不清。
   *  合成一个：点一次，两处数据一起重取（市场沿用当前筛选与页码，与旧工具栏按钮行为一致）。 */
  async function refreshPluginsPage() {
    await Promise.all([
      bag.refreshSettingsResources(),
      bag.refreshMarketPlugins(bag.pluginMarketCategory, bag.pluginMarketSearch, bag.pluginMarketPage),
    ]);
  }
bag.refreshPluginsPage = refreshPluginsPage as typeof bag.refreshPluginsPage;



  async function installMarketPlugin(plugin: PluginMarketEntry) {
    bag.setInstallingMarketPlugin(plugin.slug);
    bag.setPluginInstall({ plugin, current: 0 });
    try {
      const installed = await window.codex.installMarketPlugin(plugin);
      await bag.refreshSettingsResources();
      bag.setPluginInstall({ plugin, current: 7, engineRegistered: installed.engineRegistered, engineCheckMessage: installed.engineCheckMessage });
      bag.setNotice(installed.engineRegistered ? `已安装并由 Codex 发现：${installed.name}` : `插件已安装：${installed.name}`);
    } catch (error: any) {
      bag.setPluginInstall((current) => current ? { ...current, failed: error.message } : null);
      bag.setNotice(`安装插件失败：${error.message}`);
    } finally { bag.setInstallingMarketPlugin(null); }
  }
bag.installMarketPlugin = installMarketPlugin as typeof bag.installMarketPlugin;



  async function installMarketSkill(skill: MarketSkillEntry) {
    bag.setInstallingMarketSkill(skill.id);
    bag.setSkillInstall({ skill, current: 0 });
    try {
      const installed = await window.codex.installMarketSkill(skill);
      const next = await window.codex.listLocalSkills();
      bag.setLocalSkills(next);
      await bag.refreshSettingsResources();
      bag.setSkillInstall({ skill, current: 7, engineRegistered: installed.engineRegistered, engineCheckMessage: installed.engineCheckMessage });
      bag.setNotice(installed.engineRegistered ? `已安装并由 Codex 发现：${installed.name}` : `技能已安装：${installed.name}`);
    } catch (error: any) {
      bag.setSkillInstall((current) => current ? { ...current, failed: error.message } : null);
      bag.setNotice(`安装技能失败：${error.message}`);
    } finally { bag.setInstallingMarketSkill(null); }
  }
bag.installMarketSkill = installMarketSkill as typeof bag.installMarketSkill;



  async function toggleSkillEnabled(entry: LocalSkillEntry) {
    if (!entry.folder) return;
    const enabled = entry.enabled !== false;
    const nextEnabled = !enabled;
    // 受总闸托管的技能（ponytail-* / desktop-automation / browser-automation）关闭时拦截，
    // 统一从「常规」页总闸走，避免子项被总闸拉回导致状态漂移
    if (bag.guardGroupOff({ kind: "skill", folder: entry.folder, name: entry.name, pluginId: (entry as any).pluginId }, `技能「${entry.name}」`, nextEnabled)) return;
    try {
      await window.codex.setEnabledSkill({ folder: entry.folder, enabled: nextEnabled });
      bag.setLocalSkills(await window.codex.listLocalSkills());
      await bag.refreshSettingsResources();
      bag.setNotice(nextEnabled ? `技能已启用：${entry.name}` : `技能已停用：${entry.name}`);
    } catch (error: any) { bag.setNotice(`切换技能状态失败：${error.message}`); }
  }
bag.toggleSkillEnabled = toggleSkillEnabled as typeof bag.toggleSkillEnabled;



  async function saveConnector(draft: ConnectorDraft = bag.connectorDraft) {
    bag.setConnectorSaving(true);
    try {
      await window.codex.saveConnector(draft);
      bag.setConnectors(await window.codex.listConnectors());
      await bag.refreshSettingsResources();
      bag.setConnectorEditorOpen(false);
      bag.setConnectorDraft({ name: "", transport: "stdio", command: "", args: [], url: "", headers: {}, env: {}, secrets: {} });
      bag.setNotice("连接器已保存，引擎已重启并正在验证 MCP 状态");
    } catch (error: any) { bag.setNotice(`保存连接器失败：${error.message}`); }
    finally { bag.setConnectorSaving(false); }
  }
bag.saveConnector = saveConnector as typeof bag.saveConnector;



  /** MCP 市场一键接入：按内置模板直接写入连接器（复用 saveConnector：落盘→重启引擎→验证 MCP 状态），密钥留空后续可在连接器编辑补充 */
  const installMcpServer = (entry: SkillHubMcpEntry) => {
    const cfg = entry.config;
    if (!cfg) { void window.codex.openExternal(skillhubMcpDetailUrl(entry.id)); return; }
    void bag.saveConnector({
      name: entry.id,
      transport: cfg.transport,
      command: cfg.command ?? "",
      args: cfg.args ?? [],
      url: cfg.url ?? "",
      headers: cfg.transport === "streamable_http" ? { Authorization: "" } : {},
      env: cfg.env ?? {},
      secrets: {},
    });
  };
bag.installMcpServer = installMcpServer as typeof bag.installMcpServer;



  async function startConnectorOAuth() {
    const template = bag.connectorTemplateModal;
    if (!template) return;
    bag.setConnectorOAuth({ templateId: template.id, phase: "waiting", message: "正在启动授权…" });
    try {
      const result = await window.codex.startConnectorOAuth({ templateId: template.id, values: bag.connectorTemplateValues });
      if (!result.ok) bag.setConnectorOAuth({ templateId: template.id, phase: "failed", message: result.message ?? "授权启动失败" });
    } catch (error: any) {
      bag.setConnectorOAuth({ templateId: template.id, phase: "failed", message: error?.message ?? String(error) });
    }
  }
bag.startConnectorOAuth = startConnectorOAuth as typeof bag.startConnectorOAuth;



  async function saveConnectorFromTemplate(template: ConnectorTemplate) {
    const values = bag.connectorTemplateValues;
    const draft: ConnectorDraft = { id: template.id, name: template.name, transport: template.transport };
    const fill = (text: string) => text.replace(/\{(\w+)\}/g, (_, key: string) => (values[key] ?? "").trim() || `{${key}}`);
    if (template.transport === "stdio") {
      draft.command = template.command;
      draft.args = (template.args ?? []).map(fill);
      draft.env = { ...template.env };
      for (const field of template.fields) if (field.envVar && values[field.key]?.trim()) draft.env[field.envVar] = values[field.key].trim();
    } else {
      draft.url = fill(template.url ?? "");
      const envHttpHeaders: Record<string, string> = {};
      const secrets: Record<string, string> = {};
      for (const [header, envName] of Object.entries(template.envHttpHeaders ?? {})) {
        envHttpHeaders[header] = envName;
        const tokenField = template.fields.find((field) => field.tokenFor === envName);
        if (tokenField && values[tokenField.key]?.trim()) secrets[envName] = values[tokenField.key].trim();
      }
      if (Object.keys(envHttpHeaders).length) draft.envHttpHeaders = envHttpHeaders;
      if (Object.keys(secrets).length) draft.secrets = secrets;
    }
    bag.setConnectorTemplateSaving(true);
    try {
      await window.codex.saveConnector(draft);
      bag.setConnectors(await window.codex.listConnectors());
      await bag.refreshSettingsResources();
      bag.setConnectorTemplateModal(null);
      bag.setConnectorTemplateValues({});
      bag.setNotice(`${template.name} 连接器已保存，引擎已重启并正在验证 MCP 状态`);
    } catch (error: any) { bag.setNotice(`保存 ${template.name} 连接器失败：${error.message}`); }
    finally { bag.setConnectorTemplateSaving(false); }
  }
bag.saveConnectorFromTemplate = saveConnectorFromTemplate as typeof bag.saveConnectorFromTemplate;



  async function removeConnector(id: string) {
    try {
      await window.codex.removeConnector(id);
      bag.setConnectors(await window.codex.listConnectors());
      bag.setConnectorChecked((current) => current.filter((entry) => entry !== id));
      await bag.refreshSettingsResources();
      bag.setNotice("连接器已移除，MCP 配置已更新");
    } catch (error: any) { bag.setNotice(`移除连接器失败：${error.message}`); }
  }
bag.removeConnector = removeConnector as typeof bag.removeConnector;
  return { chooseImages, chooseFiles, refreshMarketSkills, refreshMarketPlugins, refreshPluginsPage, installMarketPlugin, installMarketSkill, toggleSkillEnabled, saveConnector, installMcpServer, startConnectorOAuth, saveConnectorFromTemplate, removeConnector };
}
