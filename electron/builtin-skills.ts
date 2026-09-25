/**
 * builtin-skills —— 保留未分出的部分（09-22 结构改造）。
 * ⛔ 顺序即契约（若含 hook / 副作用注册，调用顺序 == 原文件顺序）⇒ 只能按文件名前缀顺序 import。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { DESKTOP_SKILL } from "./builtin-skills/01-skill-desktop";
import { RETIRED_BROWSER_SKILL, BROWSER_SKILL } from "./builtin-skills/02-skill-browser";
import { HUMANIZER_SKILL } from "./builtin-skills/03-skill-humanizer";
import { NO_AI_SLOP_SKILL } from "./builtin-skills/04-skill-no-ai-slop";
import { I_HAVE_ADHD_SKILL } from "./builtin-skills/05-skill-adhd";
import { DOC_CONVERT_SKILL } from "./builtin-skills/06-skill-doc-convert";
import { SKILL_AUTHORING_SKILL } from "./builtin-skills/07-skill-authoring";
import { MEMORY_DISTILL_SKILL } from "./builtin-skills/08-skill-memory-distill";
import { SELF_REVIEW_SKILL } from "./builtin-skills/09-skill-self-review";
import { MEMORY_HYGIENE_SKILL } from "./builtin-skills/10-skill-memory-hygiene";
import { MEMORY_CLASSIFY_SKILL } from "./builtin-skills/11-skill-memory-classify";
import { SKILL_AUDIT_SKILL } from "./builtin-skills/12-skill-skill-audit";
import { MEMORY_MCP_SKILL } from "./builtin-skills/13-skill-memory-mcp";
import { effectiveMemoryBackend } from "./memory-backend";

/** 已退役的内置技能：磁盘上的内容仍是**我们当初写的那份**时，随升级清掉目录 ——
 *  否则引擎会同时加载两套浏览器说明（新的实操手册 + 旧的通道说明），模型读到自相矛盾的指引。
 *  ⛔ 只认逐字一致的指纹：用户改过、或自己建的目录**一律不碰**（不越界删用户文件）。
 *    被总闸禁用的技能文件名是 `SKILL.md.disabled`，两个名字都要比。 */
const RETIRED_SKILLS: [string, string][] = [["browser-automation", RETIRED_BROWSER_SKILL]];

