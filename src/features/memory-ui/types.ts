/**
 * memory-ui —— 记忆板块的**类型契约层**（10-05 用户要求「类型定义统一、便于扩展新记忆类型」）。
 *
 * ── 为什么单独一个 types 文件 ──────────────────────────────────────────
 * 七类记忆的**数据来源完全不同**（金字塔读层表、MCP 是后端开关、角色记忆读
 * fabric 命名空间、被调度会话读登记表）。若各视图自带类型，⛔ 加第八类时
 * 要改一堆文件且极易字段漂移 ⇒ 这里定一份**判别联合（discriminated union）**：
 * 每类记忆一个 `kind` 判别位，视图层按 `kind` 分发，编译器保证不漏分支。
 *
 * ── 扩展新记忆类型的唯一步骤 ──────────────────────────────────────────
 * ① 在 `MemoryKind` 加一个字面量
 * ② 在 `MemorySourceMap` 声明它的数据载荷（不一定要有数据 ⇒ `never`）
 * ③ 在 `views/` 写一个视图并登记进 `MEMORY_VIEWS`
 * ⛔ 其它文件**不用动**（这是本文件存在的意义）。
 *
 * ── 与后端的对齐纪律 ──────────────────────────────────────────────────
 * ⛔ 字段名与 `electron/memory-fabric.ts` 的 `MemoryEntry` **逐字对齐** ——
 * 改名会静默变成"字段缺失"（渲染成 undefined 而不报错）。
 * 守卫 `11m-memory-ui` 钉住这条。
 *
 * ⛔⛔ **10-05 修订：本文件的形状由 `normalize.ts` 负责对齐主进程，本文件不直接描述
 *   IPC 返回体。** 这份契约原先是照着理想形状手写的，没核对 handler 真实返回体
 *   ⇒ `archive` / `active` / `{records}` 三处全错 ⇒ 金字塔白屏 + 切 tab 必崩，
 *   而守卫 56/56 全绿（它只断言视图与本文件自洽，两边出自同一份想象）。
 */
import type { ReactNode } from "react";

/* ── ① 判别位：七类记忆 ────────────────────────────────────────────────── */
export type MemoryKind =
  | "pyramid"        // 金字塔（L0–L7 分层）
  | "mcp-backend"    // 本地 MCP 记忆（⛔ 是**后端开关**，不是一种记忆内容）
  | "main"           // 主会话
  | "subagent"       // 子智能体
  | "expert"         // 单个专家
  | "team"           // 专家团
  | "dispatched";    // 被调度会话

/** 每类记忆的展示元信息（标题 / 图标 / 一句话说明）—— ⛔ 单一真相源，导航与视图共用。 */
export const MEMORY_KIND_META: Record<MemoryKind, { label: string; blurb: string; icon: string }> = {
  pyramid: { label: "金字塔记忆", blurb: "七层结构 · 水位与蒸馏", icon: "layers" },
  "mcp-backend": { label: "本地 MCP 记忆", blurb: "后端开关 · 决定记忆存在哪", icon: "plug" },
  main: { label: "主会话记忆", blurb: "只有你这个会话能读到", icon: "user" },
  subagent: { label: "子智能体记忆", blurb: "每个子智能体一份，互不可见", icon: "bot" },
  expert: { label: "专家记忆", blurb: "每位专家一份，互不可见", icon: "sparkle" },
  team: { label: "专家团记忆", blurb: "团内成员互通，团外读不到", icon: "users" },
  dispatched: { label: "被调度会话", blurb: "每次派出的执行记录与产出", icon: "activity" },
};

/* ── ② 共享基类：所有条目共有的字段 ────────────────────────────────────── */
export type MemoryMeta = {
  id: string;
  /** 创建时间（epoch ms）—— ⛔ 所有条目都有，这是"记忆条目"的最小契约 */
  createdAt: number;
  updatedAt: number;
};

/* ── ③ 各类的差异化载荷 ────────────────────────────────────────────────── */

/** 金字塔层（与 memory-layers 的 PyramidLayerDef 对齐） */
export type PyramidLayer = {
  id: string;                 // L0 | L1 | ...
  name: string;
  where: string;              // 存哪
  writer: string;             // 谁写
  sink: string;               // 满了会怎样
  budget: number;
  used: number;
  ratio: number | null;       // 水位（0–1），null = 未测量
  needDistill: boolean;
};

export type PyramidMemory = MemoryMeta & {
  kind: "pyramid";
  layers: PyramidLayer[];
  archive: { files: number; bytes: number };
};

/**
 * 本地 MCP 记忆（⛔ **它是后端开关，不是一份记忆**）。
 * ⛔ 这个类型的存在是为了**如实反映现状** —— 界面上必须让用户看懂
 * "MCP 记忆"其实是"换个地方存"，否则他会以为有两种记忆并存。
 */
