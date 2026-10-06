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
  const guideAt = shell.indexOf("<NewbieGuide");
  const accountAt = shell.indexOf('className="account-row"');
  ok(listAt >= 0 && guideAt > listAt && accountAt > guideAt,
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

/* ── 三、注册表：三个设置页映射 + 日志置底 + 拓展接口头注 ──────────────────── */
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

console.log(`\n【newbie-guide】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
