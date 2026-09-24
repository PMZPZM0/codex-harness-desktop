/**
 * 技能包（skill pack）—— 「经验包」的可复用流程层：把干成的活沉淀成技能，下次直接复用。
 *
 * 为什么单列这一层（09-22 用户：「记忆技能搭配好」「他的记忆板块太弱」）：
 *   记忆层记的是**是什么** —— 事实、约束、纪律、踩过的坑（memory-layers.ts）；
 *   技能层记的是**怎么做** —— 一条可复用的操作流程（含确切命令、判据、坑）。
 *   缺技能层时，坑只会进 LESSONS.md 记一行「现象 → 解法」；同一个坑换一天、换个人还会再踩
 *   ——因为没有可执行的步骤。经验包 = 记忆（纪律）+ 技能（流程），两层互相指认。
 *
 * 落点（09-22 探针实证：独立 CODEX_HOME + 临时 cwd，spawn 真实 app-server 读 skills/list）：
 *   · 全局：`$CODEX_HOME/skills/<名>/SKILL.md`   → skills/list 里跨项目可见（现有行为）
 *   · 项目：`<cwd>/.codex/skills/<名>/SKILL.md` → skills/list 里 `scope:"repo"`（实测 ✓）
 *   ⛔ 引擎**原生发现** `<cwd>/.codex/skills`，所以**不要在 AGENTS.md 索引里重复枚举项目技能**
 *      —— 同一技能列出两遍正是本仓库踩过的坑（ponytail-plugin.ts：插件 skills 又拷一份到全局
 *      ⇒ 每个技能在列表里出现两次，看起来像假的）。
 *   ⛔ `.codex-harness/skills` 引擎**不认**（同次探针实测 ✗）。`.codex-harness/` 是应用自有的
 *      项目数据目录（记忆层在用），技能必须落 `.codex/skills` —— 与既有的 `<cwd>/.codex/commands`
 *      同族约定（commands.ts 就是这么分「全局 $CODEX_HOME / 项目 <cwd>/.codex」的）。
 *   ⛔ 项目信任策略只挡 config / hooks / exec 策略，**技能照样加载**（探针 stderr 原话：
 *      “local config, hooks, and exec policies are disabled … but skills still load.”）
 *      ⇒ 项目级技能不依赖用户去点「信任此项目」，可用性没有额外前置条件。
 *
 * 本模块是**单一真相源**：解析器（parseSkillMd）、两个落点、以及给模型看的**格式与积累规则**
 * （SKILL_FORMAT_RULES / skillTemplate）都从这里出 —— skill-discipline（AGENTS.md 守则）与
 * developer-instructions（引擎指令）都引用同一份常量，预检【103】断言两处引用的是同一常量，
 * 防止「改了措辞、另一处没跟上」这类静默漂移。
 */
import fs from "node:fs/promises";
import path from "node:path";

/** 全局技能目录名（相对 $CODEX_HOME） */
export const GLOBAL_SKILLS_SUBDIR = "skills";
/** 项目级技能目录（相对工作区根）——引擎原生发现，scope="repo" */
export const PROJECT_SKILLS_SUBDIR = ".codex/skills";
/** 技能定义文件名（停用态是 SKILL.md.disabled，与 main.ts / builtin-skills.ts 同源） */
export const SKILL_FILE = "SKILL.md";
export const SKILL_FILE_DISABLED = "SKILL.md.disabled";

export type SkillScope = "user" | "repo";
export type SkillEntry = { name: string; desc: string; file: string; scope: SkillScope; enabled: boolean };

export function globalSkillsDir(codexHome: string): string {
  return path.join(codexHome, GLOBAL_SKILLS_SUBDIR);
}

export function projectSkillsDir(cwd: string): string {
  return path.join(cwd, ...PROJECT_SKILLS_SUBDIR.split("/"));
}

/** SKILL.md 正文里的 frontmatter 解析（纯函数，便于预检直接跑）。
 *  容忍 BOM；缺 name 用目录名兜底；**缺 description 视为无效**（技能清单靠它决定何时加载）。 */
