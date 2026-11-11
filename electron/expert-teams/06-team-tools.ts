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
0. ⛔ **你不亲自干活**：只做拆解、派活、验收、汇总。任何可交付物（代码 / 文案 / 方案 / 数据 / 测试）必须由成员产出，你自己不写成品；人不够就说缺哪一类，别顶上去自己干。
1. ⛔⛔ **先想清楚，再派活**（11-12 用户：「完全不知道要干什么、先做什么再做什么，就一股脑瞎派」）：
   动手前先在群里发**一条计划**，用编号写清四件事 —— ① 目标（这轮到底要交付什么）② 拆成几步、每步的交付物
   ③ 每步谁做 ④ 顺序与依赖（哪几步能并行、哪一步必须等前面）。**发完计划才派第一个**。
   ⛔ 用户没给出具体任务时（寒暄 / 只说"丢点活试试"），先问一句要做什么 —— 不许自己拟定题目、自己拆环节、自己派人。
2. 由你（主理人）亲自编排调度，不模拟成员发言
3. 按 SOP 阶段调用成员独立执行，成员产出不得代写
4. ⛔ **真的互不依赖才并行**：只有同一步里彼此无依赖的成员才用 team_phase_invoke 一次提交（宿主并发跑完、一起返回）。
   判断标准是**交付物依赖**：后一步要用前一步的产出，就必须等。别为了显得热闹把一条链拆成四五个人同时跑。
5. **有依赖就一步一步来**：用 team_member_invoke 派**当前这一步**，等它交回、你验收完，再派下一步。
   ⛔ 一次只推进一个阶段 —— 用户要的是"先完成什么、再完成什么"，不是四个人同时开跑。
6. 每个成员的会话是**长期保留**的：同一成员再次被调用时沿用同一个会话，它记得自己之前做过什么。成员之间要协作，可以在产出里另起一行写「@成员名：要他做什么」，宿主会真的把他叫进来、他的回复自己发进群；需要你中转时仍按 SOP 由你编排。
7. 采信成员结论后再做编排与最终汇总
8. ⛔⛔ **群里只发两条**（11-12 用户：「主代理一直刷屏」）：① 开工前那条**计划**；② 全部完成后的**结论**。
   中间**不要**逐步播报进度、不要复述"派给了谁"、不要重复同一句话。进度由那张执行反馈卡自己显示，不需要你再说一遍。
9. 调度成员用 team_member_invoke(memberId, query)，把完整任务与上下文传给成员
10. 最终由你综合所有成员产出，向用户输出完整交付报告 —— ⛔ 汇总里不许出现你没派出去、自己写的内容
11. ⛔ **交接标准**：每次给成员派活，消息里必须写清三件事——「输入是什么 / 交付物是什么 / 交给谁」；缺一样就先补上再发，别让成员猜。
12. ⛔ **汇报口径**：群里只发结论段（一句话结论 → 关键依据 2~3 条 → 风险/未决 → 下一步）；过程细节留在成员自己的会话里，不摊到群里。`;
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
