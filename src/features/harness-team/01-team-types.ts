/**
 * 团队模式 · 渲染层类型（P0）
 * ⛔ 与 `src/lib/team-models.mjs` 的形状一一对应；⛔ 不在这里再定义一套业务规则（规则只在 lib 里）。
 */
import type { SenderKind } from "../../lib/message-origin.mjs";

export type MemberKind = "human" | "bot";

export type TeamMember = {
  id: string;
  kind: MemberKind;
  name: string;
  managerId: string;
  canDelegate: string[];
  addedBy: string;
  muted: boolean;
  /** P0b：绑定的真实调度目标（`listDispatchCatalog()` 那条）；空串 = 未绑定，派活会被明确拒绝 */
  targetKind: "" | "expert" | "team" | "member" | "subagent" | "cli";
  targetKey: string;
  /** 角色/岗位（专家团成员的 profession）；空串 = 没配 */
  targetProfession: string;
  /** 群内自定义头像（11-07）：空串 = 跟随默认；`preset:<id>` / `data:image/...` */
  avatar: string;
};

export type TeamGuard = {
  scope: "project" | "dept" | "all";
  allowExternal: boolean;
  respondToEveryone: boolean;
};

/** 群参考文件：只存路径 + 说明（⛔ 不搬文件：伙伴是真实子会话，自己按路径读） */
export type TeamFile = {
  path: string;
  name: string;
  note: string;
  addedBy: string;
  at: number;
};

/** 群记忆条目（豆包 `type` + `origin` 的同构）：一条一个结论，来源可追 */
export type MemoryNoteType = "fact" | "constraint" | "runbook";

export type MemoryNote = {
  id: string;
  text: string;
  type: MemoryNoteType;
  origin: { groupId: string; actorId: string; threadId: string };
  at: number;
};

/** 菜单展示形态（飞书 `ChatBotMenu` 的 `INPUT_FIRST` / `FLOAT`） */
export type MenuPlacement = "input" | "float";

/** 群定时任务（豆包 §③ 自动化定时；`nextRunAt` 由主进程算，渲染层只显示） */
export type GroupSchedule = {
  id: string;
  name: string;
  prompt: string;
  memberIds: string[];
  kind: "interval" | "daily" | "weekly" | "once";
  timeOfDay: string;
  weekdays: number[];
  scheduleType: "recurring" | "once";
  scheduledAt: string;
  enabled: boolean;
  nextRunAt: number | null;
  lastRunAt?: number;
  lastError?: string;
  createdAt: number;
};

/** 群菜单项（飞书 `menuItems` 的同构）：有 children 是分组，没有则必须带 prompt */
export type MenuItem = {
  key: string;
  label: string;
  prompt: string;
  disabled: boolean;
  tag: string;
  children: MenuItem[];
};

export type TeamGroup = {
  id: string;
  name: string;
  leadId: string;
  members: TeamMember[];
  /** 派生成员（团成员，合成 id）的头像覆盖表：他们不在 members 里，脸单独记一份 */
  avatars?: Record<string, string>;
  /** 消息排版：split = 伙伴靠左/用户靠右（默认）；left = 全部靠左 */
  messageLayout?: "split" | "left";
  /** 回复模式：process / placeholder（只决定运行时露什么） */
  replyMode?: "process" | "placeholder";
  /** 群消息形式（独立选项）：chat = 对话消息平铺；topic = 话题消息收进气泡 */
  messageForm?: "chat" | "topic";
  /** 旧字段：护栏（跨租户/外部群那套）—— 本应用没有租户概念，界面不再展示，仅保留兼容 */
  guard: TeamGuard;
  /** 群简介：这个群的共享背景（每次派活注入给伙伴） */
  memory: string;
  /** 项目地址（群的工作目录）：派活时作为子会话 cwd —— 决定伙伴在哪个仓库干活 */
  workspace: string;
  /** 群记忆条目：带类型 + 来源的结论/约定（与上面的简介分开，见 `normalizeMemoryNote`） */
  memoryNotes: MemoryNote[];
  files: TeamFile[];
  /** 快捷指令菜单（飞书 `ChatBotMenu` 的本地等价物）；空数组 = 不显示菜单按钮 */
  menu: MenuItem[];
  /** 菜单形态：贴输入框（默认）/ 悬浮面板 */
  menuPlacement: MenuPlacement;
  /** 群定时任务：到点 @ 指定伙伴（走同一条派活链路） */
  schedules: GroupSchedule[];
};

/** 群视图里的一条消息投影（真身在 threadId + itemId）。 */
export type GroupMessageRow = {
  key: string;
  threadId: string;
  itemId: string;
  authorId: string;
  authorKind: MemberKind;
  /** 11-07：真实发送者（用户 / 上级 / 定时任务 / 伙伴 / 系统）；老日志按作者推导 */
  senderKind: SenderKind;
  at: number;
  kind: "text" | "card";
  text: string;
  card: unknown;
  /** @ 了谁（成员 id） */
  mentions: string[];
  /** 被哪个伙伴叫来的（伙伴之间 @ 沟通）；null = 用户派的 */
  via?: { memberId: string; name: string } | null;
  /** 这一回合的 token 用量（11-08：与主对话页脚一致；老日志为 null） */
  usage?: { inputTokens: number; outputTokens: number; cachedTokens: number; totalTokens: number } | null;
  seq: number;
};
