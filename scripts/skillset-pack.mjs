#!/usr/bin/env node
/**
 * skillset-pack —— 把一组**本机已有技能**打成「专家配套技能包」（SkillHub skillset 格式）。
 *
 * 为什么需要：专家应**自带**技能（用户 11-18：「技能应该是专家自带的」）。
 *   · 专家市场的包走 `expert-market:install` → `installSkillHubSkillset`，装完技能落盘 + 建专家卡；
 *   · 但**自建专家**没有包可装，只能引用本机技能 ⇒ 这个脚本负责"把引用关系固化成包"，
 *     以后可以随专家一起分发/安装，而不是靠用户手动去市场找同名技能。
 *
 * 产物结构（与 SkillHub 一致）：
 *   <slug>/
 *     .skillhub.json            { kind: "skillset", marketId, name, children: [...] }
 *     <skill-a>/SKILL.md + .skillhub.json   { kind: "skillset-child", skillset: <slug> }
 *     <skill-b>/...
 *   <slug>.skillhub.zip         （能打包就打包，打包器缺失只告警）
 *
 * 用法：
 *   node scripts/skillset-pack.mjs --slug zhuji-baseline --name "筑基·环境自检" \
 *        --skills harness-api,self-tools,self-review [--out <dir>] [--install] [--dry]
 *
 * ⛔ 只复制、重命名元数据；**不改技能正文**（改内容属于作者工作，不在打包器职责内）。
 * ⛔ --install 只写 `<skills 根>/*`，不删任何已有技能；同名目录会被拒绝（不覆盖）。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const arg = (name, fallback = "") => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const slug = arg("slug");
const name = arg("name", slug);
const skills = arg("skills").split(",").map((s) => s.trim()).filter(Boolean);
const dry = flag("dry");
const install = flag("install");

if (!slug || !skills.length) {
  console.error("用法：node scripts/skillset-pack.mjs --slug <slug> --name <显示名> --skills a,b,c [--out dir] [--install] [--dry]");
  process.exit(2);
}

/** 找本机技能根：优先 --root / 环境变量，其次从 %APPDATA%/<app>/codex-home/skills 里挑一个存在的。 */
function resolveSkillsRoot() {
  const explicit = arg("root", process.env.CODEX_HARNESS_SKILLS ?? "");
  if (explicit) return explicit;
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  const candidates = [];
  try {
    for (const entry of readdirSync(appData)) {
      const dir = path.join(appData, entry, "codex-home", "skills");
      if (existsSync(dir)) candidates.push(dir);
    }
  } catch { /* 不是 Windows 或无权限 */ }
  /* macOS / Linux */
  for (const dir of [
    path.join(os.homedir(), "Library", "Application Support", "Codex Harness Desktop", "codex-home", "skills"),
    path.join(os.homedir(), ".config", "Codex Harness Desktop", "codex-home", "skills"),
  ]) if (existsSync(dir)) candidates.push(dir);

  /* 挑"技能最多的那个"：多账号并存时它是真正在用的那套。 */
  let best = "";
  let bestCount = -1;
  for (const dir of candidates) {
    const count = readdirSync(dir).filter((d) => existsSync(path.join(dir, d, "SKILL.md"))).length;
    if (count > bestCount) { best = dir; bestCount = count; }
  }
  return best;
}

const skillsRoot = resolveSkillsRoot();
if (!skillsRoot) {
  console.error("找不到本机技能目录：用 --root <dir> 指定");
  process.exit(2);
}

/* ① 校验每个技能都存在（⛔ 缺失就停，不生成半成品包） */
const missing = skills.filter((s) => !existsSync(path.join(skillsRoot, s, "SKILL.md")));
if (missing.length) {
  console.error(`这些技能不在本机技能目录里：${missing.join("、")}\n目录：${skillsRoot}`);
  console.error("⛔ 打包器不负责造技能：先把技能装好，或换用已有的技能名。");
  process.exit(3);
}

const outRoot = arg("out", path.join("dist", "skillsets"));
const pkgDir = path.join(outRoot, slug);
const now = new Date().toISOString();

if (dry) {
  console.log(`[dry] 技能根：${skillsRoot}`);
  console.log(`[dry] 将打包 ${skills.length} 个技能 → ${pkgDir}`);
  for (const s of skills) console.log("  -", s);
  process.exit(0);
}

/* ② 组包 */
mkdirSync(pkgDir, { recursive: true });
writeFileSync(path.join(pkgDir, ".skillhub.json"), JSON.stringify({
  kind: "skillset",
  marketId: slug,
  name,
  descriptionZh: `专家配套技能包（${skills.length} 个技能）`,
  version: "1.0.0",
  installedAt: now,
  children: skills,
}, null, 2) + "\n", "utf8");

for (const skill of skills) {
  const src = path.join(skillsRoot, skill);
  const dst = path.join(pkgDir, skill);
  if (existsSync(dst)) console.error(`同名技能已存在于包目录，跳过：${skill}`);
  else cpSync(src, dst, { recursive: true });
  /* 子技能清单：⛔ 覆盖旧市场清单（否则 UI 会认成别的包） */
  writeFileSync(path.join(dst, ".skillhub.json"), JSON.stringify({
    kind: "skillset-child",
    skillset: slug,
    marketId: `${slug}/${skill}`,
    name: skill,
    installedAt: now,
  }, null, 2) + "\n", "utf8");
}
console.log(`已生成包：${pkgDir}（${skills.length} 个技能）`);

/* ③ 打包成 zip（没有打包器只告警：目录本身就是可用产物） */
const zipPath = path.join(outRoot, `${slug}.skillhub.zip`);
try {
  execFileSync("tar", ["-a", "-c", "-f", zipPath, "-C", outRoot, slug], { stdio: "ignore" });
  console.log(`已打包：${zipPath}`);
} catch {
  console.warn(`⚠ 未生成 zip（系统 tar 不支持 -a 或无打包器）；目录包仍可直接使用：${pkgDir}`);
}

/* ④ 可选：装进本机技能目录（只新增，不覆盖、不删除） */
if (install) {
  const conflicts = skills.filter((s) => existsSync(path.join(skillsRoot, s)));
  if (conflicts.length) {
    console.error(`⛔ 这些技能已装在同名目录，拒绝覆盖：${conflicts.join("、")}`);
    console.error("（如需替换，请先在「设置 → 技能」里卸载旧版本）");
    process.exit(4);
  }
  for (const skill of skills) {
    cpSync(path.join(pkgDir, skill), path.join(skillsRoot, skill), { recursive: true });
    console.log(`已安装：${skill}`);
  }
  console.log(`已装到：${skillsRoot}（重启应用后引擎可见）`);
}