export async function ensureBuiltinSkills(skillsDir: string) {
  const entries: [string, string][] = [
    ["desktop-automation", DESKTOP_SKILL],
    ["browser-skill", BROWSER_SKILL],
    // 写作/输出风格类内置技能（09-21 用户：「对我们有帮助的都内置安装好」）。
    //  ⛔ 内容与上游**逐字一致**（MIT 许可，来源见 THIRD_PARTY_NOTICES.md）—— 别在常量里手改，
    //    改了就没法按 upstream sha 判断「上游有没有更新」（预检【82】会比对 sha）。
    //    要改行为请改 entries 名/停用，或在文档里说明，而不是就地改写原文。
    ["humanizer", HUMANIZER_SKILL],
    ["no-ai-slop", NO_AI_SLOP_SKILL],
    ["i-have-adhd", I_HAVE_ADHD_SKILL],
    // 教模型用内置 markitdown 读二进制文档（PDF/Word/Excel/PPT）—— 附件链路的关键一环
    ["document-convert", DOC_CONVERT_SKILL],
    // 元技能「怎么造技能」：经验包的积累通道。写成技能而不是塞进 developer_instructions，
    // 是因为格式正文只在"真要沉淀时"才需要被读（渐进披露，省每轮 token）。
    ["skill-authoring", SKILL_AUTHORING_SKILL],
    // 元技能「怎么蒸记忆金字塔」：水位提示出现时按它把那一层压下去（引擎自助，用户 09-22 点名）
    ["memory-distill", MEMORY_DISTILL_SKILL],
    // ── 09-23 用户点名要的四件（「技能配置与集成…内置为默认能力」）─────────────────
    // 收尾复盘：任务完成后自我总结 → 识别错误/改进点 → 沉淀为记忆与技能（自我进化的入口）
    ["self-review", SELF_REVIEW_SKILL],
    // 记忆整洁与清理规则（八层能清什么、什么永不自动清、三个危险动作的后果）—— 机械面在 memory-hygiene.ts
    ["memory-hygiene", MEMORY_HYGIENE_SKILL],
    // 写记忆前的分类与去重口径（一条一现象、四分类优先级）—— 机械面在 memory-lessons.ts
    ["memory-classify", MEMORY_CLASSIFY_SKILL],
    // ⛔ 强制门禁：装任何技能之前先按它审一遍（用户 09-23 明令）。与 skills-market 的机器扫描是"闸门 + 复核"。
    ["skill-audit", SKILL_AUDIT_SKILL],
    // 09-25：记忆后端 = MCP 时的写法（与 memory-classify 二选一，见下方互斥切换）
    ["memory-mcp-backend", MEMORY_MCP_SKILL],
  ];
  for (const [name, content] of entries) {
    const dir = path.join(skillsDir, name);
    const activeFile = path.join(dir, "SKILL.md");
    const disabledFile = path.join(dir, "SKILL.md.disabled");
    try {
      // ⛔ 必须尊重用户的停用状态（09-20 修）：能力总闸停用技能时是把 SKILL.md 改名成
      //    SKILL.md.disabled，而这里原先无条件写回 SKILL.md ⇒ **用户关掉的技能每次启动都被静默
      //    重新启用**，总闸形同虚设；症状还特别隐蔽（界面显示「已停用」，引擎却照常加载）。
      //    两个文件名与 main.ts 的 skills:local-list / set-skill-enabled 保持同源。
      const target = existsSync(activeFile)
        ? activeFile
        : existsSync(disabledFile) ? disabledFile : activeFile;
      const existing = await fs.readFile(target, "utf8").catch(() => "");
      // 比对前归一化行尾：停用/启用会把文件重写成 LF，与常量里的行尾不同，
      // 逐字比会每次启动都重写一遍（无意义写盘，且让「内容未变就别动」的判据失效）。
      if (existing.replace(/\r\n/g, "\n") !== content.replace(/\r\n/g, "\n")) {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(target, content, "utf8");
      }
    } catch { /* 写不进不阻塞启动 */ }
  }

  /* 09-25 记忆后端**互斥**：启用 MCP 记忆后端时只留 memory-mcp-backend，内置分类技能必须停用。
     ⛔ 不这么做的话，引擎会同时读到两套互相矛盾的写法（一套让它往 lessons/*.md 写、
     一套让它调 MCP 工具）—— 用户原话：「不要 mcp 写了记忆，又用金字塔记忆，这样重复了」。
     ⛔ 用**改名**（SKILL.md ⇄ SKILL.md.disabled）而不是删目录：切回内置时立刻恢复，不用重写盘。
     ⛔ 这是后端语义驱动的强制切换（与「能力总闸」同源），会覆盖对这两个技能的手动启停。 */
  try {
    /* ⛔ 用**生效**后端（带可用性回退），与 appendLesson 的判据同源：
       选了 MCP 但服务没装好时，技能必须保持 memory-classify（写内置），
       否则会出现「技能教模型调 MCP 工具、而工具根本不存在」的空指引。 */
    const backend = effectiveMemoryBackend();
    const setEnabled = async (name: string, enabled: boolean) => {
      const dir = path.join(skillsDir, name);
      const activeFile = path.join(dir, "SKILL.md");
      const disabledFile = path.join(dir, "SKILL.md.disabled");
      if (enabled && existsSync(disabledFile)) await fs.rename(disabledFile, activeFile);
      else if (!enabled && existsSync(activeFile)) await fs.rename(activeFile, disabledFile);
    };
    await setEnabled("memory-mcp-backend", backend === "mcp");
    await setEnabled("memory-classify", backend === "builtin");
  } catch { /* 不阻塞启动 */ }

  // 退役清理：只删「内容仍是我们写的那份」的旧内置技能目录（browser-automation → browser-skill）。
  //  ⛔ 内建写入是只增不删的：不清理的话，老用户磁盘上那份旧技能会继续被引擎加载，
  //    模型同时读到两套浏览器说明（自相矛盾的指引）。
  //  ⛔ 只认逐字一致的指纹：用户改过、或自己建的目录一律不碰（不越界删用户文件）。
  //    被总闸禁用的技能文件名是 SKILL.md.disabled，两个名字都要比。
  for (const [name, original] of RETIRED_SKILLS) {
    const dir = path.join(skillsDir, name);
    try {
      for (const fn of ["SKILL.md", "SKILL.md.disabled"]) {
        const existing = await fs.readFile(path.join(dir, fn), "utf8").catch(() => null);
        // ⛔ 比对必须归一化行尾：技能被总闸停用/启用过一次后，文件可能被重写成 LF，
        //    而常量是 CRLF —— 只用 trim() 会比出「被改过」而跳过清理（09-19 实测踩到：
        //    验收里旧技能目录一直留着，根因就是这个）。行尾不是「内容」的一部分。
        if (existing === null) continue;
        if (existing.replace(/\r\n/g, "\n").trim() !== original.replace(/\r\n/g, "\n").trim()) {
          // ⛔ 不删，但**必须留痕**：静默跳过会让「两套浏览器说明同时被加载」这种问题
          //    完全查不出（09-19 实测：指纹差 1 个字符，清理静默失效，只有真机验收才发现）。
          console.warn(`[skills] 退役技能 ${name} 的内容已被改动（非我们写的那份），保留不动`);
          continue;
        }
        await fs.rm(dir, { recursive: true, force: true });
        console.log(`[skills] 已退役内置技能 ${name}（目录已清理）`);
        break;
      }
    } catch { /* 删不掉不阻塞启动 */ }
  }
}

