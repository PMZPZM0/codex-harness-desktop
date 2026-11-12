/** session-kind.mjs 的类型声明（TS7016：.mjs 需配 .d.mts） */

export type SessionKind = "normal" | "hub" | "expertTeam" | "expert" | "workPartner" | "delegate";

export interface SessionCaps {
  /** 对外派活（agent_invoke / archive / list_children） */
  dispatch: boolean;
  /** BOSS 群编排工具面（group_create / assign / status / review / escalate / add / remove / browser） */
  bossGroup: boolean;
  /** 定时任务（scheduler_save / list / run / delete） */
  scheduler: boolean;
  /** 知识库写入（knowledge_add） */
  knowledge: boolean;
  /** 本机 CLI 安装 / 卸载（仍需用户显式确认） */
  cliInstall: boolean;
  /** 记忆命名空间边界 */
  memory: "private" | "team";
  /** 工作区边界 */
  workspace: "project" | "hub" | "session";
  /** 是否拥有群（只有中枢拥有） */
  ownsGroups: boolean;
}

/** 类型判定入参：归属事实，由调用方从各自台账取值 */
export interface SessionFacts {
  delegate?: boolean;
  team?: boolean;
  teamSolo?: boolean;
  supervised?: boolean;
  groupMember?: boolean;
  groupThread?: boolean;
  hub?: boolean;
}

export declare const SESSION_KINDS: readonly SessionKind[];
export declare const SESSION_KIND_LABEL: Record<SessionKind, string>;
export declare const SESSION_KIND_HINT: Record<SessionKind, string>;
export declare const SESSION_CAPS: Readonly<Record<SessionKind, Readonly<SessionCaps>>>;
export declare function sessionKindOf(facts?: SessionFacts): SessionKind;
export declare function capabilitiesOf(kind: string): Readonly<SessionCaps>;
export declare function isRestrictedKind(kind: string): boolean;
export declare function isDispatchOnlyKind(kind: string): boolean;
export declare function toolGatesOf(kind: string): {
  dispatch: boolean;
  bossGroup: boolean;
  scheduler: boolean;
  knowledge: boolean;
  cliInstall: boolean;
};

/** 会话角色快照（主进程 IPC 返回 / 渲染层 bag 状态同一个形状） */
export interface ThreadRoleState {
  /** 能不能对外派活（= dispatch 取反，仅为兼容旧读点保留） */
  restricted: boolean;
  /** 只关调度、其余照旧（= 受限 ∧ scheduler，仅为兼容旧读点保留） */
  dispatchOnly: boolean;
  label: string;
  kind: SessionKind;
  caps: Readonly<SessionCaps>;
}

export declare function roleOfKind(kind: string): ThreadRoleState;
