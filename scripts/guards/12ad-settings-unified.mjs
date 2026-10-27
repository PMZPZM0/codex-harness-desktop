/**
 * 设置页统一版式（10-24 三轮）：能力与内容 / 人格与记忆 / 自动化与智能体 / 数据 + 收藏夹。
 *
 * 用户令：「我框住的这些，你也全部优化一下布局，还有那个收藏夹」「对应里面界面都做好看一点，
 * 风格统一，方便新手」。上一轮的教训是**不要强制等宽网格**：内容卡一律长卡片、高度随内容；
 * 入口卡也要一列长卡，不许三张方卡留空格子。
 *
 * 失效方式大多是「看着没问题、用起来别扭」：
 *   · 切页不重置滚动 ⇒ 页头卡片被截在容器上沿（截图实测）；
 *   · 页头长说明把操作按钮挤到第二行，或把标题压成窄列；
 *   · hub-card-grid / template-grid 留下半行空白（用户明确拒绝的形态）；
 *   · 收藏夹页脚说明是 flex，文本节点被拆成可收缩的列（截图断成四块）；
 *   · 定时任务页标题写着「自动化」，新手分不清页面。
 * 判据盯**接线与结构**；真实观感由验收 settings-unified 在真窗口里量。
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const src = (rel) => codeOnly(read(rel));
let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【shell】${message}`);
  if (!condition) fails++;
};

const FILES = {
  content: "src/features/app-view/AppView/08-settings-sheet/01-settings-layout/02-settings-content.tsx",
  css: "src/styles/45-settings-experience.css",
  styles: "src/styles.css",
  schedule: "src/features/settings-schedule/ScheduleSettingsSection.tsx",
  knowledge: "src/features/knowledge-base/KnowledgeBaseSection.tsx",
  soul: "src/features/soul-market/SoulMarketSection.tsx",
  memory: "src/features/settings-memory/MemoryCenterSection.tsx",
  skills: "src/features/settings-skills/SkillsCenterSection.tsx",
  plugins: "src/features/settings-plugins/PluginsMarketSection.tsx",
  mcp: "src/features/settings-mcp/McpSettingsSection.tsx",
  commands: "src/features/settings-commands/CommandsSettingsSection.tsx",
  hooks: "src/features/settings-hooks/HooksSettingsSection.tsx",
  ssh: "src/features/settings-ssh/SshSettingsSection.tsx",
  agentteam: "src/features/settings-agentteam/AgentTeamSettingsSection.tsx",
  storage: "src/features/storage-settings/StorageSettings.tsx",
  model: "src/features/settings-model/ModelSettingsSection.tsx",
  favorites: "src/features/settings-favorites/FavoritesSettingsSection.tsx",
  relay: "src/features/relay/RelayCenterPage.tsx",
  relayBanner: "src/features/relay/RelayCenterPage/01-subscription-banner.tsx",
  relayGrid: "src/features/relay/RelayCenterPage/02-account-grid.tsx",
  openai: "src/features/openai/OpenaiSubscriptionPage.tsx",
  personal: "src/components/PersonalizationPage.tsx",
  general: "src/features/settings-general/GeneralSettingsSection.tsx",
  accept: "scripts/accept.mjs",
};
for (const [name, rel] of Object.entries(FILES)) {
  ok(existsSync(join(ROOT, rel)), `文件在位：${name}（${rel}）`);
}

const content = src(FILES.content);
const css = read(FILES.css);
const providerCss = read("src/styles/42-provider-setup.css");
const styles = read(FILES.styles);
/* ⛔ 不再 read(FILES.accept)：⑦ 的验收登记断言已随「验收脚本收敛为当前 3 项」一并删除，
   变量留着就是死代码（FILES.accept 仍参与上面「文件在位」的存在性检查）。 */
const pageSrc = (key) => src(FILES[key]);

