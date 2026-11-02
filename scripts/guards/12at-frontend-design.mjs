/**
 * 12at-frontend-design —— 前端设计方法「单一真相源 → 内置技能 → 常驻指令」链路（11-03 立）
 *
 * 用户原话：「把你的前端设计思路做成 design.md，放项目里，内置，供 codex 参考使用」。
 * 链路有三段，断任何一段都等于没做：
 *   ① 正文 = 根目录 DESIGN.md 的 DESIGN-METHOD 标记区（人和 agent 都读得到）；
 *   ② 内置 = scripts/gen-design-skill.mjs 把同一段生成为 electron/builtin-skills/27-*；
 *   ③ 可达 = builtin-skills 落盘 + # 面板保底 + developer_instructions 指路。
 *
 * ⛔ 本守卫不跑应用；它只证明「文档 / 生成物 / 注册 / 指令」四处没有漂移。
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./_ctx.mjs";
import { buildDesignSkill } from "../../scripts/gen-design-skill.mjs";

let checks = 0;
let fails = 0;
const ok = (cond, msg) => {
  checks++;
  console.log(`  ${cond ? "✓" : "✗"} 【design】${msg}`);
  if (!cond) fails++;
};
const read = (p) => readFileSync(join(ROOT, p), "utf8");

console.log("\n【design】前端设计方法：DESIGN.md → 内置技能 → 常驻指令");

/* ── ① DESIGN.md 正文 ─────────────────────────────────────────────── */
const md = read("DESIGN.md");
ok(md.includes("<!-- DESIGN-METHOD:BEGIN -->") && md.includes("<!-- DESIGN-METHOD:END -->"),
  "DESIGN.md 有 DESIGN-METHOD 标记区（生成器的唯一输入）");
const method = md.slice(md.indexOf("<!-- DESIGN-METHOD:BEGIN -->"), md.indexOf("<!-- DESIGN-METHOD:END -->"));
ok(method.includes("前端设计方法") && method.includes("层级 → 布局 → 状态 → 细节"),
  "方法章节存在且写明设计顺序");
ok(["先读懂，再动手", "单一主色", "baseline", "空 / 载 / 错", "反模式", "交付前验证"].every((k) => method.includes(k)),
  "方法章节含核心内容（先读懂 / 单一主色 / 基线对齐 / 状态齐全 / 验证清单 / 反模式）");

/* 文档真值对账：办公室章节曾长期写「现行 = 3D 场景、像素/office-sim/drawScreen 已删除」，
   而代码一直是像素 v19（office-sim.ts + drawScreen 都在）⇒ 文档主动误导下一轮。 */
const simFile = join(ROOT, "src", "features", "team-office", "office-sim.ts");
const hasSim = existsSync(simFile);
ok(!md.includes("现行 = 交互式 3D 场景"), "DESIGN.md 不再把 3D 场景写成现行（代码是像素 v19）");
ok(!md.includes("走位模拟（office-sim）/ 逐帧屏渲染（drawScreen/屏保）已整体删除") || !hasSim,
  "DESIGN.md 与代码一致：office-sim 仍在时不许写「已整体删除」");
ok((md.includes("像素卡通办公室 v19") || md.includes("v19 像素版")) && md.includes("office-inspector"),
  "办公室章节记录了现行像素 v19 与 11-02 悬停放大屏");

/* ── ② 生成物新鲜度 ───────────────────────────────────────────────── */
const generatedPath = "electron/builtin-skills/27-skill-frontend-design.ts";
let fresh = false;
let buildError = "";
try {
  fresh = read(generatedPath).replace(/\r\n/g, "\n") === buildDesignSkill();
} catch (error) {
  buildError = error?.message ?? String(error);
}
ok(fresh, "内置技能是 DESIGN.md 标记区的逐字生成物（过期就跑 node scripts/gen-design-skill.mjs）"
  + (buildError ? `：${buildError}` : ""));
const gen = read(generatedPath).replace(/\r\n/g, "\n");
ok(gen.includes("---\nname: frontend-design\ndescription: "),
  "生成物含合法 frontmatter（name + 一行 description，否则引擎技能表里不出现）");
ok(gen.includes("先读懂，再动手") && gen.includes("单一主色"),
  "生成物正文与 DESIGN.md 方法一致（不是只搬了标题）");

/* ── ③ 注册与可达性 ───────────────────────────────────────────────── */
const reg = read("electron/builtin-skills.ts");
ok(reg.includes('from "./builtin-skills/27-skill-frontend-design"')
  && reg.includes('["frontend-design", FRONTEND_DESIGN_SKILL]'),
  "frontend-design 注册进 ensureBuiltinSkills entries（不注册 = 永远不落盘）");
