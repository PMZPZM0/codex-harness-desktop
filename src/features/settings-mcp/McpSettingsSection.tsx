/**
 * 设置页 · mcp（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX / 体内语句与原块逐字一致（仅去掉外层缩进与 IIFE 包装）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 */
import { PageInfo } from "../../components/SettingsHead";
import { ArrowUpRight, Check, CircleStop, KeyRound, Link2, Play, Plus, RefreshCw, Search, Trash2, Wifi, Wrench, Zap } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { SKILLHUB_MCP_CATALOG, SKILLHUB_MCP_CATEGORIES, skillhubMcpDetailUrl } from "../../lib/skillhub-mcp";
import { BatchActions, CheckCard, SearchField, SelectAllToggle, ToggleSwitch } from "../../components/SettingsWidgets";
import { MarketLogo } from "../../features/skills-market";
import { ConnectorSetupModal, ConnectorTemplateModal } from "../../features/connectors";

export type McpSettingsSectionProps = { connectors: any; connectorsManageOnly: any; settingsResources: any; connectorSearch: any; connectorChecked: any; setConnectorChecked: any; mcpOverrides: any; mcpServerSearch: any; mcpServerChecked: any; setMcpServerChecked: any; setConnectorSecret: any; setConnectorDraft: any; setConnectorEditorOpen: any; refreshSettingsResources: any; resourceLoading: any; mcpMarketCategory: any; setMcpMarketCategory: any; setMcpMarketSearch: any; mcpMarketSearch: any; setMarketPreview: any; installMcpServer: any; connectorTemplates: any; setConnectorTemplateValues: any; setConnectorTemplateModal: any; setConnectorOAuth: any; connectorTemplateModal: any; connectorTemplateValues: any; connectorTemplateSaving: any; connectorOAuth: any; saveConnectorFromTemplate: any; startConnectorOAuth: any; setConnectorsManageOnly: any; setConnectorSearch: any; connectorBatchBusy: any; batchSetConnectorsEnabled: any; connectorStatusBusy: any; setConnectorEnabled: any; removeConnector: any; connectorEditorOpen: any; connectorDraft: any; connectorSecret: any; connectorSaving: any; saveConnector: any; setMcpServerSearch: any; mcpServerBatchBusy: any; batchSetMcpServersEnabled: any; mcpServerStatusBusy: any; setMcpServerEnabled: any; mcpToolPermissions: any; setMcpToolPermission: any };

