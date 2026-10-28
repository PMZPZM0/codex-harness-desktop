/**
 * 设置页 · hooks（09-21 从 App.tsx 内联块搬出）。
 *
 * 10-28 用户令（钩子页截图）：「界面帮我优化一下，改成搜索框 + 筛选 + 刷新」——
 * 顶部收成一条工具栏：搜索（事件 / 命令 / 来源）+ 状态筛选 + 来源筛选 + 刷新，
 * 信任全部跟着工具条右对齐；统计卡保留为总览，筛选后实时提示「匹配 N / 共 M」。
 * ⛔ 筛选只影响**显示**，不改任何钩子/插件的启用、信任与分组开关语义。
 */
import { useState } from "react";
import { Spinner } from "../../components/CardShell";
import { RefreshCw, ShieldCheck, Wrench } from "lucide-react";
import { SearchField, ToggleSwitch } from "../../components/SettingsWidgets";
import { AppSelect } from "../../components/AppSelect";
import { refreshWithReceipt } from "../../lib/refresh-receipt.mjs";

export type HooksSettingsSectionProps = { settingsResources: any; pluginDisplayName: any; localSkills: any; hookTrusting: any; trustAllHooks: any; refreshSettingsResources: any; resourceLoading: any; linkedBusy: any; setLinkedEnabled: any; hookBusy: any; setHookEnabled: any; setNotice: any };

type StatusFilter = "all" | "on" | "off" | "untrusted";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "全部状态" },
  { value: "on", label: "启用中" },
  { value: "off", label: "已停用" },
  { value: "untrusted", label: "未信任" },
];

