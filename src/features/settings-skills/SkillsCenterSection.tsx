/**
 * 设置页 · skills（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX / 体内语句与原块逐字一致（仅去掉外层缩进与 IIFE 包装）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 */
import { ArrowLeft, ArrowRight, Check, CircleStop, FolderKanban, LayoutGrid, Paperclip, Play, Plus, Quote, RefreshCw, SlidersHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { Spinner } from "../../components/CardShell";
import { BatchActions, CheckCard, SearchField, SelectAllToggle, ToggleSwitch } from "../../components/SettingsWidgets";
import { AppSelect } from "../../components/AppSelect";
import { SkillAvatar } from "../../features/skills-market";
import { SkillPoolSection } from "./SkillPoolSection";
import { refreshWithReceipt } from "../../lib/refresh-receipt.mjs";

export type SkillsCenterSectionProps = { openAppConfirm: (title: string, text: string, confirmLabel?: string) => Promise<boolean>; userDataPath: any; displayPath: any; projects?: [string, unknown][]; skillsManageOnly: any; setSkillsManageOnly: any; installedTotalCount: any; importSkill: any; refreshMarketSkills: any; skillHubCategory: any; skillHubSearch: any; marketPage: any; marketLoading: any; skillHubCategories: any; setSkillHubCategory: any; setMarketPage: any; skillManageSearch: any; setSkillManageSearch: any; setSkillHubSearch: any; skillHubCategoryTabs: any; skillHubFilterCategory: any; setSkillHubFilterCategory: any; marketSkills: any; skillHubCategoryName: any; localSkills: any; settingsResources: any; skillChecked: any; setSkillChecked: any; skillZhNote: any; toggleSkillEnabled: any; setSelectedSkills: any; setSettingsOpen: any; removeLocalSkill: any; skillBatchBusy: any; batchSetSkillEnabled: any; marketPageSize: any; setMarketPreview: any; setNotice: any; installMarketSkill: any; installingMarketSkill: any };

export function SkillsCenterSection(props: SkillsCenterSectionProps) {
  const { openAppConfirm, userDataPath, displayPath, skillsManageOnly, setSkillsManageOnly, installedTotalCount, importSkill, refreshMarketSkills, skillHubCategory, skillHubSearch, marketPage, marketLoading, skillHubCategories, setSkillHubCategory, setMarketPage, skillManageSearch, setSkillManageSearch, setSkillHubSearch, skillHubCategoryTabs, skillHubFilterCategory, setSkillHubFilterCategory, marketSkills, skillHubCategoryName, localSkills, settingsResources, skillChecked, setSkillChecked, skillZhNote, toggleSkillEnabled, setSelectedSkills, setSettingsOpen, removeLocalSkill, skillBatchBusy, batchSetSkillEnabled, marketPageSize, setMarketPreview, setNotice, installMarketSkill, installingMarketSkill } = props;
  /* ⛔ 10-27 审查：筛选必须在分页切片**之前**。原先先切当前页再 filter ⇒ 在第二页选分类
     只过滤那 12 张卡、翻页总数还是全量（用户看到「分类里没东西」）。 */
  const marketFiltered = marketSkills.filter((skill: any) =>
    (!skillHubFilterCategory || skill.category === skillHubFilterCategory)
    && (!skillHubSearch || `${skill.name} ${skill.description}`.toLowerCase().includes(skillHubSearch.toLowerCase()))
    && !localSkills.some((entry: any) => entry.marketId === skill.id));
  const marketPageSizeSafe = Math.max(1, Number(marketPageSize) || 12);
  const marketTotalPages = Math.max(1, Math.ceil(marketFiltered.length / marketPageSizeSafe));
  const marketSafePage = Math.min(Math.max(1, Number(marketPage) || 1), marketTotalPages);
  /* 10-30 用户：「共享技能池放到搜索框一排；搜索框这一排跟下面卡片合到一起；上面的文字注释不要了」。 */
  const [poolOpen, setPoolOpen] = useState(false);
  return (
    <>
      <section className="settings-section stack skill-center">
        <div className="skill-center-shell">
                    {/* 10-27 三轮用户令：「跟搜索框放一排；那一排分类小字删了；右上角帮助问号删了」——
                        搜索 + 榜单筛选 + 三颗小按键同一行；分类芯片行与页头 ? 一并删除。 */}
                    <div className="resource-toolbar secondary skill-filter-row">
                      <SearchField
                        value={skillsManageOnly ? skillManageSearch : skillHubSearch}
                        onChange={(next) => { if (skillsManageOnly) setSkillManageSearch(next); else { setSkillHubSearch(next); setMarketPage(1); } }}
                        placeholder={skillsManageOnly ? "搜索已安装技能的名称或描述" : "搜索 SkillHub 技能"}
                      />
                      {!skillsManageOnly && (
                        <>
                          <span className="skill-rank-filter" title="按榜单筛选">
                            <SlidersHorizontal size={13} />
                            <AppSelect
                              className="skill-rank-select"
                              value={skillHubCategory}
                              ariaLabel="榜单筛选"
                              options={skillHubCategories.map((category: any) => ({ value: category, label: category }))}
                              onChange={(next) => { setSkillHubCategory(next); setMarketPage(1); setSkillsManageOnly(false); }}
                            />
                          </span>
                          <span className="skill-category-filter" title="按分类筛选">
                            <AppSelect
                              className="skill-category-select"
                              value={skillHubFilterCategory}
                              ariaLabel="技能分类筛选"
                              options={skillHubCategoryTabs.map(([label, value]: any) => ({ value, label: value ? label : "全部分类" }))}
                              onChange={(next) => { setSkillHubFilterCategory(next); setMarketPage(1); }}
                            />
                          </span>
                        </>
                      )}
                      <div className="skill-actions-line">
                        {skillsManageOnly && (
                          <button type="button" className={`secondary-setting skill-action-sm ${poolOpen ? "active-manage" : ""}`} onClick={() => setPoolOpen((v) => !v)} title={poolOpen ? "返回我的技能列表" : "按项目生效：选择该项目里哪些全局技能可用"}>
                            {poolOpen ? <><ArrowLeft size={13} />返回技能列表</> : <><FolderKanban size={13} />共享技能池</>}
                          </button>
                        )}
                        <button className={`${skillsManageOnly ? "active-manage" : "secondary-setting"} skill-action-sm`} onClick={() => { setPoolOpen(false); setSkillsManageOnly(!skillsManageOnly); }}><LayoutGrid size={13} />{skillsManageOnly ? "返回市场浏览" : `我的技能 ${installedTotalCount}`}</button>
                        <button className="secondary-setting skill-action-sm" onClick={() => void importSkill()}><Paperclip size={13} />导入技能</button>
                        <button className="icon-button skill-action-sm" title="刷新技能市场" onClick={() => void refreshWithReceipt(setNotice, "刷新技能市场", () => { setMarketPage(1); return refreshMarketSkills(skillHubCategory, skillHubSearch, 1); })}>{marketLoading ? <Spinner /> : <RefreshCw size={13} />}</button>
                      </div>
                    </div>
                    {skillsManageOnly ? (() => {
                      // 技能规范化名：剥掉插件限定前缀（引擎对插件技能返回 `ponytail:ponytail-audit`，
                      // 本地目录同名技能是 `ponytail-audit`）——不归一化会让同一个技能重复出现在两组。
                      const normSkillName = (name: string) => { const n = String(name ?? "").toLowerCase(); const i = n.lastIndexOf(":"); return i >= 0 ? n.slice(i + 1) : n; };
                      // 同技能装两遍（市场一次 + 本地导入一次）会产生两个目录、同名 → 只保留市场来源那条，
                      // 避免同一技能同时出现在「市场安装」与「本地导入」两张卡。
                      const dedupedLocal = (() => {
                        const byName = new Map<string, LocalSkillEntry>();
                        for (const entry of localSkills) {
                          const key = normSkillName(entry.name);
                          const existing = byName.get(key);
                          const isMarket = entry.source === "cocoloop" || entry.source === "skillhub";
                          if (!existing) { byName.set(key, entry); continue; }
                          const existingIsMarket = existing.source === "cocoloop" || existing.source === "skillhub";
                          if (isMarket && !existingIsMarket) byName.set(key, entry);
                        }
                        return [...byName.values()];
                      })();
                      const localNames = new Set(dedupedLocal.map((entry) => normSkillName(entry.name)));
                      const localByPath = new Set(dedupedLocal.map((entry) => entry.path));
                      const builtinSkills = settingsResources.skills.filter((entry: any) => !localByPath.has(entry.path) && !localNames.has(normSkillName(entry.name ?? "")));
                      const keyword = skillManageSearch.trim().toLowerCase();
                      const match = (skill: { name: string; description: string }) => !keyword || `${skill.name} ${skill.description}`.toLowerCase().includes(keyword);
                      const marketInstalled = dedupedLocal.filter((entry) => (entry.source === "cocoloop" || entry.source === "skillhub") && match(entry));
                      const localInstalled = dedupedLocal.filter((entry) => entry.source !== "cocoloop" && entry.source !== "skillhub" && match(entry));
                      const shownBuiltin = builtinSkills.filter((skill: any) => match({ name: skill.name, description: skill.description ?? "" }));
                      // 批量管理只服务「本地导入」：市场技能走市场更新/单卡开关，内置技能不可停用。
                      const manageable = [...localInstalled];
                      const selectableFolders = manageable.map((skill) => skill.folder ?? skill.name);
                      // 筛选变化后取交集，避免已不可见的勾选项仍计入
                      const checkedFolders = skillChecked.filter((folder: any) => selectableFolders.includes(folder));
                      const checkedSkills = manageable.filter((skill) => checkedFolders.includes(skill.folder ?? skill.name));
                      const offList = checkedSkills.filter((skill) => skill.enabled === false).map((skill) => skill.folder ?? skill.name);
                      const onList = checkedSkills.filter((skill) => skill.enabled !== false).map((skill) => skill.folder ?? skill.name);
                      const toggleSkillChecked = (folder: string) => setSkillChecked((current: any) => current.includes(folder) ? current.filter((entry: any) => entry !== folder) : [...current, folder]);
                      const renderCard = (skill: { name: string; description: string; descriptionZh?: string; path?: string; source?: "cocoloop" | "skillhub" | "local"; folder?: string; enabled?: boolean; allowedTools?: string[]; category?: string; icon?: string }, sourceTag: "builtin" | "market" | "local") => {
                        const removable = sourceTag !== "builtin";
                        const selectable = sourceTag === "local";
                        const folder = removable ? skill.folder ?? skill.name : null;
                        const sourceLabel = sourceTag === "builtin" ? "内置" : sourceTag === "market" ? "市场安装" : "本地导入";
                        const enabled = skill.enabled !== false;
                        const skillKey = folder ?? skill.name;
                        const checked = selectable && checkedFolders.includes(skillKey);
                        const allowedTools = (skill.allowedTools ?? []).filter(Boolean);
                        // 卡片描述：中文注释优先（注释表 / 安装时存下的市场中文简介），没有中文才退回原文
                        const zhNote = skillZhNote(skill);
                        const cardDescription = zhNote !== "已安装技能" ? zhNote : (skill.description || "已发现技能");
                        return <article className={`skill-card-compact source-${sourceTag} ${removable && !enabled ? "is-disabled" : ""} ${checked ? "is-checked" : ""}`} key={`${sourceTag}-${skill.name}`}>
                          <div className="skill-card-compact-head">
                            <div className="skill-card-head-left">
                              <CheckCard checked={checked} disabled={!selectable} label={`选择 ${skill.name}`} title={!selectable ? (sourceTag === "builtin" ? "内置技能不可勾选" : "市场安装的技能请在市场里更新/管理") : checked ? `取消选择 ${skill.name}` : `勾选 ${skill.name}`} onChange={() => { if (selectable) toggleSkillChecked(skillKey); }} />
                              <SkillAvatar skill={skill} size={14} />
                              <span className={`skill-source-tag tag-${sourceTag}`}>{sourceLabel}</span>
                            </div>
                            <ToggleSwitch
                              checked={enabled}
                              disabled={!removable}
                              label={`${skill.name} 启用开关`}
                              title={!removable ? "内置技能由 Codex 引擎提供，不能停用" : enabled ? "停用技能（引擎将不再发现它）" : "启用技能"}
                              onChange={() => void toggleSkillEnabled({ ...(skill as LocalSkillEntry), name: skill.name, folder: folder ?? skill.name, enabled })}
                            />
                          </div>
                          <strong>{skill.name}{removable && !enabled && <em className="skill-disabled-label">已停用</em>}</strong>
                          <p>{cardDescription}</p>
                          {allowedTools.length ? <div className="skill-card-allowed-tools" title="SKILL.md 声明的工具白名单（allowed-tools，展示用）">{allowedTools.slice(0, 5).map((tool) => <code key={tool}>{tool}</code>)}{allowedTools.length > 5 ? <code className="skill-card-tools-more">+{allowedTools.length - 5}</code> : null}</div> : null}
                          <div className="skill-card-compact-foot">
                            {skill.path && <span className="skill-card-path" title={skill.path}>{skill.path.replace(/^.*[\\/]/, "")}</span>}
                            <div className="skill-card-compact-tools">
                              <button className="icon-button" title="引用到对话" onClick={() => { setSelectedSkills((current: any) => current.some((entry: any) => entry.name === skill.name) ? current : [...current, { name: skill.name, description: skill.description }]); setSettingsOpen(false); }}><Quote size={13} /></button>
                              {removable && folder && <button className="icon-button" title="卸载技能" onClick={() => { void openAppConfirm(`卸载技能 ${skill.name}`, "将删除该技能的本地目录并重启引擎，Codex 不再加载它。", "卸载").then((ok) => { if (ok) void removeLocalSkill({ folder, name: skill.name, description: skill.description }); }); }}><Trash2 size={13} /></button>}
                            </div>
                          </div>
                        </article>;
                      };
                      return <div className="skill-installed-view">
                        {/* 技能自动更新开关**已移到「控制台」**（10-13 用户令：所有自动更新开关统一到控制台）。
                            ⛔ 这里只留一句指路，**不再放开关** —— 同一状态两个入口，用户会以为两边不一致。
                            真正的检查/更新在主进程后台跑（skills-ipc 的 runSkillAutoUpdate），与本页是否打开无关；
                            手动逐项更新入口 = 卡片上的「重新安装」（同一条市场安装链）。 */}
                        {poolOpen ? (
                          <SkillPoolSection projects={props.projects} onNotice={setNotice} open onOpenChange={setPoolOpen} hideTrigger />
                        ) : <>
                        {shownBuiltin.length > 0 && <section className="skill-installed-group"><header><span className="skill-group-dot tag-builtin" />Codex 内置技能<small>由 Codex app-server 自带，不支持停用</small></header><div className="skill-card-grid compact">{shownBuiltin.map((skill: any) => renderCard({ name: skill.name, description: skill.description ?? "由 Codex 引擎内置提供", path: skill.path }, "builtin"))}</div></section>}
                        {marketInstalled.length > 0 && <section className="skill-installed-group"><header><span className="skill-group-dot tag-market" />市场安装<small>从 SkillHub / CocoLoop 市场一键安装到 Codex 技能目录</small></header><div className="skill-card-grid compact">{marketInstalled.map((skill) => renderCard(skill, "market"))}</div></section>}
                        {localInstalled.length > 0 && <section className="skill-installed-group">
                          <header><span className="skill-group-dot tag-local" />本地导入<small>通过 SKILL.md 添加到本机，不会随 Codex 更新被覆盖</small></header>
                          <div className="skill-local-bulk">
                            <div className="skill-local-bulk-head">
                              <SelectAllToggle total={selectableFolders.length} selected={checkedFolders.length} unit="个本地技能" onSelectAll={() => setSkillChecked(selectableFolders)} onClear={() => setSkillChecked([])} />
                              <span className="skill-local-bulk-count">共 {localInstalled.length} 项 · 启用中 {localInstalled.filter((skill) => skill.enabled !== false).length} · 已停用 {localInstalled.filter((skill) => skill.enabled === false).length}</span>
                            </div>
                            <BatchActions
                              hint={checkedFolders.length ? `已选 ${checkedFolders.length} / ${selectableFolders.length} 个本地技能：${onList.length} 个启用中 · ${offList.length} 个已停用` : "勾选本地导入的技能后可批量启用或停用（内置与市场安装的技能不参与）"}
                              actions={[
                                { label: offList.length ? `启用所选 (${offList.length})` : "启用所选", icon: <Play size={13} />, disabled: !offList.length, busy: skillBatchBusy === "enable", onClick: () => void batchSetSkillEnabled(offList, true), title: offList.length ? `启用选中的 ${offList.length} 个已停用本地技能` : "没有勾选已停用的本地技能" },
                                { label: onList.length ? `停用所选 (${onList.length})` : "停用所选", icon: <CircleStop size={13} />, tone: "danger", disabled: !onList.length, busy: skillBatchBusy === "disable", onClick: () => void batchSetSkillEnabled(onList, false), title: onList.length ? `停用选中的 ${onList.length} 个启用中本地技能` : "没有勾选启用中的本地技能" },
                              ]}
                            />
                          </div>
                          <div className="skill-card-grid compact">{localInstalled.map((skill) => renderCard(skill, "local"))}</div>
                        </section>}
                        {!shownBuiltin.length && !marketInstalled.length && !localInstalled.length && <p className="muted">{keyword ? "没有匹配的已安装技能，换个关键词试试。" : "还没有已安装技能。可通过“市场浏览”安装，或“从本地添加技能”导入 SKILL.md。"}</p>}
                        </>}
                      </div>;
                    })() : <><div className="skill-card-grid page-turn" key={marketSafePage}>{marketFiltered.slice((marketSafePage - 1) * marketPageSizeSafe, marketSafePage * marketPageSizeSafe).map((skill: any) => { const installed = localSkills.some((entry: any) => entry.marketId === skill.id); return <article className={`skill-card ${installed ? "installed" : ""}`} key={skill.name} onClick={() => setMarketPreview({
                              kind: "skill",
                              title: skill.name,
                              subtitle: `${skillHubCategoryName(skill.category)}${skill.subCategory ? ` · ${skill.subCategory}` : ""} · SkillHub 技能市场`,
                              icon: skill.icon,
                              iconChar: skill.name,
                              description: skill.description,
                              meta: [skillHubCategoryName(skill.category), ...(skill.subCategory ? [skill.subCategory] : [])],
                              installed,
                              installLabel: installed ? "在对话中使用" : "一键安装",
                              onInstall: () => { if (installed) { setSelectedSkills((current: any) => current.some((entry: any) => entry.name === skill.name) ? current : [...current, skill]); setSettingsOpen(false); setNotice(`已引用技能：${skill.name}`); } else void installMarketSkill(skill); },
                              externalUrl: "https://skillhub.tencent.com/",
                              externalLabel: "SkillHub 查看",
                              note2: installed ? undefined : "安装到 Codex 技能目录，对话中可直接引用",
                            })}><div className="skill-card-head"><SkillAvatar skill={skill} /><button className="skill-add" title={installed ? "在对话中使用已安装技能" : "一键安装到 Codex 技能目录"} disabled={Boolean(installingMarketSkill)} onClick={(event) => { event.stopPropagation(); if (installed) { setSelectedSkills((current: any) => current.some((entry: any) => entry.name === skill.name) ? current : [...current, skill]); setSettingsOpen(false); setNotice(`已引用技能：${skill.name}`); } else void installMarketSkill(skill); }}>{installed ? <Check size={14} /> : <Plus size={14} />}</button></div><strong>{skill.name}</strong><p>{skill.description}</p><footer><span title={skill.category}>{skillHubCategoryName(skill.category)}{skill.subCategory ? ` · ${skill.subCategory}` : ""}</span><a href="https://skillhub.tencent.com/" onClick={(event) => { event.preventDefault(); event.stopPropagation(); void window.codex.openExternal("https://skillhub.tencent.com/"); }}>SkillHub 查看</a></footer></article>; })}</div>{marketTotalPages > 1 && <div className="skill-market-pagination"><span>共 {marketFiltered.length} 个技能 · 第 {marketSafePage} / {marketTotalPages} 页</span><div><button className="secondary-setting" disabled={marketSafePage <= 1} onClick={() => setMarketPage(marketSafePage - 1)}><ArrowLeft size={14} />上一页</button><button className="secondary-setting" disabled={marketSafePage >= marketTotalPages} onClick={() => setMarketPage(marketSafePage + 1)}>下一页<ArrowRight size={14} /></button></div></div>}</>}
        </div>
      </section>
    </>
  );
}
