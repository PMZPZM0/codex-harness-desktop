/**
 * 12bs-design-md —— 「设计参考」库（VoltAgent/awesome-design-md）全链路守卫（11-15）。
 *
 * 用户令「看看这个开源项目，看看我们怎么用起来」⇒ 随包 84 份 DESIGN.md + Codex 工具 + 设置页。
 * 钉住：
 *   ① 随包数据是真的（84 份 / 10 类 / MIT / 正文非空），许可是 MIT、上游可追溯；
 *   ② 同步脚本走整包 tarball + 镜像序（⛔ 不逐个打 GitHub API，配额一次就耗光）；
 *   ③ IPC 三通道：slug 白名单、导出只写 design-references/<slug>.md（⛔ 不覆盖项目 DESIGN.md）；
 *   ④ 工具 design_md（schema + 执行端 + 网关描述 + 常驻指令）；
 *   ⑤ 内置技能 design-md-library（注册 + 中文导读）；
 *   ⑥ 设置页五处注册齐全（类型 / 导航 / 页面表 / 扩展页白名单 / 帮助总览）；
 *   ⑦ 合规：第三方声明 + 只作风格参考（不复制 logo / 商标）。
 *
 * ⛔ 独立守卫（不进 _ctx MODULES 计数），必须同时加进 package.json 的 check 链。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log(`  ${c ? "✓" : "✗"} 【design-md】${m}`); if (!c) fails++; };
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const codeOnly = (s) => String(s)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const LIB = "resources/design-md/library.json";
const DOMAIN = "electron/features/design-md-ipc.ts";
const DATA = "electron/design-md-library.ts";
const TOOL = "electron/features/dispatch-core.ts";
const RPC = "electron/features/dispatch-rpc.ts";
const SKILL = "electron/builtin-skills/32-skill-design-md.ts";
const PAGE = "src/features/design-library/DesignLibrary.tsx";

/* ── ① 随包数据 ─────────────────────────────────────────────── */
{
  ok(existsSync(join(ROOT, LIB)), "随包库文件存在（resources/design-md/library.json）");
  ok(existsSync(join(ROOT, "resources/design-md/LICENSE")), "上游 MIT 许可原文随包（resources/design-md/LICENSE）");
  if (existsSync(join(ROOT, LIB))) {
    const lib = JSON.parse(read(LIB));
    ok(lib.source === "VoltAgent/awesome-design-md" && String(lib.home || "").includes("github.com/VoltAgent/awesome-design-md"),
      "来源锚定 VoltAgent/awesome-design-md（可追溯）");
    ok(lib.license === "MIT", "许可 = MIT（⛔ 非 MIT 不许内置）");
    ok(Array.isArray(lib.items) && lib.items.length >= 80, `DESIGN.md 数量 ${lib.items?.length ?? 0}（应 ≥ 80，上游 README 宣称 84）`);
    ok(Array.isArray(lib.categories) && lib.categories.length >= 8, `分类 ${lib.categories?.length ?? 0} 组（应 ≥ 8）`);
    const bad = (lib.items ?? []).filter((it) => !it.slug || !it.designMd || String(it.designMd).length < 1500);
    ok(bad.length === 0, `每份都有 slug + 正文（异常 ${bad.length} 条：${bad.slice(0, 3).map((b) => b.slug).join(", ")}）`);
    /* 上游 84 份里 10 份是「# Design System Inspired by X」正文式（没有 YAML 头），
       其余 74 份是 Stitch 的 `---` tokens 格式 —— 两种都要收，断言只看「格式可识别 + 以标题开头」。 */
    const trimmed = (lib.items ?? []).map((it) => String(it.designMd).trimStart());
    const yamlCount = trimmed.filter((text) => text.startsWith("---")).length;
    const headingCount = trimmed.filter((text) => /^#\s+/.test(text)).length;
    ok(yamlCount + headingCount === trimmed.length && yamlCount >= 60,
      `每份都以 YAML tokens 或 Markdown 标题开头（YAML ${yamlCount} 份 / 正文式 ${headingCount} 份）`);
    const catKeys = new Set((lib.categories ?? []).map((c) => c.key));
    ok((lib.items ?? []).every((it) => catKeys.has(it.category)), "每条 item 的分类都在 categories 表里（不会出现孤儿分类）");
    const slack = (lib.items ?? []).find((it) => it.slug === "slack");
    ok(Boolean(slack), "README 漏列的 slack 已用 EXTRA 补齐（84 份完整）");
    const noZh = (lib.items ?? []).filter((it) => !String(it.zh ?? "").trim());
    ok(noZh.length === 0, `每份都有中文导读（展示用；缺 ${noZh.length} 条：${noZh.slice(0, 3).map((it) => it.slug).join(", ")}）`);
  }
}

/* ── ② 同步脚本 ─────────────────────────────────────────────── */
{
  const sync = codeOnly(read("scripts/sync-design-md.mjs"));
  ok(/codeload\.github\.com\/\$\{REPO\}\/tar\.gz/.test(sync), "同步脚本走整包 tarball（⛔ 不逐个打 GitHub API —— 匿名配额 60 次/小时）");
  ok(/gh-proxy\.com/.test(sync) && /ghfast\.top/.test(sync), "下载镜像序含 gh-proxy → ghfast → 直连");
  ok(/MIT License/i.test(sync) && /designMd: readFileSync/.test(sync), "脚本校验上游 MIT 并逐字收正文");
  ok(/EXTRA[\s\S]{0,300}?slug: "slack"/.test(sync), "README 漏列目录有 EXTRA 兜底（slack）");
}

/* ── ③ 主进程数据端 + IPC 三通道 ─────────────────────────────── */
{
  const data = codeOnly(read(DATA));
  ok(/process\.resourcesPath/.test(data) === false && /"resources", "design-md"/.test(data),
    "库路径 = app.asar 内 resources/design-md/library.json（dev/打包同一相对路径）");
  ok(/\^\[a-z0-9\]\[a-z0-9\.-\]\{0,63\}\$/.test(data), "slug 白名单（小写 + 数字 + . / -）—— ⛔ 防路径穿越");
  ok(/export function designMdList/.test(data) && /export function designMdGet/.test(data),
    "list / get 两个导出（设置页与工具共用同一份实现）");

  const dom = codeOnly(read(DOMAIN));
  ok(/\bdesign-md:list\b/.test(dom) && /\bdesign-md:get\b/.test(dom) && /\bdesign-md:export\b/.test(dom),
    "域文件注册 list / get / export 三通道");
  ok(/path\.join\(dir, "design-references"\)/.test(dom) && /`\$\{doc\.slug\}\.md`/.test(dom),
    "导出落点 = <项目>/design-references/<slug>.md（⛔ 不覆盖项目根 DESIGN.md）");
  ok(/!path\.isAbsolute\(dir\)/.test(dom) && /isDesignMdSlug\(slug\)/.test(dom),
    "导出前置校验：目录必须绝对路径 + slug 白名单");
  ok(/ctx\.effect\(\(\) => \{[\s\S]{0,160}?removeHandler/.test(dom), "卸载时摘 handler（组合层可逆副作用）");
}

/* ── ④ 通道三处一致 + 组合表 ────────────────────────────────── */
{
  const manifest = read("electron/ipc-channels.manifest.json");
  ok(/"channel": "design-md:list"/.test(manifest) && /"channel": "design-md:get"/.test(manifest) && /"channel": "design-md:export"/.test(manifest),
    "manifest 三条通道齐全（单一真相源）");
  const registry = read("electron/ipc-registry.ts");
  ok(/\{ prefix: "design-md", count: 3, status: "in-features", file: "features\/design-md-ipc\.ts"/.test(registry),
    "registry 记账（prefix design-md / 3 通道 / in-features）");
  ok(/channels: \["design-md:list", "design-md:get", "design-md:export"\]/.test(registry), "registry 通道清单完整");
  const composition = read("electron/composition.json");
  ok(/"id": "design-md"[\s\S]{0,120}?"enabled": true/.test(composition), "组合表启用 design-md 域");
  const gen = read("electron/composition.gen.ts");
  ok(/feat_design_md/.test(gen), "组合生成物已包含 design-md 域（重跑过 gen:domains）");
  const preload = read("electron/preload.ts");
  ok(/designMdList:/.test(preload) && /designMdGet:/.test(preload) && /designMdExport:/.test(preload),
    "preload 桥已生成三个方法（重跑过 gen:ipc）");
}

/* ── ⑤ 工具 design_md ──────────────────────────────────────── */
{
  const tool = codeOnly(read(TOOL));
  ok(/name: "design_md"/.test(tool), "dispatch-core 注册 design_md");
  const block = tool.slice(tool.indexOf('name: "design_md"'), tool.indexOf('name: "design_md"') + 2600);
  ok(/enum: \["list", "search", "get"\]/.test(block), "工具动作 = list / search / get");
  ok(/不复制品牌 logo \/ 商标/.test(block), "工具描述写明合规边界（只作风格参考）");
  ok(/linear\.app/.test(block) && /vercel/.test(block), "工具描述给代表 slug（模型不乱编）");
  const rpc = codeOnly(read(RPC));
  ok(/if \(name === "design_md"\)/.test(rpc) && /designMdGet\(/.test(rpc) && /designMdList\(/.test(rpc),
    "执行端接通 designMdGet / designMdList");
  ok(/action=search/.test(rpc), "查不到时给下一步指引（先 search 找 slug）");
  const gateway = read("src/features/app-state/parts/part08/01-seg.tsx");
  ok(/design_md（品牌设计语言参考库/.test(gateway), "harness_tools 网关描述点名 design_md（工具不在描述里 = 模型不知道）");
  const dev = read("electron/developer-instructions.ts");
  ok(/DESIGN_MD_INSTRUCTIONS/.test(dev) && /text \+= DESIGN_MD_INSTRUCTIONS;/.test(dev),
    "常驻指令第 20 条已接线（append 语句在位）");
  ok(/\\n20\) DESIGN LANGUAGE REFERENCES/.test(dev), "第 20 条编号与正文共存");
}

/* ── ⑥ 内置技能 ─────────────────────────────────────────────── */
{
  ok(existsSync(join(ROOT, SKILL)), "技能文件 electron/builtin-skills/32-skill-design-md.ts 存在");
  const skill = read(SKILL);
  ok(/name: design-md-library/.test(skill), "技能名前缀正确（design-md-library）");
  ok(/design_md/.test(skill) && /design-references/.test(skill), "技能正文讲清工具用法与导出落点");
  ok(/不复制 logo、商标/.test(skill), "技能写明合规边界");
  const registry = read("electron/builtin-skills.ts");
  ok(/\bDESIGN_MD_SKILL\b/.test(registry) && /\["design-md-library", DESIGN_MD_SKILL\]/.test(registry),
    "builtin-skills 登记 design-md-library（与中文导读 keys 对应）");
  const zh = read("electron/builtin-skills/00-skill-zh-notes.ts");
  ok(/"design-md-library": `# 设计参考库/.test(zh), "中文导读已补（守卫【229】两边 keys 对应）");
}

/* ── ⑦ 设置页五处注册 ──────────────────────────────────────── */
{
  ok(/"design-library"/.test(read("src/features/app-view/types.ts")), "SettingsPage 类型含 design-library");
  ok(/\["design-library", "设计参考", Palette/.test(read("src/features/app-view/helpers/catalogs.ts")),
    "设置导航含 [design-library, 设计参考]（否则用户进不去）");
  /* 设置页注册表在三仓里可能是拆页后的 pages/capabilities.tsx（主仓），也可能是老的
     00-settings-registry.tsx（PPcode / 云助手）—— 两种都认，断言只钉「条目在 + 接线对」。 */
  const REGISTRY_CANDIDATES = [
    "src/features/app-view/AppView/08-settings-sheet/01-settings-layout/pages/capabilities.tsx",
    "src/features/app-view/AppView/08-settings-sheet/01-settings-layout/00-settings-registry.tsx",
  ];
  const registryFile = REGISTRY_CANDIDATES.find((file) => existsSync(join(ROOT, file))) ?? REGISTRY_CANDIDATES[0];
  const registrySrc = read(registryFile);
  ok(/"design-library": \{ render:/.test(registrySrc),
    "设置页注册表有 design-library 的 render 条目（缺了【101】会红）");
  ok(/"design-library"/.test(read("electron/features/extensions-ipc.ts")), "拓展接口白名单含 design-library");
  ok(/page: "设计参考"/.test(read("src/components/HelpDialog.tsx")), "帮助总览含「设计参考」（缺了【32】会红）");
  const page = codeOnly(read(PAGE));
  ok(/designMdList/.test(page) && /designMdGet/.test(page) && /designMdExport/.test(page),
    "页面走 design-md 三通道（不自己读文件）");
  ok(/comp-lib-cat-filter/.test(page) && /<AppSelect/.test(page) && /value=\{cat\}/.test(page),
    "筛选 = 搜索框 + 分类下拉（用户 11-15 令：分类做成下拉，不铺一排 tab）");
  ok(/item\.zh/.test(page) && /design-lib-zh-line/.test(page) && /英文原文 DESIGN.md/.test(page),
    "展示用中文导读（卡片 + 详情），并写明复制/导出仍是英文原文");
  ok(/chooseDirectory/.test(page) && /design-lib-export-select/.test(page) && /exportDir/.test(page),
    "导出目标可选：项目下拉 + 自选目录（dialog:directory）");
  ok(/projectGroups\.map\(\(\[path\]\) => path\)/.test(registrySrc),
    "设置注册表把侧栏项目列表传给页面（projects prop）");
  ok(/onHandoff/.test(page) && /onCloseSettings/.test(page), "「交给 Codex」= 填进输入框（onHandoff）+ 先关设置");
  ok(/setPrompt\(text\)/.test(registrySrc),
    "交给 Codex 的接线走 bag.setPrompt（⛔ 不自动发送 —— 避免误触发一轮）");
  ok(/不要复制品牌 logo、商标/.test(page), "页面文案写明合规边界");
  ok(!/\.innerHTML\s*=/.test(page), "⛔ 预览用 Markdown 组件渲染，不碰 innerHTML");
}

/* ── ⑧ 打包 + 合规声明 ──────────────────────────────────────── */
{
  const pkg = JSON.parse(read("package.json"));
  ok((pkg.build?.files ?? []).includes("resources/design-md/**"),
    "package.json build.files 带上 resources/design-md/**（漏了 = 装进 asar 时读不到库）");
  const notices = read("THIRD_PARTY_NOTICES.md");
  ok(/awesome-design-md/.test(notices) && /VoltAgent/.test(notices) && /MIT/.test(notices),
    "THIRD_PARTY_NOTICES 登记上游与 MIT 许可");
  ok(/仅作风格参考/.test(notices) && /logo \/ 商标/.test(notices), "第三方声明写明只作风格参考 / 不复制品牌资产");
}

/* ── ⑨ 预览拆 tokens（纯函数真值表） ───────────────────────── */
{
  const { splitDesignMd, groupColors, tokenLabelZh, summarizeTokens } = await import(new URL("../../src/lib/design-md-preview.mjs", import.meta.url).href);
  const sample = "---\nversion: alpha\ncolors:\n  primary: \"#5e6ad2\"\n  ink: '#111111'\n---\n## Overview\nBody text";
  const parsed = splitDesignMd(sample);
  ok(parsed.tokens.includes("version: alpha") && parsed.body.startsWith("## Overview"),
    "YAML 头与正文拆开（正文不再把 tokens 当正文摊出来）");
  ok(parsed.colors.some((c) => c.hex === "#5e6ad2") && parsed.colors.some((c) => c.hex === "#111111"),
    "色板提取（双引号 / 单引号两种写法）");
  const plain = splitDesignMd("# Design System Inspired by X\n\n## Section");
  ok(plain.tokens === "" && plain.body.startsWith("# Design"), "没有 YAML 头的正文式文档原样当正文");
  const grouped = groupColors([
    { name: "primary", hex: "#5e6ad2" },
    { name: "canvas", hex: "#010102" },
    { name: "ink", hex: "#f7f8f8" },
    { name: "hairline", hex: "#23252a" },
    { name: "semantic-success", hex: "#27a644" },
  ]);
  ok(grouped.map((g) => g.key).join(",") === "accent,bg,text,line,state",
    `色板按用途分组且顺序稳定（${grouped.map((g) => g.key).join(",")}）`);
  ok(tokenLabelZh("primary") === "主色" && tokenLabelZh("canvas") === "页面底色" && tokenLabelZh("whatever") === "whatever",
    "token 中文名映射（未知 key 原样保留）");
  ok(grouped.every((g) => g.items.every((item) => Boolean(item.label))),
    "分组里的色块都带中文名（未知 token 保留英文）");
  const page = codeOnly(read(PAGE));
  ok(/splitDesignMd/.test(page) && /groupColors/.test(page) && /design-lib-swatches/.test(page),
    "预览页用纯函数拆 tokens（分组色板 + YAML 折叠块 + Markdown 正文）");

  /* 中文导读的信息量：字体 / 字号层级 / 圆角 / 间距 / 组件样式都由 tokens 生成（用户 11-15：
     「为啥中文这么少，英文这么多」—— 一句话 + 色板不够，要把 tokens 里的规则翻成中文列出）。 */
  const rich = [
    "colors:",
    "  primary: \"#5e6ad2\"",
    "  ink: \"#111111\"",
    "typography:",
    "  display-lg:",
    "    fontFamily: Linear Display",
    "    fontSize: 56px",
    "    fontWeight: 600",
    "  body:",
    "    fontFamily: Linear Text",
    "    fontSize: 16px",
    "rounded:",
    "  md: 8px",
    "spacing:",
    "  s: 8px",
    "components:",
    "  button-primary:",
    "    backgroundColor: \"{colors.primary}\"",
    "    textColor: \"{colors.ink}\"",
    "    rounded: \"{rounded.md}\"",
    "    padding: 8px 14px",
    "  button-hover:",
    "    backgroundColor: \"{colors.primary}\"",
  ].join("\n");
  const summary = summarizeTokens(rich, { maxComponents: 1 });
  ok(summary.fonts.length === 2 && summary.typeScale.some((row) => row.label === "正文") && summary.typeScale.some((row) => row.label === "展示标题"),
    "字体家族 + 字号层级（中文用途名）");
  ok(summary.rounded.some((row) => row.label === "中" && row.value === "8px") && summary.spacing.some((row) => row.value === "8px"),
    "圆角 / 间距中文名与取值");
  const buttonGroup = summary.components.find((group) => group.group === "button");
  ok(Boolean(buttonGroup) && buttonGroup.label === "按钮"
    && buttonGroup.items[0].background === "主色 #5e6ad2"
    && buttonGroup.items[0].text === "正文文字 #111111"
    && buttonGroup.items[0].rounded === "中 8px"
    && buttonGroup.items[0].label === "按钮 · 主要",
    "组件样式：token 引用解析成真实色值 + 中文变体名（主要 / 悬停 / …）");
  ok(summary.hiddenComponents === 1, "组件超出上限时给出「还有 N 个」计数（不静默丢）");
  /* 上游部分文件在色值行尾写注释（`primary: "#0070d5"  # DJI Blue — …`）——
     不剥注释会整条丢色，色板缺一整块（实测 dji / nintendo-2001）。 */
  const commented = splitDesignMd("---\ncolors:\n  primary: \"#0070d5\"  # DJI Blue — store pill\n  ink: \"#111111\" # text\n---\nbody");
  ok(commented.colors.length === 2 && commented.colors[0].hex === "#0070d5" && commented.colors[1].hex === "#111111",
    "色值行尾注释不影响解析（quoted + trailing # comment）");
  const commentedSummary = summarizeTokens("colors:\n  primary: \"#0070d5\"  # DJI Blue\ncomponents:\n  button-primary:\n    backgroundColor: \"{colors.primary}\"\n");
  ok(commentedSummary.components[0].items[0].background === "主色 #0070d5",
    "组件底色解析也会剥掉行尾注释（不会把注释带进中文导读）");
  ok(/summarizeTokens/.test(page) && /design-lib-scale/.test(page) && /design-lib-components/.test(page),
    "中文导读页签渲染字号层级表与组件样式（⛔ 不再只有一句话 + 色板）");
}

console.log(`\n【design-md】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