export function HooksSettingsSection(props: HooksSettingsSectionProps) {
  const { settingsResources, pluginDisplayName, localSkills, hookTrusting, trustAllHooks, refreshSettingsResources, resourceLoading, linkedBusy, setLinkedEnabled, hookBusy, setHookEnabled, setNotice } = props;
  const hooks = settingsResources.hooks as any[];
  const untrusted = hooks.filter((hook: any) => hook.trustStatus && hook.trustStatus !== "trusted");
  const enabledCount = hooks.filter((hook: any) => hook.enabled !== false).length;
  /* ⛔ 筛选状态只在本页（不进 bag）：离开设置页即重置，不会污染别处。 */
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  // 按来源分组：插件钩子归到插件名下（便于联动），其余算自定义钩子
  const groups: { id: string; label: string; pluginId?: string; hooks: any[]; skillCount: number; pluginEnabled?: boolean }[] = [];
  const byPlugin = new Map<string, any[]>();
  const userHooks: any[] = [];
  for (const hook of hooks) {
    const pid = hook.pluginId ? String(hook.pluginId) : "";
    if (pid) {
      if (!byPlugin.has(pid)) byPlugin.set(pid, []);
      byPlugin.get(pid)!.push(hook);
    } else userHooks.push(hook);
  }
  // 分组必须以「已安装的插件」为准，不能只靠 hooks/list：
  // 插件一旦停用，它提供的钩子会整组从 hooks/list 里消失，
  // 只按钩子建组的话分组会一起消失，用户就再也找不到开关把插件开回来了。
  const installedPlugins = (settingsResources.plugins as any[]).filter((plugin) => plugin.installed);
  const seenPlugins = new Set<string>();
  for (const plugin of installedPlugins) {
    const pluginId = String(plugin.id ?? "");
    if (!pluginId) continue;
    seenPlugins.add(pluginId);
    groups.push({
      id: pluginId,
      label: pluginDisplayName(plugin),
      pluginId,
      hooks: byPlugin.get(pluginId) ?? [],
      skillCount: localSkills.filter((entry: any) => entry.pluginId === pluginId).length,
      pluginEnabled: plugin.enabled !== false,
    });
  }
  // 插件已卸载、但钩子还残留在配置里的情况也要给个出口
  for (const [pluginId, list] of byPlugin) {
    if (seenPlugins.has(pluginId)) continue;
    groups.push({ id: pluginId, label: pluginId, pluginId, hooks: list, skillCount: localSkills.filter((entry: any) => entry.pluginId === pluginId).length, pluginEnabled: true });
  }
  if (userHooks.length) groups.push({ id: "user", label: "自定义钩子", hooks: userHooks, skillCount: 0 });
  // 插件组的开关状态由插件本身决定（钩子列表可能为空），自定义组则由钩子决定
  const groupEnabled = (group: typeof groups[number]) => group.pluginId ? group.pluginEnabled !== false : group.hooks.some((hook: any) => hook.enabled !== false);

  const keyword = query.trim().toLowerCase();
  const filtering = keyword !== "" || statusFilter !== "all" || sourceFilter !== "all";
  const hookMatches = (hook: any, group: typeof groups[number]) => {
    const trusted = Boolean(hook.trustStatus && hook.trustStatus !== "trusted");
    const on = hook.enabled !== false;
    if (statusFilter === "on" && !on) return false;
    if (statusFilter === "off" && on) return false;
    if (statusFilter === "untrusted" && !trusted) return false;
    if (!keyword) return true;
    const hay = [
      hook.eventName, hook.event, hook.command, hook.scriptPath, hook.matcher,
      hook.sourcePath, hook.source, group.label, group.id,
    ].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(keyword);
  };
  const visibleGroups = groups
    .filter((group) => sourceFilter === "all" || group.id === sourceFilter)
    .map((group) => ({ ...group, hooks: group.hooks.filter((hook) => hookMatches(hook, group)) }))
    /* 不筛选时保留空插件组（它是「插件没提供钩子 / 插件已停用」的唯一出口）；
       一旦筛选就只显示有命中的组。 */
    .filter((group) => !filtering || group.hooks.length > 0);
  const matched = visibleGroups.reduce((sum, group) => sum + group.hooks.length, 0);
  const clearFilters = () => { setQuery(""); setStatusFilter("all"); setSourceFilter("all"); };

  return <section className="settings-section stack hook-center">
    <div className="resource-toolbar secondary hook-filter-row">
      <SearchField value={query} onChange={setQuery} placeholder="搜索钩子的事件、命令或来源" />
      <span className="hook-filter-select" title="按状态筛选">
        <AppSelect
          className="hook-status-select"
          value={statusFilter}
          ariaLabel="钩子状态筛选"
          options={STATUS_OPTIONS}
          onChange={(next) => setStatusFilter(next as StatusFilter)}
        />
      </span>
      <span className="hook-filter-select" title="按来源筛选">
        <AppSelect
          className="hook-source-select"
          value={sourceFilter}
          ariaLabel="钩子来源筛选"
          options={[{ value: "all", label: "全部来源" }, ...groups.map((group) => ({ value: group.id, label: group.label }))]}
          onChange={(next) => setSourceFilter(next)}
        />
      </span>
      {filtering && <span className="hook-filter-count">匹配 {matched} / 共 {hooks.length}</span>}
      <div className="hook-actions-line settings-actions-row">
        {/* 10-28 审查：主进程只提供「批量信任待信任钩子」（hooks:trust），没有单条信任通道。
            这里原先每条未信任钩子都放一颗「信任」，点哪条都会信任**全部** ⇒ 误导。
            唯一入口保留在页头「信任全部 N」。 */}
        {untrusted.length > 0 && <button className="primary-setting" disabled={hookTrusting} onClick={() => void trustAllHooks()}>{hookTrusting ? <Spinner /> : <ShieldCheck size={14} />}信任全部 {untrusted.length}</button>}
        <button className="icon-button" title="刷新钩子" onClick={() => void refreshWithReceipt(setNotice, "刷新钩子", () => refreshSettingsResources())}>{resourceLoading ? <Spinner /> : <RefreshCw size={14} />}</button>
      </div>
    </div>

    <div className="hook-stats">
      <div className="hook-stat"><span>钩子总数</span><strong>{hooks.length}</strong></div>
      <div className="hook-stat"><span>启用中</span><strong className="stat-ok">{enabledCount}</strong></div>
      <div className="hook-stat"><span>已停用</span><strong className="stat-off">{hooks.length - enabledCount}</strong></div>
      <div className="hook-stat"><span>未信任</span><strong className={untrusted.length ? "stat-warn" : "stat-ok"}>{untrusted.length}</strong></div>
      <div className="hook-stat"><span>来源</span><strong>{groups.length}</strong></div>
    </div>

    {visibleGroups.map((group) => {
      const groupOn = groupEnabled(group);
      const groupBusy = group.pluginId ? linkedBusy === group.pluginId : false;
      return <section className={`hook-group ${groupOn ? "" : "is-off"}`} key={group.id}>
        <header className="hook-group-head">
          <div className="hook-group-title">
            <strong>{group.label}</strong>
            <span className="hook-group-meta">
              {group.hooks.length} 个钩子
              {group.skillCount > 0 && <> · {group.skillCount} 个技能</>}
              {group.pluginId && <> · <code>{group.id}</code></>}
            </span>
          </div>
          {group.pluginId ? <ToggleSwitch
            checked={groupOn}
            disabled={groupBusy}
            label={`${group.label} 联动开关`}
            title={groupOn ? `停用「${group.label}」：插件、${group.hooks.length} 个钩子与 ${group.skillCount} 个技能一起停用` : `启用「${group.label}」：插件、${group.hooks.length} 个钩子与 ${group.skillCount} 个技能一起启用`}
            onChange={(next) => void setLinkedEnabled(group.id, next, group.label)}
          /> : <span className="hook-group-tag">用户自定义</span>}
        </header>
        <div className="hook-list">
      {group.hooks.map((hook: any, index: number) => {
        const trusted = hook.trustStatus === "trusted";
        const on = hook.enabled !== false;
        const key = hook.key ?? index;
        const busy = hookBusy === String(hook.key ?? "");
        return <article className={`hook-card ${trusted ? "trusted" : "untrusted"} ${on ? "" : "is-disabled"}`} key={key}>
          <div className="hook-card-head">
            <span className="hook-event">{hook.eventName ?? hook.event ?? "hook"}</span>
            <span className={`hook-trust ${trusted ? "on" : "off"}`}>{hook.trustStatus ?? "unknown"}</span>
            <ToggleSwitch
              checked={on}
              disabled={busy}
              label={`${hook.eventName ?? "钩子"} 启用开关`}
              title={on ? "停用这条钩子" : "启用这条钩子"}
              onChange={(next) => void setHookEnabled(hook, next)}
            />
          </div>
          <code className="hook-command" title={hook.command}>{hook.command ?? hook.scriptPath ?? "—"}</code>
          <div className="hook-card-foot">
            <span className="hook-source" title={hook.sourcePath}>{hook.matcher ? <>匹配 <code>{hook.matcher}</code> · </> : null}{hook.timeoutSec ? <>{hook.timeoutSec}s · </> : null}{hook.sourcePath ? String(hook.sourcePath).replace(/^.*[\\/]/, "") : (hook.source ?? "user")}</span>
          </div>
        </article>;
      })}
          {!group.hooks.length && <p className="hook-group-empty">{group.pluginId ? (groupOn ? "这个插件没有提供钩子。" : "插件已停用，它的钩子没有加载。打开上方开关即可恢复。") : "没有钩子。"}</p>}
        </div>
      </section>;
    })}
    {!hooks.length && <div className="hook-empty"><Wrench size={26} /><strong>还没有注册钩子</strong><p>钩子来自 <code>$CODEX_HOME/hooks.json</code> 或已安装的插件（例如 ponytail）。</p></div>}
    {Boolean(hooks.length) && filtering && !matched && <div className="hook-empty"><Wrench size={26} /><strong>没有匹配的钩子</strong><p>换个关键词，或把状态 / 来源筛选改回「全部」。</p><button className="secondary-setting hook-clear-filters" onClick={clearFilters}>清除筛选</button></div>}
  </section>;
}