export function McpSettingsSection(props: McpSettingsSectionProps) {
  const { connectors, connectorsManageOnly, settingsResources, connectorSearch, connectorChecked, setConnectorChecked, mcpOverrides, mcpServerSearch, mcpServerChecked, setMcpServerChecked, setConnectorSecret, setConnectorDraft, setConnectorEditorOpen, refreshSettingsResources, resourceLoading, mcpMarketCategory, setMcpMarketCategory, setMcpMarketSearch, mcpMarketSearch, setMarketPreview, installMcpServer, connectorTemplates, setConnectorTemplateValues, setConnectorTemplateModal, setConnectorOAuth, connectorTemplateModal, connectorTemplateValues, connectorTemplateSaving, connectorOAuth, saveConnectorFromTemplate, startConnectorOAuth, setConnectorsManageOnly, setConnectorSearch, connectorBatchBusy, batchSetConnectorsEnabled, connectorStatusBusy, setConnectorEnabled, removeConnector, connectorEditorOpen, connectorDraft, connectorSecret, connectorSaving, saveConnector, setMcpServerSearch, mcpServerBatchBusy, batchSetMcpServersEnabled, mcpServerStatusBusy, setMcpServerEnabled, mcpToolPermissions, setMcpToolPermission } = props;
  const visibleConnectors = connectors.filter((connector: any) => (!connectorsManageOnly || settingsResources.mcp.some((server: any) => server.name === connector.id)) && (!connectorSearch || `${connector.name} ${connector.id} ${connector.command ?? ""} ${connector.url ?? ""}`.includes(connectorSearch)));
  const selectableConnectorIds = visibleConnectors.map((connector: any) => connector.id);
  // 勾选集合取交集：筛选变化后已不可见的勾选项不计入批量
  const checkedConnectorIds = connectorChecked.filter((id: any) => selectableConnectorIds.includes(id));
  const checkedConnectors = connectors.filter((connector: any) => checkedConnectorIds.includes(connector.id));
  const connectorBatchTargets = {
    enable: checkedConnectors.filter((connector: any) => connector.enabled === false),
    disable: checkedConnectors.filter((connector: any) => connector.enabled !== false),
  };
  const toggleConnectorChecked = (id: string) => setConnectorChecked((current: any) => current.includes(id) ? current.filter((entry: any) => entry !== id) : [...current, id]);
  // —— app-server MCP 状态：卡片自带开关与批量勾选 ——
  // 名字集合不能只取 app-server 的回报：服务器一旦停用就不出现在回报里，
  // 卡片会跟着消失，用户再也找不到开关把它开回来（和钩子分组消失是同一个坑）。
  // 所以以「已知服务器」为准：内置 nuphus + 连接器 + 覆盖表 + 引擎回报。
  const mcpRows = Array.from(new Set([
    "nuphus",
    ...connectors.map((entry: any) => entry.id),
    ...Object.keys(mcpOverrides),
    ...settingsResources.mcp.map((server: any) => String(server.name ?? "")),
  ])).filter(Boolean).map((name) => {
    const server: any = settingsResources.mcp.find((entry: any) => String(entry.name ?? "") === name);
    const connector = connectors.find((entry: any) => entry.id === name);
    const runtime = server?.runtimeStatus?.type ?? server?.runtimeStatus ?? "";
    const tools = server ? (Array.isArray(server.tools) ? server.tools : Object.keys(server.tools ?? {})) : [];
    return {
      name,
      reported: Boolean(server),
      runtime: String(runtime || (server?.authStatus ?? "")),
      toolNames: tools.map((tool: any) => String(typeof tool === "string" ? tool : tool?.name ?? "")),
      auth: String(server?.authStatus ?? ""),
      enabled: connector ? connector.enabled !== false : mcpOverrides[name] !== false,
      managed: Boolean(connector),
    };
  }).filter((row) => !mcpServerSearch || `${row.name} ${row.runtime} ${row.toolNames.join(" ")}`.toLowerCase().includes(mcpServerSearch.toLowerCase()));
  const selectableMcpIds = mcpRows.map((row) => row.name);
  const checkedMcpIds = mcpServerChecked.filter((id: any) => selectableMcpIds.includes(id));
  const mcpBatchTargets = {
    enable: mcpRows.filter((row) => checkedMcpIds.includes(row.name) && !row.enabled),
    disable: mcpRows.filter((row) => checkedMcpIds.includes(row.name) && row.enabled),
  };
  const toggleMcpChecked = (id: string) => setMcpServerChecked((current: any) => current.includes(id) ? current.filter((entry: any) => entry !== id) : [...current, id]);
  return (
  <section className="settings-section stack">
  <div className="settings-copy channel-heading"><div><h2>MCP<PageInfo text={<>上方卡片来自 SkillHub MCP 工具广场（skillhub.cn/mcp），点卡片看详情、带接入模板的可一键写入连接器；下方为已接入管理：保存后写入 Codex 配置、加密保存密钥并重启引擎，支持批量启用/停用。“可用”以 app-server 返回的运行/认证状态为准。</>} helpKey="mcp" label="MCP" /></h2></div><div className="settings-heading-actions"><button className="secondary-setting" onClick={() => { setConnectorSecret(""); setConnectorDraft({ name: "", transport: "stdio", command: "", args: [], url: "", headers: {}, env: {}, secrets: {} }); setConnectorEditorOpen(true); }}><Plus size={14} />添加 MCP</button><button className="secondary-setting" title="打开 SkillHub MCP 工具广场" onClick={() => void window.codex.openExternal("https://skillhub.cn/mcp")}><ArrowUpRight size={14} />SkillHub MCP 广场</button><button className="secondary-setting" title="打开 AIbase MCP 广场找服务" onClick={() => void window.codex.openExternal("https://mcp.aibase.com/zh/explore")}><ArrowUpRight size={14} />AIbase 广场</button><button className="icon-button" title="刷新 MCP 状态" onClick={() => void refreshSettingsResources()}>{resourceLoading ? <Spinner /> : <RefreshCw size={14} />}</button></div></div>
    <div className="plugin-market-block">
      <div className="plugin-market-title">MCP 市场<small>SkillHub MCP 工具广场 · 27 个服务 · 带模板一键接入 / 其余直达官网</small></div>
      <div className="resource-toolbar">
        <div className="skill-tabs">{SKILLHUB_MCP_CATEGORIES.map((category) => <button key={category} className={mcpMarketCategory === category ? "active" : ""} onClick={() => { setMcpMarketCategory(category); setMcpMarketSearch(""); }}>{category}</button>)}</div>
        <SearchField value={mcpMarketSearch} onChange={setMcpMarketSearch} placeholder="搜索 MCP 服务名称或简介" />
      </div>
      <div className="skill-card-grid">
        {SKILLHUB_MCP_CATALOG.filter((entry) => (mcpMarketCategory === "全部" || entry.category === mcpMarketCategory) && (!mcpMarketSearch || `${entry.name} ${entry.description} ${entry.category}`.toLowerCase().includes(mcpMarketSearch.toLowerCase()))).map((entry) => {
          const installed = connectors.some((connector: any) => connector.name === entry.id);
          return <article className={`skill-card ${installed ? "installed" : ""}`} key={entry.id} onClick={() => setMarketPreview({
            kind: "mcp",
            title: entry.name,
            subtitle: `${entry.category} · SkillHub MCP 工具广场`,
            iconChar: entry.name,
            description: entry.description,
            meta: [entry.category, ...(entry.config ? [entry.config.transport === "stdio" ? "stdio 本地进程" : "HTTP 远程服务"] : [])],
            installed,
            installLabel: entry.config ? "一键接入" : "查看接入配置",
            onInstall: entry.config ? () => installMcpServer(entry) : undefined,
            externalUrl: skillhubMcpDetailUrl(entry.id),
            note: entry.configNote,
            note2: entry.config ? "密钥可留空稍后在连接器编辑中补充；保存后引擎重启并验证 MCP 状态" : "该服务暂无内置模板，打开官网复制接入配置",
          })}>
            <div className="skill-card-head">
              <MarketLogo label={entry.name} size={30} />
              <button className="skill-add" title={installed ? "已接入连接器" : entry.config ? "一键接入（写入连接器配置）" : "打开 SkillHub 查看接入配置"} disabled={installed} onClick={(event) => { event.stopPropagation(); if (installed) return; if (entry.config) installMcpServer(entry); else void window.codex.openExternal(skillhubMcpDetailUrl(entry.id)); }}>{installed ? <Check size={14} /> : entry.config ? <Plus size={14} /> : <ArrowUpRight size={14} />}</button>
            </div>
            <strong title={entry.name}>{entry.name}</strong>
            <p>{entry.description}</p>
            <footer><span>{entry.category}</span><span>{installed ? "已接入" : entry.config ? "可一键接入" : "官网看配置"}</span><a href={skillhubMcpDetailUrl(entry.id)} onClick={(event) => { event.preventDefault(); void window.codex.openExternal(skillhubMcpDetailUrl(entry.id)); }}>详情</a></footer>
          </article>;
        })}
      </div>
    </div>
  <div className="settings-subhead connector-template-heading"><Zap size={13} />一键接入模板<span className="settings-subhead-hint">官方/社区 MCP 真实配置 · 填入你的凭据即可</span></div>
  <div className="connector-template-grid">{connectorTemplates.map((template: any) => { const entry = connectors.find((connector: any) => connector.id === template.id); const installed = Boolean(entry); const oauthConnected = entry?.oauth?.status === "connected"; return <article className={`connector-template-card ${installed ? "installed" : ""} ${oauthConnected ? "oauth" : ""}`} key={template.id}><div className="connector-template-top"><span className="connector-card-icon"><Zap size={15} /></span><small>{template.vendor}</small>{oauthConnected ? <span className="connector-template-badge oauth-badge"><KeyRound size={11} />已授权</span> : installed ? <span className="connector-template-badge">已配置</span> : null}</div><strong>{template.name}</strong><p>{template.summary}</p>{oauthConnected && entry.oauth?.accountHint ? <small className="connector-oauth-hint">{entry.oauth.accountHint}</small> : null}<button className={installed ? "secondary-setting" : "primary-setting"} onClick={() => { setConnectorTemplateValues({}); setConnectorTemplateModal(template); setConnectorOAuth(null); }}><RefreshCw size={13} />{installed ? "重新配置" : "配置连接"}</button></article>; })}</div>
  {connectorTemplateModal && <ConnectorTemplateModal template={connectorTemplateModal} values={connectorTemplateValues} saving={connectorTemplateSaving} oauth={connectorOAuth} onChange={setConnectorTemplateValues} onClose={() => { setConnectorTemplateModal(null); setConnectorTemplateValues({}); setConnectorOAuth(null); }} onSave={() => void saveConnectorFromTemplate(connectorTemplateModal)} onOAuth={() => void startConnectorOAuth()} />}
  <div className="skill-center-toolbar"><div className="skill-tabs"><button className={!connectorsManageOnly ? "active" : ""} onClick={() => setConnectorsManageOnly(false)}>全部配置</button><button className={connectorsManageOnly ? "active" : ""} onClick={() => setConnectorsManageOnly(true)}>已验证 {settingsResources.mcp.filter((server: any) => connectors.some((connector: any) => connector.id === server.name)).length}</button></div><label className="skill-search"><Search size={14} /><input value={connectorSearch} onChange={(event) => setConnectorSearch(event.target.value)} placeholder="搜索 MCP 连接器" /></label></div>
  <div className="resource-toolbar secondary">
    <SelectAllToggle total={selectableConnectorIds.length} selected={checkedConnectorIds.length} unit="个连接器" onSelectAll={() => setConnectorChecked(selectableConnectorIds)} onClear={() => setConnectorChecked([])} />
    <BatchActions
      hint={checkedConnectorIds.length ? `选中里：${connectorBatchTargets.disable.length} 个启用中 · ${connectorBatchTargets.enable.length} 个已停用` : "勾选连接器后可批量启用或停用"}
      actions={[
        { label: connectorBatchTargets.enable.length ? `启用所选 (${connectorBatchTargets.enable.length})` : "启用所选", icon: <Play size={13} />, disabled: !connectorBatchTargets.enable.length, busy: connectorBatchBusy === "enable", onClick: () => void batchSetConnectorsEnabled(connectorBatchTargets.enable.map((connector: any) => connector.id), true), title: connectorBatchTargets.enable.length ? `启用选中的 ${connectorBatchTargets.enable.length} 个已停用连接器` : "没有勾选已停用的连接器" },
        { label: connectorBatchTargets.disable.length ? `停用所选 (${connectorBatchTargets.disable.length})` : "停用所选", icon: <CircleStop size={13} />, tone: "danger", disabled: !connectorBatchTargets.disable.length, busy: connectorBatchBusy === "disable", onClick: () => void batchSetConnectorsEnabled(connectorBatchTargets.disable.map((connector: any) => connector.id), false), title: connectorBatchTargets.disable.length ? `停用选中的 ${connectorBatchTargets.disable.length} 个启用中连接器` : "没有勾选启用中的连接器" },
      ]}
    />
  </div>
  <div className="connector-card-grid">{visibleConnectors.map((connector: any) => {
    const status = settingsResources.mcp.find((server: any) => server.name === connector.id);
    const detail = status?.runtimeStatus?.type ?? status?.runtimeStatus ?? status?.authStatus;
    const isEnabled = connector.enabled !== false;
    const checked = checkedConnectorIds.includes(connector.id);
    const busy = connectorStatusBusy === connector.id;
    return <article className={`connector-card ${status && isEnabled ? "connected" : ""} ${isEnabled ? "" : "is-disabled"} ${checked ? "is-checked" : ""}`} key={connector.id}>
      <div className="connector-card-head">
        <CheckCard checked={checked} label={`选择 ${connector.name}`} title={checked ? `取消选择 ${connector.name}` : `勾选 ${connector.name}，纳入批量操作`} onChange={() => toggleConnectorChecked(connector.id)} />
        <div className="connector-card-icon"><Link2 size={16} /></div>
        <div className="connector-card-title"><strong title={connector.name}>{connector.name}</strong><small>{connector.transport === "stdio" ? "本地命令 · stdio" : "远程服务 · HTTP MCP"}{connector.hasSecrets ? " · 已加密密钥" : ""}</small></div>
        {isEnabled ? <span className="plugin-state on">启用中</span> : <span className="plugin-state off">已停用</span>}
        <ToggleSwitch checked={isEnabled} disabled={busy} label={`${connector.name} 启用开关`} title={isEnabled ? "停用后引擎不再加载该 MCP，配置保留" : "启用该 MCP 连接器"} onChange={(next) => void setConnectorEnabled(connector, next)} />
      </div>
      <p className="connector-card-detail">{connector.transport === "stdio" ? `${connector.command} ${(connector.args ?? []).join(" ")}` : connector.url}</p>
      <div className="connector-card-foot">
        <small>{!isEnabled ? "已停用 · 引擎不会加载，配置与密钥保留" : status ? `引擎状态：${detail || "已发现"}` : "已写入配置，等待引擎状态返回"}</small>
        <button className="icon-button" title="移除连接器" onClick={() => void removeConnector(connector.id)}><Trash2 size={14} /></button>
      </div>
    </article>;
  })}{!connectors.length && <p className="muted">尚未配置连接器。请从服务提供方获取真实 MCP 启动命令或 HTTP MCP 地址后添加。</p>}</div>
  {connectorEditorOpen && <ConnectorSetupModal draft={connectorDraft} secret={connectorSecret} saving={connectorSaving} onDraftChange={setConnectorDraft} onSecretChange={setConnectorSecret} onClose={() => setConnectorEditorOpen(false)} onSave={(draft) => void saveConnector(draft)} />}
  {false && <div className="schedule-editor connector-legacy-editor"><input value={connectorDraft.name} onChange={(event) => setConnectorDraft({ ...connectorDraft, name: event.target.value })} placeholder="连接器名称，例如 GitHub MCP" /><div className="schedule-kind" role="group"><button type="button" className={connectorDraft.transport === "stdio" ? "active" : ""} onClick={() => setConnectorDraft({ ...connectorDraft, transport: "stdio" })}>本地 stdio</button><button type="button" className={connectorDraft.transport === "streamable_http" ? "active" : ""} onClick={() => setConnectorDraft({ ...connectorDraft, transport: "streamable_http" })}>HTTP MCP</button></div>{connectorDraft.transport === "stdio" ? <><input value={connectorDraft.command ?? ""} onChange={(event) => setConnectorDraft({ ...connectorDraft, command: event.target.value })} placeholder="启动命令，例如 npx" /><input value={(connectorDraft.args ?? []).join(" ")} onChange={(event) => setConnectorDraft({ ...connectorDraft, args: event.target.value.trim() ? event.target.value.trim().split(/\s+/) : [] })} placeholder="参数，空格分隔，例如 -y @modelcontextprotocol/server-github" /></> : <input value={connectorDraft.url ?? ""} onChange={(event) => setConnectorDraft({ ...connectorDraft, url: event.target.value })} placeholder="https://service.example.com/mcp" />}<input value={connectorSecret} type="password" onChange={(event) => setConnectorSecret(event.target.value)} placeholder="可选：访问令牌（保存时使用 MCP_TOKEN 加密存储）" /><div className="settings-actions"><button className="secondary-setting" onClick={() => setConnectorEditorOpen(false)}>取消</button><button className="primary-setting" disabled={connectorSaving || !connectorDraft.name || (connectorDraft.transport === "stdio" ? !connectorDraft.command : !connectorDraft.url)} onClick={() => { const secrets: Record<string, string> = connectorSecret ? { MCP_TOKEN: connectorSecret } : {}; const draft: ConnectorDraft = { ...connectorDraft, secrets }; setConnectorDraft(draft); void saveConnector(draft); }}>{connectorSaving ? <Spinner /> : <Check size={14} />}保存并验证</button></div></div>}
  <div className="settings-subhead"><Wifi size={13} />app-server MCP 状态<span className="settings-subhead-hint">引擎真实加载的服务器 · 可单卡或批量启停</span></div>
  <div className="skill-center-toolbar"><label className="skill-search"><Search size={14} /><input value={mcpServerSearch} onChange={(event) => setMcpServerSearch(event.target.value)} placeholder="搜索 MCP 服务或工具名" /></label></div>
  <div className="resource-toolbar secondary">
    <SelectAllToggle total={selectableMcpIds.length} selected={checkedMcpIds.length} unit="个 MCP 服务" onSelectAll={() => setMcpServerChecked(selectableMcpIds)} onClear={() => setMcpServerChecked([])} />
    <BatchActions
      hint={checkedMcpIds.length ? `选中里：${mcpBatchTargets.disable.length} 个启用中 · ${mcpBatchTargets.enable.length} 个已停用` : "勾选 MCP 服务后可批量启用或停用"}
      actions={[
        { label: mcpBatchTargets.enable.length ? `启用所选 (${mcpBatchTargets.enable.length})` : "启用所选", icon: <Play size={13} />, disabled: !mcpBatchTargets.enable.length, busy: mcpServerBatchBusy === "enable", onClick: () => void batchSetMcpServersEnabled(mcpBatchTargets.enable.map((row) => row.name), true), title: mcpBatchTargets.enable.length ? `启用选中的 ${mcpBatchTargets.enable.length} 个已停用 MCP 服务` : "没有勾选已停用的 MCP 服务" },
        { label: mcpBatchTargets.disable.length ? `停用所选 (${mcpBatchTargets.disable.length})` : "停用所选", icon: <CircleStop size={13} />, tone: "danger", disabled: !mcpBatchTargets.disable.length, busy: mcpServerBatchBusy === "disable", onClick: () => void batchSetMcpServersEnabled(mcpBatchTargets.disable.map((row) => row.name), false), title: mcpBatchTargets.disable.length ? `停用选中的 ${mcpBatchTargets.disable.length} 个启用中 MCP 服务` : "没有勾选启用中的 MCP 服务" },
      ]}
    />
  </div>
  <div className="mcp-server-grid">{mcpRows.map((row) => {
    const busy = mcpServerStatusBusy === row.name;
    const checked = checkedMcpIds.includes(row.name);
    const live = row.enabled && (row.runtime === "live" || row.runtime === "ready" || row.runtime === "running" || row.runtime === "connected");
    const failed = row.enabled && (row.runtime === "error" || row.runtime === "failed" || row.runtime === "disconnected");
    return <article className={`mcp-server-card ${live ? "live" : ""} ${failed ? "failed" : ""} ${row.enabled ? "" : "is-disabled"} ${checked ? "is-checked" : ""}`} key={row.name}>
      <div className="mcp-server-head">
        <CheckCard checked={checked} label={`选择 ${row.name}`} title={checked ? `取消选择 ${row.name}` : `勾选 ${row.name}，纳入批量操作`} onChange={() => toggleMcpChecked(row.name)} />
        <div className="mcp-server-icon"><Wrench size={15} /></div>
        <div className="mcp-server-title">
          <strong title={row.name}>{row.name}</strong>
          <small>{row.managed ? "本应用管理的连接器" : "引擎直管服务器"}{row.auth ? ` · 认证 ${row.auth}` : ""}</small>
        </div>
        <span className={`mcp-server-state ${row.enabled ? (live ? "on" : failed ? "bad" : "idle") : "off"}`}>
          {!row.enabled ? "已停用" : live ? "运行中" : failed ? "启动失败" : row.reported ? (row.runtime || "已发现") : "等待回报"}
        </span>
        <ToggleSwitch checked={row.enabled} disabled={busy} label={`${row.name} 启用开关`} title={row.enabled ? `停用后引擎不再加载 ${row.name}，配置保留` : `启用 ${row.name}`} onChange={(next) => void setMcpServerEnabled(row.name, next)} />
      </div>
      <div className="mcp-server-body">
        <span className="mcp-server-metric" title="该服务器暴露的工具数量"><Wrench size={11} />{row.toolNames.length} 个工具</span>
        <span className="mcp-server-metric" title="app-server 回报的运行状态">状态 {row.reported ? (row.runtime || "已发现") : "未加载"}</span>
        {row.auth ? <span className="mcp-server-metric" title="认证方式">认证 {row.auth}</span> : null}
      </div>
      {row.toolNames.length ? <div className="mcp-server-tools">{
        row.toolNames.slice(0, 10).map((tool: string) => {
          const perm = mcpToolPermissions[row.name]?.[tool];
          return (
            <button
              key={tool}
              className={`mcp-tool-chip${perm ? ` perm-${perm}` : ""}`}
              title={`${perm ? `当前权限：${perm === "deny" ? "拒绝" : perm === "ask" ? "询问" : "放行"}。` : "未设权限规则。"}点击循环：放行 → 询问 → 拒绝 → 清除`}
              onClick={() => { const next = perm === undefined || perm === "allow" ? "ask" : perm === "ask" ? "deny" : null; void setMcpToolPermission(row.name, tool, next); }}
            >
              <code>{tool}</code>{perm ? <em>{perm === "deny" ? "拒" : perm === "ask" ? "问" : "放"}</em> : null}
            </button>
          );
        })
      }{row.toolNames.length > 10 ? <code className="mcp-server-tools-more">+{row.toolNames.length - 10}</code> : null}</div> : null}
      <div className="mcp-server-foot"><small>{row.enabled ? (row.reported ? "已写入引擎配置，改动后引擎会自动重启" : "已写入引擎配置，等待 app-server 回报状态") : "已停用 · 引擎不会加载，配置保留"}</small></div>
    </article>;
  })}{!mcpRows.length && <div className="mcp-server-empty"><Wifi size={26} /><strong>app-server 还没有发现 MCP 服务</strong><p>在上面添加连接器并保存，引擎重启后这里会出现真实运行状态；内置桌面自动化 MCP 也会列在这里。</p></div>}</div>
  </section>
  );
}