export function parseSkillMdSource(raw: string, fallbackName: string): { name: string; desc: string } | null {
  const text = raw.replace(/^\uFEFF/, "");
  if (!/^---\s*$/m.test(text)) return null;
  const head = text.split(/^---\s*$/m)[1] ?? "";
  const pick = (key: string) => {
    const m = head.match(new RegExp(`^${key}:\\s*(.+)$`, "mi"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  };
  const name = pick("name") || fallbackName;
  const desc = pick("description").slice(0, 160);
  if (!desc) return null;
  return { name, desc };
}

/** 读单个技能目录。
 *  ⛔ `includeDisabled` 默认 **false**：能力清单只该列**启用中**的技能 —— 总闸把一个技能改名成
 *     `SKILL.md.disabled` 后，模型若还在清单里看到它，就会去调一个用户明确关掉的能力
 *     （与 builtin-skills.ts 里「无条件写回 SKILL.md ⇒ 总闸形同虚设」是同一类事故）。
 *     停用态只给**管理界面**看（includeDisabled: true），并带 enabled=false 标记。 */
export async function readSkillFile(
  dir: string,
  fallbackName: string,
  opts: { includeDisabled?: boolean } = {},
): Promise<{ name: string; desc: string; file: string; enabled: boolean } | null> {
  const names = opts.includeDisabled ? [SKILL_FILE, SKILL_FILE_DISABLED] : [SKILL_FILE];
  for (const fn of names) {
    const file = path.join(dir, fn);
    try {
      const parsed = parseSkillMdSource(await fs.readFile(file, "utf8"), fallbackName);
      if (parsed) return { ...parsed, file, enabled: fn === SKILL_FILE };
      if (fn === SKILL_FILE) return null; // 有 SKILL.md 但解析不出来 = 该技能坏了，不退回 .disabled
    } catch { /* 该名字不存在，试下一个 */ }
  }
  return null;
}

/** 扫一个技能根目录（目录不存在 = 空清单，不抛） */
export async function scanSkillRoot(root: string, scope: SkillScope, opts: { includeDisabled?: boolean } = {}): Promise<SkillEntry[]> {
  const out: SkillEntry[] = [];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const parsed = await readSkillFile(path.join(root, entry.name), entry.name, opts);
      if (parsed) out.push({ name: parsed.name, desc: parsed.desc, file: parsed.file, scope, enabled: parsed.enabled });
    }
  } catch { /* 目录不存在 = 空 */ }
  return out;
}

/** 扫项目级技能（<cwd>/.codex/skills）——用于 UI 列表与"写前查重"（含停用项，便于管理） */
export function listProjectSkills(cwd: string, opts: { includeDisabled?: boolean } = {}): Promise<SkillEntry[]> {
  return scanSkillRoot(projectSkillsDir(cwd), "repo", opts);
}

/**
 * 「技能沉淀」元技能的名字 —— 指令里提到它时必须用这个常量（预检【103】断言两处同源）。
 * 正文（格式与时机）落在内置技能 `electron/builtin-skills/07-skill-authoring.ts`：
 *   ⛔ 为什么不把格式写进 developer_instructions：那会**每轮**多烧几百 token（本仓库的渐进披露纪律
 *      ——与 BROWSER_INSTRUCTIONS 注释里同一条理由）。写成技能后索引里只占一行 description，
 *      模型真要沉淀时再读全文。
 *   ⛔ 又为什么那份正文必须是**字面量**而不是从本模块拼出来：预检【86】按**源文件文本**做配置面安全
 *      扫描，常量若在运行时拼装，扫描器就看不到内容 —— 正是本仓库记过的「假绿」形态
 *      （config-scan 曾因技能正文搬走而让「内置技能零 critical/high」变成恒真）。
 */
export const SKILL_AUTHORING_NAME = "skill-authoring";

/**
 * 另外三类元技能的名字（09-23 加）—— 与 `SKILL_AUTHORING_NAME` 同一纪律：
 *   指令 / AGENTS.md 守则 / 预检守卫**三处都必须用这几个常量**，不许各写一遍字符串字面量。
 *   正文分别在 `electron/builtin-skills/` 下的同名文件里（渐进披露：索引里只占一行 description）。
 *   · MEMORY_DISTILL 已有的那个在 08（常量在 memory-layers 侧引用），这里补齐其余三件：
 *   · SELF_REVIEW  —— 任务完成后的复盘纠错（把"错了什么/绕了什么弯"沉淀成记忆与技能）
 *   · MEMORY_HYGIENE —— 记忆整洁与清理规则（八层能清什么、什么永不自动清、留痕在哪）
 *   · MEMORY_CLASSIFY —— 写记忆前的分类口径（一条一现象，四分类优先级）
 *   · SKILL_AUDIT —— **安装任何技能前的强制审查门禁**（用户 09-23 明确要求的硬规则）
 */
export const SELF_REVIEW_SKILL = "self-review";
export const MEMORY_HYGIENE_SKILL = "memory-hygiene";
export const MEMORY_CLASSIFY_SKILL = "memory-classify";
export const SKILL_AUDIT_SKILL = "skill-audit";

