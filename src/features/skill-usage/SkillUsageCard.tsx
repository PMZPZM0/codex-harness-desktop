/**
 * 技能使用卡 —— 「用了哪个技能、这个技能管什么、这一步具体做了什么」的**唯一渲染口**。
 *
 * ⛔⛔ 10-29 用户令（附截图）：「为啥使用技能是运行命令呢，下面也没有使用技能映射反馈，
 *    摸清楚逻辑，再给我做一个使用技能展示，不要展示运行命令」。
 *
 * 摸清的逻辑（改之前的样子）：
 *   引擎里**没有"技能调用"这种事件**。模型"用技能"在事件流里就是一条普通的
 *   `commandExecution`（最常见是 `Get-Content …/skills/<名>/SKILL.md`，其次跑技能自带脚本）。
 *   所以：
 *     ① 渲染层靠 `skillOfItem` 的字面特征把这条命令认成技能，**表头**改成「已使用技能」；
 *     ② 但那张卡仍是 `CommandExecutionCard`（命令卡）—— 展开体是「Shell / 用途 / 耗时 / 输出」，
 *        动词映射表还是命令那套，状态行（run-activity-bar）也照旧写「正在运行命令」。
 *   ⇒ 用户看到的就是"上面说用了技能、下面说在运行命令"，而且整张卡没有任何一处说明
 *      **这个技能是干什么的**（原话：「下面也没有使用技能映射反馈」）。
 *
 * 现在的分工（⛔ 别再合并回去）：
 *   · 命中技能 ⇒ `ItemView` 直接渲染**本卡**，命令卡完全不参与（连"运行命令"这个动词都不会出现）；
 *   · 本卡**不显示命令行原文**：技能卡要说的是"用了什么技能"，不是"敲了什么命令"；
 *     唯一来自命令的信息被翻成人话（`skillActionOf`：读取技能说明 / 运行技能脚本 x / 执行技能命令）；
 *   · 技能的「说明」常驻表头第二行（来自 `skills:local-list` 的 description），展开体给全文 + 输出，
 *     还能一键打开 SKILL.md（用户常问"这技能到底写了什么"）。
 *
 * 扩展点（将来要支持"技能专属展示"时加在这三处，别另开一条渲染路径）：
 *   ① `src/lib/tool-display.mjs` 的 `SKILL_MATCHERS`：认出新技能；
 *   ② `registerKnownSkills()`：把技能的中文名与说明喂进来（已接 `skills:local-list`）；
 *   ③ 本文件：新的展示形态只加在这里。
 */
import { Sparkles, FileText } from "lucide-react";
import type { ThreadItem } from "../../lib/thread-item";
import type { ActionStatus } from "../../components/CardShell";
import { ToolCodeBlock } from "../shared/ToolCodeBlock";
import { ActionCard } from "../session-cards";
import { formatDuration } from "../../lib/format-duration";
import { skillActionOf, skillFilePathOf, skillOfItem } from "../../lib/tool-display.mjs";

export function SkillUsageCard({ item, waitingForApproval, onOpenFile }: {
  item: ThreadItem;
  waitingForApproval?: boolean;
  onOpenFile?: (path: string) => void;
}) {
  const skill = skillOfItem(item);
  /* skill 为空 = 调用方判错了（本卡只该渲染识别出的技能命令）⇒ 什么都不画，别硬贴标签。 */
  if (!skill) return null;
  const running = item.status === "inProgress" || item.status === "running";
  const failed = !running && item.exitCode != null && item.exitCode !== 0;
  const command = String(item.command ?? "");
  const output = String(item.aggregatedOutput ?? "").trim();
  /* 读 SKILL.md 的输出就是说明全文本身（已经铺在卡里了），再重复一遍只是噪音。 */
  const showOutput = Boolean(output) && !/SKILL\.md/i.test(command);
  const action = skillActionOf(command);
  const description = String(skill.description ?? "").trim();
  const skillFile = skillFilePathOf(command);
  const duration = formatDuration(item.durationMs);
  const status: ActionStatus = running ? (waitingForApproval ? "pending" : "running") : failed ? "error" : "done";
  /* 文案与命令卡的技能态同源（守卫【127】）：正在 / 已 / 失败 三态齐全。 */
  const verb = waitingForApproval && running ? "等待批准"
    : running ? "正在使用技能"
      : failed ? "使用技能失败"
        : "已使用技能";
  /* 卡片骨架复用 `ActionCard`（与工具卡同一套折叠行为 / 箭头 / 状态图标 / 无障碍）。
     ⛔ 10-30 用户：「技能还显示两行，不美观」⇒ **不再传 subtitle**：表头收成一行
     「已使用技能 <中文名>」，动作行（运行技能脚本 x / 读取技能说明）留在右侧 info；
     技能说明本来就常驻展开体第一段，不必在表头再占一行。 */
  return (
    <ActionCard
      icon={<Sparkles size={13} />}
      verb={verb}
      target={<code>{skill.label}</code>}
      status={status}
      info={(
        <>
          {action ? <span className="skill-usage-action">{action}</span> : null}
          <code>{skill.skill}</code>
          {duration ? <span>{duration}</span> : null}
        </>
      )}
    >
      {description ? <p className="skill-usage-desc">{description}</p> : null}
      {skillFile && onOpenFile ? (
        <button type="button" className="skill-usage-open" onClick={() => onOpenFile(skillFile)} title={skillFile}>
          <FileText size={12} />打开技能说明
        </button>
      ) : null}
      {showOutput ? <ToolCodeBlock language="text" text={output} revealing={false} className="skill-usage-output" maxHeight={230} /> : null}
    </ActionCard>
  );
}