/* ── ① 全设置页接线（10-24 四轮：不再按页白名单） ── */
ok(/className="settings-content settings-exp-shell"/.test(content), "所有设置页无条件挂 settings-exp-shell（统一简洁风）");
ok(!/EXP_SHELL_PAGES/.test(content), "⛔ 不再按页白名单判断（否则没列进去的页还是旧样式）");
ok(/scrollTop\s*=\s*0/.test(content) && /\[settingsPage\]/.test(content) && /requestAnimationFrame/.test(content), "切页把设置内容滚回顶部（首帧后再补一次，压住自动聚焦的滚动）");

/* ── ② 页头：平面标题 + 右侧操作一行，说明整宽一行 ── */
const headerRule = css.slice(css.indexOf(".settings-exp-shell > .settings-section > .settings-copy,"), css.indexOf("/* 页头 = 第一行"));
ok(/display:\s*grid/.test(headerRule), "页头用 grid（不是可换行的 flex）");
ok(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/.test(headerRule), "页头两列：标题弹性 + 操作定宽");
ok(/padding:\s*0;/.test(headerRule) && /background:\s*none;/.test(headerRule) && /border:\s*0;/.test(headerRule), "页头是平面标题，不做卡片");
ok(/\.settings-exp-shell > \.settings-section > \.settings-copy > div:not\(\.settings-heading-actions\)\s*\{\s*display:\s*contents/.test(css), "标题包装层摊平（长说明不会把按钮挤下去）");
ok(/\.settings-exp-shell > \.settings-section > \.settings-copy h2[\s\S]{0,160}grid-column:\s*1;[\s\S]{0,80}grid-row:\s*1/.test(css), "标题固定第一行第一列");
ok(/\.settings-exp-shell > \.settings-section > \.settings-copy p[\s\S]{0,160}grid-column:\s*1 \/ -1;[\s\S]{0,80}grid-row:\s*2/.test(css), "说明整宽第二行");
ok(/\.settings-exp-shell > \.settings-section > \.settings-copy > \.settings-heading-actions,[\s\S]{0,220}grid-column:\s*2;[\s\S]{0,80}grid-row:\s*1/.test(css), "操作按钮固定第一行第二列");
ok(/\.settings-exp-hero\s*\{[^}]*background:\s*none/s.test(css), "四页头图组件也改成平面标题（不再用渐变卡）");
ok(!/linear-gradient|radial-gradient/.test(css), "⛔ 统一简洁风里不再有渐变（回到旧观感会直接红）");

/* ── ③ 白卡 + 中性图标 + 不留空格子 ── */
ok(/\.settings-exp-shell \.settings-card\s*\{[^}]*background:\s*var\(--panel\)/s.test(css), "标准卡是平面白卡（无渐变）");
ok(/\.settings-exp-shell \.settings-card-head > svg\s*\{[^}]*background:\s*var\(--panel-2\)[^}]*color:\s*var\(--muted\)/s.test(css), "卡头图标是中性灰胶囊（不按页面色相上色）");
ok(/\.settings-exp-shell \.hub-card-grid\s*\{\s*grid-template-columns:\s*1fr/.test(css), "入口卡一列长卡（自动化 / 专家团不再三张方卡）");
ok(/grid-template-areas:\s*"icon title"\s*"icon desc"\s*"icon version"/.test(css), "入口卡横向排布：图标 + 标题/说明/版本");
ok(/\.settings-exp-shell \.hub-card-icon\s*\{[^}]*background:\s*var\(--panel-2\)[^}]*color:\s*var\(--muted\)/s.test(css), "入口卡图标也是中性灰");
ok(/\.settings-exp-shell \.template-grid\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(css), "模板两列（不再是 auto-fill 三列）");
ok(/\.template-card:last-child:nth-child\(odd\)\s*\{\s*grid-column:\s*1 \/ -1/.test(css), "落单的最后一张模板占满整行（没有空格子）");
ok(/\.settings-exp-shell \.memory-center \.settings-cards\s*\{[^}]*grid-template-columns:\s*1fr/s.test(css), "记忆两张内容卡改成一列长卡");

/* ── ④ 收藏夹：页脚说明单列 ── */
ok(/\.settings-exp-shell \.favorites-settings \.fav-foot\s*\{[^}]*display:\s*block/s.test(css), "收藏夹页脚改单列（flex 会把文本节点拆成四块）");
ok(/\.settings-exp-shell \.favorites-settings \.fav-foot > svg\s*\{[^}]*vertical-align/s.test(css), "页脚图标按行内对齐（不与文字错位）");

/* ── ⑤ 页面自身：标题、页头与分组 ── */
const schedule = pageSrc("schedule");
ok(/<h2>定时任务<\/h2>/.test(schedule) && !/<h2>自动化<\/h2>/.test(schedule), "定时任务页标题是「定时任务」（不再是「自动化」）");
const knowledge = pageSrc("knowledge");
ok(/<h2>知识库<PageInfo/.test(knowledge) && !/settings-exp-group-head/.test(knowledge), "知识库有页头，本地文档分组小字已删");
const soul = pageSrc("soul");
/* 10-27 用户令：「刷新放到第一个标题卡片里面，帮助❓号删了，codex 在下面用户在上面」
   ⇒ 页头整块撤掉、刷新进「用户人格」卡标题行、用户人格排在 Codex 人格之前。 */
ok(!/PageInfo/.test(soul) && /UserPersonaPanel[\s\S]{0,600}action=\{<button/.test(soul) && soul.indexOf("<UserPersonaPanel") < soul.indexOf("soul-market-status"), "人格市场：无 ?，刷新在用户人格卡标题行，用户人格在 Codex 人格之上");
const memory = pageSrc("memory");
ok(/<h2>记忆<PageInfo[\s\S]{0,200}<p>/.test(memory), "记忆页头有新手可读的一句说明");
ok(/\.settings-exp-shell \.memory-center \.memory-backends\s*\{[^}]*border-top/s.test(css), "「记忆存到哪里」与内容卡之间有分隔");
const skillsPage = pageSrc("skills");
ok(/skill-actions-line/.test(skillsPage) && !/skill-market-toolbar|settings-heading-actions/.test(skillsPage) && !/<div className="skill-tabs">/.test(skillsPage) && !/<span className="skill-filter-count">/.test(skillsPage), "技能页：按键与搜索同排，分类小字与页头按键已删");
ok(!/PageInfo/.test(skillsPage), "技能页右上角帮助问号已删");
ok(/<AppSelect[\s\S]{0,200}skill-category-select/.test(skillsPage) && /skillHubFilterCategory \|\| skill\.category === skillHubFilterCategory/.test(skillsPage), "技能分类筛选下拉回来了（卡片按分类过滤）");
const skillsCss = read("src/styles/12-settings-skills.css");
ok(/\.skill-actions-line\s*\{[^}]*margin-left:\s*auto/.test(skillsCss) && /\.skill-action-sm\s*\{[^}]*height:\s*28px/.test(skillsCss), "技能页按键与搜索同一行、右对齐且小尺寸（28px）");
const commandsPage = pageSrc("commands");
ok(!/settings-copy|PageInfo|settings-heading-actions/.test(commandsPage) && /command-actions-line/.test(commandsPage), "命令页页头按键/问号已删，新建与刷新并进搜索行");
ok(!/还没有自定义命令/.test(commandsPage), "命令页不再显示「还没有自定义命令」空态注释");
ok(/<AppSelect[\s\S]{0,200}command-filter-select/.test(commandsPage) && !/command-stats|command-tabs/.test(commandsPage), "命令分类收成下拉筛选（统计小字与 tab 已删）");
const commandCss = read("src/styles/14-model-onboarding.css");
ok(/\.command-actions-line\s*\{/.test(commandCss) && /\.command-action-sm\s*\{[^}]*height:\s*28px/.test(commandCss) && /\.command-filter-select\s*\{/.test(commandCss), "命令页按键小尺寸（28px）、筛选下拉在位");
const pluginsPage = pageSrc("plugins");
ok(/<AppSelect[\s\S]{0,200}market-category-select/.test(pluginsPage) && !/<div className="skill-tabs">/.test(pluginsPage) && !/>在线市场<\/button>/.test(pluginsPage), "插件市场分类收成下拉，在线市场跳转已删");
const compLibSrc = read("src/features/component-library/ComponentLibrary.tsx");
ok(/comp-lib-cat-select/.test(compLibSrc) && !/ui-skin-cats/.test(compLibSrc) && /\.comp-lib-filter-row/.test(read("src/styles/23-ui-skin.css")), "组件库分类收成搜索行右侧下拉（搜索不再拉满）");
ok(/\.comp-lib-grid\s*\{[^}]*max-height:\s*calc\(100vh/.test(read("src/styles/23-ui-skin.css")), "组件库网格高度跟窗口走（不再固定 460px 留空白）");
const sshPage = pageSrc("ssh");
ok(!/PageInfo|settings-copy/.test(sshPage) && /ssh-status-select/.test(sshPage) && /ssh-actions-line/.test(sshPage), "SSH 页问号/页头已删，状态筛选下拉与三颗操作并进搜索行");
const sshCss = read("src/styles/16-settings-ssh.css");
ok(/\.ssh-filter-row/.test(sshCss) && /\.ssh-action-sm\s*\{[^}]*height:\s*28px/.test(sshCss), "SSH 操作按钮小尺寸（28px）");
ok(/\.app-lock-actions\s*\{[^}]*justify-content:\s*flex-end/.test(read("src/styles/48-app-lock.css")), "应用锁操作按钮靠右");
const expertCenterSrc = read("src/features/settings-expert-center/ExpertCenterSection.tsx");
ok(/expert-center-head/.test(expertCenterSrc) && /onBack/.test(expertCenterSrc) && !/PageInfo/.test(expertCenterSrc), "专家中心返回与专家市场并排，帮助问号已删");
ok(!/"expert-center": \{ back:/.test(read("src/features/app-view/AppView/08-settings-sheet/01-settings-layout/00-settings-registry.tsx")), "专家中心返回键不再由壳层单独占一行");
const teamsSrc = read("src/features/settings-teams/TeamsSettingsSection.tsx");
ok(/teams-back/.test(teamsSrc) && !/subagent-banner/.test(teamsSrc) && /onBack/.test(teamsSrc), "专家团返回并进操作行，Codex 说明卡已删");
ok(!/teams: \{ back:/.test(read("src/features/app-view/AppView/08-settings-sheet/01-settings-layout/00-settings-registry.tsx")), "专家团返回键不再由壳层单独占一行");
/* ── ⑨ 子智能体编辑器（10-27 用户：「新建子智能体更新一下，都是旧的，工具也是」）──
   ⛔ 只断言 SubAgentEditorModal 段：专家团弹窗在同一个文件里，它的「启用状态」仍是原生 checkbox。 */
const subAgentModal = codeOnly(read("src/features/experts-teams/ExpertsTeams/01-modals.tsx").split("export function ExpertTeamEditorModal")[0]);
ok(!/ALL_EFFORTS/.test(subAgentModal) && /CUSTOM_MODEL_EFFORTS/.test(subAgentModal) && /effortLabels\[level\]/.test(subAgentModal),
  "子智能体推理强度改四档（低/中/高/极高），不再列极简/最高/max");
ok(/ToggleSwitch/.test(subAgentModal) && !/<input type="checkbox"/.test(subAgentModal),
  "子智能体开关走共享 ToggleSwitch（原生大蓝勾选框已删）");
ok(/subagent_save/.test(subAgentModal) && /agent_invoke/.test(subAgentModal) && !/dynamicTools|agent_invoke · subagent/.test(subAgentModal),
  "工具说明改成 agent_invoke（派活）+ subagent_save（建/改），旧 dynamicTools 文案已删");
const agentsSrc = read("src/features/settings-agents/AgentsSettingsSection.tsx");
ok(/normalizeSubagentEffort/.test(agentsSrc) && /SUBAGENT_SANDBOX_OPTIONS/.test(agentsSrc) && /SUBAGENT_APPROVAL_OPTIONS/.test(agentsSrc),
  "子智能体卡片：推理强度归一四档，沙箱/审批显示中文标签");
ok(/effort: normalizeSubagentEffort\(agent\.effort\)/.test(read("src/features/app-state/parts/part07/02-seg/01-connectors-subagents-teams.tsx")),
  "打开旧条目时把历史推理档位归一到四档（下拉不会空着）");
ok(/manageable = \[\.\.\.localInstalled\]/.test(skillsPage), "技能批量管理只覆盖本地导入（市场/内置不参与）");
ok(/skill-local-bulk/.test(skillsPage) && /本地导入/.test(skillsPage), "批量管理卡在本地导入分组内（不再挂在页面顶部）");
ok(!/resource-toolbar secondary[sS]{0,500}BatchActions/.test(skillsPage), "顶部不再挂全局批量条");
ok(/const selectable = sourceTag === "local"/.test(skillsPage), "市场/内置卡片不参与本地批量勾选");
const modelPage = pageSrc("model");
ok(/provider-card-actions[\s\S]{0,700}provider-card-update/.test(modelPage), "「更新模型」在供应商卡底部操作行（与测试/编辑并排，不再占模型芯片行）");
const actionsAt = modelPage.indexOf("provider-card-actions");
const actionsEnd = modelPage.indexOf("</span>", actionsAt);
const actionsBlock = actionsAt >= 0 && actionsEnd > actionsAt ? modelPage.slice(actionsAt, actionsEnd) : "";
ok(/provider-card-icon-btn/.test(modelPage) && actionsBlock.length > 0 && !/编辑<\/button>/.test(actionsBlock), "编辑入口只保留右上角铅笔（底部操作行不再重复）");
ok(/refreshCardModels/.test(modelPage) && /provider-card-update[\s\S]{0,700}refreshCardModels/.test(modelPage), "「更新模型」直接刷新模型列表（不再只打开编辑弹窗）");
const refreshAt = modelPage.indexOf("const refreshCardModels");
const refreshEnd = modelPage.indexOf("const testProviderCard", refreshAt);
const refreshBlock = refreshAt >= 0 && refreshEnd > refreshAt ? modelPage.slice(refreshAt, refreshEnd) : "";
ok(refreshBlock.length > 0 && /addedIds/.test(refreshBlock) && /removed/.test(refreshBlock) && /saveCustomDraft/.test(refreshBlock) && /relaunchApp/.test(refreshBlock), "「更新模型」新增/移除模型都保存并重启（与编辑弹窗保存同口径）");
/* 10-27 用户令（数据管理页截图）：「右上角的帮助问号删了」⇒ 该页页头整块撤掉，
   从这条「必须有 ? 入口」的名单里移出（其余两页逻辑不变）。 */
for (const [key, title] of [["hooks", "钩子"], ["agentteam", "专家和专家团"]]) {
  const text = pageSrc(key);
  const at = text.indexOf(`<h2>${title}`);
  const window = at >= 0 ? text.slice(at, at + 2200) : "";
  /* 10-26 用户令：「界面左上角一排大字和下面一排小字都删了，纯多余」⇒ 页头不再显示副标题，
     说明的唯一入口变成标题旁的 ?。判据跟着行为走（⛔ 不是"源码里还有 <p> 就算过"——
     那样守卫会自洽地绿，而界面上一个字都没有）。 */
  ok(at >= 0 && /<PageInfo/.test(window), `${title}页头说明收进 ?（10-26 起副标题整排不显示）`);
}

/* 10-27 用户（MCP 页截图）：「右上角问号删了」⇒ MCP 页头整块撤掉，
   进页直接是工具条与市场卡片。⛔ 名单里去掉 mcp 的同时单独钉一条，
   免得以后「每页都有 ?」这条判据又把它悄悄加回来。 */
const mcpHeaderSrc = pageSrc("mcp");
ok(!/PageInfo/.test(mcpHeaderSrc) && !/settings-copy/.test(mcpHeaderSrc), "MCP 页不再挂 ? / 页头说明（进页直接是工具条与卡片）");

/* 10-26 用户（中转站页截图）第二次令：「文字赘述删掉，问号删掉，大字就行」——
   本页连 ? 一起收掉，说明段、页脚、添加卡小字全部删除，只剩大字与操作。 */
const relayPage = pageSrc("relay");
const relayBanner = pageSrc("relayBanner");
const relayGrid = pageSrc("relayGrid");
ok(!/PageInfo/.test(relayPage) && !/relay-center-foot/.test(relayPage), "中转站页不再挂 ?、页脚说明已删（只留大字）");
const guestBranch = /state === "guest" \? \(([\s\S]*?)\) : expired/.exec(relayBanner)?.[1] ?? "";
ok(/<strong>付费订阅 · 开通即用<\/strong>/.test(guestBranch) && !/<p>/.test(guestBranch), "未登录横幅只留大字标题（说明段已删）");
const addCard = /className="relay-plan-card relay-add-card"([\s\S]*?)<\/button>/.exec(relayGrid)?.[1] ?? "";
ok(/<Plus\b/.test(addCard) && /<strong>添加中转站账号<\/strong>/.test(addCard) && !/<small>/.test(addCard), "添加账号卡只留图标 + 大字（小字说明已删）");
ok(/\.settings-exp-shell \.relay-add-card\s*\{[^}]*flex-direction:\s*row[^}]*min-height:\s*64px/.test(css), "添加账号卡横向单行（不再竖排留白）");

/* 10-26 用户：「免费网关删了，配套也删掉」「右下角这个也太太靠下了，位置不好看」 */
ok(!existsSync(join(ROOT, "src/features/free-gateway")) && !existsSync(join(ROOT, "electron/features/free-gateway-ipc.ts")) && !existsSync(join(ROOT, "scripts/guards/12c-free-gateway.mjs")), "免费网关渲染层 / IPC 域 / 守卫文件已删除");
ok(!/free-gateway|免费模型网关/.test(modelPage) && !/provider-more-section/.test(modelPage), "模型页不再挂免费网关推荐卡与「更多供应商」区块");
ok(!/free-gateway/.test(read("electron/ipc-channels.manifest.json")) && !/free-gateway/.test(read("electron/ipc-registry.ts")) && !/free-gateway/.test(read("electron/composition.json")), "manifest / registry / composition 不再登记免费网关");
ok(!/12c-free-gateway/.test(read("package.json")), "package.json 的 check 链不再调用已删除的 12c 守卫");
ok(!/provider-list-head|provider-count/.test(modelPage) && !/model-page-dock/.test(modelPage) && !/\.model-page-dock/.test(providerCss), "模型页不再显示「模型供应商 N」小字与底部操作条");
ok(/provider-page-toolbar[\s\S]*model-compact-control[\s\S]*provider-page-actions[\s\S]*自动配置[\s\S]*自定义供应商[\s\S]*保存重启/.test(modelPage), "模型页工具栏：压缩靠左，自动配置 / 自定义供应商 / 保存重启靠右");
ok(/<button className="primary-setting" onClick=\{openAutoSetup\}[\s\S]{0,120}自动配置/.test(modelPage) && /<button className="secondary-setting" onClick=\{openNewProvider\}[\s\S]{0,120}自定义供应商/.test(modelPage), "绿色主按钮只给「自动配置」；「自定义供应商」是普通按钮");
ok(/<button className="danger-setting" disabled=\{restarting\}[\s\S]{0,160}保存重启/.test(modelPage), "「保存重启」是红色警示按钮");

/* 10-27 用户：「那个分类做成筛选形式，几个市场跳转删了」 */
const mcpPage = src("src/features/settings-mcp/McpSettingsSection.tsx");
ok(/<AppSelect[\s\S]{0,200}mcp-category-select/.test(mcpPage) && !/SkillHub MCP 广场|AIbase 广场/.test(mcpPage), "MCP 分类改成筛选下拉，两个市场跳转按钮已删");
ok(/\.mcp-category-filter\s*\{[^}]*white-space:\s*nowrap/.test(read("src/styles/07-settings-mcp-connectors.css")), "MCP 分类标签不换行");

/* 10-26 用户（OpenAI 订阅页截图）：「问号删除，小文字注释删除大字就行，账户长卡片
   改成长方形卡片，不要拉这么长」—— ? / 副标题 / 卡片小字全删；添加卡两列并排。 */
const openaiPage = pageSrc("openai");
ok(!/PageInfo/.test(openaiPage) && !/settings-copy/.test(openaiPage), "OpenAI 订阅页不再挂 ? / 页头说明（只留卡片大字）");
const oaAddCards = [...openaiPage.matchAll(/className="relay-plan-card relay-add-card"([\s\S]*?)<\/button>/g)].map((m) => m[1]);
ok(oaAddCards.length === 2 && oaAddCards.every((s) => !/<small>/.test(s)), "OpenAI 添加卡只留图标 + 大字（小字说明已删）");
ok(/\.settings-exp-shell \.openai-account-grid \.relay-add-card\s*\{[^}]*grid-column:\s*auto/.test(css), "OpenAI 添加卡两列并排（不再横贯整行）");

/* 10-26 用户：「左上角一排小字删除，其他设置界面还有的一起删」——
   SettingsGroupHead / settings-exp-group-head 全部下线；权限卡片文字居中。 */
const groupPages = [
  "src/features/settings-general/GeneralSettingsSection.tsx",
  "src/features/settings-appearance/AppearanceSettingsSection.tsx",
  "src/features/settings-pet/PetSettingsSection.tsx",
  "src/components/PersonalizationPage.tsx",
  "src/features/settings-app-lock/AppLockSettingsSection.tsx",
  "src/features/storage-settings/StorageSettings.tsx",
  "src/features/storage-settings/WorkLogsSection.tsx",
  "src/features/storage-settings/ChangeBackupSection.tsx",
  "src/features/knowledge-base/KnowledgeBaseSection.tsx",
];
ok(groupPages.every((p) => !/SettingsGroupHead|settings-exp-group-head/.test(read(p))), "设置页不再出现「常用 / 基础外观」这类分组小字");
ok(!/SettingsGroupHead/.test(read("src/components/SettingsPageHero.tsx")) && !/\.settings-exp-group-head/.test(css), "分组小字组件与样式已删除");
ok(/\.perm-seg-btn\s*\{[^}]*align-items:\s*center[^}]*text-align:\s*center/.test(read("src/styles/02-sidebar-threads.css")), "权限三张卡文字居中");

/* ── ⑥ SSH 工具栏不落单 ── */
ok(/\.settings-exp-shell \.ssh-toolbar \.search-field\s*\{[^}]*flex:\s*1 1 160px;[^}]*width:\s*auto\s*!important/s.test(css), "SSH 搜索框可收缩（导出/导入不再被挤到第二行单飞）");

/* ── ⑦ 验收题同轮登记（⛔ 10-26 删除这两条）──
   它们断言 accept.mjs 里有 `"settings-unified": "10-24"` 轮次表与 `id: "settings-unified"` 验收项，
   但 `c1344271b`（「验收脚本收敛为当前 3 项」）已把轮次表机制与该项一起**有意删除**。
   断言已不存在的对象 = 永远红或永远假绿，两种都没价值 ⇒ 去掉；
   上面 ①~⑥ 的结构断言才是这条守卫真正在守的东西。 */

/* ── ⑧ 个性化页去重（10-27 用户令：「个性化里面的用户称呼可以删了，还有语气自适应也删了，
     跟用户中心和控制台的ahd重复了」）──
   称呼已并入「用户中心 → 基本资料」，语气自适应的开关挪到「控制台 → 回复风格」。
   ⛔ 最要紧的一条是「保存不再传 nickname」：个性化页保存走 partial 语义
   （字段 undefined = 保留原值），一旦这里传空字符串就会把用户中心写的昵称清掉。 */
const personalPage = pageSrc("personal");
ok(!/aria-label="称呼"/.test(personalPage) && !/setNickname/.test(personalPage)
  && !/card-nickname/.test(personalPage), "个性化页不再有「用户称呼」输入（已并入用户中心）");
ok(!/语气自适应/.test(personalPage) && !/adaptiveTone/.test(personalPage), "个性化页不再有「语气自适应」（已挪到控制台）");
ok(/savePersonalization\(\{\s*customInstructions/.test(personalPage)
  && !/savePersonalization\(\{[^}]*nickname/.test(personalPage),
  "个性化保存只传自定义指令（不覆盖用户中心写的昵称）");
ok(!existsSync(join(ROOT, "src/features/settings-personalization/PersonalizationSettingsSection.tsx")),
  "个性化旧区块组件已删除（语气自适应整块搬走）");
/* 10-27 用户令：「回复风格跟用户中心重复了，那边前端删除这个选项，但不能影响新手引导生效；
   搭配 Grill-me 技能加一个需求询问选项，启用就默认用这个技能」 */
ok(/value: "inquiry"/.test(personalPage) && /需求询问/.test(personalPage),
  "回复风格新增「需求询问」档（启用即按 grill-me 先问清需求）");
ok(!/uc-style-options/.test(src("src/components/UserCenter.tsx")) && /STYLE_OPTIONS/.test(src("src/components/UserCenter.tsx")),
  "用户中心不再重复「回复风格」选择区（唯一入口在个性化页），风格标签回显保留");
const generalPage = pageSrc("general");
ok(/语气自适应/.test(generalPage) && /ToggleSwitch/.test(generalPage)
  && /card-reply/.test(generalPage), "控制台「回复风格」卡里有语气自适应开关");
ok(/changeAdaptiveTone/.test(generalPage), "控制台语气自适应开关接的是全局开关回调");

/* 10-27 用户令：「就在 codex 的个性化指令里面加一条，让 codex 自主询问（是否 handoff 交接）」
   ⇒ 指令片段挂在 lib 里（纯函数、可断言），拼进每回合下发的 developer instructions。
   ⛔ 三条硬约束缺一不可：大致阈值 / 只问一次 / 走 handoff 技能写 HANDOFF.md。 */
const nudgeSrc = src("src/lib/handoff-nudge.mjs");
ok(/40~50 轮/.test(nudgeSrc) && /只问一次/.test(nudgeSrc) && /handoff/.test(nudgeSrc) && /HANDOFF\.md/.test(nudgeSrc),
  "长会话交接提醒的三条约束在位（阈值 / 只问一次 / 写 HANDOFF.md）");
ok(/handoffNudge\(\)/.test(src("src/features/app-state/parts/part06/02-seg/01-turn-runtime-activity.tsx")),
  "交接提醒已拼进 developer instructions（不是写了没接线）");

console.log(`\n【shell】${checks - fails}/${checks} 通过`);
process.exit(fails ? 1 : 0);
