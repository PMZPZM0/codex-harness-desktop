/**
 * 设置页 · plugins（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX / 体内语句与原块逐字一致（仅去掉外层缩进与 IIFE 包装）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 */
import { PageInfo } from "../../components/SettingsHead";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, CircleStop, Play, Plus, RefreshCw, Store, Trash2 } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { BatchActions, CheckCard, SearchField, SegmentedTabs, SelectAllToggle, ToggleSwitch } from "../../components/SettingsWidgets";
import { CODEX_MARKET_ZH, zhCategory } from "../../lib/codex-market-zh";
import { MarketLogo } from "../../features/skills-market";
import { avatarToneOf } from "../../lib/entity-avatar";

export type PluginsMarketSectionProps = { settingsResources: any; pluginSearch: any; pluginInstalledOnly: any; pluginDisplayName: any; pluginDescription: any; pluginChecked: any; setPluginChecked: any; refreshPluginsPage: any; resourceLoading: any; pluginMarketLoading: any; pluginMarketCategoryTabs: any; pluginMarketCategory: any; setPluginMarketCategory: any; setPluginMarketPage: any; pluginMarketSearch: any; setPluginMarketSearch: any; pluginMarketItems: any; installingMarketPlugin: any; setMarketPreview: any; installMarketPlugin: any; pluginMarketTotal: any; pluginMarketPage: any; pluginMarketPageSize: any; setPluginInstalledOnly: any; setPluginSearch: any; pluginBatchBusy: any; batchSetPluginEnabled: any; pluginBusy: any; setPluginEnabled: any; changePlugin: any };

