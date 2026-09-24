/**
 * 设置页 · commands（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX / 体内语句与原块逐字一致（仅去掉外层缩进与 IIFE 包装）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 */
import { copyTextToClipboard } from "../../lib/clipboard";
import { PageInfo } from "../../components/SettingsHead";
import { AlertTriangle, Bot, Copy, PenLine, Play, Plus, Quote, RefreshCw, Search, Shield, Trash2, Type, X } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { CommandEditorModal } from "../../features/commands";
import { createPortal } from "react-dom";

export type CommandsSettingsSectionProps = { settingsResources: any; customCommands: any; commandSearch: any; builtinCommandCatalog: any; commandFilter: any; setNotice: any; setCommandEditor: any; workspace: any; refreshCommands: any; commandBusy: any; setCommandSearch: any; setCommandFilter: any; setCommandDelete: any; useCommand: any; commandEditor: any; commandBusyKey: any; persistCommand: any; commandDelete: any; confirmDeleteCommand: any };

export function CommandsSettingsSection(props: CommandsSettingsSectionProps) {
  const { settingsResources, customCommands, commandSearch, builtinCommandCatalog, commandFilter, setNotice, setCommandEditor, workspace, refreshCommands, commandBusy, setCommandSearch, setCommandFilter, setCommandDelete, useCommand, commandEditor, commandBusyKey, persistCommand, commandDelete, confirmDeleteCommand } = props;
  // 技能命令：已启用技能即 WorkBuddy 语义里的 slash-command 包
  const skillCommands = settingsResources.skills.filter((skill: any) => skill.enabled !== false);
  const customVisible = customCommands.filter((entry: any) => !commandSearch || `${entry.name} ${entry.description} ${entry.argumentHint}`.toLowerCase().includes(commandSearch.toLowerCase()));
  const builtinVisible = builtinCommandCatalog.filter((cmd: any) => !commandSearch || `${cmd.name} ${cmd.description} ${cmd.hint ?? ""}`.toLowerCase().includes(commandSearch.toLowerCase()));
  const skillVisible = skillCommands.filter((skill: any) => !commandSearch || `${skill.name} ${skill.description ?? ""}`.toLowerCase().includes(commandSearch.toLowerCase()));
  const builtinCategories = ["会话管理", "上下文与状态", "模型与权限", "审查与代码", "信息查询", "运行控制"];
  const totalCount = builtinCommandCatalog.length + customCommands.length + skillCommands.length;
  const filterTabs: { key: "all" | "custom" | "builtin" | "skill"; label: string; count: number }[] = [
    { key: "all", label: "全部", count: totalCount },
    { key: "custom", label: "自定义", count: customCommands.length },
    { key: "builtin", label: "内置", count: builtinCommandCatalog.length },
    { key: "skill", label: "技能", count: skillCommands.length },
  ];
  const showAll = commandFilter === "all";
  const copyCommand = async (text: string) => {
    try { await copyTextToClipboard(text); setNotice(`已复制 ${text}`); } catch { setNotice("复制失败"); }
  };
  const openNewCommand = () => setCommandEditor({ mode: "new", name: "", source: workspace ? "project" : "global", description: "", argumentHint: "", allowedTools: "", model: "", body: "" });
  const openEditCommand = (entry: CustomCommandEntry) => setCommandEditor({ mode: "edit", name: entry.name, source: entry.source, description: entry.description, argumentHint: entry.argumentHint, allowedTools: entry.allowedTools, model: entry.model, body: entry.body, prevFilePath: entry.filePath });
  return <section className="settings-section stack command-center">
    <div className="settings-copy channel-heading"><div><h2>命令<PageInfo text={<>复用常用操作与自定义工作流。输入框输入 <code>/</code> 会弹出命令补全，点击下方命令可直接填入；自定义命令以 <code>commands/*.md</code> 保存，支持参数与文件引用。</>} /></h2></div><div className="settings-heading-actions"><button className="secondary-setting" onClick={openNewCommand}><Plus size={14} />新建命令</button><button className="icon-button" title="刷新命令" onClick={() => void refreshCommands()}>{commandBusy ? <Spinner /> : <RefreshCw size={14} />}</button></div></div>
    <div className="command-toolbar">
      <label className="skill-search command-search"><Search size={14} /><input value={commandSearch} onChange={(event) => setCommandSearch(event.target.value)} placeholder="搜索命令名称或描述…" /></label>
      <div className="command-stats"><span>内置 <b>{builtinCommandCatalog.length}</b></span><span>自定义 <b>{customCommands.length}</b></span><span>技能 <b>{skillCommands.length}</b></span></div>
    </div>
    <div className="skill-tabs command-tabs">{filterTabs.map((tab) => <button key={tab.key} className={commandFilter === tab.key ? "active" : ""} onClick={() => setCommandFilter(tab.key)}>{tab.label} <small>{tab.count}</small></button>)}</div>
    {commandFilter === "all" || commandFilter === "custom" ? (customVisible.length ? <section className="command-group"><header><span className="command-group-dot custom" />自定义命令<small>{customVisible.length} 个 · 个人全局与项目级 .md 模板</small></header><div className="command-grid">{customVisible.map((entry: any) => (
      <article className={`command-card custom`} key={entry.filePath}>
        <div className="command-card-top"><code className="command-slash">/{entry.name}</code><span className={`command-source-tag ${entry.source}`}>{entry.source === "global" ? "个人全局" : "项目级"}</span><div className="command-card-actions"><button className="icon-button" title="复制命令" onClick={() => void copyCommand(`/${entry.name}`)}><Copy size={12} /></button><button className="icon-button" title="编辑" onClick={() => openEditCommand(entry)}><PenLine size={12} /></button><button className="icon-button danger" title="删除" onClick={() => setCommandDelete(entry)}><Trash2 size={12} /></button></div></div>
        <p className="command-desc">{entry.description || "（无描述）"}</p>
        <div className="command-chips">{entry.argumentHint ? <span className="command-chip hint"><Type size={11} />{entry.argumentHint}</span> : null}{entry.allowedTools ? <span className="command-chip tools" title={entry.allowedTools}><Shield size={11} />{entry.allowedTools}</span> : null}{entry.model ? <span className="command-chip model"><Bot size={11} />{entry.model}</span> : null}</div>
        <button className="command-use" onClick={() => useCommand(entry.name, "custom")}><Play size={12} />使用</button>
      </article>
    ))}</div></section> : <p className="muted command-empty">{commandSearch ? "没有匹配的自定义命令，换个关键词试试。" : "还没有自定义命令。点击「新建命令」创建你的第一个工作流，例如 /git:commit、/review-pr。"}</p>) : null}
    {showAll || commandFilter === "builtin" ? builtinVisible.length ? builtinCategories.map((category) => {
      const categoryCommands = builtinVisible.filter((cmd: any) => cmd.category === category);
      if (!categoryCommands.length) return null;
      return <section className="command-group" key={category}><header><span className="command-group-dot builtin" />{category}<small>{categoryCommands.length} 个内置命令</small></header><div className="command-grid">{categoryCommands.map((cmd: any) => (
        <article className="command-card builtin" key={cmd.name}>
          <div className="command-card-top"><code className="command-slash">/{cmd.name}</code><span className="command-source-tag builtin">内置</span><div className="command-card-actions"><button className="icon-button" title="复制命令" onClick={() => void copyCommand(`/${cmd.name}`)}><Copy size={12} /></button></div></div>
          <p className="command-desc">{cmd.description}</p>
          {cmd.hint ? <div className="command-chips"><span className="command-chip hint"><Type size={11} />{cmd.hint}</span></div> : null}
          <button className="command-use" onClick={() => useCommand(cmd.name, "builtin")}><Play size={12} />使用</button>
        </article>
      ))}</div></section>;
    }) : <p className="muted command-empty">{commandSearch ? "没有匹配的内置命令，换个关键词试试。" : "内置命令为空。"} </p> : null}
    {showAll || commandFilter === "skill" ? skillVisible.length ? <section className="command-group"><header><span className="command-group-dot skill" />技能命令<small>{skillVisible.length} 个已启用技能 · 技能即 WorkBuddy 语义下的 slash-command 包</small></header><div className="command-grid">{skillVisible.map((skill: any) => (
      <article className="command-card skill" key={skill.name}>
        <div className="command-card-top"><code className="command-slash">/{skill.name}</code><span className="command-source-tag skill">技能</span><div className="command-card-actions"><button className="icon-button" title="复制命令" onClick={() => void copyCommand(`/${skill.name}`)}><Copy size={12} /></button></div></div>
        <p className="command-desc">{skill.description || "已启用的技能命令"}</p>
        <button className="command-use" onClick={() => useCommand(skill.name, "skill", skill)}><Quote size={12} />引用技能</button>
      </article>
    ))}</div></section> : <p className="muted command-empty">{commandSearch ? "没有匹配的技能命令。" : "还没有可用的技能命令。到「技能」页安装或启用技能后，这里会列出它们的斜杠命令。"}</p> : null}
    {commandEditor && <CommandEditorModal draft={commandEditor} saving={commandBusyKey === "save"} onChange={setCommandEditor} onClose={() => setCommandEditor(null)} onSave={() => void persistCommand()} />}
    {commandDelete && createPortal(<div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCommandDelete(null); }}><section className="connector-setup-modal command-delete-modal" role="dialog" aria-modal="true" aria-label="删除命令"><header><div className="connector-setup-title"><span><AlertTriangle size={17} /></span><div><strong>删除命令 /{commandDelete.name}</strong><p>将删除文件 <code>{commandDelete.filePath}</code>，删除后无法恢复。</p></div></div><button className="icon-button relay-modal-close" title="关闭" onClick={() => setCommandDelete(null)}><X size={16} /></button></header><footer><button className="secondary-setting" onClick={() => setCommandDelete(null)}>取消</button><button className="danger-button" disabled={commandBusyKey === "delete"} onClick={() => void confirmDeleteCommand()}>{commandBusyKey === "delete" ? <Spinner /> : <Trash2 size={14} />}确认删除</button></footer></section></div>, document.body)}
  </section>;
}
