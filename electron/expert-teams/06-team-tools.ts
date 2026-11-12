/**
 * expert-teams 的「team-tools」部分（09-22 从同目录 expert-teams.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import type { ExpertTeamConfig } from "./01-team-types";
// ─────────────────────────────────────────────────────────────
// 团队会话上下文构建（注入主理人会话）
// ─────────────────────────────────────────────────────────────
/**
 * ⛔⛔ 11-12 用户：「如果还要我指定让他派哪个人干嘛，那就是废物，自己成员都不了解？」
 *   「成员名册+能力清单」。
 *
 * 主理人要能**自己点将**，前提是名册里写着"他擅长什么、能交出什么"，而不是只有一个花名。
 * ⛔ 一处口径：主理人的系统提示词与成员开跑时的上下文都读这一份（别各写一套名册格式）。
 * 能力来源优先级：一句话职责（description）→ 角色定义首段（systemPrompt 去标题后第一段）。
 */
export function memberRosterLines(
  team: { lead?: ExpertTeamConfig["lead"]; members: ExpertTeamConfig["members"] },
  opts: { withLead?: boolean; selfId?: string } = {},
): string {
  const all = [...(opts.withLead && team.lead ? [team.lead] : []), ...team.members].filter(Boolean);
  const self = String(opts.selfId ?? "").toLowerCase();
  return all
    .map((m) => {
      const oneLine = String(m.description ?? "").replace(/\s+/g, " ").trim();
      /* 角色定义首段：去掉 markdown 标题与空行，取第一段有效文字（通常就是"你能做什么"）。 */
      const firstPara = String(m.systemPrompt ?? "")
        .split("\n")
        .map((line) => line.replace(/^#+\s*/, "").trim())
        .find((line) => line.length >= 12 && !/^[-*|]/.test(line)) ?? "";
      const ability = (oneLine || firstPara).slice(0, 110);
      const isMe = String(m.id ?? "").toLowerCase() === self;
      return `- ${m.name}｜${m.id}｜${m.profession.zh}${ability ? `｜擅长：${ability}` : ""}${isMe ? "　← 这就是你" : ""}`;
    })
    .join("\n");
}

/** 构建主理人的系统提示：团队组织 + 名册能力清单 + SOP + 铁律 */
export function buildTeamSystemPrompt(team: ExpertTeamConfig): string {
  const memberList = memberRosterLines(team, { withLead: true });
  return `# ${team.displayName.zh}

你是本专家团的主理人 ${team.lead.name}（${team.lead.profession.zh}）。

${team.lead.systemPrompt}

## 你的角色：这个群里最高的负责人

成员各管一摊，**只有你对整件事负责** —— 目标、拆解、派谁、什么时候派、验收、收尾。
你比任何成员都更清楚：现在做到第几步、谁在做什么、谁交回了什么、还差什么、卡在哪。

### 你始终要掌握的五件事
1. **目标**：这一轮要交付什么，什么算完成
2. **队伍**：团里有谁、各自擅长什么、谁手上还有活
3. **计划**：拆成几步、每步的交付物、谁做、先后与依赖
4. **进度**：第几步在做、谁已交回、谁卡住、缺什么
5. **未决**：还有哪句话没回、哪个产出没验收

不清楚就先查（group_read / group_members），⛔ 别猜、别编。

### 接活的顺序（一步都不能跳）
① **分析** —— 交付物是什么、难点在哪、有没有必须先确认的前提
② **拆解** —— 分成有先后顺序的几步，每步一个**可验收**的交付物
③ **点将** —— **由你按各自擅长决定派谁**。这是你的本职，⛔ 不许问用户「要派给谁」「谁来做合适」
   （自己的团队都不了解，那要你干什么）；只有确实缺某一类人，才说一句缺什么
④ **发计划** —— 调 team_plan 把（目标 / 步骤 / 谁做 / 顺序）发成群里**一条**消息，让所有人跟你对齐
⑤ **派第一步** —— 只派当前这一步，写清「输入 / 交付物 / 交给谁」

### 派活的规矩
- 一次只推进一个阶段；后一步要用前一步的产出，就**等它交回**再派
- 只有彼此真正不依赖的才并行；⛔ 别把一条链拆成几个人同时跑
- 每次派活都写清三件事：输入是什么 / 交付物是什么 / 交给谁
- 同一位成员的同一件活只派一次

### 成员交回之后（这才是你该干活的时候）
1. **验收**：对照交付物看够不够；不合格就点名打回，并说清差哪一点
2. **记账**：这一步算完成，更新计划里的位置
3. **推进**：按计划派下一步；没有下一步就进入收尾
4. **收尾**：全部完成时给一条结论 —— 结论 / 依据 / 还剩什么没做

### 你自己的活 vs 成员的活（分清楚，这不是"你什么都不许做"）
**你可以自己干**：拟题目、列提纲、定验收标准、查资料、做判断、写计划与结论、把关质量。
**必须交给成员**：真正的**可交付物** —— 成品文件 / 代码 / 文案 / 设计稿 / 数据 / 报告正文。
判断标准只有一句：**这个东西是要交出去的成品吗？** 是 ⇒ 派给成员；不是（提纲、标准、结论）⇒ 你自己写。
⛔ 最忌讳的是"一个人把整条链干完"：从头写到尾、成员一个没动 —— 那这个团队就没有存在的意义，
用户看到的也只是一段你自己的长文。**每一步都要有人真的在做，你负责让他做对。**

### ⛔ 你不做的事
- 不代写成员的交付物（他那一份成品必须他自己产出）
- 不自己发明任务：用户没说要做什么，就先问一句
- 不在群里刷屏：只发两条（计划、结论）；中间不报进度、不复述派给谁
- 不重复派同一位同一件活，不替成员说话

### 群里怎么说话
- **计划**：编号短句，谁做什么一目了然
- **结论**：一句话结论 → 2~3 条依据 → 风险/未决 → 下一步
- 其余时间闭嘴 —— 让成员的产出自己说话。


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
/**
 * ⛔⛔ 11-12 用户：「你给他们设计好流程，配套好工具」。
 *
 * 原来流程只写在提示词里 —— 计划在模型脑子里、进度靠它自己记，交回几轮就乱了。
 * ⇒ 把流程做成**工具**：计划必须先写出来（team_plan，落成群里一条消息），进度随时可查（team_status）。
 *   ⛔ 计划不另存一份状态：它就是群里那条消息（刷新/重启都还在，用户也看得见）。
 */
export function buildTeamPlanTool() {
  return {
    type: "function",
    name: "team_plan",
    description: "开工第一步：把任务拆成**有先后顺序**的步骤，写成一条计划发进群，让所有人对齐。"
      + "⛔ 必须先调它，再派第一步；⛔ 用户还没说清要做什么时不要调（先问）。"
      + "步骤要按依赖排序：后一步用到前一步的产出，就排在后面。",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "这轮要交付什么（一句话，说清「什么算完成」）" },
        steps: {
          type: "array",
          minItems: 1,
          description: "按先后顺序排好的步骤（每一步一个可验收的交付物）",
          items: {
            type: "object",
            properties: {
              memberName: { type: "string", description: "这一步交给谁（用名册里的花名）" },
              task: { type: "string", description: "这一步要交出什么（一句话）" },
            },
            required: ["memberName", "task"],
          },
        },
      },
      required: ["goal", "steps"],
    },
  };
}

/** 进度查询：把群里刚才发生了什么**原样**给它（⛔ 不给判断、不替它下结论）。 */
export function buildTeamStatusTool() {
  return {
    type: "function",
    name: "team_status",
    description: "查群里最近的进展（谁派了谁、谁交回了什么、还差什么）。"
      + "⛔ 不确定做到第几步、谁交回了什么时先调它，别凭记忆猜。",
    inputSchema: { type: "object", properties: {} },
  };
}

/** 构建整团可用的团队工具清单（派活 / 查状态 / 成员协作），⛔ 这里只出 schema，不执行任务。 */
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
