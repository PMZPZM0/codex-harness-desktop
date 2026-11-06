/**
 * 团队模式 · 渲染层类型（P0）
 * ⛔ 与 `src/lib/team-models.mjs` 的形状一一对应；⛔ 不在这里再定义一套业务规则（规则只在 lib 里）。
 */

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

export type TeamGroup = {
  id: string;
  name: string;
  leadId: string;
  members: TeamMember[];
  /** 旧字段：护栏（跨租户/外部群那套）—— 本应用没有租户概念，界面不再展示，仅保留兼容 */
  guard: TeamGuard;
  /** 群记忆：这个群的共享背景，每次派活注入给伙伴 */
  memory: string;
  files: TeamFile[];
};

/** 群视图里的一条消息投影（真身在 threadId + itemId）。 */
export type GroupMessageRow = {
  key: string;
  threadId: string;
  itemId: string;
  authorId: string;
  authorKind: MemberKind;
  at: number;
  kind: "text" | "card";
  text: string;
  card: unknown;
  seq: number;
};
