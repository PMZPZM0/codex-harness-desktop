/**
 * 新手引导板块判据（10-07 立；用户：「侧栏底部加一个新手引导常驻板块…点击后弹窗，左选项右内容，
 * 迷你版设置界面；模型配置/开发工具/人格市场三个设置页映射 + 版本更新日志置底；留好 UI 拓展接口」
 * + 追问「这个新手引导不能被对话选项遮住」）。
 *
 * 失效方式全是有害且静默的：
 *   · 入口被放进 .thread-list 里 ⇒ 跟着列表滚走、还会被内容压住（用户点名的那条）；
 *   · 侧栏 flex 链被改坏（entry 不 flex:none / .thread-list 少了 min-height:0）⇒ 窄窗里
 *     滚动区把入口挤扁或溢出;
 *   · 映射页 id 与 settingsNav 漂移（改设置页 key 后这里变死链，点了没反应）;
 *   · 版本日志抄了第二份数据（单一真相源破功，改一处漏一处——同「组件库」类既有纪律）。
 * 行为（点击开合、跳设置）由验收 `newbie-guide` 真跑；本守卫钉结构、登记表与单源接线。
 * 独立守卫（不进 check-preflight 的 checks 计数）。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【newbie-guide】${message}`);
  if (!condition) fails++;
};

const shell = codeOnly(read("src/features/app-view/AppView/01-sidebar-shell.tsx"));
const guide = codeOnly(read("src/features/newbie-guide/NewbieGuide.tsx"));
const sections = codeOnly(read("src/features/newbie-guide/sections.tsx"));
const css = read("src/styles/31-newbie-guide.css");
const baseCss = read("src/styles/01-base-and-chrome.css");
const stylesEntry = read("src/styles.css");
const manifest = read("electron/ipc-channels.manifest.json");
const whatsNewIpc = codeOnly(read("electron/features/whats-new-ipc.ts"));
const registry = read("electron/ipc-registry.ts");
const preload = read("electron/preload.ts");

/* ── 一、入口常驻、绝不被滚没（用户 10-07 点名的一条）────────────────────── */
{
  const listAt = shell.indexOf('className="thread-list"');
  /* ⛔ 锚**入口按钮**而不是 `<NewbieGuide>`：10-22 起账户行压成侧栏最后一条（用户名贴底），
     弹窗组件仍挂在 Fragment 尾部（它的位置与可见性无关）；拿组件位置比对会永远红。 */
  const entryAt = shell.indexOf("<span>新手教程</span>");
  const accountAt = shell.indexOf('className="account-row"');
  ok(listAt >= 0 && entryAt > listAt && accountAt > entryAt,
    "入口在 .thread-list **之外**、账户行之上（⛔ 放进列表里会随滚动走、被内容压住 —— 用户点名）");
  ok(/\.guide-entry \{[\s\S]{0,120}?flex: none/.test(css),
    ".guide-entry flex:none（侧栏 flex 列里唯一允许收缩的是 .thread-list —— 入口不许被压扁）");
  ok(/\.thread-list \{[\s\S]{0,200}?flex: 1 1 0[\s\S]{0,200}?min-height: 0[\s\S]{0,200}?overflow-y: auto/.test(baseCss),
    ".thread-list 仍是唯一滚动容器（flex:1 1 0 + min-height:0 + overflow-y:auto —— 防「加行挤坏滚动」）");
  ok(stylesEntry.includes('@import "./styles/31-newbie-guide"'),
    "31-newbie-guide.css 已被 styles.css 引入（漏引 = 入口裸奔）");
}

/* ── 二、弹窗结构：左选项 / 右内容 + 三路关闭 ─────────────────────────────── */
{
  ok(guide.includes('className="modal-backdrop guide-backdrop"') && guide.includes('className="guide-modal"'),
    "弹窗挂在 .modal-backdrop（全局模态 400 档）+ 自有迷你设置容器");
  ok(guide.includes('className="guide-nav"') && guide.includes('className="guide-body"'),
    "左选项 / 右内容两栏结构在");
  ok(/onMouseDown[\s\S]{0,120}?event\.target === event\.currentTarget[\s\S]{0,60}?setOpen\(false\)/.test(guide)
    && /key === "Escape"[\s\S]{0,80}?setOpen\(false\)/.test(guide) && guide.includes('className="guide-close"'),
    "关闭三路：点遮罩 / Esc / ✕（与本仓既有弹窗同口径）");
  ok(/setOpen\(false\);\s*\n?\s*onOpenSettings\?\.\(page\)/.test(guide) || /onOpenSettings\?\.\(page\)/.test(guide),
    "「打开设置」= 关弹窗 + onOpenSettings(page) 跳真设置页（映射的落点）");
}

/* ── 三、注册表：设置页映射 + 日志置底 + 拓展接口头注 ──────────────────────── */
{
  /* 映射的 page id 必须真存在于 settingsNav（改设置 key 后这里变死链的样子是"点了没反应"） */
  const navSrc = read("src/features/app-view/helpers/catalogs.ts");
  for (const page of ["model", "devtools", "soul-market"]) {
    ok(sections.includes(`page: "${page}"`) && new RegExp(`\\["${page.replace("-", "\\-")}",`).test(navSrc),
      `章节映射 page="${page}" 且 settingsNav 里真有这个页（防死链）`);
  }
  ok(/id: "changelog"[\s\S]{0,400}?changelog: true/.test(sections) && /changelog: true[\s\S]*?\];?\s*$/m.test(sections),
    "版本更新日志节在数组**最后**（用户：「默认在最下面」）");
  ok(/export const GUIDE_SECTIONS/.test(sections) && /export type GuideSection/.test(sections)
    && /数组加一项/.test(read("src/features/newbie-guide/sections.tsx")),
    "拓展接口：GUIDE_SECTIONS 注册表 + GuideSection 类型 + 头注写明「加一节 = 数组加一项」");

  /* 10-18 二轮：用户点名「前端UI开发、组件库、生图工作流、视频工作流、专家/专家团/子智能体、
     个性化、人格市场」这些都没写 ⇒ 每项独立成节，且内容里要有真实入口名（不许再一笔带过）。
     同日再追加「分新手和高级教程 + 拓展开发（怎么自己加功能）」⇒ tier 分组与 api 节也在这里钉。 */
  const required = [
    ["start", "快速上手", "beginner", []],
    ["frontend", "前端开发", "advanced", ["交给 Codex 实现", "44 种"]],
    ["library", "组件库", "advanced", ["复制代码", "ui_component_search"]],
    ["image", "生图", "advanced", ["生图插件", "图像工坊", "生图工作流"]],
    ["video", "视频", "advanced", ["视频生成接口", "白模视频工作流", "FFmpeg"]],
    ["agents", "专家团队", "advanced", ["子智能体", "专家团", "调度", "办公室"]],
    ["memory", "记忆知识", "advanced", ["项目共享记忆库", "记忆后端", "知识库"]],
    ["personal", "个性化", "beginner", ["称呼", "回复风格", "自定义指令", "语气自适应"]],
    ["soul-market", "人格市场", "beginner", ["应用此人格", "下一个新会话"]],
    ["api", "拓展开发", "advanced", ["harness-api", "ipc-channels.manifest.json", "npm run gen:ipc", "scripts/guards", "scripts/accept.mjs", "FEATURE-LEDGER"]],
  ];
  for (const [id, label, tier, needles] of required) {
    ok(sections.includes(`id: "${id}"`) && sections.includes(`label: "${label}"`)
      && new RegExp(`id: "${id}",[\\s\\S]{0,160}?tier: "${tier}",`).test(sections)
      && needles.every((needle) => sections.includes(needle)),
      `章节「${label}」在、层级=${tier}、真实入口 / 关键动作写全（${needles.join(" / ") || "—"}）`);
  }
  /* 每一节（更新日志除外）都必须归组；更新日志不参与分组，留在最下面 */
  const ids = [...sections.matchAll(/^    id: "([^"]+)",/gm)].map((m) => m[1]);
  const tiers = [...sections.matchAll(/^    tier: "(beginner|advanced)",/gm)].map((m) => m[1]);
  ok(ids.length >= 20 && tiers.length === ids.length - 1,
    `新手 / 高级两组覆盖除更新日志外的全部章节（${ids.length} 节 / ${tiers.length} 个 tier）`);
  ok(!/id: "changelog"[\s\S]{0,300}?tier:/.test(sections),
    "更新日志不参与分组（置底，不归入高级教程）");
  ok(!/在会话里选择人格/.test(sections),
    "⛔ 人格市场那句旧错话不许回来（人格写全局个性化、**下一个新会话**生效，不是「在会话里选」）");
  /* 左列表标签 ≤6 字（弹窗 176px 列宽；超了会折行把导航挤乱） */
  const labels = [...sections.matchAll(/^    label: "([^"]+)"/gm)].map((m) => m[1]);
  ok(labels.length >= 18 && labels.every((label) => [...label].length <= 6),
    `章节标签都 ≤6 字（实测 ${labels.length} 节：${labels.join(" / ")}）`);

  /* 10-18 用户：「分新手和高级教程」「写好看一点」—— 分组导航 + 层级徽章 + 重点提醒卡。 */
  ok(/const GUIDE_TIERS[\s\S]{0,220}?"新手教程"[\s\S]{0,140}?"高级教程"/.test(guide),
    "左导航分「新手教程 / 高级教程」两组");
  ok(/className="guide-nav-group"/.test(guide) && /section\.tier === tier\.id/.test(guide),
    "导航按 tier 分组渲染（新手 / 高级各一组）");
  ok(/section\.tier === tier\.id/.test(guide) && /!section\.tier/.test(guide) && /guide-nav-sep/.test(guide),
    "更新日志不分组、用分隔线单独置底");
  ok(/guide-tier-pill/.test(guide) && /className="guide-tip"/.test(guide),
    "正文标题旁有层级徽章、步骤后有重点提醒卡");
  ok(/\.guide-tier-pill/.test(css) && /\.guide-tip \{/.test(css) && /\.guide-nav-group \{/.test(css),
    "两组导航 / 层级徽章 / 提醒卡的样式都在（不是裸结构）");
  const tipCount = (sections.match(/^    tip: \{/gm) || []).length;
  ok(tipCount >= 8, `重点提醒覆盖关键章节（实测 ${tipCount} 条）`);
}

/* ── 四、版本日志 = 单一真相源（whatsnew:history，不许抄第二份）────────────── */
{
  ok(guide.includes("window.codex.whatsNewHistory()"),
    "日志数据走 whatsNewHistory（渲染层只画不抄）");
  ok(!/v?0\.0\.\d+\s*"[\s\S]{0,80}?"20\d\d-\d\d-\d\d/.test(guide),
    "⛔ 组件里没有硬编码的版本/日期数据（抄第二份 = 单一真相源破功）");
  ok(manifest.includes('"channel": "whatsnew:history"') && whatsNewIpc.includes('ipcHost.handle("whatsnew:history"')
    && registry.includes('"whatsnew:history"') && preload.includes('whatsNewHistory'),
    "whatsnew:history 通道贯通（manifest → feature handler → registry → preload 生成物）");
  ok(/WHATS_NEW_ENTRIES\.map/.test(whatsNewIpc),
    "history 直接复用 whats-new-notes.ts 的 WHATS_NEW_ENTRIES（同 whatsnew:state 的数据源）");
}

/* ── 五、图示 + 文字（10-18 用户：「把应用功能都扫一遍，做一个详细的新手教程，画图+字结合起来」）── */
{
  const figures = read("src/features/newbie-guide/figures.tsx");
  ok(/export function GuideFigureView/.test(figures) && /kind: "window"/.test(figures)
    && /kind: "flow"/.test(figures) && /kind: "panes"/.test(figures) && /kind: "layers"/.test(figures),
    "图示组件四种形态齐全（窗口图 / 流程 / 并列 / 分层）");
  ok(/guide-window-map/.test(figures) && /viewBox="0 0 520 306"/.test(figures),
    "「界面速览」用内联 SVG 画窗口分区（不是截图 / 不是外链图）");
  ok(/<GuideFigureView figure=\{active\?\.figure\} \/>/.test(guide),
    "引导右页渲染 figure（位置在 intro 之后、步骤之前）");
  const figureSections = (sections.match(/figure: \{/g) || []).length;
  const sectionCount = (sections.match(/\bid: "/g) || []).length;
  ok(figureSections >= 10, `每一节都配了图（实测 ${figureSections} 节带 figure；changelog 除外）`);
  ok(figureSections === sectionCount - 1,
    `除更新日志外**每一节都有图**（${figureSections} 图 vs ${sectionCount} 节 —— 新增章节漏图会红）`);
  ok(/figure\?: GuideFigure/.test(sections) && /from "\.\/figures"/.test(sections),
    "GuideSection 类型带 figure 字段（拓展接口：加一节 = 数组加一项，图跟着写）");
  ok(/\.guide-figure\b/.test(css) && /\.guide-figure-caption/.test(css) && /\.guide-window-map/.test(css),
    "图示样式在（容器 / 图注 / 窗口图文字色）");
  ok(!/from "[^"]+\.(png|jpe?g|webp|gif|svg)\?/.test(guide + figures) && !/\.(png|jpe?g|webp|gif)"/.test(figures),
    "⛔ 不用位图资产（截图会过期、生成图与界面对不上；JS import 的位图还会被 before-pack 当死块删掉）");
}
console.log(`\n【newbie-guide】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
