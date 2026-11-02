#!/usr/bin/env node
/**
 * gen-design-skill —— 从 DESIGN.md 的「前端设计方法」标记区生成内置技能。
 *
 * 为什么要有这一层：
 *   · 设计方法必须留在项目里（人和 agent 都读 DESIGN.md），但**打包版没有源码树** ——
 *     引擎只能看 codexHome/skills。把同一段正文生成为内置技能，才叫「内置」。
 *   · ⛔ 只维护一份：DESIGN.md 的 `<!-- DESIGN-METHOD:BEGIN/END -->` 之间是唯一真相源，
 *     本脚本只做搬运，不允许在生成物里手改（守卫 12at 比对新鲜度）。
 *
 * 用法：node scripts/gen-design-skill.mjs [--check]
 *   --check：只比对不写；生成物与 DESIGN.md 不一致时 exit 1（守卫用）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MD_PATH = path.join(ROOT, "DESIGN.md");
const OUT = path.join(ROOT, "electron", "builtin-skills", "27-skill-frontend-design.ts");
const BEGIN = "<!-- DESIGN-METHOD:BEGIN -->";
const END = "<!-- DESIGN-METHOD:END -->";

const DESCRIPTION =
  "前端设计作业手册：先读懂任务与真实数据，再按「层级 → 布局 → 状态 → 细节」落地。"
  + "任何要写或改界面的任务（页面 / 组件 / 布局 / 设置页 / 表单 / 弹窗 / 卡片列表 / 样式 / 主题 / 响应式）都先读它。"
  + "含十条硬规则、组件与交互模式、主题/壁纸/高 DPI/减动效适配、交付前验收清单与反模式。";

/** 从 DESIGN.md 抽出方法正文，拼成完整 SKILL.md。 */
export function buildDesignSkill() {
  /* ⛔ 先归一化行尾再切片：Windows 检出（core.autocrlf）下 DESIGN.md 是 CRLF，
     而生成物进 Git 时会被归一成 LF —— 不归一就会「换了台机器跑 --check 恒红」。 */
  const md = fs.readFileSync(MD_PATH, "utf8").replace(/\r\n?/g, "\n");
  const start = md.indexOf(BEGIN);
  const end = md.indexOf(END);
  if (start < 0 || end <= start) {
    throw new Error("DESIGN.md 缺少 DESIGN-METHOD 标记区（BEGIN/END）");
  }
  const section = md.slice(start + BEGIN.length, end).trim();
  if (section.length < 1200) {
    throw new Error(`DESIGN.md 设计方法正文过短（${section.length} 字符），疑似标记区被截断`);
  }
  const body = `---\nname: frontend-design\ndescription: ${DESCRIPTION}\n---\n\n${section}\n`;
  const escaped = body.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${");
  return `/**
 * builtin-skills 的「frontend-design」部分 —— ⛔ 本文件由 scripts/gen-design-skill.mjs 自动生成，勿手改。
 * 正文唯一真相源：根目录 DESIGN.md 的 DESIGN-METHOD 标记区（对应「前端设计方法（Codex 作业手册）」一节）。
 * 用途：打包版没有源码树，引擎只能读 codexHome/skills —— 生成后由 ensureBuiltinSkills 落盘，
 *       Codex 在任何项目里都能按这套方法做界面。守卫 12at 比对新鲜度，过期即红。
 */
export const FRONTEND_DESIGN_SKILL = \`${escaped}\`;
`;
}

function main() {
  const next = buildDesignSkill();
  const check = process.argv.includes("--check");
  const existing = (fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "").replace(/\r\n/g, "\n");
  if (check) {
    if (existing !== next) {
      console.error("✗ frontend-design 内置技能已过期：请跑 node scripts/gen-design-skill.mjs");
      process.exit(1);
    }
    console.log("✓ frontend-design 内置技能与 DESIGN.md 一致");
    return;
  }
  if (existing !== next) {
    fs.writeFileSync(OUT, next, "utf8");
    console.log("✓ 已生成 electron/builtin-skills/27-skill-frontend-design.ts");
  } else {
    console.log("✓ frontend-design 内置技能无变化");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
