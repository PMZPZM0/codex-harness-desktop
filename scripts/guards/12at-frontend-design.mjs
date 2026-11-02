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

console.log(`\n【design】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