export function PluginsMarketSection(props: PluginsMarketSectionProps) {
  const { settingsResources, pluginSearch, pluginInstalledOnly, pluginDisplayName, pluginDescription, pluginChecked, setPluginChecked, refreshPluginsPage, resourceLoading, pluginMarketLoading, pluginMarketCategoryTabs, pluginMarketCategory, setPluginMarketCategory, setPluginMarketPage, pluginMarketSearch, setPluginMarketSearch, pluginMarketItems, installingMarketPlugin, setMarketPreview, installMarketPlugin, pluginMarketTotal, pluginMarketPage, pluginMarketPageSize, setPluginInstalledOnly, setPluginSearch, pluginBatchBusy, batchSetPluginEnabled, pluginBusy, setPluginEnabled, changePlugin } = props;
  const all = settingsResources.plugins as any[];
  const installed = all.filter((plugin) => plugin.installed);
  // 市场卡片「已安装」判定：引擎插件 id 形如 name@marketplace，取 @ 前与市场 slug 比对
  const installedMarketPluginSlugs = new Set(installed.map((plugin) => String(plugin.id ?? plugin.name ?? "").split("@")[0]));
  const enabledCount = installed.filter((plugin) => plugin.enabled !== false).length;
  const disabledCount = installed.length - enabledCount;
  const keyword = pluginSearch.trim().toLowerCase();
  const visible = all.filter((plugin) => {
    if (pluginInstalledOnly && !plugin.installed) return false;
    if (!keyword) return true;
    return `${pluginDisplayName(plugin)} ${pluginDescription(plugin)} ${plugin.marketplaceName ?? ""} ${plugin.name ?? ""}`.toLowerCase().includes(keyword);
  });
  // 只有已安装的插件可以勾选：没装的谈不上启用/停用
  const selectableIds = visible.filter((plugin) => plugin.installed).map((plugin) => String(plugin.id ?? ""));
  // 筛选变化后，之前勾的条目可能已不可见，取交集避免计数错乱
  const checkedIds = pluginChecked.filter((id: any) => selectableIds.includes(id));
  const checkedPlugins = all.filter((plugin) => checkedIds.includes(String(plugin.id ?? "")));
  const batchTargets = {
    enable: checkedPlugins.filter((plugin) => plugin.enabled === false),
    disable: checkedPlugins.filter((plugin) => plugin.enabled !== false),
  };
  const togglePluginChecked = (id: string) => setPluginChecked((current: any) => current.includes(id) ? current.filter((entry: any) => entry !== id) : [...current, id]);
  return <section className="settings-section stack plugin-center">
    <div className="settings-copy channel-heading"><div><h2>插件<PageInfo text={<>上方卡片来自 Codex Plugin Marketplace（codex-marketplace.com），一键安装写入本地插件目录，无需 ChatGPT 登录；下方为已安装插件管理，停用后 Codex 不再加载该插件提供的指令、技能与钩子。</>} helpKey="plugins" label="插件" /></h2></div><div className="settings-heading-actions"><button className="secondary-setting" title="打开 Codex Plugin Marketplace 在线市场" onClick={() => void window.codex.openExternal("https://www.codex-marketplace.com/plugins")}><ArrowUpRight size={14} />在线市场</button><button className="icon-button" title="刷新：已装插件 / 技能 / 钩子 / 记忆 / 任务 / MCP + 插件市场（沿用当前分类与搜索）" onClick={() => void refreshPluginsPage()}>{(resourceLoading || pluginMarketLoading) ? <Spinner /> : <RefreshCw size={14} />}</button></div></div>

    <div className="plugin-market-block">
      <div className="plugin-market-title">插件市场<small>来自 Codex Plugin Marketplace · 一键安装无需登录</small></div>
      <div className="resource-toolbar">
        <div className="skill-tabs">{pluginMarketCategoryTabs.map(([label, value]: any) => <button key={value} className={pluginMarketCategory === value ? "active" : ""} onClick={() => { setPluginMarketCategory(value); setPluginMarketPage(1); }}>{label}</button>)}: any</div>
        <SearchField value={pluginMarketSearch} onChange={(next) => { setPluginMarketSearch(next); setPluginMarketPage(1); }} placeholder="搜索插件名称、简介或作者" />
      </div>
      {pluginMarketItems.length > 0 ? <div className="skill-card-grid">
        {pluginMarketItems.map((plugin: any) => {
          const installedMarket = installedMarketPluginSlugs.has(plugin.slug);
          const busy = installingMarketPlugin === plugin.slug;
          return <article className={`skill-card ${installedMarket ? "installed" : ""}`} key={plugin.slug} onClick={() => setMarketPreview({
            kind: "plugin",
            title: plugin.displayName,
            subtitle: `${zhCategory(plugin.category)} · codex-marketplace.com`,
            icon: plugin.logo,
            iconChar: plugin.displayName,
            description: CODEX_MARKET_ZH[plugin.slug] ?? plugin.description,
            meta: [zhCategory(plugin.category), ...(plugin.githubStars > 0 ? [`★ ${plugin.githubStars}`] : [])],
            installed: Boolean(installedMarket),
            installLabel: "一键安装",
            onInstall: installedMarket ? undefined : () => void installMarketPlugin(plugin),
            externalUrl: plugin.repository,
            externalLabel: "查看来源",
            note2: installedMarket ? undefined : "下载插件目录到本地并注册进引擎，无需 ChatGPT 登录",
          })}>
            <div className="skill-card-head">
              <MarketLogo url={plugin.logo} label={plugin.displayName} size={30} />
              <button className="skill-add" title={installedMarket ? "已安装" : "一键安装到本地插件目录"} disabled={Boolean(installingMarketPlugin) || installedMarket} onClick={(event) => { event.stopPropagation(); if (!installedMarket) void installMarketPlugin(plugin); }}>{installedMarket ? <Check size={14} /> : busy ? <Spinner /> : <Plus size={14} />}</button>
            </div>
            <strong title={plugin.displayName}>{plugin.displayName}</strong>
            <p>{CODEX_MARKET_ZH[plugin.slug] ?? plugin.description}</p>
            <footer><span>{zhCategory(plugin.category)}</span>{plugin.githubStars > 0 && <span title="GitHub Stars">★ {plugin.githubStars}</span>}<a href={plugin.repository} onClick={(event) => { event.preventDefault(); void window.codex.openExternal(plugin.repository); }}>查看来源</a></footer>
          </article>;
        })}
      </div> : <p className="muted">{pluginMarketLoading ? "正在加载插件市场…" : "没有匹配的插件，换个关键词试试。"}</p>}
      <div className="skill-market-pagination"><span>共 {pluginMarketTotal} 个插件 · 第 {pluginMarketPage} / {Math.max(1, Math.ceil(pluginMarketTotal / pluginMarketPageSize))} 页</span><div><button className="secondary-setting" disabled={pluginMarketLoading || pluginMarketPage <= 1} onClick={() => setPluginMarketPage((page: any) => Math.max(1, page - 1))}><ArrowLeft size={14} />上一页</button><button className="secondary-setting" disabled={pluginMarketLoading || pluginMarketPage >= Math.max(1, Math.ceil(pluginMarketTotal / pluginMarketPageSize))} onClick={() => setPluginMarketPage((page: any) => page + 1)}>下一页<ArrowRight size={14} /></button></div></div>
    </div>

    <div className="plugin-stats">
      <div className="plugin-stat"><span>市场插件</span><strong>{all.length}</strong></div>
      <div className="plugin-stat"><span>已安装</span><strong>{installed.length}</strong></div>
      <div className="plugin-stat"><span>启用中</span><strong className="stat-ok">{enabledCount}</strong></div>
      <div className="plugin-stat"><span>已停用</span><strong className="stat-off">{disabledCount}</strong></div>
    </div>

    <div className="resource-toolbar">
      <SegmentedTabs
        value={pluginInstalledOnly ? "installed" : "all"}
        onChange={(next) => setPluginInstalledOnly(next === "installed")}
        options={[{ value: "all", label: "全部", count: all.length }, { value: "installed", label: "已安装", count: installed.length }]}
      />
      <SearchField value={pluginSearch} onChange={setPluginSearch} placeholder="搜索插件名称、描述或来源市场" />
    </div>
    <div className="resource-toolbar secondary">
      <SelectAllToggle total={selectableIds.length} selected={checkedIds.length} unit="个插件" onSelectAll={() => setPluginChecked(selectableIds)} onClear={() => setPluginChecked([])} />
      <BatchActions
        hint={checkedIds.length ? `选中里：${batchTargets.disable.length} 个启用中 · ${batchTargets.enable.length} 个已停用` : "勾选插件后可批量启用或停用"}
        actions={[
          { label: batchTargets.enable.length ? `启用所选 (${batchTargets.enable.length})` : "启用所选", icon: <Play size={13} />, disabled: !batchTargets.enable.length, busy: pluginBatchBusy === "enable", onClick: () => void batchSetPluginEnabled(batchTargets.enable, true), title: batchTargets.enable.length ? `启用选中的 ${batchTargets.enable.length} 个已停用插件` : "没有勾选已停用的插件" },
          { label: batchTargets.disable.length ? `停用所选 (${batchTargets.disable.length})` : "停用所选", icon: <CircleStop size={13} />, tone: "danger", disabled: !batchTargets.disable.length, busy: pluginBatchBusy === "disable", onClick: () => void batchSetPluginEnabled(batchTargets.disable, false), title: batchTargets.disable.length ? `停用选中的 ${batchTargets.disable.length} 个启用中插件` : "没有勾选启用中的插件" },
        ]}
      />
    </div>

    <div className="plugin-card-grid">
      {visible.map((plugin: any) => {
        const key = plugin.id ?? plugin.name ?? Math.random();
        const busy = pluginBusy === String(plugin.id ?? plugin.name ?? key);
        const isInstalled = Boolean(plugin.installed);
        const isEnabled = isInstalled && plugin.enabled !== false;
        const displayName = pluginDisplayName(plugin);
        const initial = displayName.replace(/^@/, "").charAt(0).toUpperCase();
        const capabilities: string[] = plugin.interface?.capabilities ?? [];
        const checked = checkedIds.includes(String(plugin.id ?? ""));
        return <article className={`plugin-card ${isInstalled ? "installed" : ""} ${isInstalled && !isEnabled ? "is-disabled" : ""} ${checked ? "is-checked" : ""}`} key={key}>
          <div className="plugin-card-head">
            <CheckCard checked={checked} disabled={!isInstalled} label={`选择 ${displayName}`} title={!isInstalled ? "未安装的插件无法勾选" : checked ? `取消选择 ${displayName}` : `勾选 ${displayName}`} onChange={() => togglePluginChecked(String(plugin.id ?? ""))} />
            <span className={`plugin-avatar tone-${avatarToneOf(displayName)}`}>{initial}</span>
            <div className="plugin-card-title"><strong title={displayName}>{displayName}</strong><small>{plugin.marketplaceName ? `来自 ${plugin.marketplaceName}` : "本地市场"}{plugin.interface?.developerName ? ` · ${plugin.interface.developerName}` : ""}</small></div>
            {!isInstalled && <span className="plugin-state off">未安装</span>}
            <ToggleSwitch
              checked={isEnabled}
              disabled={!isInstalled || busy !== false}
              label={`${displayName} 启用开关`}
              title={!isInstalled ? "安装后才能启用" : isEnabled ? "停用插件" : "启用插件"}
              onChange={(next) => void setPluginEnabled(plugin, next)}
            />
          </div>
          <p className="plugin-desc">{pluginDescription(plugin)}</p>
          {capabilities.length > 0 && <div className="plugin-tags">{capabilities.slice(0, 3).map((capability) => <span className="plugin-tag" key={capability}>{capability}</span>)}</div>}
          <div className="plugin-card-foot">
            <span className="plugin-source"><Store size={11} />{plugin.localVersion ? `v${plugin.localVersion}` : plugin.interface?.category ?? "plugin"}</span>
            <button className={isInstalled ? "secondary-setting plugin-action danger" : "primary-setting plugin-action"} disabled={busy} onClick={() => void changePlugin(plugin)}>
              {busy ? <Spinner /> : isInstalled ? <><Trash2 size={13} />卸载</> : <><Plus size={13} />安装</>}
            </button>
          </div>
        </article>;
      })}
      {!visible.length && <div className="plugin-empty"><Store size={26} /><strong>{all.length ? "没有匹配的插件" : "还没有发现插件"}</strong><p>{all.length ? "换个关键词，或清除「已安装」筛选。" : "在 Codex 配置里添加 marketplace 后，插件会出现在这里。"}</p></div>}
    </div>
  </section>;
}
