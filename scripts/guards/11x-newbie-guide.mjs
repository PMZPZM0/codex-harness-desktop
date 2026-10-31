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
import { existsSync, readFileSync } from "node:fs";
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
/* 10-24 并行线把侧栏入口抽进 function-menu 板块；入口文案在这里，位置仍由侧栏的
   `.sidebar-options` 容器决定（⛔ 不能因为换了文件就放过「放进 thread-list」的负向）。 */
const functionMenu = existsSync(join(ROOT, "src/features/function-menu/FunctionMenu.tsx"))
  ? codeOnly(read("src/features/function-menu/FunctionMenu.tsx"))
  : "";
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
  const optionsAt = Math.max(
    shell.indexOf('className="sidebar-options"'),
    shell.indexOf('className={`sidebar-options'),
  );
  const entryAt = shell.indexOf("<span>新手教程</span>") >= 0
    ? shell.indexOf("<span>新手教程</span>")
    : functionMenu.indexOf('"新手教程"');
  const accountAt = shell.indexOf('className="account-row"');
  /* 10-24 并行线把功能入口改成「顶部 / 底部」可选（f5a74e4）：顶部时 optionsAt 在 thread-list 之前。
     仍必须满足「入口在账户行之上」且「入口由 function-menu 提供」；⛔ 不再硬绑「必须在 thread-list 之后」。 */
  ok(listAt >= 0 && optionsAt >= 0 && accountAt > optionsAt && entryAt >= 0,
    "入口在账户行之上（顶部/底部两种位置都允许；入口由 function-menu 提供，⛔ 不放进会话列表里随滚动走）");
  ok(/\.guide-entry \{[\s\S]{0,120}?flex: none/.test(css),
    ".guide-entry flex:none（侧栏 flex 列里唯一允许收缩的是 .thread-list —— 入口不许被压扁）");
  ok(/\.thread-list \{[\s\S]{0,600}?flex: 1 1 0[\s\S]{0,600}?min-height: 0[\s\S]{0,600}?overflow-y: auto/.test(baseCss),
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

/* ── 10-31 用户截图：侧栏能力教程弹窗被压成侧栏宽度、文字一字一行 ──
   根因：弹窗挂在 `.sidebar` 子树里，而侧栏有 translate（transform）⇒ 作为 fixed 的包含块，
   把遮罩/弹窗关进 256px；同时「能做什么」写死 3 列，窄宽度下挤成竖排。
   判据：① 两个侧栏内弹窗都必须 portal 到 body；② 卡片网格按宽度自适应（不许写死 3 列）。 */
{
  const guideModal = read("src/features/app-view/AppView/SidebarGuideModal.tsx");
  const loginModal = read("src/features/app-view/AppView/LoginManagerModal.tsx");
  const guideCss = read("src/styles/41-sidebar-guide.css");
  ok(/createPortal\(/.test(guideModal) && /document\.body/.test(guideModal),
    "教程弹窗 portal 到 body（⛔ 侧栏有 transform，内嵌时 fixed 会被压成侧栏宽度）");
  ok(/createPortal\(/.test(loginModal) && /document\.body/.test(loginModal),
    "登录管理弹窗同样 portal（同一坑，别只修一个）");
  ok(/grid-template-columns: repeat\(auto-fit, minmax\(210px, 1fr\)\)/.test(guideCss)
    && !/repeat\(3, minmax\(0, 1fr\)\)/.test(guideCss),
    "「能做什么」卡片按可用宽度自适应列数（⛔ 不许写死 3 列 → 窄窗口一字一行）");
  ok(/@media \(max-width: 720px\)[\s\S]{0,400}?\.sidebar-guide-caps \{ grid-template-columns: 1fr; \}/.test(guideCss),
    "窄窗口兜底：单列（媒体查询阈值 720，覆盖平板宽度）");
  /* 外圈边框（10-31 三次定稿）：外圈保持 6px + 细边；中间（侧栏↔内容）3px 且不画线。 */
  const shellCss = read("src/styles/01-base-and-chrome.css");
  ok(/\.app-shell > \.topbar \{[\s\S]{0,260}?margin: 6px 6px 0 3px;[\s\S]{0,140}?border-left: 0;/.test(shellCss)
    && /\.app-shell > \.workspace \{[\s\S]{0,200}?margin: 0 6px 6px 3px;[\s\S]{0,120}?border-left: 0;/.test(shellCss),
    "外圈卡：上/右/下 6px + 细边；中间只留 3px 且不画线");
  ok(/\.app-shell > \.sidebar \{ border-right: 0; \}/.test(shellCss),
    "侧栏右边界线去掉（中间只剩底色过渡）");
  /* ★ 10-31 用户令：「左侧栏也加拖动功能」「右侧栏中间一条灰色细线就行」 */
  const appViewSrc = read("src/features/app-view/AppView.tsx");
  ok(/className="sidebar-resizer"/.test(appViewSrc) && /onPointerDown=\{beginSidebarResize\}/.test(appViewSrc)
    && /SIDEBAR_MIN = 260/.test(appViewSrc) && /SIDEBAR_MAX = 420/.test(appViewSrc) && /SIDEBAR_DEFAULT = 260/.test(appViewSrc),
    "侧栏右缘可拖动改宽（260–420 钳制，双击复位 260）");
  ok(/localStorage\.setItem\("sidebar-width"/.test(appViewSrc) && /localStorage\.getItem\("sidebar-width"\)/.test(appViewSrc)
    && /"--side-w": `\$\{sidebarWidth\}px`/.test(appViewSrc),
    "侧栏宽度落盘 + 用 --side-w 下发（换算一条真相源，轨道数不变）");
  /* ⛔ 10-31 用户：「左侧栏上有一条线，能不能不显示，但也要支持拖动」——
     平时透明（只剩命中面与 col-resize 光标），hover/拖动才亮主题色。 */
  ok(/\.sidebar-resizer \{[\s\S]{0,260}?left: calc\(var\(--side-w, 256px\) - 3px\)[\s\S]{0,260}?cursor: col-resize/.test(shellCss)
    && /\.sidebar-resizer::after \{[\s\S]{0,200}?width: 1px;[\s\S]{0,200}?background: transparent/.test(shellCss)
    && /\.sidebar-resizer:hover::after,[\s\S]{0,80}?background: var\(--accent\)/.test(shellCss),
    "拖动条 = 7px 命中面 + **平时不画线**（hover/拖动才亮主题色）");

  /* ── ⑩ 侧栏品牌按钮：UA 边框要清掉 + 折叠箭头跟 logo 同色系（10-31 用户截图两次）────
     ① 那圈"黑色边框"是 UA 给 `<button>` 的原生 `border: 2px outset` + `appearance: auto`
        （项目没有全局 button reset，自绘按钮都得自己清）；
     ② 箭头本是 `#fff`，却被 `.brand-row span { color: var(--faint) }` 吃掉 ⇒ 灰箭头压黑底 =
        「黑色折叠箭头」；③ hover 底色原来是黑渐变，与旁边蓝图标割裂。 */
  const shellCode = codeOnly(read("src/styles/01-base-and-chrome.css"));
  ok(/\.brand-mark \{[\s\S]{0,700}?border: 0;[\s\S]{0,160}?appearance: none;/.test(shellCode),
    "⑩ 品牌按钮清掉了 UA 原生边框（2px outset 在圆角上就是那一圈黑边）");
  ok(!/button\.brand-mark\.sidebar-toggle:hover \{[\s\S]{0,240}?#26282c/.test(shellCode),
    "⑩ 负向：悬停不许再回到黑色渐变（箭头压黑底 = 「黑色折叠箭头」）");
  ok(/\.brand-mark \.sidebar-toggle-arrow \{[\s\S]{0,320}?color: #fff/.test(shellCode),
    "⑩ 折叠箭头 color 必须带 .brand-mark 前缀（否则被 `.brand-row span{color:var(--faint)}` 吃掉、变灰）");

  /* ── ⑪ 顶栏右侧紧凑 + mac 品牌行锚点（10-31 用户：「右上角跟他这样紧凑一点，注意 mac 适配」）─
     ① 预留区 145→**132**：Windows 原生三钮 46×3=138，顶栏自身还有 6px 外圈 margin ⇒
        要贴住必须 138−6；② 图标盒 32→**28**（只限 .topbar）、簇间 gap 2→**0**；
     ③ mac 品牌行 margin-top 32→**38**：顶栏首行已从 44 改 50（6 外圈 + 44 本体），
        12(侧栏 padding-top) + 38 = 50 才与顶栏底边齐平 —— 锚在 32 会高 6px。 */
  const threadsCss = codeOnly(read("src/styles/02-sidebar-threads.css"));
  ok(/\.topbar \{[\s\S]{0,700}?padding-right: 132px/.test(threadsCss),
    "⑪ 顶栏右侧预留 = 132px（138 原生钮 − 6 外圈）：图标簇右缘正好贴住窗口钮");
  ok(/\.topbar-actions \{[\s\S]{0,200}?gap: 0;/.test(threadsCss),
    "⑪ 操作簇 gap = 0（盒内已有内边距，再叠 2px 显散）");
  ok(/\.topbar \.icon-button \{[\s\S]{0,120}?width: 28px;[\s\S]{0,60}?height: 28px;/.test(threadsCss),
    "⑪ 顶栏图标盒 28px（⛔ 只限 .topbar：32 是别的面板口径）");
  ok(/\[data-os=\"darwin\"\] \.sidebar \.brand-row \{[\s\S]{0,320}?margin-top: 38px/.test(threadsCss)
    && !/\[data-os=\"darwin\"\] \.sidebar \.brand-row \{[^}]*margin-top: 32px/.test(threadsCss),
    "⑪ mac 品牌行锚点 = 38（12+38=50 = 顶栏底边；⛔ 不许退回 32，那会让品牌行高 6px）");
  ok(/\[data-os=\"darwin\"\] \.topbar \{[\s\S]{0,160}?padding-right: 16px/.test(threadsCss),
    "⑪ mac 顶栏把 132 的窗口钮预留全部还回去（红绿灯在左上，右侧不留区）");


  /* ⛔ 10-31 改为「只有一个 owner 画这条线」：用户两次反馈「还是这么粗」，实测剖面证明粗的不是
     1px 本身，而是 ①主区右边 6px `--panel` 底色带 ②scaleX(.5) 在 dpr=1 下被抗锯齿摊成两个像素
     ③面板自己的 border-left —— 三份叠加。现在只留分隔线一条实心 1px（与左侧同宽同色）。 */
  ok(/\.app-shell\.with-context > \.panel-divider::after \{[\s\S]{0,220}?width: 1px;[\s\S]{0,120}?background: var\(--line-soft\)/.test(shellCss)
    && !/scaleX\(0\.5\)/.test(shellCss),
    "右栏与主区之间只有分隔线一条实心 1px 灰线（⛔ 半像素、面板左边框、6px 底色带都已去掉）");
  /* ★ 系统窗口钮对齐：原生 overlay 高度 55 ⇒ 钮中心 27.5 ≈ 顶栏 6+44/2=28。 */
  const windowFactorySrc = read("electron/features/window-factory.ts");
  ok(/titleBarOverlay: \{ color: "#00000000", symbolColor: titleBarOverlayOptions\(\)\.symbolColor, height: 55 \}/.test(windowFactorySrc)
    && /titleBarOverlay: \{[\s\S]{0,120}?height: 55,/.test(windowFactorySrc),
    "主窗口/独立窗口的 titleBarOverlay 高度 55（与顶栏下移 6px 后同一行）");
}
console.log(`\n【newbie-guide】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
