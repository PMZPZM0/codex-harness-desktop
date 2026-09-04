// 技能图标解析纯函数单测（node:test，零新依赖）。
// 用法: npm run verify:skill-icon
// 流程: 读 src/lib/skill-icon.ts，把 lucide-react import 替换成轻量 shim 后
//       用 tsc 编译成 CJS 到 .test-tmp/，再 require 跑断言。
//       （lucide-react 是 ESM 包，CJS require 不了；图标组件本身不是被测对象。）
// 数据依据: CocoLoop API 实测 icon 字段约 1/4 为空串（如 self-improving-agent、Auto-Updater）。
// 覆盖: emoji 优先直通、空 icon 关键词兜底、分类兜底、未知分类默认、配色 tone 映射。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmpDir = join(root, ".test-tmp");
const srcFile = join(tmpDir, "skill-icon.src.ts");
// tsc 以输入文件名命名产物（skill-icon.src.js），不重命名
const outFile = join(tmpDir, "skill-icon.src.js");
const tscBin = join(root, "node_modules", "typescript", "bin", "tsc");

if (!existsSync(tscBin)) {
  console.error("FATAL: typescript not installed");
  process.exit(1);
}
mkdirSync(tmpDir, { recursive: true });
rmSync(outFile, { force: true });const source = readFileSync(join(root, "src", "lib", "skill-icon.ts"), "utf8");
// lucide-react 是 ESM：类型导入换本地 type 别名，值导入换成恒返回 null 的显式 shim（Proxy 无类型会报 TS2339）
const iconNames = ["Bot", "Brain", "Briefcase", "ChartColumn", "Code2", "FileText", "Globe2", "LayoutGrid", "MessageSquare", "Phone", "Search", "ShieldCheck", "Sparkles", "Star", "Store", "Target", "TerminalSquare", "Wrench", "Workflow"];
const shimmed = source
  .replace(/import type \{ LucideIcon \} from "lucide-react";/, "type LucideIcon = any;")
  .replace(/import \{[\s\S]*?\} from "lucide-react";/, `const ${iconNames.join(" = 0 || {}, ")} = 0 || {};`);
writeFileSync(srcFile, shimmed, "utf8");

execFileSync(process.execPath, [
  tscBin,
  srcFile,
  "--module", "commonjs",
  "--target", "es2020",
  "--outDir", tmpDir,
  "--skipLibCheck",
], { stdio: "pipe" });

const require_ = createRequire(import.meta.url);
const { resolveSkillVisual } = require_(outFile);

test("市场 emoji 非空 → 直接使用且 Icon 为空", () => {
  const v = resolveSkillVisual({ name: "ontology", category: "专业技能", icon: "🕸️" });
  assert.equal(v.emoji, "🕸️");
  assert.equal(v.Icon, null);
});

test("市场 emoji 为空 → 按名称关键词选 lucide 图标（search/engine）", () => {
  const v = resolveSkillVisual({ name: "Multi Search Engine", description: "聚合 16 个搜索引擎", category: "效率", icon: "" });
  assert.equal(v.emoji, "");
  assert.ok(v.Icon, "应有关键词命中的图标");
  assert.equal(v.iconClass, "tone-green", "效率分类 → 绿色调");
});

test("市场 emoji 为空 + 名称无关键词 → 分类图标兜底", () => {
  const v = resolveSkillVisual({ name: "Auto-Updater Skill", description: "自动更新", category: "开发", icon: "" });
  assert.equal(v.emoji, "");
  assert.ok(v.Icon);
  assert.equal(v.iconClass, "tone-blue", "开发分类 → 蓝色调");
});

test("icon 字段 undefined（本地导入无市场清单）→ 走兜底链", () => {
  const v = resolveSkillVisual({ name: "SkillScan", description: "面向 AI 态的技能安全扫描工具", category: "安全工具" });
  assert.equal(v.emoji, "");
  assert.ok(v.Icon);
  assert.equal(v.iconClass, "tone-green", "安全工具 → 绿色调");
});

test("未知分类 + 无关键词 → 默认 Sparkles + tone-blue", () => {
  const v = resolveSkillVisual({ name: "Evolver", description: "", category: "", icon: "" });
  assert.equal(v.emoji, "");
  assert.ok(v.Icon);
  assert.equal(v.iconClass, "tone-blue");
});

test("关键词命中时色调仍随分类（audit 命中但分类是开发）", () => {
  const v = resolveSkillVisual({ name: "Code Audit Tool", description: "扫描代码风险", category: "开发", icon: "" });
  assert.ok(v.Icon);
  assert.equal(v.iconClass, "tone-blue");
});

test("真实市场样本回归：截图里 9 个技能的图标解析", () => {
  const samples = [
    { name: "Self-Improving Agent", icon: "📝", category: "专业技能" },
    { name: "self-improving-agent", icon: "", category: "专业技能" },
    { name: "Self-Improving + Proactive Agent", icon: "🧠", category: "专业技能" },
    { name: "ontology", icon: "🕸️", category: "专业技能" },
    { name: "SkillScan", icon: "🛡️", category: "安全工具" },
    { name: "Multi Search Engine", icon: "🔍", category: "效率" },
    { name: "AdMapix", icon: "📊", category: "效率" },
    { name: "PollyReach", icon: "🦜", category: "专业技能" },
    { name: "Prismfy Web Search | Free Google", icon: "🔍", category: "效率" },
  ];
  for (const s of samples) {
    const v = resolveSkillVisual(s);
    if (s.icon) assert.equal(v.emoji, s.icon, `${s.name} 应保留市场 emoji`);
    else assert.ok(v.Icon || v.emoji, `${s.name} 空图标应有兜底`);
  }
});
