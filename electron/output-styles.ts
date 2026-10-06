/**
 * 输出风格（10-06 用户报障：「这个没有自动生效，要我点名才生效」）。
 *
 * 「写作风格类内置技能」（i-have-adhd / humanizer / no-ai-slop…）此前只做到一半：
 * 技能文件在磁盘上 = 引擎**能发现**它，但引擎对技能是**渐进披露**的 —— 技能目录只给
 * name + description + 路径，用不用由模型自己判断；而 i-have-adhd 的 description 开头就是
 * 「Invoke with /i-have-adhd; stays on until "stop adhd mode"」，模型把它读成**手动模式**，
 * 于是永远等用户点名（10-06 用户截图实证：开关开着，第一轮照样不点火）。
 * 用户要的是「开关一开就生效」⇒ 只能由宿主把开关状态翻译成**常驻指令**。
 *
 * ⛔⛔ 同时纠正一条旧认知（10-06 二进制取证，别再拿它当理由）：
 *   技能 frontmatter 的 `disable-model-invocation: true` **引擎并不执行**。
 *   取证 = 全量扫引擎二进制（codex.exe，322MB），该字段（中划线/下划线两种写法）只出现在两处：
 *     ① 给模型看的**技能编写规范**文本（"- disable-model-invocation: true for workflows with side effects"）；
 *     ② 一个校验**插件内**技能（`<plugin>/skills/<name>/SKILL.md`）的 Python 脚本，
 *        而那条规则的内容是「必须是 false」。
 *   `$CODEX_HOME/skills/` 不走那个校验，Rust 侧也没有任何读取/过滤它的代码
 *   ⇒ 它既不是「不生效」的原因，也不构成障碍。
 *   （10-03 那次「引擎认这个字段」的结论其实只证明「二进制里有这串字」—— 恰好正是这两种，
 *    属本仓反复踩的「注释声称能力」；技能原文仍逐字保留、不动它。）
 *
 * 落点：`developer_instructions`（与桌面自动化 / 浏览器自动化 / 生图 / 视觉四个能力段同一通道、
 * 同一口径）—— 全局、每轮都在、所有会话（含被委派）都拿得到；开关一变由
 * `refreshDeveloperInstructions()` 立刻重写 config.toml 并重启引擎。
 * 拓展方式：往 OUTPUT_STYLES 加一行（id + 技能名 + 标签），别在别处硬编码技能名。
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { globalSkillsDir, SKILL_FILE } from "./skill-pack";
import { readGlobalDisabled } from "./skill-pool";

export type OutputStyle = {
  /** 稳定 id（只用于日志/界面；状态一律以技能名为准） */
  id: string;
  /** 技能目录名 = SKILL.md frontmatter 的 name（与 builtin-skills 的 entries 同源） */
  skill: string;
  /** 界面上的中文标签（与设置页卡片文案同源） */
  label: string;
};

/** 风格技能登记表（**单一真相源**）。⛔ 新增风格技能只改这里一行。 */
export const OUTPUT_STYLES: OutputStyle[] = [
  { id: "adhd", skill: "i-have-adhd", label: "直白写作（ADHD 风格）" },
];

/** 这条技能是不是「输出风格」（决定它启停后要不要重下发 developer_instructions）。
 *  ⛔ 给 IPC 用：池面板能开关任意技能，但只有风格类才牵动常驻指令 ——
 *    其余技能启停不必重启引擎（重启是有代价的，别一刀切）。 */
export function isOutputStyleSkill(name: string): boolean {
  return OUTPUT_STYLES.some((style) => style.skill === String(name ?? ""));
}

/**
 * 当前**生效**的风格技能（= 不在全局停用集里，且技能文件真的在磁盘上）。
 * ⛔ 判据只认技能池的全局停用集（`codex-home/skill-global-disabled.json`）——
 *   与控制台开关、技能页共享技能池**同一份真相源**；这里绝不另存一份状态
 *   （两份状态必然各说各话，本仓 09-27 的技能池重构就是为消灭它）。
 * ⛔ 还要求 SKILL.md 真的存在：指令里会点名这个路径，指向一个不存在的文件 = 空指引。
 */
export function activeOutputStyles(codexHome: string): OutputStyle[] {
  try {
    const disabled = readGlobalDisabled(codexHome);
    return OUTPUT_STYLES.filter(
      (style) => !disabled.has(style.skill) && existsSync(path.join(globalSkillsDir(codexHome), style.skill, SKILL_FILE)),
    );
  } catch {
    return [];
  }
}

/** 下发用目标：技能名 + 标签 + **SKILL.md 绝对路径**。
 *  ⛔ 路径必须写进指令：模型未必在技能清单里看到它（清单是否收录该技能不由我们决定），
 *    点名绝对路径才保证读得到。 */
export function outputStyleTargets(codexHome: string): { skill: string; label: string; file: string }[] {
  return activeOutputStyles(codexHome).map((style) => ({
    skill: style.skill,
    label: style.label,
    file: path.join(globalSkillsDir(codexHome), style.skill, SKILL_FILE),
  }));
}