ok(read("electron/builtin-skills/00-skill-zh-notes.ts").includes('"frontend-design":'),
  "中文导读补了 frontend-design（守卫【229】要求 entries 与导读一一对应）");
ok(read("src/features/app-view/constants/01-notices-labels.tsx").includes('"frontend-design"'),
  "# 面板保底名单登记（否则引擎重扫前用户看不到它）");

const instr = read("electron/developer-instructions.ts");
ok(instr.includes("const FRONTEND_DESIGN_INSTRUCTIONS =")
  && /text \+= FRONTEND_DESIGN_INSTRUCTIONS;/.test(instr),
  "常驻指令块存在且真的拼进 developer_instructions（常量在、接线不在 = 白写）");
const instrBlock = instr.slice(
  instr.indexOf("const FRONTEND_DESIGN_INSTRUCTIONS ="),
  instr.indexOf("/* ── 第 14 条"),
);
ok(instrBlock.includes("frontend-design") && instrBlock.includes("DESIGN.md"),
  "指令块同时点名内置技能与方法来源 DESIGN.md（技能没读 = 没生效）");
ok(instrBlock.includes("render it") && instrBlock.includes("empty/loading/error"),
  "指令块要求真渲染验证 + 状态齐全（不是只读代码就交付）");
ok(read("package.json").includes("node scripts/gen-design-skill.mjs"),
  "生成器接进 npm run gen:ipc（改 DESIGN.md 后重跑会带上它）");

/* ── ④ 设置 → 个性化：前端设计风格 + 自定义内容（11-03 用户追加）──────────
   ⛔ 这条链断在任何一处都表现成「选了没生效」：界面预设表 / 主进程归一 / 写 AGENTS.md /
      预览校验。四段都在才算通。 */
const styleLib = read("src/lib/frontend-design-style.mjs");
ok(styleLib.includes("FRONTEND_DESIGN_STYLES") && styleLib.includes('DEFAULT_FRONTEND_DESIGN_STYLE = "auto"')
  && styleLib.includes("export function normalizeFrontendDesignStyle")
  && styleLib.includes("export function frontendDesignPrompt")
  && styleLib.includes("enabled === false"),
  "共享预设表存在（主进程与渲染层同一份 id，未知值回落跟随项目；支持关闭）");
ok(styleLib.includes('id: "apple"') && styleLib.includes('id: "tech"') && styleLib.includes('id: "swiss"')
  && styleLib.includes('id: "glass"') && styleLib.includes('id: "material"')
  && styleLib.includes("prompt:") && styleLib.includes("swatches:"),
  "内置风格库含苹果 / 科技 / 瑞士 / 玻璃 / Material 等提示词与色板（随应用更新）");
ok(styleLib.includes("refs:") && styleLib.includes("FRONTEND_REFERENCE_SYSTEMS")
  && styleLib.includes("Ant Design") && styleLib.includes("Arco Design") && styleLib.includes("TDesign")
  && styleLib.includes("Semi Design") && styleLib.includes("Vant") && styleLib.includes("NutUI"),
  "每套风格带参考设计系统地址 + 国内设计系统清单（Ant / Arco / TDesign / Semi / Vant / NutUI…）");
ok(styleLib.includes("spec:") && styleLib.includes("设计规范（苹果风）") && styleLib.includes("设计规范（科技风）")
  && styleLib.includes("materials:") && styleLib.includes("Reference materials"),
  "每套风格有一套设计规范（色彩/字体/布局/组件/动效）+ 参考素材（随应用更新）");
ok(styleLib.includes("Design specification") && styleLib.includes("Reference design docs")
  && styleLib.includes("Reference materials") && styleLib.includes("read their specs"),
  "注入提示词同时带设计规范、参考文档与参考素材地址（不只给一句方向）");
ok(styleLib.includes("ui_component_search") && styleLib.includes("ui_component_get"),
  "风格提示词联动内置组件库（实现前先搜 Uiverse，再按风格改造）");
ok(/preset\?\.prompt/.test(styleLib),
  "frontendDesignPrompt 真的使用预设提示词（只登记不注入 = 白写）");
ok(read("src/lib/frontend-design-style.d.mts").includes("FRONTEND_DESIGN_STYLES"),
  "共享预设表有类型声明（tsc 能检查界面消费点）");

