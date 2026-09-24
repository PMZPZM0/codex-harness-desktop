/**
 * 设置页 · hooks（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX / 体内语句与原块逐字一致（仅去掉外层缩进与 IIFE 包装）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 */
import { PageInfo } from "../../components/SettingsHead";
import { Spinner } from "../../components/CardShell";
import { RefreshCw, ShieldCheck, Wrench } from "lucide-react";
import { ToggleSwitch } from "../../components/SettingsWidgets";

export type HooksSettingsSectionProps = { settingsResources: any; pluginDisplayName: any; localSkills: any; hookTrusting: any; trustAllHooks: any; refreshSettingsResources: any; resourceLoading: any; linkedBusy: any; setLinkedEnabled: any; hookBusy: any; setHookEnabled: any };

export function HooksSettingsSection(props: HooksSettingsSectionProps) {
  const { settingsResources, pluginDisplayName, localSkills, hookTrusting, trustAllHooks, refreshSettingsResources, resourceLoading, linkedBusy, setLinkedEnabled, hookBusy, setHookEnabled } = props;
  const hooks = settingsResources.hooks as any[];
  const untrusted = hooks.filter((hook: any) => hook.trustStatus && hook.trustStatus !== "trusted");
  const enabledCount = hooks.filter((hook: any) => hook.enabled !== false).length;
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
  return <section className="settings-section stack hook-center">
    <div className="settings-copy channel-heading"><div><h2>钩子<PageInfo text={<>钩子的启停会<b>联动所属插件与它提供的技能</b>。另外 Codex <b>不会执行未信任的钩子</b>——新装后必须点一次「信任」，否则装了等于没装。</>} /></h2></div><div className="settings-heading-actions">{untrusted.length > 0 && <button className="primary-setting" disabled={hookTrusting} onClick={() => void trustAllHooks()}>{hookTrusting ? <Spinner /> : <ShieldCheck size={14} />}信任全部 {untrusted.length}</button>}<button className="icon-button" title="刷新钩子" onClick={() => void refreshSettingsResources()}>{resourceLoading ? <Spinner /> : <RefreshCw size={14} />}</button></div></div>

    <div className="hook-stats">
      <div className="hook-stat"><span>钩子总数</span><strong>{hooks.length}</strong></div>
      <div className="hook-stat"><span>启用中</span><strong className="stat-ok">{enabledCount}</strong></div>
      <div className="hook-stat"><span>已停用</span><strong className="stat-off">{hooks.length - enabledCount}</strong></div>
      <div className="hook-stat"><span>未信任</span><strong className={untrusted.length ? "stat-warn" : "stat-ok"}>{untrusted.length}</strong></div>
      <div className="hook-stat"><span>来源</span><strong>{groups.length}</strong></div>
    </div>

    {groups.map((group) => {
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
            {!trusted && <button className="secondary-setting hook-trust-button" disabled={hookTrusting} onClick={() => void trustAllHooks()}><ShieldCheck size={12} />信任</button>}
          </div>
        </article>;
      })}
          {!group.hooks.length && <p className="hook-group-empty">{group.pluginId ? (groupOn ? "这个插件没有提供钩子。" : "插件已停用，它的钩子没有加载。打开上方开关即可恢复。") : "没有钩子。"}</p>}
        </div>
      </section>;
    })}
    {!hooks.length && <div className="hook-empty"><Wrench size={26} /><strong>还没有注册钩子</strong><p>钩子来自 <code>$CODEX_HOME/hooks.json</code> 或已安装的插件（例如 ponytail）。</p></div>}
  </section>;
}
