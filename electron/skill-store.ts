/**
 * skill-store（10-03 从 `features/builtin-skills-ipc/03-plugins-market.ts` **下沉到基座层**）
 *
 * 为什么下沉：`setSkillEnabledSilent` 是**技能启停**的口径（改 SKILL.md ⇄ SKILL.md.disabled），
 * 却被 `plugins` 域（插件停用要连带停用它提供的技能）使用。按前缀拆成 skills / plugins 两个板块后，
 * 它不能留在任一域的内部文件里 ⇒ 落到基座层。
 *
 * ⛔ 停用靠**改名**（`SKILL.md` → `SKILL.md.disabled`）：Codex 扫描目录时看不到 .disabled，
 *    技能才真的不生效 —— 不是写个 enabled 字段。
 * ⛔ 路径必须做包含性校验（防目录穿越）：解析后必须仍在技能根目录内。
 */
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { userSkillsDir } from "./main";

export async function setSkillEnabledSilent(folder: string, enabled: boolean) {
  const resolved = path.resolve(userSkillsDir, String(folder ?? ""));
  if (!resolved.startsWith(path.resolve(userSkillsDir) + path.sep)) throw new Error("非法技能路径");
  const active = path.join(resolved, "SKILL.md");
  const inactive = path.join(resolved, "SKILL.md.disabled");
  if (enabled) {
    if (existsSync(inactive) && !existsSync(active)) await fs.rename(inactive, active);
  } else if (existsSync(active)) {
    await fs.rename(active, inactive);
  }
}
