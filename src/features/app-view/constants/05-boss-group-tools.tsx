/**
 * constants 的「创世 boss · 群编排」部分（2026-10-24 新增，独立板块的工具面）。
 *
 * ⛔ 这套工具**只给 boss 会话用**（带队的那个），成员会话不挂：成员不许拉人、不许审人。
 * ⛔ 派活是**异步**的（宿主 turn/start 立刻返回，结果回投给 boss）—— 描述里必须写死，
 *    否则模型会以为"派完就拿到结果了"，接着基于空气往下编。
 */

export const GROUP_CREATE_TOOL = {
  type: "function",
  name: "group_create",
  description:
    "建一个「群」：你当 boss，成员各自是一条常驻会话（有名字、岗位、模型，能记住自己做过什么）。"
    + "⛔ 岗位（role）和 systemPrompt 要在这一步写清 —— 成员会话的工具面在建会话那一刻定死，之后改不了。"
    + "成员默认 1~6 个；建完返回群 id 与成员 id（后续派活要用）。",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "群名（会出现在成员会话标题里，如「落地页上线」）" },
      workspace: { type: "string", description: "工作区路径；省略 = 当前会话工作区" },
      members: {
        type: "array",
        description: "成员清单（1~6 个）",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "成员名（如「写手」「前端」）" },
            role: { type: "string", description: "岗位（一句话，决定它的专业面）" },
            systemPrompt: { type: "string", description: "额外交代：风格、边界、禁止事项" },
            model: { type: "string", description: "可选：单独指定模型（省略 = 当前模型）" },
            effort: { type: "string", description: "可选：思考档" },
          },
          required: ["name", "role"],
        },
      },
      maxRejects: { type: "number", description: "打回上限，默认 2（超过就升级给用户）" },
      budgetMinutes: { type: "number", description: "整群时间预算（分钟），默认 40；用尽自动暂停派活" },
    },
    required: ["name", "members"],
  },
};

export const GROUP_ASSIGN_TOOL = {
  type: "function",
  name: "group_assign",
  description:
    "给群里某个成员派一条任务。**立刻返回**（成员在它自己的会话里异步干活；交活、审查、打回都会回到你这里）。"
    + "⛔ criteria（验收标准）必填 —— 独立评审按它判，打回理由也必须对得上它；没有标准就等于没法审。"
    + "⛔ 不要在一次回复里派完就等结果：派完先继续你的话，结果到了会有一条 [群事件] 找你。",
  inputSchema: {
    type: "object",
    properties: {
      groupId: { type: "string", description: "群 id" },
      title: { type: "string", description: "任务标题（短）" },
      brief: { type: "string", description: "任务说明：要什么、边界、参考物" },
      criteria: { type: "string", description: "验收标准（可逐条列，审查与打回都按它判）" },
      assignee: { type: "string", description: "可选：指定成员 id（省略 = 自动挑一个没被锁的）" },
    },
    required: ["groupId", "title", "brief", "criteria"],
  },
};

export const GROUP_STATUS_TOOL = {
  type: "function",
  name: "group_status",
  description: "读群账本：成员状态、每个任务到哪一步、被打回几次、谁被锁了、事件流。传 groupId 省略则列出所有群。",
  inputSchema: {
    type: "object",
    properties: { groupId: { type: "string", description: "群 id；省略 = 列出所有群" } },
  },
};

export const GROUP_REVIEW_TOOL = {
  type: "function",
  name: "group_review",
  description:
    "对某条已交活的任务给结论（默认由独立评审做，这条是**人工覆盖口**：评审判得不对、或用户说要打回时用）。"
    + "⛔ verdict=rejected 必须给 reasons，且要指向验收标准里的具体条；空理由会被宿主直接拒绝。",
  inputSchema: {
    type: "object",
    properties: {
      taskId: { type: "string" },
      verdict: { type: "string", enum: ["approved", "rejected"] },
      reasons: { type: "array", items: { type: "string" }, description: "打回理由（必须非空且具体）" },
    },
    required: ["taskId", "verdict"],
  },
};

export const GROUP_ESCALATE_TOOL = {
  type: "function",
  name: "group_escalate",
  description:
    "任务升级后的三选一（打回超限 / 全群都被锁时用）：retry-with-other-model（换模型重做）、"
    + "relax-criteria（放宽标准：必须给 note 写新标准）、user-takeover（用户自己接手）。",
  inputSchema: {
    type: "object",
    properties: {
      taskId: { type: "string" },
      choice: { type: "string", enum: ["retry-with-other-model", "relax-criteria", "user-takeover"] },
      note: { type: "string", description: "relax-criteria 时必填：新的验收标准原文" },
    },
    required: ["taskId", "choice"],
  },
};

export const GROUP_BROWSER_TOOL = {
  type: "function",
  name: "group_browser_setup",
  description:
    "检查成员能不能用浏览器（ego lite）。每个成员**各自一个独立 TaskSpace**（codex-<它的线程>），同群并行不冲突。"
    + "没装就调它：会打开官方下载页并告诉你装完怎么回来复查（⛔ 不要自己编安装命令）。",
  inputSchema: { type: "object", properties: {} },
};

export const GROUP_ADD_MEMBER_TOOL = {
  type: "function",
  name: "group_add_member",
  description:
    "给已有的群加一个成员（动态拉人）。只建档，不立刻建会话 —— TA 第一次被派活时才有自己的会话。"
    + "返回成员 id，之后 group_assign 可以指派给 TA。",
  inputSchema: {
    type: "object",
    properties: {
      groupId: { type: "string" },
      name: { type: "string", description: "成员名" },
      role: { type: "string", description: "岗位（一句话）" },
      systemPrompt: { type: "string", description: "可选：风格与边界交代" },
      model: { type: "string", description: "可选：单独指定模型" },
      effort: { type: "string", description: "可选：思考档" },
    },
    required: ["groupId", "name", "role"],
  },
};

export const GROUP_REMOVE_MEMBER_TOOL = {
  type: "function",
  name: "group_remove_member",
  description:
    "把成员移出群。⛔ 会话与轨迹保留（不删）；TA 手上正在跑的任务**不打断**——交活后照常审查，之后不再派活；"
    + "TA 的未派任务会自动换人（被移出视同锁死）。",
  inputSchema: {
    type: "object",
    properties: {
      groupId: { type: "string" },
      memberId: { type: "string" },
    },
    required: ["groupId", "memberId"],
  },
};

/** 工具面批量注入用（顺序 = 模型看到的顺序：建群 → 派活 → 查账 → 审/升级 → 成员管理 → 浏览器）。 */
export const BOSS_GROUP_TOOLS = [
  GROUP_CREATE_TOOL,
  GROUP_ASSIGN_TOOL,
  GROUP_STATUS_TOOL,
  GROUP_REVIEW_TOOL,
  GROUP_ESCALATE_TOOL,
  GROUP_ADD_MEMBER_TOOL,
  GROUP_REMOVE_MEMBER_TOOL,
  GROUP_BROWSER_TOOL,
];