const personalSrc = read("electron/personalization.ts");
ok(personalSrc.includes("frontendDesignStyle?: string") && personalSrc.includes("frontendDesignNotes?: string")
  && /frontendDesignPrompt\([\s\S]{0,120}personalization\.frontendDesignStyle/.test(personalSrc)
  && /normalizeFrontendDesignStyle\(/.test(personalSrc),
  "主进程档案含两个字段，且写入 AGENTS.md 时真的调用 frontendDesignPrompt");

const pipc = read("electron/features/personalization-ipc.ts");
ok(pipc.includes("frontendDesignPrompt(stored.frontendDesignStyle")
  && pipc.includes("frontendDesignNotes?: unknown"),
  "personalization:save 接收新字段；verify 的 expects 把前端风格也算作已配置");

const page = read("src/components/PersonalizationPage.tsx");
ok(page.includes("card-frontend-design") && page.includes("FRONTEND_DESIGN_STYLES.map")
  && page.includes('aria-label="前端设计风格"') && page.includes('aria-label="前端设计自定义内容"')
  && page.includes("frontend-style-chips") && page.includes("data-style-id"),
  "个性化页渲染前端设计风格库（9 套胶囊 + 色板 + 自定义内容输入）");
ok(page.includes("frontend-style-prompt") && page.includes("frontend-style-library")
  && page.includes("onOpenComponentLibrary") && page.includes("frontendDesignPrompt(frontendStyle, frontendNotes)"),
  "风格卡可查看真实注入的提示词，并联动打开内置组件库");
ok(page.includes("frontend-style-refs") && page.includes("FRONTEND_REFERENCE_SYSTEMS.map")
  && page.includes("window.codex.openExternal") && page.includes("frontend-style-spec")
  && page.includes("frontend-style-materials") && page.includes("selectedFrontendStyle.materials.map"),
  "风格卡显示设计规范、参考文档、参考素材与国内设计系统清单，链接走系统浏览器打开");
const setWiringPath = "src/features/app-view/AppView/08-settings-sheet/01-settings-layout/pages/appearance.tsx";
const registryWiringPath = "src/features/app-view/AppView/08-settings-sheet/01-settings-layout/00-settings-registry.tsx";
const wiringSrc = read(existsSync(join(ROOT, setWiringPath)) ? setWiringPath : registryWiringPath);
ok(wiringSrc.includes("onOpenComponentLibrary") && wiringSrc.includes('"component-library"'),
  "组件库入口真的接到设置页导航（只写 prop 不接线 = 点了没反应）");
ok(/frontendDesignStyle:\s*frontendStyle/.test(page) && /frontendDesignNotes:\s*frontendNotes\.trim\(\)/.test(page),
  "保存时把预设与自定义内容一起提交（只存不传 = 白填）");
ok(/const dirty[\s\S]*frontendNotes\.trim\(\)/.test(page),
  "dirty 判定包含前端风格内容（否则改了按钮仍是灰的）");

const manifest = read("electron/ipc-channels.manifest.json");
ok(/paramsImpl[^\n]*frontendDesignStyle[^\n]*frontendDesignNotes/.test(manifest)
  && /paramsDecl[^\n]*frontendDesignStyle[^\n]*frontendDesignNotes/.test(manifest),
  "manifest 的 paramsImpl/paramsDecl 含新字段（生成物才会带上类型）");
ok(read("src/styles/12-settings-skills.css").includes(".personalization-frontend-notes"),
  "前端设计自定义内容的样式在位（输入区高度与其它输入区分档）");

/* ── ⑤ 软件开发规范 / 应用架构规范（11-03 用户追加）+ 联动专家 ───────────
   ⛔ 只写进 AGENTS.md 不够：用户点名「记得这个联动专家」⇒ 派发专家 / 团 / 成员时
      角色提示词也必须带上同一份规范（AGENTS.md 与角色提示词两条路都要通）。 */
const engineeringLib = read("src/lib/engineering-norms.mjs");
ok(engineeringLib.includes("SOFTWARE_DEV_NORMS") && engineeringLib.includes("APP_ARCHITECTURE_NORMS")
  && engineeringLib.includes("personalNormsPrompt")
  && engineeringLib.includes("务实稳健") && engineeringLib.includes("分层单体")
  && engineeringLib.includes("阿里巴巴 Java 开发手册") && engineeringLib.includes("凤凰架构"),
  "软件开发 / 应用架构规范库存在（预设 + 规范全文 + 国内参考文档）");
ok(engineeringLib.includes("backend / server-side code") && engineeringLib.includes("frontend UI only")
  && engineeringLib.includes("not visual design") && engineeringLib.includes("enabled === false"),
  "规范适用范围写清：前端设计只给 UI，软件开发按后端，架构按后端 / 全栈；且支持关闭");
ok(read("src/lib/engineering-norms.d.mts").includes("EngineeringNormPreset")
  && read("src/lib/engineering-norms.d.mts").includes("personalNormsPrompt"),
  "工程规范库有类型声明（tsc 能检查设置页消费点）");

const personalNormSrc = read("electron/personalization.ts");
ok(personalNormSrc.includes("softwareDevStyle?: string") && personalNormSrc.includes("appArchitectureStyle?: string")
  && personalNormSrc.includes("frontendDesignEnabled?: boolean") && personalNormSrc.includes("softwareDevEnabled?: boolean")
  && personalNormSrc.includes("appArchitectureEnabled?: boolean")
  && /engineeringNormsPrompt\(personalization\)/.test(personalNormSrc)
  && personalNormSrc.includes("Frontend design direction (frontend UI only")
  && personalNormSrc.includes("Backend engineering norms")
  && personalNormSrc.includes("normalizeSoftwareDevNorm") && personalNormSrc.includes("normalizeAppArchitectureNorm"),
  "个性化档案含两套规范字段与三个开关，AGENTS.md 分区写清前端 / 后端适用范围");

const delegationNormSrc = read("electron/features/delegation.ts");
ok(delegationNormSrc.includes("personalNormsPrompt")
  && /rolePrompt = .*User norms/.test(delegationNormSrc)
  && /target\.kind !== "cli"/.test(delegationNormSrc),
  "派发专家 / 团 / 成员 / 子智能体时，角色提示词追加前端设计 + 后端规范（联动专家）");
const teamsNormSrc = read("electron/features/teams-ipc.ts");
ok(teamsNormSrc.includes("personalNormsBlock") && teamsNormSrc.includes("withPersonalNorms")
  && (teamsNormSrc.match(/withPersonalNorms\(/g) || []).length >= 4,
  "专家团开团 / 成员会话 / 会话配置都带完整规范");
ok(read("electron/team-invoke.ts").includes("personalNormsPrompt")
  && /User norms/.test(read("electron/team-invoke.ts")),
  "主理人调用成员（team_member_invoke）也带完整规范");

const pageNorm = read("src/components/PersonalizationPage.tsx");
ok(pageNorm.includes("NormCard") && pageNorm.includes("SOFTWARE_DEV_NORMS") && pageNorm.includes("APP_ARCHITECTURE_NORMS")
  && pageNorm.includes("data-norm-card={cardId}") && pageNorm.includes('cardId="software-dev"')
  && pageNorm.includes('cardId="app-architecture"')
  && pageNorm.includes("软件开发规范（后端）") && pageNorm.includes("应用架构规范（后端 / 全栈）"),
  "个性化页渲染软件开发（后端）+ 应用架构（后端 / 全栈）两张规范卡");
ok(/frontendDesignEnabled: frontendEnabled/.test(pageNorm)
  && /softwareDevEnabled,/.test(pageNorm) && /appArchitectureEnabled: appArchEnabled/.test(pageNorm)
  && pageNorm.includes("ToggleSwitch") && pageNorm.includes("norm-toggle")
  && pageNorm.includes("personalization-norm-off"),
  "三类规范各有启用开关；关闭后不注入但保留配置");
ok(/softwareDevStyle,/.test(pageNorm) && /appArchitectureStyle: appArchStyle/.test(pageNorm)
  && /const dirty[\s\S]*softwareDevNotes\.trim\(\)[\s\S]*appArchNotes\.trim\(\)/.test(pageNorm)
  && /const dirty[\s\S]*softwareDevEnabled[\s\S]*appArchEnabled/.test(pageNorm)
  && pageNorm.includes("personalization-savebar"),
  "两套规范参与保存 / dirty / 启用态判定，并由页面统一保存条提交");
ok(/softwareDevStyle[^\n]*softwareDevNotes[^\n]*softwareDevEnabled[^\n]*appArchitectureStyle[^\n]*appArchitectureNotes[^\n]*appArchitectureEnabled/.test(manifest)
  && /frontendDesignEnabled/.test(manifest),
  "manifest 的保存参数含两套工程规范字段与三个开关（生成物才会带上类型）");
ok(read("src/styles/12-settings-skills.css").includes(".personalization-savebar"),
  "页面统一保存条样式在位（四类设置共用一个保存动作）");

console.log(`\n【design】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
