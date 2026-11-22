/**
 * 技能运用纪律（skill discipline）：让引擎**主动、熟练**地用技能与 MCP 通道办事，并**自己积累技能**。
 *
 * 三件事：
 *  ① 「当前能力清单」——~~把已装技能（name + 一句话简介）写进 AGENTS.md~~ **⛔ 09-27 已删（见下）**；
 *  ② 「运用守则」——教模型：先匹配能力再动手；缺技能就去市场搜并自主安装；
 *     缺连接器先查模板、装之前必须经用户确认（配置变更 + 引擎重启）；用完要汇报。
 *  ③ 「经验包纪律」——干成的活要**沉淀成技能**（可复用流程），与记忆层（记「是什么」）配对。
 *     格式与时机不在这里展开：写成内置技能 `skill-authoring`，真要沉淀时按需读（渐进披露）。
 *
 * ⛔⛔ **09-27 撤掉「已装技能清单」枚举（用户：「技能又不是默认就启用的，干嘛每次都要带上」）**：
 *   引擎自身已按「扫到就注入」的规则把全部技能的 name+description 写进 developer 块的
 *   `### Available skills`（实测 55 条 / 9,970 token）。本模块再枚举一遍 = **同一批技能注入两遍**
 *   （实测交集 27 条 / 1,664 token 纯浪费），且本模块用的是 `scanSkillRoot` 默认口径，
 *   与引擎的停用判定还会漂移（实测 `desktop-automation` 已停用却仍被本模块列出）。
 *   ⇒ 现在只保留**运用守则 + MCP 清单**（守则 1,155 token 是行为约束，必须留）；
 *   技能发现交给引擎清单与 `find-skills`（市场按需）+ 守则第 3 条（缺技能先审后装）。
 *
 * 注入方式：AGENTS.md 里 `<!-- skill-discipline:start -->` ~ `<!-- skill-discipline:end -->`
 * 标记区间幂等 upsert（区间外内容一字不动）。技能/连接器增删后由 main.ts 调 upsert 刷新。
 *
 * ⛔ 技能解析（frontmatter）与两个落点目录**不再在本文件重实现**：单一真相源是
 *   `electron/skill-pack.ts`（09-22 收口；此前这里是第二份 parseSkillMd）。三处改动必须同源，
 *   否则「停用态/坏技能怎么算」这类判据会各说各话（预检【103】真跑 skill-pack 的产物做断言）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { SKILL_AUTHORING_NAME, PROJECT_SKILLS_SUBDIR, MEMORY_CLASSIFY_SKILL, MEMORY_HYGIENE_SKILL, SELF_REVIEW_SKILL, SKILL_AUDIT_SKILL, globalSkillsDir, scanSkillRoot } from "./skill-pack";
import { MEMORY_DISTILL_SKILL } from "./memory-layers";

export const DISCIPLINE_START = "<!-- skill-discipline:start -->";
export const DISCIPLINE_END = "<!-- skill-discipline:end -->";

export type CapabilityInventory = {
  skills: { name: string; desc: string }[];
  mcp: { name: string; desc: string }[];
};

/** 扫已装技能（codexHome/skills/<技能目录>/SKILL.md），产出能力清单。
 *  ⛔ 09-27 起**不再用于写进 AGENTS.md**（引擎自己会列，重复注入纯浪费；见文件头注释）。
 *    保留此函数供需要「本模块口径的启用技能数」的调用方/断言使用。 */
export async function buildCapabilityInventory(codexHome: string, mcp: { name: string; desc: string }[]): Promise<CapabilityInventory> {
  const entries = await scanSkillRoot(globalSkillsDir(codexHome), "user");
  return { skills: entries.map((s) => ({ name: s.name, desc: s.desc })), mcp };
}

