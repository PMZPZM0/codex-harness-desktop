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

/* ── ① 目标页集合与接线 ── */
const TARGETS = [
  "skills", "plugins", "component-library", "mcp", "commands",
  "soul-market", "memory", "knowledge-base",
  "automation", "schedule", "hooks", "ssh", "agentteam",
  "usage", "storage", "backup", "archive", "favorites",
];
const missing = TARGETS.filter((id) => !new RegExp(`"${id}"`).test(content.slice(content.indexOf("EXP_SHELL_PAGES"), content.indexOf("EXP_SHELL_PAGES") + 700)));
ok(missing.length === 0, `18 个目标设置页都在 EXP_SHELL_PAGES 里${missing.length ? `（缺 ${missing.join(", ")}）` : ""}`);
ok(/EXP_SHELL_PAGES\.has\(settingsPage\)\s*\?\s*" settings-exp-shell"/.test(content), "当前页命中集合才挂 settings-exp-shell（不波及账户/模型/外观等页）");
ok(/scrollTo\(\{\s*top:\s*0\s*\}\)/.test(content) && /\[settingsPage\]/.test(content), "切页把设置内容滚回顶部（页头不再被截在容器上沿）");

/* ── ② 页头：标题 + 右侧操作一行，说明整宽一行 ── */
ok(/\.settings-exp-shell > \.settings-section > \.settings-copy[\s\S]{0,260}display:\s*grid/.test(css), "页头用 grid（不是可换行的 flex）");
ok(/\.settings-exp-shell > \.settings-section > \.settings-copy[\s\S]{0,400}grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/.test(css), "页头两列：标题弹性 + 操作定宽");
ok(/\.settings-copy > div:not\(\.settings-heading-actions\)\s*\{\s*display:\s*contents/.test(css), "标题包装层摊平（长说明不会把按钮挤下去）");
ok(/\.settings-exp-shell > \.settings-section > \.settings-copy h2[\s\S]{0,120}grid-column:\s*1;[\s\S]{0,80}grid-row:\s*1/.test(css), "标题固定第一行第一列");
ok(/\.settings-exp-shell > \.settings-section > \.settings-copy p[\s\S]{0,120}grid-column:\s*1 \/ -1;[\s\S]{0,80}grid-row:\s*2/.test(css), "说明整宽第二行");
ok(/\.settings-exp-shell > \.settings-section > \.settings-copy > \.settings-heading-actions,[\s\S]{0,220}grid-column:\s*2;[\s\S]{0,80}grid-row:\s*1/.test(css), "操作按钮固定第一行第二列");

/* ── ③ 长卡片 / 不留空格子 ── */
ok(/\.settings-exp-shell \.hub-card-grid\s*\{\s*grid-template-columns:\s*1fr/.test(css), "入口卡一列长卡（自动化 / 专家团不再三张方卡）");
ok(/grid-template-areas:\s*"icon title"\s*"icon desc"\s*"icon version"/.test(css), "入口卡横向排布：图标 + 标题/说明/版本");
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
