/**
 * 设置页 · skills（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX / 体内语句与原块逐字一致（仅去掉外层缩进与 IIFE 包装）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 */
import { PageInfo } from "../../components/SettingsHead";
import { ArrowUpRight, Check, CircleStop, LayoutGrid, Paperclip, Play, Plus, Quote, RefreshCw, Trash2 } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { BatchActions, CheckCard, SearchField, SelectAllToggle, ToggleSwitch } from "../../components/SettingsWidgets";
import { SkillAvatar } from "../../features/skills-market";

export type SkillsCenterSectionProps = { userDataPath: any; displayPath: any; skillsManageOnly: any; setSkillsManageOnly: any; installedTotalCount: any; importSkill: any; refreshMarketSkills: any; skillHubCategory: any; skillHubSearch: any; marketPage: any; marketLoading: any; skillHubCategories: any; setSkillHubCategory: any; setMarketPage: any; skillManageSearch: any; setSkillManageSearch: any; setSkillHubSearch: any; skillHubCategoryTabs: any; skillHubFilterCategory: any; setSkillHubFilterCategory: any; marketSkills: any; skillHubCategoryName: any; localSkills: any; settingsResources: any; skillChecked: any; setSkillChecked: any; skillZhNote: any; toggleSkillEnabled: any; setSelectedSkills: any; setSettingsOpen: any; removeLocalSkill: any; skillBatchBusy: any; batchSetSkillEnabled: any; marketPageSize: any; setMarketPreview: any; setNotice: any; installMarketSkill: any; installingMarketSkill: any };