export type McpBackendMemory = MemoryMeta & {
  kind: "mcp-backend";
  /** **实际生效**的后端（⛔ 不是用户选的值：选了 MCP 但服务没装时会回退 builtin） */
  active: "mcp" | "builtin";
  /** 连接器名（harness 写进引擎 config.toml 的那个） */
  connector: string;
  /** 连接器是否就绪（⛔ 与"是否启用"不同：装了就绪 ≠ 生效） */
  ready: boolean;
  /** 切换后记忆"搬到哪"的去向说明（给用户看的一句话） */
  sinkLabel: string;
  /** ⛔ 选了 MCP 却回退内置的原因（用户唯一能知道"我明明开了为什么没生效"的线索） */
  fallbackReason: string | null;
  /** 装服务的命令（给用户复制） */
  installCommand: string;
};

/** fabric 条目（⛔ 与后端 MemoryEntry 逐字对齐） */
export type MemoryEntry = {
  id: string;
  content: string;
  scope: "private" | "team" | "project";
  sessionId: string | null;
  /** 这条记忆**是谁写的**（来源会话 id）—— 新增需求「按会话看记忆」的分组键。
   *  ⛔ 后端 memory-fabric 一直在返回它（normalize 也一直在读），此前只是**类型没声明**
   *     ⇒ 属于契约缺口，不是新增字段。 */
  originThreadId?: string;
  projectKey: string;
  sourceAgent: { kind: string; id: string; label?: string };
  category: string;
  weight: number;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  useCount: number;
  archivedAt?: number | null;
};

/** 一个执行体（主会话 / 子智能体 / 专家 / 专家团）的记忆集合 */
export type ActorMemory = MemoryMeta & {
  kind: "main" | "subagent" | "expert" | "team";
  /** 执行体稳定 id（⛔ 不用显示名：改名不该丢记忆） */
  actorId: string;
  actorName: string;
  /** 私有命名空间（private__<会话或角色键>） */
  privateNamespace?: string;
  /** 团内命名空间（只有 expert/team 可能有） */
  teamNamespace?: string;
  entries: MemoryEntry[];
  /** 该执行体的统计（⛔ 由前端算好传入，视图不重复算） */
  stats: { total: number; pinned: number; archived: number; chars: number };
  /** 专家团成员（kind=team 时有）：⛔ 团内记忆的可见范围就等于这个名单 */
  members?: { id: string; name: string; profession?: string; running?: boolean }[];
};

/** 被调度会话（⛔ 字段与 DelegateRecord 对齐） */
export type DispatchedSession = {
  kind: "dispatched";
  threadId: string;
  originThreadId: string;
  /** 调度类型：subagent / expert / team / member */
  dispatchKind: string;
  name: string;
  depth: number;
  status: "running" | "done" | "failed";
  startedAt: number;
  endedAt?: number;
  archived?: boolean;
  error?: string;
  /** 实时/最终产出 */
  output?: string;
  /** 该会话自己的私有记忆条数（⛔ 调度作用域隔离：它读不到主会话的） */
  memoryCount?: number;
};

export type MemorySourceMap = {
  pyramid: PyramidMemory;
  "mcp-backend": McpBackendMemory;
  main: ActorMemory;
  subagent: ActorMemory;
  expert: ActorMemory;
  team: ActorMemory;
  dispatched: DispatchedSession;
};

/** 判别联合：视图层按 `kind` 分发，⛔ 漏分支会被编译器抓到 */
export type AnyMemory = { [K in MemoryKind]: MemorySourceMap[K] }[MemoryKind];

/* ── ④ 视图注册表：加新类型只改这一处 ──────────────────────────────────── */
export type MemoryViewProps<T extends MemoryKind = MemoryKind> = {
  data: MemorySourceMap[T];
  /** 深浅色由 CSS 变量承担（⛔ 不在 JS 里读主题，那会让两套样式分叉） */
  dense?: boolean;
  onOpenThread?: (threadId: string) => void;
  /** 空态与加载态由外壳统一处理，视图只管"有数据时怎么画" */
};

export type MemoryView = {
  kind: MemoryKind;
  /** 渲染函数（⛔ 懒加载由外壳的 registry 决定，视图本身不感知） */
  render: (props: MemoryViewProps<any>) => ReactNode;
};

/* ── ⑤ 共享的小工具类型 ────────────────────────────────────────────────── */
export type LoadState = "idle" | "loading" | "ready" | "error";

/** 分区统计条（每类记忆标题下那一条） */
export type SectionStat = { label: string; value: string | number; hint?: string };

/** ⛔ 作用域的展示元信息（与 UI 的分区表同源，⛔ 别在两处各写一份） */
export const SCOPE_META: Record<MemoryEntry["scope"], { label: string; short: string; hint: string }> = {
  private: { label: "私有记忆", short: "仅自己", hint: "只有这个执行体自己读得到" },
  team: { label: "团内记忆", short: "团内共享", hint: "同一专家团的成员互通，团外读不到" },
  project: { label: "项目记忆", short: "全员共享", hint: "本项目全体会话与智能体都能读到" },
};
