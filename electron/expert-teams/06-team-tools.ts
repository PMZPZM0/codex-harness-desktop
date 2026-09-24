/**
 * expert-teams 的「team-tools」部分（09-22 从同目录 expert-teams.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import type { ExpertTeamConfig } from "./01-team-types";
// ─────────────────────────────────────────────────────────────
// 团队会话上下文构建（注入主理人会话）
// ─────────────────────────────────────────────────────────────
/** 构建主理人的系统提示：团队组织 + 成员清单 + SOP + 铁律 */
export function buildTeamSystemPrompt(team: ExpertTeamConfig): string {
  const memberList = team.members
    .map((m) => `- ${m.name}（${m.id}）${m.profession.zh}：${m.description}`)
    .join("\n");
  return `# ${team.displayName.zh}

你是本专家团的主理人 ${team.lead.name}（${team.lead.profession.zh}）。

${team.lead.systemPrompt}

## 团队成员（Agent ID 即 team_member_invoke 的 memberId）
${memberList}

## 标准工作流程（SOP）
${team.sop}

## 协作铁律
1. 由你（主理人）亲自编排调度，不模拟成员发言
2. 按 SOP 阶段调用成员独立执行，成员产出不得代写
3. ⛔ **同阶段并行用 team_phase_invoke**：SOP 里标「并行」的阶段，把该阶段所有成员写进**一次** team_phase_invoke(tasks) 提交 —— 宿主会并发跑完、一次性返回全部结论。**不要**用 team_member_invoke 逐个调用：实测那样会退化成串行，整轮耗时变成各成员耗时之和。
4. 只有「单个成员的任务」、或 SOP 明确标「串行」/后一阶段**依赖前一阶段产出**时才用 team_member_invoke（例如风控官必须先拿到前序结论）。
5. 每个成员的会话是**长期保留**的：同一成员再次被调用时沿用同一个会话，它记得自己之前做过什么。但成员之间仍然互不可见，跨成员信息一律经你中转。
6. 采信成员结论后再做编排与最终汇总
7. 每完成一个阶段向用户简要通报进度
8. 调度成员用 team_member_invoke(memberId, query)，把完整任务与上下文传给成员
9. 最终由你综合所有成员产出，向用户输出完整交付报告`;
}

/** 构建团队会话工具描述（注入 dynamicTools） */
export function buildTeamTools(team: ExpertTeamConfig) {
  const memberOptions = team.members.map((m) => `${m.id}（${m.name}·${m.profession.zh}：${m.description}）`).join("；");
  return {
    type: "function",
    name: "team_member_invoke",
    description: `你是「${team.displayName.zh}」的主理人。调用此工具调度一个团队成员在独立会话中完成子任务并返回结构化结果，成员产出必须经你中转与汇总，不得代写。若同一阶段需要多个成员（SOP 标「并行」），请在同一个回合内**一次性发起多个 team_member_invoke 调用**——宿主会并发执行它们，比逐个调用快得多。可用成员：${memberOptions}。`,
    inputSchema: {
      type: "object",
      properties: {
        memberId: { type: "string", description: `要调用的成员 ID，必须是：${memberOptions}`, enum: team.members.map((m) => m.id) },
        query: { type: "string", description: "交给成员的完整子任务描述，信息要足够独立执行" },
      },
      required: ["memberId", "query"],
    },
  };
}

/** 并行阶段工具：一次提交同一阶段的**全部**成员，宿主并发执行后一次性返回全部结论。
 *  为什么需要它（09-14 实测）：只靠提示词让模型「一次性发多个调用」不可靠 —— 实测它仍然
 *  逐个发，退化成串行，整轮耗时 = 各成员之和（4 个成员 160s）。把并行做成一个工具，
 *  并行就由宿主保证，而不是靠模型自觉。 */
export function buildTeamPhaseTool(team: ExpertTeamConfig) {
  const memberOptions = team.members.map((m) => `${m.id}（${m.name}·${m.profession.zh}）`).join("；");
  return {
    type: "function",
    name: "team_phase_invoke",
    description: `并行调度同一阶段的多个成员：把该阶段所有子任务一次性提交，宿主会**并发**跑完它们并把全部结论一起返回。SOP 里标「并行」的阶段必须用本工具 —— 用 team_member_invoke 逐个调用会退化成串行，总耗时变成各成员耗时之和。可用成员：${memberOptions}。`,
    inputSchema: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          minItems: 1,
          description: "本并行阶段要下发的全部子任务（同一阶段、互不依赖）",
          items: {
            type: "object",
            properties: {
              memberId: { type: "string", description: `成员 ID，必须是：${memberOptions}`, enum: team.members.map((m) => m.id) },
              query: { type: "string", description: "交给该成员的完整子任务描述，信息要足够独立执行" },
            },
            required: ["memberId", "query"],
          },
        },
      },
      required: ["tasks"],
    },
  };
}
