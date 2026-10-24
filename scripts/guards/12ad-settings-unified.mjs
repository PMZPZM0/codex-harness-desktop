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
  accept: "scripts/accept.mjs",
};
for (const [name, rel] of Object.entries(FILES)) {
  ok(existsSync(join(ROOT, rel)), `文件在位：${name}（${rel}）`);
}

const content = src(FILES.content);
const css = read(FILES.css);
const styles = read(FILES.styles);
const accept = read(FILES.accept);
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
ok(/<h2>知识库<PageInfo/.test(knowledge) && /settings-exp-group-head[\s\S]{0,240}本地文档/.test(knowledge), "知识库有页头，本地文档降为分组标题");
const soul = pageSrc("soul");
ok(/settings-copy channel-heading[\s\S]{0,1600}刷新/.test(soul), "人格市场的「刷新」收进页头操作区（不再单飞一行）");
const memory = pageSrc("memory");
ok(/<h2>记忆<PageInfo[\s\S]{0,200}<p>/.test(memory), "记忆页头有新手可读的一句说明");
ok(/\.settings-exp-shell \.memory-center \.memory-backends\s*\{[^}]*border-top/s.test(css), "「记忆存到哪里」与内容卡之间有分隔");
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
for (const [key, title] of [["skills", "技能中心"], ["plugins", "插件"], ["mcp", "MCP"], ["commands", "命令"], ["hooks", "钩子"], ["ssh", "SSH 服务器"], ["agentteam", "专家和专家团"], ["storage", "数据管理"]]) {
  const text = pageSrc(key);
  const at = text.indexOf(`<h2>${title}`);
  const window = at >= 0 ? text.slice(at, at + 2200) : "";
  ok(at >= 0 && /<p>/.test(window), `${title}页头带一句说明（新手知道这页是干什么的）`);
}

/* ── ⑥ SSH 工具栏不落单 ── */
ok(/\.settings-exp-shell \.ssh-toolbar \.search-field\s*\{[^}]*flex:\s*1 1 160px;[^}]*width:\s*auto\s*!important/s.test(css), "SSH 搜索框可收缩（导出/导入不再被挤到第二行单飞）");

/* ── ⑦ 验收题同轮登记 ── */
ok(/"settings-unified":\s*"10-24"/.test(accept), "验收 settings-unified 已登记到 10-24 轮（默认轮能跑到）");
ok(/id:\s*"settings-unified"/.test(accept), "验收项本体存在");

console.log(`\n【shell】${checks - fails}/${checks} 通过`);
process.exit(fails ? 1 : 0);
