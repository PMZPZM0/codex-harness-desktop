/**
 * 设置页 · plugins（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX / 体内语句与原块逐字一致（仅去掉外层缩进与 IIFE 包装）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 *
 * 09-27 追加（非搬迁部分）：顶部内置「视频生成接口」卡 + 各厂商凭证配置弹层 ——
 * 走内置 IPC `video:*`（国内外 8 家），不是市场里的可安装插件，所以独立成卡。
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, CircleStop, Play, Plus, RefreshCw, Store, Trash2 } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { AppSelect } from "../../components/AppSelect";
import { BatchActions, CheckCard, SearchField, SegmentedTabs, SelectAllToggle, ToggleSwitch } from "../../components/SettingsWidgets";
import { MarketLogo } from "../../features/skills-market";
import { CodexOfficialMarketSection } from "../codex-official-market";
import { avatarToneOf } from "../../lib/entity-avatar";
import { refreshWithReceipt } from "../../lib/refresh-receipt.mjs";

/** 已安装插件的**来源渠道标签**（10-06 用户：「每个市场安装的都要在已安装里打来源渠道标签」）。
 *  marketplaceName 的取值由各市场注册时写入：官方源 = codex-official-market；Gitee 镜像 = 名字里带 gitee/claude；
 *  引擎自带精选 = openai-api-curated。⛔ 未知来源原样显示勾选名，不猜。 */
function pluginChannelLabel(plugin: any): string {
  const market = String(plugin?.marketplaceName ?? "");
  if (!market) return "本地";
  if (/codex-official/i.test(market)) return "Codex 官方";
  if (/gitee|claude/i.test(market)) return "Claude 镜像";
  if (/curated/i.test(market)) return "引擎官方市场";
  return market;
}
function pluginChannelTone(plugin: any): string {
  const market = String(plugin?.marketplaceName ?? "");
  if (/codex-official/i.test(market)) return "ch-official";
  if (/gitee|claude/i.test(market)) return "ch-mirror";
  if (/curated/i.test(market)) return "ch-engine";
  return "ch-local";
}

export type PluginsMarketSectionProps = { /** 内置插件三件（10-27：只在「已安装」视图里出现） */ builtinSlot?: ReactNode; openAppConfirm: (title: string, text: string, confirmLabel?: string) => Promise<boolean>; settingsResources: any; pluginSearch: any; pluginInstalledOnly: any; pluginDisplayName: any; pluginDescription: any; pluginChecked: any; setPluginChecked: any; refreshPluginsPage: any; resourceLoading: any; pluginMarketLoading: any; pluginMarketCategoryTabs: any; pluginMarketCategory: any; setPluginMarketCategory: any; setPluginMarketPage: any; pluginMarketSearch: any; setPluginMarketSearch: any; pluginMarketItems: any; installingMarketPlugin: any; setMarketPreview: any; installMarketPlugin: any; pluginMarketTotal: any; pluginMarketPage: any; pluginMarketPageSize: any; setPluginInstalledOnly: any; setPluginSearch: any; pluginBatchBusy: any; batchSetPluginEnabled: any; pluginBusy: any; setPluginEnabled: any; changePlugin: any; setNotice: any };