export function SkillsCenterSection(props: SkillsCenterSectionProps) {
  const { userDataPath, displayPath, skillsManageOnly, setSkillsManageOnly, installedTotalCount, importSkill, refreshMarketSkills, skillHubCategory, skillHubSearch, marketPage, marketLoading, skillHubCategories, setSkillHubCategory, setMarketPage, skillManageSearch, setSkillManageSearch, setSkillHubSearch, skillHubCategoryTabs, skillHubFilterCategory, setSkillHubFilterCategory, marketSkills, skillHubCategoryName, localSkills, settingsResources, skillChecked, setSkillChecked, skillZhNote, toggleSkillEnabled, setSelectedSkills, setSettingsOpen, removeLocalSkill, skillBatchBusy, batchSetSkillEnabled, marketPageSize, setMarketPreview, setNotice, installMarketSkill, installingMarketSkill } = props;
  return (
    <>
      <section className="settings-section stack skill-center">
                    <div className="settings-copy channel-heading"><div><h2>技能中心<PageInfo text={<>技能清单来自腾讯 SkillHub 市场（skillhub.cn），一键安装自动写入 <code>{userDataPath ? displayPath(userDataPath, "codex-home", "skills") : "Codex 技能目录"}</code>，更新来源清单并重启引擎确认可用。</>} helpKey="skills" label="技能中心" /></h2></div><div className="settings-heading-actions"><button className={skillsManageOnly ? "active-manage" : "secondary-setting"} onClick={() => setSkillsManageOnly(!skillsManageOnly)}><LayoutGrid size={14} />{skillsManageOnly ? "返回市场浏览" : `我的技能 ${installedTotalCount}`}</button><button className="secondary-setting" onClick={() => void importSkill()}><Paperclip size={14} />从本地添加技能</button><button className="secondary-setting" title="打开腾讯 SkillHub 技能市场" onClick={() => void window.codex.openExternal("https://skillhub.tencent.com/")}><ArrowUpRight size={14} />SkillHub 市场</button><button className="icon-button" title="刷新技能市场" onClick={() => void refreshMarketSkills(skillHubCategory, skillHubSearch, marketPage)}>{marketLoading ? <Spinner /> : <RefreshCw size={14} />}</button></div></div>
                    <div className="resource-toolbar">
                      {!skillsManageOnly && <div className="skill-tabs">{skillHubCategories.map((category: any) => <button key={category} className={skillHubCategory === category ? "active" : ""} onClick={() => { setSkillHubCategory(category); setMarketPage(1); setSkillsManageOnly(false); }}>{category}</button>)}</div>}
                      <SearchField
                        value={skillsManageOnly ? skillManageSearch : skillHubSearch}
                        onChange={(next) => { if (skillsManageOnly) setSkillManageSearch(next); else { setSkillHubSearch(next); setMarketPage(1); } }}
                        placeholder={skillsManageOnly ? "搜索已安装技能的名称或描述" : "搜索 SkillHub 技能"}
                      />
                    </div>
                    {!skillsManageOnly && <div className="resource-toolbar secondary skill-filter-row">
                      <div className="skill-tabs">{skillHubCategoryTabs.map(([label, value]: any) => <button key={label} className={skillHubFilterCategory === value ? "active" : ""} onClick={() => { setSkillHubFilterCategory(value); setMarketPage(1); }}>{label}</button>)}: any</div>
                      {marketSkills.length > 0 && <span className="skill-filter-count">当前榜单 {marketSkills.length} 个技能 · 分类 <b>{skillHubFilterCategory ? skillHubCategoryName(skillHubFilterCategory) : "全部"}</b></span>}
                    </div>}
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
                      // 批量只处理本机可移除的技能，内置技能由引擎提供、不支持停用
                      const manageable = [...marketInstalled, ...localInstalled];
                      const selectableFolders = manageable.map((skill) => skill.folder ?? skill.name);
                      // 筛选变化后取交集，避免已不可见的勾选项仍计入
                      const checkedFolders = skillChecked.filter((folder: any) => selectableFolders.includes(folder));
                      const checkedSkills = manageable.filter((skill) => checkedFolders.includes(skill.folder ?? skill.name));
                      const offList = checkedSkills.filter((skill) => skill.enabled === false).map((skill) => skill.folder ?? skill.name);
                      const onList = checkedSkills.filter((skill) => skill.enabled !== false).map((skill) => skill.folder ?? skill.name);
                      const toggleSkillChecked = (folder: string) => setSkillChecked((current: any) => current.includes(folder) ? current.filter((entry: any) => entry !== folder) : [...current, folder]);
                      const renderCard = (skill: { name: string; description: string; descriptionZh?: string; path?: string; source?: "cocoloop" | "skillhub" | "local"; folder?: string; enabled?: boolean; allowedTools?: string[]; category?: string; icon?: string }, sourceTag: "builtin" | "market" | "local") => {
                        const removable = sourceTag !== "builtin";
                        const folder = removable ? skill.folder ?? skill.name : null;
                        const sourceLabel = sourceTag === "builtin" ? "内置" : sourceTag === "market" ? "市场安装" : "本地导入";
                        const enabled = skill.enabled !== false;
                        const skillKey = folder ?? skill.name;
                        const checked = removable && checkedFolders.includes(skillKey);
                        const allowedTools = (skill.allowedTools ?? []).filter(Boolean);
                        // 卡片描述：中文注释优先（注释表 / 安装时存下的市场中文简介），没有中文才退回原文
                        const zhNote = skillZhNote(skill);
                        const cardDescription = zhNote !== "已安装技能" ? zhNote : (skill.description || "已发现技能");
                        return <article className={`skill-card-compact source-${sourceTag} ${removable && !enabled ? "is-disabled" : ""} ${checked ? "is-checked" : ""}`} key={`${sourceTag}-${skill.name}`}>
                          <div className="skill-card-compact-head">
                            <div className="skill-card-head-left">
                              <CheckCard checked={checked} disabled={!removable} label={`选择 ${skill.name}`} title={!removable ? "内置技能不可勾选" : checked ? `取消选择 ${skill.name}` : `勾选 ${skill.name}`} onChange={() => toggleSkillChecked(skillKey)} />
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
                              {removable && folder && <button className="icon-button" title="卸载技能" onClick={() => void removeLocalSkill({ folder, name: skill.name, description: skill.description })}><Trash2 size={13} /></button>}
                            </div>
                          </div>
                        </article>;
                      };
                      return <div className="skill-installed-view">
                        <div className="resource-toolbar secondary">
                          <SelectAllToggle total={selectableFolders.length} selected={checkedFolders.length} unit="个技能" onSelectAll={() => setSkillChecked(selectableFolders)} onClear={() => setSkillChecked([])} />
                          <div className="skill-installed-summary">共 {installedTotalCount} 项 · 内置 {builtinSkills.length} · 市场 {localSkills.filter((entry: any) => entry.source === "cocoloop" || entry.source === "skillhub").length} · 本地 {localSkills.filter((entry: any) => entry.source !== "cocoloop" && entry.source !== "skillhub").length} · 停用 {localSkills.filter((entry: any) => entry.enabled === false).length}</div>
                          <BatchActions
                            hint={checkedFolders.length ? `选中里：${onList.length} 个启用中 · ${offList.length} 个已停用` : "勾选技能后可批量启用或停用"}
                            actions={[
                              { label: offList.length ? `启用所选 (${offList.length})` : "启用所选", icon: <Play size={13} />, disabled: !offList.length, busy: skillBatchBusy === "enable", onClick: () => void batchSetSkillEnabled(offList, true), title: offList.length ? `启用选中的 ${offList.length} 个已停用技能` : "没有勾选已停用的技能" },
                              { label: onList.length ? `停用所选 (${onList.length})` : "停用所选", icon: <CircleStop size={13} />, tone: "danger", disabled: !onList.length, busy: skillBatchBusy === "disable", onClick: () => void batchSetSkillEnabled(onList, false), title: onList.length ? `停用选中的 ${onList.length} 个启用中技能` : "没有勾选启用中的技能" },
                            ]}
                          />
                        </div>
                        {shownBuiltin.length > 0 && <section className="skill-installed-group"><header><span className="skill-group-dot tag-builtin" />Codex 内置技能<small>由 Codex app-server 自带，不支持停用</small></header><div className="skill-card-grid compact">{shownBuiltin.map((skill: any) => renderCard({ name: skill.name, description: skill.description ?? "由 Codex 引擎内置提供", path: skill.path }, "builtin"))}</div></section>}
                        {marketInstalled.length > 0 && <section className="skill-installed-group"><header><span className="skill-group-dot tag-market" />市场安装<small>从 SkillHub / CocoLoop 市场一键安装到 Codex 技能目录</small></header><div className="skill-card-grid compact">{marketInstalled.map((skill) => renderCard(skill, "market"))}</div></section>}
                        {localInstalled.length > 0 && <section className="skill-installed-group"><header><span className="skill-group-dot tag-local" />本地导入<small>通过 SKILL.md 添加到本机，不会随 Codex 更新被覆盖</small></header><div className="skill-card-grid compact">{localInstalled.map((skill) => renderCard(skill, "local"))}</div></section>}
                        {!shownBuiltin.length && !marketInstalled.length && !localInstalled.length && <p className="muted">{keyword ? "没有匹配的已安装技能，换个关键词试试。" : "还没有已安装技能。可通过“市场浏览”安装，或“从本地添加技能”导入 SKILL.md。"}</p>}
                      </div>;
                    })() : <div className="skill-card-grid">{marketSkills.slice((marketPage - 1) * marketPageSize, marketPage * marketPageSize).filter((skill: any) => (!skillHubFilterCategory || skill.category === skillHubFilterCategory) && (!skillHubSearch || `${skill.name} ${skill.description}`.toLowerCase().includes(skillHubSearch.toLowerCase()))).map((skill: any) => { const installed = localSkills.some((entry: any) => entry.marketId === skill.id); return <article className={`skill-card ${installed ? "installed" : ""}`} key={skill.name} onClick={() => setMarketPreview({
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
                            })}><div className="skill-card-head"><SkillAvatar skill={skill} /><button className="skill-add" title={installed ? "在对话中使用已安装技能" : "一键安装到 Codex 技能目录"} disabled={Boolean(installingMarketSkill)} onClick={(event) => { event.stopPropagation(); if (installed) { setSelectedSkills((current: any) => current.some((entry: any) => entry.name === skill.name) ? current : [...current, skill]); setSettingsOpen(false); setNotice(`已引用技能：${skill.name}`); } else void installMarketSkill(skill); }}>{installed ? <Check size={14} /> : <Plus size={14} />}</button></div><strong>{skill.name}</strong><p>{skill.description}</p><footer><span title={skill.category}>{skillHubCategoryName(skill.category)}{skill.subCategory ? ` · ${skill.subCategory}` : ""}</span><a href="https://skillhub.tencent.com/" onClick={(event) => { event.preventDefault(); event.stopPropagation(); void window.codex.openExternal("https://skillhub.tencent.com/"); }}>SkillHub 查看</a></footer></article>; })}</div>}
                  </section>
    </>
  );
}