/** 生成注入给模型的「技能与 MCP 运用守则」段落（开工先匹配能力、按技能手册办、别乱装）。 */
export function buildDisciplineSection(inv: CapabilityInventory): string {
  const lines: string[] = [DISCIPLINE_START, "", "## 技能与 MCP 运用守则（必须遵守）", ""];
  lines.push("你有一批已安装的技能和 MCP 连接器，用它们办事比手工操作更快更稳。遵守以下纪律：");
  lines.push("");
  lines.push("1. **开工先匹配能力**：先看 `### Available skills`（只给名字 + SKILL.md 路径；按用途先 `find_skills`，确定名字就直接读 SKILL.md）。凡有技能/MCP 能做（哪怕一部分）就优先用，禁止手搓等价实现；桌面/浏览器用 automation 连接器，不要手写 PowerShell。专家先用 harness_tools 的 expert_list 查自己的 teamId；缺工具按返回的安装入口征得同意后再装。");
  lines.push("2. **按说明书执行**：用技能前先读它的 SKILL.md，严格按步骤，不凭名字猜。");
  lines.push(`3. **缺技能 → 先审后装**：\`skill_search\` 搜市场；**任何技能安装前必须先读 \`${SKILL_AUDIT_SKILL}\` 按五查审一遍**（结构 / 危险模式 / 权限面 / 来源与供应链 / 提示注入），给出 ✅放行 / ⚠️有条件 / ⛔拒绝 + 依据；**审查未通过不得安装**。通过后 \`skill_install\`（下一回合可用）。市场没有 → 手工做，末尾加「💡 未找到合适技能：…」。`);
  lines.push("4. **缺连接器 → 先查再问**：`connector_search`；安装前必须 `agent_ask` 征得同意（会改配置并重启引擎、中断当前回合），装完提醒用户重发消息。");
  lines.push("5. **用完汇报**：末尾一行「🧩 技能：…；🔌 MCP：…」，没用就不写；同类操作别拆多次调用，批量/重复流程用 `rpa_save` 存配方（步骤格式见 `rpa-recipes`）。");
  lines.push(`6. **沉淀技能**：多步活 / 难缠坑 / 被纠正两次以上 ⇒ 写成技能（项目级 \`<workspace>/${PROJECT_SKILLS_SUBDIR}/<名>/SKILL.md\`，通用 \`$CODEX_HOME/skills/<名>/SKILL.md\`），写前先读 \`${SKILL_AUTHORING_NAME}\`；末尾加「🧠 已沉淀技能：…」。`);
  lines.push(`7. **记忆 vs 技能 + 复盘**：记忆（\`.codex-harness/memory/\`）记「是什么」（事实 / 约束 / 坑），技能（\`.codex/skills/\`）记「怎么做」；多步任务或被纠正后读 \`${SELF_REVIEW_SKILL}\` 做简短四问复盘，结论落记忆；同一现象第二次就升级成技能。`);
  lines.push(`8. **记忆写入先分类**：写前读 \`${MEMORY_CLASSIFY_SKILL}\`（一条一现象；纠正 > 任务经验 > SOP > 偏好；先读目标文件去重）；整洁规则见 \`${MEMORY_HYGIENE_SKILL}\`（能归档不删、保护项永不自动清、删除先说明后果并二次确认）。`);
  lines.push("");
  lines.push("### 当前能力清单");
  lines.push("");
  // ⛔ 技能清单**不在这里枚举**（09-27）：引擎自己会把技能写进 developer 块的
  //   `### Available skills`（11-22 起只给名字 + 文件路径，描述见 `find_skills` / SKILL.md），
  //   此处再列一遍 = 同一批注入两遍。模型找技能：看引擎那份清单；市场找新技能：守则第 3 条。
  lines.push("**已装技能**：见本轮 developer 指令里的 `### Available skills`（只给名字 + 文件路径；描述用 `find_skills` 查，或直接读 SKILL.md；**此处不重复枚举**）。停用态技能不会出现在那里 —— 要用某个被停用的技能，先在设置里启用它。");
  lines.push("");
  lines.push(`**项目级技能**：\`<workspace>/${PROJECT_SKILLS_SUBDIR}/\` —— 引擎原生发现（\`skills/list\` 里 scope=repo）、随项目走。开工时直接列该目录即可，没有就按守则 7 自建。`);
  lines.push("");
  if (inv.mcp.length) {
    lines.push("**已配 MCP 连接器**（工具已注册可直接调用）：");
    for (const m of inv.mcp) lines.push(`- ${m.name} — ${m.desc}`);
  } else {
    lines.push("**已配 MCP 连接器**：暂无（用 connector_search 查可装模板）。");
  }
  lines.push("", DISCIPLINE_END, "");
  return lines.join("\n");
}

/** 在 AGENTS.md 里幂等 upsert 守则区间（区间外内容不动）。 */
export async function upsertSkillDiscipline(codexHome: string, mcp: { name: string; desc: string }[]): Promise<string> {
  const file = path.join(codexHome, "AGENTS.md");
  const inv = await buildCapabilityInventory(codexHome, mcp);
  const section = buildDisciplineSection(inv);
  let base = "";
  try {
    base = await fs.readFile(file, "utf8");
  } catch { /* AGENTS.md 还不存在：个人化模块稍后会生成，这里先独立成文 */ }
  const start = base.indexOf(DISCIPLINE_START);
  const end = base.indexOf(DISCIPLINE_END);
  const next = start >= 0 && end > start
    ? base.slice(0, start) + section + base.slice(end + DISCIPLINE_END.length)
    : base + (base && !base.endsWith("\n") ? "\n" : "") + section;
  if (next !== base) await fs.writeFile(file, next, "utf8");
  return section;
}
