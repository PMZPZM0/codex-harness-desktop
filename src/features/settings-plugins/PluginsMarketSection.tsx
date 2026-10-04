/**
 * 设置页 · plugins（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX / 体内语句与原块逐字一致（仅去掉外层缩进与 IIFE 包装）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 *
 * 09-27 追加（非搬迁部分）：顶部内置「视频生成接口」卡 + 各厂商凭证配置弹层 ——
 * 走内置 IPC `video:*`（国内外 8 家），不是市场里的可安装插件，所以独立成卡。
 */
import { PageInfo } from "../../components/SettingsHead";
import { useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, CircleStop, Play, Plus, RefreshCw, Store, Trash2 } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { BatchActions, CheckCard, SearchField, SegmentedTabs, SelectAllToggle, ToggleSwitch } from "../../components/SettingsWidgets";
import { MarketLogo } from "../../features/skills-market";
import { CodexOfficialMarketSection } from "../codex-official-market";
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
  // 两个市场数据源（10-03）：Gitee 上的 Claude Code 官方镜像 ⇄ Codex 官方 openai/plugins（GitHub 国内镜像读取）。
  // 各自的分类表、卡片与安装进度互不相干 ⇒ 切的是**整块**（用户拍板「按源给各自的分类 tab」），不是把 18 个分类混排。
  const [marketSource, setMarketSource] = useState("gitee");
  return <section className="settings-section stack plugin-center">
    <div className="settings-copy channel-heading"><div><h2>插件<PageInfo text={<>上方卡片来自两个插件市场源：<b>Claude 插件镜像</b>（Gitee 国内源，48 个，全部与 Codex 兼容）与 <b>Codex 官方源</b>（GitHub <code>openai/plugins</code>，65 个官方插件，走国内镜像下载）。一键安装写入本地插件目录；官方源全部需要授权/配置服务凭据（其中 15 个依赖 ChatGPT 应用连接器），卡片上的提示就是这一条。下方为已安装插件管理（含引擎自带的 openai-api-curated 官方市场），停用后 Codex 不再加载该插件提供的指令、技能与钩子。</>} helpKey="plugins" label="插件" /></h2></div><div className="settings-heading-actions"><button className="secondary-setting" title={marketSource === "official" ? "打开 GitHub 上的 Codex 官方插件仓库" : "打开 Gitee 插件市场镜像"} onClick={() => void window.codex.openExternal(marketSource === "official" ? "https://github.com/openai/plugins" : "https://gitee.com/yuqiaodi/claude-plugins-official-gitee")}><ArrowUpRight size={14} />在线市场</button><button className="icon-button" title="刷新：已装插件 / 技能 / 钩子 / 记忆 / 任务 / MCP + 插件市场（沿用当前分类与搜索）" onClick={() => void refreshPluginsPage()}>{(resourceLoading || pluginMarketLoading) ? <Spinner /> : <RefreshCw size={14} />}</button></div></div>

    <div className="market-source-switch">
      <SegmentedTabs
        value={marketSource}
        // ⛔ 三个选项而不是两个：之前「已安装」那屏被压在**市场下面**（同一个页面里从上往下滚），
        //   于是用户看到的是「57 个市场插件混排，其中 6 个显示已安装」—— 既看不出哪些是本地的，
        //   也找不到启停开关。⇒ 已安装独立成第三个 tab（用户 10-04 拍板）。
        //   ⛔ 值域用三态字符串而不是布尔：布尔无法表达「市场/已安装」这第三种。
        onChange={(next) => setMarketSource(next === "official" ? "official" : next === "installed" ? "installed" : "gitee")}
        options={[
          { value: "gitee", label: "Claude 插件镜像" },
          { value: "official", label: "Codex 官方插件" },
          // ⛔ 不是「已安装 6」这种数字角标：已安装的数量会随启停变，角标会骗人。
          //   只在真安装/卸载后刷新时才有意义 —— 那一屏本来就在下面，不必再报数。
          { value: "installed", label: "已安装" },
        ]}
      />
    </div>

    {/* 10-04：切到「已安装」时不渲染市场那整块（57 张卡片 + 分页）—— 不是 display:none，
        而是**根本不挂载**：省掉一次长列表渲染，也避免用户滚动时误以为下面还有市场。 */}
    {/* ⛔ 09-28：「内置接口（视频生成接口）」块**搬走**了 —— 它属于「内置插件」那一组
        （与生图/视觉插件并列，见 BuiltinPluginsSection）。本页只负责**插件市场**：
        外部市场的可安装列表 + 已安装插件管理。两件事混在一页会让人分不清「自带」与「要装」。 */}
    {/* 10-04：切到「已安装」tab 时**不挂载市场那整块**（57 张卡片 + 分页）——
        不是 display:none，而是不渲染：省一次长列表，也避免用户以为下面还有市场。
        ⛔ 这行必须紧贴它下面的三元开头 —— 写偏一行会把表达式截断，tsc 直接语法错
        （本轮踩过：注释里带引号 + 三元符号，在 JSX 注释中会被解析器当成真代码）。 */}
    {marketSource === "installed" ? null : marketSource === "official"
      ? <CodexOfficialMarketSection onResourcesChanged={() => void refreshPluginsPage()} />
      : <div className="plugin-market-block">
      <div className="plugin-market-title">插件市场<small>来自 Gitee 官方镜像（Claude Code 插件，与 Codex 兼容）· 一键安装</small></div>
      <div className="resource-toolbar">
        <div className="skill-tabs">{pluginMarketCategoryTabs.map(([label, value]: any) => <button key={value} className={pluginMarketCategory === value ? "active" : ""} onClick={() => { setPluginMarketCategory(value); setPluginMarketPage(1); }}>{label}</button>)}</div>
        <SearchField value={pluginMarketSearch} onChange={(next) => { setPluginMarketSearch(next); setPluginMarketPage(1); }} placeholder="搜索插件名称、简介或作者" />
      </div>
      {pluginMarketItems.length > 0 ? <div className="skill-card-grid">
        {pluginMarketItems.map((plugin: any) => {
          // ⛔⛔ 10-03 用户报障「插件安装后没有更新状态，已安装里还是 +」：
          //   权威判定 = 主进程按**本地 manifest**（.codex-market.json）回传的 plugin.installed；
          //   引擎 plugin/list 的「id@market 前段 === slug」只作回落（引擎没认领时它为空，
          //   以前这就是永远显示「+」的根因）。两个来源任一命中即视为已装。
          const installedMarket = plugin.installed === true || installedMarketPluginSlugs.has(plugin.slug);
          const busy = installingMarketPlugin === plugin.slug;
          return <article className={`skill-card ${installedMarket ? "installed" : ""}`} key={plugin.fullName ?? plugin.slug} onClick={() => setMarketPreview({
            kind: "plugin",
            title: plugin.displayName,
            subtitle: `${plugin.categoryZh ?? plugin.category} · Gitee 官方镜像`,
            icon: plugin.logo,
            iconChar: plugin.displayName,
            description: plugin.description,
            meta: [plugin.categoryZh ?? plugin.category, ...(plugin.githubStars > 0 ? [`★ ${plugin.githubStars}`] : []), ...(plugin.license ? [plugin.license] : [])],
            installed: Boolean(installedMarket),
            installLabel: "一键安装",
            onInstall: installedMarket ? undefined : () => void installMarketPlugin(plugin),
            externalUrl: plugin.repository,
            externalLabel: "查看来源",
            note2: installedMarket ? undefined : "探测到 Codex 兼容 manifest 才可安装（DSH 专属插件会明确报错）",
          })}>
            <div className="skill-card-head">
              <MarketLogo url={plugin.logo} label={plugin.displayName} size={30} />
              <button className="skill-add" title={installedMarket ? "已安装" : "一键安装到本地插件目录"} disabled={Boolean(installingMarketPlugin) || installedMarket} onClick={(event) => { event.stopPropagation(); if (!installedMarket) void installMarketPlugin(plugin); }}>{installedMarket ? <Check size={14} /> : busy ? <Spinner /> : <Plus size={14} />}</button>
            </div>
            <strong title={plugin.fullName ?? plugin.displayName}>{plugin.displayName}</strong>
            <p>{plugin.description}</p>
            <footer><span>{plugin.categoryZh ?? plugin.category}</span>{plugin.githubStars > 0 && <span title="GitHub Stars">★ {plugin.githubStars}</span>}<a href={plugin.repository} onClick={(event) => { event.preventDefault(); void window.codex.openExternal(plugin.repository); }}>查看来源</a></footer>
          </article>;
        })}
      </div> : <p className="muted">{pluginMarketLoading ? "正在加载插件市场…" : "没有匹配的插件，换个关键词试试。"}</p>}
      <div className="skill-market-pagination"><span>共 {pluginMarketTotal} 个插件 · 第 {pluginMarketPage} / {Math.max(1, Math.ceil(pluginMarketTotal / pluginMarketPageSize))} 页</span><div><button className="secondary-setting" disabled={pluginMarketLoading || pluginMarketPage <= 1} onClick={() => setPluginMarketPage((page: any) => Math.max(1, page - 1))}><ArrowLeft size={14} />上一页</button><button className="secondary-setting" disabled={pluginMarketLoading || pluginMarketPage >= Math.max(1, Math.ceil(pluginMarketTotal / pluginMarketPageSize))} onClick={() => setPluginMarketPage((page: any) => page + 1)}>下一页<ArrowRight size={14} /></button></div></div>
    </div>}

    {/* 10-04 用户拍板：市场与已安装**顶栏各占一个 tab**。
        ⛔ 下面这块（plugin-stats 起）是**本地已装插件**的列表：启用/停用开关、版本、来源都在这，
           与远端市场是**两个不同的池子**。之前两者同页上下堆叠 ⇒ 用户看到「57 个市场插件混排，
           其中几个标着已安装」，既看不出哪些是本地的、也找不到启停入口。
        ⛔ 切到「已安装」tab 时**只显示这一块**（下面的条件化），市场那整块不挂载。 */}
    {marketSource === "installed" ? null : <>
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
    </>}
  </section>;
}
