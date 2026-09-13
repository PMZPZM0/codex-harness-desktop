/**
 * 技能运用纪律（skill discipline）：让引擎**主动、熟练**地用技能与 MCP 通道办事。
 *
 * 两件事：
 *  ① 「当前能力清单」——把已装技能（name + 一句话简介）与已配 MCP 连接器写进 AGENTS.md，
 *     引擎每个会话注入，模型开局即知军火库，不用每次跑 skills/list 探测。
 *  ② 「运用守则」——教模型：先匹配能力再动手；缺技能就去市场搜并自主安装；
 *     缺连接器先查模板、装之前必须经用户确认（配置变更 + 引擎重启）；用完要汇报。
 *
 * 注入方式：AGENTS.md 里 `<!-- skill-discipline:start -->` ~ `<!-- skill-discipline:end -->`
 * 标记区间幂等 upsert（区间外内容一字不动）。技能/连接器增删后由 main.ts 调 upsert 刷新。
 */
import fs from "node:fs/promises";
import path from "node:path";

export const DISCIPLINE_START = "<!-- skill-discipline:start -->";
export const DISCIPLINE_END = "<!-- skill-discipline:end -->";

export type CapabilityInventory = {
  skills: { name: string; desc: string }[];
  mcp: { name: string; desc: string }[];
};

/** 从 SKILL.md 的 YAML frontmatter 里抠 name/description（容忍 BOM、缺 name 用目录名）。 */
async function parseSkillMd(file: string, fallbackName: string): Promise<{ name: string; desc: string } | null> {
  try {
    const raw = (await fs.readFile(file, "utf8")).replace(/^\uFEFF/, "");
    if (!/^---\s*$/m.test(raw)) return null;
    const head = raw.split(/^---\s*$/m)[1] ?? "";
    const pick = (key: string) => {
      const m = head.match(new RegExp(`^${key}:\\s*(.+)$`, "mi"));
      return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
    };
    const name = pick("name") || fallbackName;
    const desc = pick("description").slice(0, 160);
    if (!desc) return null;
    return { name, desc };
  } catch {
    return null;
  }
}

/** 扫已装技能（codexHome/skills/<技能目录>/SKILL.md），产出能力清单。mcp 由调用方传入（readConnectors 在 main.ts）。 */
export async function buildCapabilityInventory(codexHome: string, mcp: { name: string; desc: string }[]): Promise<CapabilityInventory> {
  const skillsRoot = path.join(codexHome, "skills");
  const skills: { name: string; desc: string }[] = [];
  try {
    const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const parsed = await parseSkillMd(path.join(skillsRoot, entry.name, "SKILL.md"), entry.name);
      if (parsed) skills.push(parsed);
    }
  } catch { /* 技能目录不存在 = 空清单 */ }
  return { skills, mcp };
}

export function buildDisciplineSection(inv: CapabilityInventory): string {
  const lines: string[] = [DISCIPLINE_START, "", "## 技能与 MCP 运用守则（必须遵守）", ""];
  lines.push("你有一批已安装的技能和 MCP 连接器，用它们办事比手工操作更快更稳。遵守以下纪律：");
  lines.push("");
  lines.push("1. **开工先匹配能力**：接到任务先扫一遍下面的能力清单，凡是有技能或 MCP 工具能做（哪怕只做一部分），就必须优先用它们，禁止自己手搓等价实现。例如：桌面/浏览器操作用 automation 连接器的 desktop_* / browser_* 工具，不要手写 PowerShell 脚本点击。");
  lines.push("2. **按技能说明书执行**：用技能前先读它的 SKILL.md（技能目录下），严格按其中步骤做，不要凭名字猜用法。");
  lines.push("3. **缺技能 → 自主搜索并安装**：清单里没有合适技能时，调用 `skill_search` 搜索内置技能市场；命中就调 `skill_install` 安装（装完下一回合即可用，无需重启应用），然后按其说明书使用。市场也没有 → 手工完成任务，并在回复末尾加一行「💡 未找到合适技能：〈想要的能力〉」，让用户知道可以去技能市场逛逛。");
  lines.push("4. **缺 MCP 连接器 → 先查再问**：调用 `connector_search` 查内置连接器模板。有合适的：**必须先用 agent_ask 征求用户同意再安装**（安装会改配置并重启引擎、中断当前回合）。用户同意后调 `connector_install`，并提醒用户「安装完成，请重新发一条消息继续」。");
  lines.push("5. **用完汇报**：回复末尾用一行注明本轮用了哪些能力，格式：「🧩 技能：〈名〉；🔌 MCP：〈连接器/工具〉」。没用就不写。");
  lines.push("6. **效率优先**：同类操作能用一个工具完成的不要拆多次调用；批量任务优先写成 RPA 配方复用（rpa_save）。");
  lines.push("");
  lines.push("### 当前能力清单");
  lines.push("");
  if (inv.skills.length) {
    lines.push("**已装技能**（用法见各 SKILL.md）：");
    for (const s of inv.skills) lines.push(`- ${s.name} — ${s.desc}`);
  } else {
    lines.push("**已装技能**：暂无（用 skill_search 搜索市场按需安装）。");
  }
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