/**
 * 专家技能市场（09-13）：cheat-on-content / ppt-master 随包静态分发在
 * resources/expert-skills/（含 .claude-plugin/marketplace.json 清单），**原位不动、零拷贝**——
 * 只在 config.toml 幂等注册 [marketplaces.expert-skills]（source_type=local 指向该目录），
 * 引擎 plugin/list 直接从原目录发现技能，装好即用。
 * 该段不在 HARNESS_CONFIG_SECTIONS，harness 整份重写 config 时由 preserveUserConfig 原样保留。
 */
export async function ensureExpertSkillsMarketplace(codexHome: string): Promise<void> {
  const marketDir = expertSkillsSourceDir();
  const configPath = path.join(codexHome, "config.toml");
  try {
    const existing = await fs.readFile(configPath, "utf8").catch(() => "");
    if (!/\[marketplaces\.expert-skills\]/.test(existing)) {
      const section = [
        "[marketplaces.expert-skills]",
        'source_type = "local"',
        `source = "${marketDir.replaceAll("\\", "/")}"`,
        "",
      ].join("\n");
      const next = existing.trim() ? existing.trimEnd() + "\n\n" + section + "\n" : section + "\n";
      await fs.writeFile(configPath, next, "utf8");
    }
  } catch (error) {
    console.warn("seed expert-skills marketplace section failed:", error);
  }
}

/** 专家技能包源目录：开发版用项目 resources/，打包版用 process.resourcesPath（与 voicePresetsDir 同规则）。
 *  ⚠️ 导出给 expert-teams 用：内置专家要把「技能包绝对路径」写进 systemPrompt 做兜底 ——
 *  `[marketplaces.expert-skills]` 只是让技能**可被发现**，用户没装就不可用
 *  （实测 codex-home/plugins/cache 下没有 expert-skills 条目）。路径写死进提示词，
 *  专家才能用文件工具直接读到规则集，闭环不依赖「用户是否去技能中心装过」。 */
export function expertSkillsSourceDir(): string {
  const dev = path.join(process.cwd(), "resources", "expert-skills");
  if (existsSync(dev)) return dev;
  return path.join(process.resourcesPath ?? process.cwd(), "expert-skills");
}
