/**
 * expert-teams 的「team-types」部分（09-22 从同目录 expert-teams.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
// ─────────────────────────────────────────────────────────────
// 专家团（Team 型专家）数据模型与读写
// 复刻 WorkBuddy 专家团机制：团队 = 主理人(lead) + 团员(members)
// 运行时复用现有子智能体引擎（thread/start + turn/start + 完成回调）
// ─────────────────────────────────────────────────────────────

export type ExpertTeamMember = {
  /** kebab-case 成员 ID（对应"MD 文件名"语义，调度时用） */
  id: string;
  /** 花名（谐音/拆字人名风格，如"承枢"） */
  name: string;
  /** 职业头衔（如"交付总监"） */
  profession: { zh: string; en: string };
  /** 一句话职责 */
  description: string;
  /** 完整角色定义（systemPrompt） */
  systemPrompt: string;
  /** 推理强度（可空=跟随主会话） */
  effort?: string;
  /** 模型（可空=跟随主会话） */
  model?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy?: "never" | "on-request" | "on-failure" | "untrusted";
};

export type ExpertTeamConfig = {
  /** kebab-case 团队 ID */
  teamId: string;
  displayName: { zh: string; en: string };
  profession: { zh: string; en: string };
  /** 展示描述（中文 40-50 字为宜） */
  description: { zh: string; en: string };
  /** 行业分类 */
  category: string;
  /** 擅长领域标签（固定 3 个） */
  tags: { zh: string; en: string }[];
  /** 推荐提示词（3 个，第一个为默认启动提示） */
  quickPrompts: { zh: string; en: string }[];
  /** 主理人（编排者） */
  lead: ExpertTeamMember;
  /** 团员（不含主理人） */
  members: ExpertTeamMember[];
  /** 标准工作流程（SOP 编排文本，注入主理人会话） */
  sop: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};
