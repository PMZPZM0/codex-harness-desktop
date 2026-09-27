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

export function buildDisciplineSection(inv: CapabilityInventory): string {
  const lines: string[] = [DISCIPLINE_START, "", "## 技能与 MCP 运用守则（必须遵守）", ""];
  lines.push("你有一批已安装的技能和 MCP 连接器，用它们办事比手工操作更快更稳。遵守以下纪律：");
  lines.push("");
  lines.push("1. **开工先匹配能力**：接到任务先看**你自己的技能清单**（本轮 developer 指令里的 `### Available skills`，含每个技能的一句话说明与文件路径），凡是有技能或 MCP 工具能做（哪怕只做一部分），就必须优先用它们，禁止自己手搓等价实现。例如：桌面/浏览器操作用 automation 连接器的 desktop_* / browser_* 工具，不要手写 PowerShell 脚本点击。");
  lines.push("2. **按技能说明书执行**：用技能前先读它的 SKILL.md（技能目录下），严格按其中步骤做，不要凭名字猜用法。");
  lines.push(`3. **缺技能 → 先审查、再安装**：清单里没有合适技能时，调用 \`skill_search\` 搜索技能市场。**命中后不许直接装** —— 用户设了一条硬规则：**任何技能在安装之前，必须先读技能 \`${SKILL_AUDIT_SKILL}\` 并按它的五查清单审一遍**（结构合法性 / 危险模式 / 权限面 / 来源与供应链 / 提示注入），给出「✅ 放行 / ⚠️ 有条件放行 / ⛔ 拒绝」+ **依据**的结论；**审查未通过就不得安装**，把命中的原文片段报给用户。审查通过后再调 \`skill_install\`（装完下一回合即可用，无需重启应用），然后按其说明书使用。市场也没有 → 手工完成任务，并在回复末尾加一行「💡 未找到合适技能：〈想要的能力〉」，让用户知道可以去技能市场逛逛。`);
  lines.push("4. **缺 MCP 连接器 → 先查再问**：调用 `connector_search` 查内置连接器模板。有合适的：**必须先用 agent_ask 征求用户同意再安装**（安装会改配置并重启引擎、中断当前回合）。用户同意后调 `connector_install`，并提醒用户「安装完成，请重新发一条消息继续」。");
  lines.push("5. **用完汇报**：回复末尾用一行注明本轮用了哪些能力，格式：「🧩 技能：〈名〉；🔌 MCP：〈连接器/工具〉」。没用就不写。");
  lines.push("6. **效率优先**：同类操作能用一个工具完成的不要拆多次调用；批量任务优先写成 RPA 配方复用（rpa_save）。");
  lines.push(`7. **干成的活要沉淀成技能（经验包）**：干完一件多步的活、修掉一个难缠的坑、或被用户纠正两次以上之后，把做法写成技能 —— 项目专属写 \`<workspace>/${PROJECT_SKILLS_SUBDIR}/<名>/SKILL.md\`（引擎原生以 scope=repo 发现，随项目走），跨项目通用写 \`$CODEX_HOME/skills/<名>/SKILL.md\`。**写之前先读技能 \`${SKILL_AUTHORING_NAME}\`**（格式、查重、骨架都在里面；缺 description 的技能等于没写）。写完在回复末尾加一行「🧠 已沉淀技能：〈名〉（〈路径〉）」。`);
  lines.push("8. **记忆与技能分工**：记忆（`.codex-harness/memory/`）记「**是什么**」——事实、约束、踩过的坑（LESSONS.md）；技能（`.codex/skills/`）记「**怎么做**」——可复用流程。同一个坑在 LESSONS.md 出现**第二次** ⇒ 升级成技能（把“现象+解法”改写成“步骤+判据”）。");
  lines.push(`9. **收尾复盘（自我进化入口）**：完成多步任务、被用户纠正、或走了弯路又绕回来之后，读技能 \`${SELF_REVIEW_SKILL}\` 做一次**简短**复盘（四问：错在哪 / 被纠正了什么 / 绕了什么弯 / 有什么可固化），把结论落到记忆对应分类；同一现象出现第二次就升级成技能。**不要写长篇汇报**，回复里一行带过即可。`);
  lines.push(`10. **记忆写入的分类与整洁**：写任何一条记忆之前先读 \`${MEMORY_CLASSIFY_SKILL}\`（一条一现象；分类优先级 纠错 > 任务经验 > 工作流SOP > 用户偏好；**先读目标文件去重**）。看到常驻记忆里的「记忆水位 ≥90% 蒸馏线」提示 ⇒ 按 \`${MEMORY_DISTILL_SKILL}\` 先把那一层蒸下去。整洁与清理规则见 \`${MEMORY_HYGIENE_SKILL}\`：**能归档就不删、保护项（用户手写 / 用户纠错 / pinned）永不自动清、涉及删除的动作一律先说明后果并等用户二次确认**（那三个动作走应用 IPC，不由你直接执行）。`);
  lines.push("");
  lines.push("### 当前能力清单");
  lines.push("");
  // ⛔ 技能清单**不在这里枚举**（09-27）：引擎自己会把全部技能写进 developer 块的
  //   `### Available skills`（含 name + description + file 路径），此处再列一遍 = 同一批注入两遍。
  //   模型找技能：看引擎那份清单；市场找新技能：守则第 3 条（skill_search → 先审后装）。
  lines.push("**已装技能**：见本轮 developer 指令里的 `### Available skills`（引擎按技能目录自动列出，含文件路径；**此处不重复枚举**）。停用态技能不会出现在那里 —— 要用某个被停用的技能，先在设置里启用它。");
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
