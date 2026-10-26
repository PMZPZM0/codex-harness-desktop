/**
 * 创世 boss · 群编排 —— 类型面（唯一真相源）
 *
 * 定位：一个 boss 会话 + N 个成员会话 + 一个任务账本 + 审查打回闭环。
 * ⛔ 群**不是**一条引擎 thread（引擎里一条 thread 只能有一个 agent）：
 *    boss 那条会话是唯一对话入口，成员各自是隐藏的常驻会话，群消息由宿主合成。
 * ⛔ 本文件只有类型与常量，不放逻辑（逻辑在 state.ts，纯函数可断言）。
 */

/** 成员状态：忙 = 有在跑的回合；reviewing = 交活后等审查；locked = 被打回、本轮不许再碰这条活。 */
export type GroupMemberStatus = "idle" | "busy" | "reviewing" | "locked" | "removed";

/**
 * 任务状态机（转换只有 state.ts 里那几个 reducer 能做，其它地方只许读）：
 *   queued → assigned → running → submitted → reviewing ─┬→ approved → done
 *                                                        └→ rejected ─┬→ assigned（换人重做）
 *                                                                     └→ escalated（超限/无人可派）
 */
export type TaskStatus =
  | "queued" | "assigned" | "running" | "submitted" | "reviewing"
  | "approved" | "rejected" | "escalated" | "done" | "failed";

export type ReviewVerdict = "approved" | "rejected";

/** 审查档：自检（成员自己填） / 独立评审（新鲜上下文子智能体） / boss 终审。 */
export type ReviewLevel = "self" | "fresh" | "boss";

export type GroupMember = {
  id: string;
  name: string;
  /** 岗位（决定提示词与擅长领域），建会话时用一次，之后只读。 */
  role: string;
  systemPrompt: string;
  model?: string;
  effort?: string;
  sandbox?: string;
  approvalPolicy?: string;
  /** 常驻复用：同一 (groupId, memberId) 永远同一线程，成员因此记得自己做过什么。 */
  threadId?: string;
  threadName?: string;
  status: GroupMemberStatus;
  /** 锁在哪些任务上（⛔ 任务级，不是成员级：他被锁的是这条活，别的活照做）。 */
  lockedTaskIds: string[];
  /** 执行体来源（10-25 群聊重构）：engine 默认；cli = 外部 CLI（cliCommand 必填）。 */
  source?: GroupMemberSource;
  /** cli 成员的命令模板，`{prompt}` 会被替换成任务全文（例：`zcode -p "{prompt}"`）。 */
  cliCommand?: string;
};

/** 成员执行体来源：engine = 引擎会话（默认）；cli = 本机外部 CLI agent（zcode/qoder/豆包等，派遣时起子进程跑命令行）。 */
export type GroupMemberSource = "engine" | "cli";

export type ReviewRecord = {
  by: ReviewLevel | string;
  verdict: ReviewVerdict;
  /** ⛔ 打回必须给理由，且理由要能对上验收标准（空数组 = 非法，见 state.ts）。 */
  reasons: string[];
  at: number;
};

export type TaskAttempt = {
  n: number;
  memberId: string;
  threadId: string;
  turnId?: string;
  startedAt: number;
  endedAt?: number;
  output?: string;
  review?: ReviewRecord;
};

export type GroupTask = {
  id: string;
  groupId: string;
  title: string;
  /** 任务说明（派活时原样进成员提示词）。 */
  brief: string;
  /** 验收标准（审查 rubric 的唯一来源；打回理由必须引它）。 */
  criteria: string;
  assignee: string;
  status: TaskStatus;
  attempts: TaskAttempt[];
  rejects: number;
  /** ⛔ 作者锁：被打回的作者不许再碰这条任务。放行被锁作者 = 制度失效。 */
  lockedAuthors: string[];
  createdAt: number;
  updatedAt: number;
  endedAt?: number;
  /** 升级给用户时的可选项与当前结论（P0：只出选项，不做自动决策）。 */
  escalation?: { reasons: string[]; options: EscalateChoice[]; at: number };
  /** 预算告警档位（80% 一次，100% 一次），防止每个 tick 都刷事件。 */
  budgetWarned?: "80" | "100";
};

/**
 * 升级选项（P0：只出选项，不做自动决策）
 * ⛔ 10-25 审查修正：原值 `retry-with-other-model` **名不副实** —— 实际既不换模型也不改任何设置，
 *    只是解锁作者 + 清零打回计数后重新排队。按"名字必须描述真实行为"改名为 `retry`；
 *    旧值由 state.ts 的 `normalizeEscalateChoice` 兼容（账本里可能存着老值）。
 */
export type EscalateChoice = "retry" | "relax-criteria" | "user-takeover";

export type GroupPolicy = {
  /** 打回上限（Magentic 的 stall ≤2 同款思路）。默认 2。 */
  maxRejects: number;
  /** 审查档：P0 只实现 fresh（新鲜上下文独立评审）。 */
  reviewer: ReviewLevel;
  /** 预算：分钟（tokens 需要引擎用量口径，P1 再上，⛔ 别写成假字段骗自己）。 */
  budgetMinutes: number;
};

export type GroupEvent = {
  id: string;
  groupId: string;
  taskId?: string;
  memberId?: string;
  kind: "created" | "queued" | "assigned" | "running" | "submitted" | "reviewed" | "rejected" | "reassigned" | "done" | "escalated" | "stalled" | "budget" | "note"
    /* 群聊正文（10-24 用户令：「不在群里回，在外面回，没意思」）——boss/成员/你的发言直接进群流。 */
    | "chat-user" | "chat-boss" | "chat-member";
  text: string;
  at: number;
};

export type BossGroup = {
  id: string;
  name: string;
  createdAt: number;
  workspace: string;
  /** boss 主会话（唯一可对话入口）；事件与提醒都回投到这里。 */
  bossThreadId: string;
  policy: GroupPolicy;
  members: GroupMember[];
  /** paused = 预算打满或用户叫停，不再自动派活。 */
  paused?: boolean;
  /** 置顶的群事件 id（群视图顶部卡带，最多 3 条，超出挤掉最旧；视图层收藏，不影响任务状态）。 */
  pinnedEventIds: string[];
};

export type BossState = {
  version: 1;
  groups: Record<string, BossGroup>;
  tasks: Record<string, GroupTask>;
  /** 事件流：追加写、按群保留最近 N 条（见 store.ts），不参与状态判定。 */
  events: GroupEvent[];
};

export const DEFAULT_POLICY: GroupPolicy = {
  maxRejects: 2,
  reviewer: "fresh",
  budgetMinutes: 40,
};

/** 事件流上限（按群裁剪后仍保留的总量上限，防 json 无限长）。 */
export const MAX_EVENTS = 600;

/** 单群成员上限：再多就不会有"群"的感觉，而且并发一定失控。 */
export const MAX_MEMBERS = 6;