export function PluginsMarketSection(props: PluginsMarketSectionProps) {
  const { builtinSlot, openAppConfirm, settingsResources, pluginSearch, pluginInstalledOnly, pluginDisplayName, pluginDescription, pluginChecked, setPluginChecked, refreshPluginsPage, resourceLoading, pluginMarketLoading, pluginMarketCategoryTabs, pluginMarketCategory, setPluginMarketCategory, setPluginMarketPage, pluginMarketSearch, setPluginMarketSearch, pluginMarketItems, installingMarketPlugin, setMarketPreview, installMarketPlugin, pluginMarketTotal, pluginMarketPage, pluginMarketPageSize, setPluginInstalledOnly, setPluginSearch, pluginBatchBusy, batchSetPluginEnabled, pluginBusy, setPluginEnabled, changePlugin, setNotice } = props;
  const all = settingsResources.plugins as any[];
  // 10-04：源切换器（Claude 镜像 / Codex 官方 / 已安装）。⛔ 必须声明在 visible 之前——
  //   visible 要按它过滤（已装屏只显示已装的）。
  const [marketSource, setMarketSource] = useState("gitee");
  /* 10-24 用户令：「已安装插件为啥两张展示方式」——已安装屏只留一份列表；
     顶部两块更新面板撤掉，改成一个「检查更新」按钮：两个市场都查，有新版逐个更新。 */
  const [pluginUpdating, setPluginUpdating] = useState(false);
  const installed = all.filter((plugin) => plugin.installed);
  // 市场卡片「已安装」判定：引擎插件 id 形如 name@marketplace，取 @ 前与市场 slug 比对
  const installedMarketPluginSlugs = new Set(installed.map((plugin) => String(plugin.id ?? plugin.name ?? "").split("@")[0]));
  const enabledCount = installed.filter((plugin) => plugin.enabled !== false).length;
  const disabledCount = installed.length - enabledCount;
  /* 10-27 用户令：「上面已启用、已停用做成下拉框选项，已安装不要了」
     ⇒ 三个统计方块撤掉，改成卡内一个状态下拉（全部 / 启用中 / 已停用）。 */
  const [installedState, setInstalledState] = useState<"all" | "on" | "off">("all");
  const keyword = pluginSearch.trim().toLowerCase();
  const visible = all.filter((plugin) => {
    // 10-04：源切换器有「已安装」这一项 ⇒ 这一屏**只显示已装的**。
    // 原来的 `pluginInstalledOnly` 二级 tab（全部 57 / 已安装 6）已删除——它与顶栏那一项
    // 语义重复且位置别扭（在页面最下面，用户以为是"上面那个市场的下半截"）。
    // ⚠️ 未安装的那些来自**引擎自带市场**（openai-api-curated），安装走 `plugin/install`
    //   引擎请求、需要登录 ChatGPT 账号 ⇒ 没登录时点了必然失败。放在"已安装"这一屏里
    //   只会让人反复点一个注定失败的东西，所以这里**彻底不露出未安装的**。
    if (marketSource === "installed" && !plugin.installed) return false;
    /* ⛔ 10-06 用户定案：**市场里不再显示已安装的**——装了的只在「已安装」屏出现，
       与技能页「市场装的进已安装分组」同一口径（各市场不再各显一套 ✓/已装状态）。 */
    if (marketSource !== "installed" && plugin.installed) return false;
    if (marketSource === "installed" && installedState !== "all" && (plugin.enabled !== false) !== (installedState === "on")) return false;
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
  const checkAndUpdatePlugins = async () => {
    if (pluginUpdating) return;
    setPluginUpdating(true);
    try {
      const [gitee, official] = await Promise.all([
        window.codex.checkPluginUpdates().catch(() => []),
        window.codex.checkOfficialPluginUpdates().catch(() => []),
      ]);
      const targets = [
        ...(Array.isArray(gitee) ? gitee : []).filter((row: any) => row.hasUpdate).map((row: any) => ({ name: String(row.name ?? row.slug), run: () => window.codex.updatePlugin(row.slug) })),
        ...(Array.isArray(official) ? official : []).filter((row: any) => row.hasUpdate).map((row: any) => ({ name: String(row.name ?? row.slug), run: () => window.codex.updateOfficialPlugin(row.slug) })),
      ];
      if (!targets.length) { setNotice("插件已是最新，没有可更新的版本"); return; }
      setNotice(`发现 ${targets.length} 个插件有更新，正在更新…`);
      let ok = 0, failed = 0;
      for (const target of targets) {
        try { await target.run(); ok += 1; } catch { failed += 1; }
      }
      setNotice(`插件更新完成：${ok} 个已更新${failed ? `，${failed} 个失败（可稍后重试）` : ""}`);
      await refreshPluginsPage();
    } catch (error: any) {
      setNotice(`检查插件更新失败：${error?.message ?? error}`);
    } finally {
      setPluginUpdating(false);
    }
  };
  // 两个市场数据源（10-03）：Gitee 上的 Claude Code 官方镜像 ⇄ Codex 官方 openai/plugins（GitHub 国内镜像读取）。
  // 各自的分类表、卡片与安装进度互不相干 ⇒ 切的是**整块**（用户拍板「按源给各自的分类 tab」），不是把 18 个分类混排。
  /* 10-27 用户令：「把刷新按键放到卡片里面来，三个界面风格统一」⇒ 刷新不再是来源 tabs 行右侧的孤儿，
     而是每张市场卡工具条的最右一格（三个视图同一位置）。 */
  const refreshButton = <button className="icon-button market-refresh" title="刷新：已装插件 / 技能 / 钩子 / 记忆 / 任务 / MCP + 插件市场（沿用当前分类与搜索）" onClick={() => void refreshWithReceipt(setNotice, "刷新插件与市场", () => refreshPluginsPage())}>{(resourceLoading || pluginMarketLoading) ? <Spinner /> : <RefreshCw size={14} />}</button>;
  /* 10-27 用户令：「上面一排按键放到卡片里面来，空间不够就缩小按键」
     ⇒ 来源 tab 不再是卡片外面的一行，而是每张卡的第一行；按钮尺寸收小一号（.market-shell 里调）。 */
  /* 10-27 用户令：「那三个按键放到刷新旁边，搜索框靠左，分类按键在搜索框后面」
     ⇒ 来源 tab 不再是单独一行，而是塞进**同一行工具条**的右端（紧挨刷新）。 */
  const sourceTabs = (
    <div className="market-inline-tabs">
      <SegmentedTabs
        value={marketSource}
        onChange={(next) => setMarketSource(next === "official" ? "official" : next === "installed" ? "installed" : "gitee")}
        options={[
          { value: "gitee", label: "Claude 插件镜像" },
          { value: "official", label: "Codex 官方插件" },
          { value: "installed", label: "已安装" },
        ]}
      />
    </div>
  );

  return <section className="settings-section stack plugin-center">
    {/* 10-26 用户令（插件页截图）：「左右按键对齐，中间空白删除，把上面一排按键放下来，右边也是」
        ⇒ 页头那两颗（在线市场 / 刷新）下来与三个来源 tab 同排：tab 贴左、按键贴右，中间不留空。
        六轮又令「插件市场 ? 号删除，中间缝隙还是很大」⇒ 页头整块（大字 + 隐藏副标题 + ?）也删掉，
        上方那条空带随之消失，本页只剩这一行 + 下面的市场卡片。 */}

    {/* ⛔ 09-28：「内置接口（视频生成接口）」块**搬走**了 —— 它属于「内置插件」那一组
        （与生图/视觉插件并列，见 BuiltinPluginsSection）。本页只负责**插件市场**：
        外部市场的可安装列表 + 已安装插件管理。两件事混在一页会让人分不清「自带」与「要装」。 */}
    {marketSource === "installed" ? null : marketSource === "official"
      ? <CodexOfficialMarketSection onResourcesChanged={() => void refreshPluginsPage()} refreshSlot={refreshButton} tabsSlot={sourceTabs} />
      : <div className="plugin-market-block">
      {/* 10-26 用户令：「插件市场，来自 GitHub 这一排字删了」（来源已在上面 tab 里说明一次） */}
      <div className="resource-toolbar plugin-market-filter">
        <SearchField value={pluginMarketSearch} onChange={(next) => { setPluginMarketSearch(next); setPluginMarketPage(1); }} placeholder="搜索插件名称、简介或作者" />
        {/* 10-27 用户令：「搜索框不用那么长，三个界面风格统一，刷新放进卡片」
            ⇒ 分类仍用下拉（守卫【shell】钉着「收成下拉」），但**不再留一个空的 chips 容器**
               —— 那个空 div 被 `flex: 1 1 420px` 撑满，正是截图里搜索框右边那块空白。
            整条恒为一行：搜索(220) + 分类下拉 + 刷新贴右。 */}
        <span className="market-category-filter">
          <AppSelect
            className="market-category-select"
            value={pluginMarketCategory}
            ariaLabel="插件分类筛选"
            options={pluginMarketCategoryTabs.map(([label, value]: any) => ({ value, label: value === "全部" ? "全部分类" : label }))}
            onChange={(next) => { setPluginMarketCategory(next); setPluginMarketPage(1); }}
          />
        </span>
        {sourceTabs}
        {refreshButton}
      </div>
      {pluginMarketItems.length > 0 ? <div className="skill-card-grid page-turn" key={pluginMarketPage}>
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

    {/* 市场更新（10-12 用户要求「技能和插件加一个更新功能」）：
        与市场列表**并列**而不是塞进去 —— 它管的是「已装的那批要不要更新」，
        两个源各自独立比对（gitee 镜像 / Codex 官方），在「已安装」屏两块都出。 */}

    {marketSource === "installed" ? <>
      <div className="plugin-market-block">
      {/* 10-27 用户令：「已启用 / 已停用做成下拉框选项，已安装不要了，检查更新不要了，
          卡片里面这一行留一个刷新图标就行」⇒ 统计三连撤掉、检查更新撤掉，
          一行只剩：搜索 + 状态下拉（全部 / 启用中 N / 已停用 N）+ 刷新。 */}
      <div className="resource-toolbar">
        <SearchField value={pluginSearch} onChange={setPluginSearch} placeholder="搜索已安装插件的名称、描述或来源" />
        <span className="market-category-filter">
          <AppSelect
            className="market-category-select"
            value={installedState}
            ariaLabel="已安装状态筛选"
            options={[{ value: "all", label: "全部" }, { value: "on", label: `启用中 ${enabledCount}` }, { value: "off", label: `已停用 ${disabledCount}` }]}
            onChange={(next) => setInstalledState(next as "all" | "on" | "off")}
          />
        </span>
        {sourceTabs}
        {refreshButton}
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
      {/* 10-27 用户令：「做成卡片放已安装里面」⇒ 三张内置卡直接排进这张网格，和已安装插件同列。 */}
      {builtinSlot}
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
            <div className="plugin-card-title"><strong title={displayName}>{displayName}</strong><small><span className={`plugin-channel ${pluginChannelTone(plugin)}`}>{pluginChannelLabel(plugin)}</span>{plugin.interface?.developerName ? ` · ${plugin.interface.developerName}` : ""}</small></div>
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
            <button className={isInstalled ? "secondary-setting plugin-action danger" : "primary-setting plugin-action"} disabled={busy} onClick={() => { if (!isInstalled) { void changePlugin(plugin); return; } void openAppConfirm(`卸载插件 ${pluginDisplayName(plugin)}`, "将删除本地插件目录，重启 Codex 后不再加载该插件。", "卸载").then((ok) => { if (ok) void changePlugin(plugin); }); }}>
              {busy ? <Spinner /> : isInstalled ? <><Trash2 size={13} />卸载</> : <><Plus size={13} />安装</>}
            </button>
          </div>
        </article>;
      })}
      {!visible.length && <div className="plugin-empty"><Store size={26} /><strong>{all.length ? "没有匹配的插件" : "还没有安装任何插件"}</strong><p>{all.length ? "换个关键词试试。" : "去上面两个市场装一个，或在 Codex 配置里添加 marketplace 后，插件会出现在这里。"}</p></div>}
    </div>
    </div>
    </> : null}
  </section>;
}
