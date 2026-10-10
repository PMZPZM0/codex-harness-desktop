/**
 * memory-scope-rules —— **记忆分层管理规则**的唯一真相源（2026-10-10 立项）。
 *
 * ⛔ 为什么放在 `src/lib/*.mjs`（基座层）而不是 electron/ 或某个 feature 目录：
 *   这份规则**两侧都要读** —— 渲染层（记忆中心按它组织分类）与主进程/守卫（按它校验实现）。
 *   而本仓 electron/ 与 src/ **互不 import**；`src/lib/*.mjs` 是唯一两侧都认的共享基座
 *   （同款先例：`harness-block-strip.mjs` 被渲染层与主进程同时消费）。
 *
 * ── 用户规则（10-10 原话）──────────────────────────────────────────────
 *   「将**项目规则、用户档案、工作纪要**按**项目维度共享**并保持**跨项目一致**，
 *     其余记忆**按会话独立存储**，共同组成金字塔结构；明确各层的**存储范围、共享边界、
 *     隔离原则与优先级顺序**，并说明层与层之间如何**引用、继承和同步**。」
 *
 * ── 三个作用域（scope）────────────────────────────────────────────────
 *   cross-project 跨项目一致 —— L0 用户档案：全项目唯一一份（应用数据目录），
 *                 不随项目切换而变。**这是唯一"跨项目一致"的层**。
 *   project       项目维度共享 —— L1 宪法 / L2 纪律 / L3 背景 / L4 日志 / L5 卷宗 /
 *                 L6 冷存档：落在 `<项目>/.codex-harness/memory/`，本项目全体会话与智能体
 *                 共享；⛔ 别的项目读不到（隔离边界 = 项目根目录）。
 *   session       按会话独立 —— fabric 命名空间（private__<threadId> / team__<teamId>）+
 *                 角色记忆 + L7 碎片池：只有该会话（或该团）读得到，
 *                 隔离边界 = 会话 id / 团队 id。
 *
 * ── 注入优先级（四档，与实现一致）──────────────────────────────────────
 *   first    纪律（L2）排最前 —— 坑与纠错比背景更容易被反复踩，被截断的代价最大。
 *   resident 常驻（L0/L1/L3）参与注入，各层预算独立（见 electron/memory-layers.ts 的 MEMORY_BUDGET）。
 *   last     日志（L4）拼在最后 —— 超预算时**按天从最旧丢**（⛔ 不按字符砍尾）。
 *   never    不进注入（L5/L6/L7）—— 需要时靠检索/召回，不占常驻预算。
 *   ⛔ 档位是**契约**：改它要同步改 memory-layers 的拼装与守卫【104】的预算自洽式
 *     （常驻四层之和 + 日志段 = total）。
 *
 * ── 与实现的对应（⛔ 别在这份表里"另写一套"）──────────────────────────
 *   · 层 id / 名称 / 落盘位置 / 写入者 / 去向 → `electron/memory-layers.ts` 的 MEMORY_PYRAMID
 *     （本文件只补它没有的三个维度：scope / 共享与隔离 / 优先级档）。
 *   · 会话级条目的真实存储 → `electron/memory-fabric.ts` 的 namespaceOf(scope, ownerId)。
 *   · 守卫【110】钉住「层 id 集合与 MEMORY_PYRAMID 完全一致」—— 两张表不许漂移。
 */

/** 作用域 → 展示文案 */
export const MEMORY_SCOPE_LABEL = {
  "cross-project": "跨项目一致",
  project: "项目维度共享",
  session: "按会话独立",
};

/** 作用域 → 一句话说明（UI 卡片副标题用） */
export const MEMORY_SCOPE_HINT = {
  "cross-project": "换项目也读到同一份（用户档案）",
  project: "本项目全体会话与智能体共享，别的项目读不到",
  session: "只有这一路会话（或这一个团）读得到",
};

/** 注入档 → 展示文案 */
export const MEMORY_INJECT_LABEL = {
  first: "排最前（纪律优先）",
  resident: "常驻（参与注入）",
  last: "排最后（超预算先丢）",
  never: "不进注入（按需检索）",
};

/**
 * 八层规则表。
 * @type {ReadonlyArray<{
 *   layer: string, name: string, scope: "cross-project"|"project"|"session",
 *   store: string, sharedWith: string, isolatedFrom: string,
 *   inject: "first"|"resident"|"last"|"never",
 *   inheritsFrom: string, syncsTo: string,
 * }>}
 */
export const MEMORY_LAYER_RULES = [
  {
    layer: "L0", name: "用户档案", scope: "cross-project",
    store: "USER.md（应用数据目录，**全项目唯一一份**）",
    sharedWith: "所有项目、所有会话",
    isolatedFrom: "不随项目切换而变 —— 这正是「跨项目一致」的实现方式",
    inject: "resident",
    inheritsFrom: "用户手写；助手可以提议，但由用户确认",
    syncsTo: "人工精简（不自动删）",
  },
  {
    layer: "L1", name: "项目宪法", scope: "project",
    store: "project/MEMORY.md（项目 .codex-harness/memory/ 下，每项目一份）",
    sharedWith: "本项目全体会话与智能体",
    isolatedFrom: "其它项目读不到（隔离边界 = 项目根目录）",
    inject: "resident",
    inheritsFrom: "L5 月度卷宗蒸馏、L3 项目背景升格",
    syncsTo: "同层压缩（合并同主题、删过时）",
  },
  {
    layer: "L2", name: "纪律与记忆", scope: "project",
    store: "lessons/<分类>.md（一个分类一个文件；用户纠错单独一类）",
    sharedWith: "本项目全体会话与智能体",
    isolatedFrom: "其它项目读不到",
    inject: "first",
    inheritsFrom: "捕获链自动（纠错 > 坑 > 偏好 > 约定）+ 引擎补写",
    syncsTo: "先升级为技能（可复用）再压缩",
  },
  {
    layer: "L3", name: "项目背景", scope: "project",
    store: "project/BACKGROUND.md（每项目一份）",
    sharedWith: "本项目全体会话与智能体",
    isolatedFrom: "其它项目读不到",
    inject: "resident",
    inheritsFrom: "用户 / 引擎（本项目快速入门）",
    syncsTo: "稳定下来的升格进 L1",
  },
  {
    layer: "L4", name: "每日日志", scope: "project",
    store: "logs/YYYY-MM-DD.md（每项目一天一份）",
    sharedWith: "本项目全体会话与智能体",
    isolatedFrom: "其它项目读不到",
    inject: "last",
    inheritsFrom: "捕获链自动（每回合）",
    syncsTo: "沉 L5 月度卷宗（原文进 L6 冷存档）",
  },
  {
    layer: "L5", name: "月度卷宗", scope: "project",
    store: "rollup/YYYY-MM.md（每项目每月一卷）",
    sharedWith: "本项目全体会话与智能体",
    isolatedFrom: "其它项目读不到",
    inject: "never",
    inheritsFrom: "L4 每日日志蒸馏",
    syncsTo: "精炼结论沉 L1 项目宪法",
  },
  {
    layer: "L6", name: "冷存档", scope: "project",
    store: "archive/*.md（每项目一份归档目录）",
    sharedWith: "本项目（可回溯，但需主动查阅）",
    isolatedFrom: "其它项目读不到；⛔ 不进注入",
    inject: "never",
    inheritsFrom: "蒸馏时**原文移位**（⛔ 不是删）",
    syncsTo: "终态：可回溯",
  },
  {
    layer: "L7", name: "碎片池", scope: "session",
    store: "memory.json（MemoryStore；条目带来源会话）",
    sharedWith: "写入它的那个会话（条目按来源会话标记）",
    isolatedFrom: "别的会话看不到来源不是自己的条目",
    inject: "never",
    inheritsFrom: "捕获链自动（碎片级、尚未归层的临时记忆）",
    syncsTo: "按 TTL 淘汰（记录进 pruned.jsonl）；成型后归入 L2 / L4",
  },
];

/** 会话级存储（不在金字塔文件里，但同属「记忆」—— 用户规则里的"其余记忆按会话独立存储"）。 */
export const MEMORY_SESSION_SCOPES = [
  { id: "private", label: "会话私有", owner: "一个会话（threadId）", note: "命名空间 private__<threadId>；主会话、子智能体、专家各一份，互不可见" },
  { id: "team", label: "专家团共享", owner: "一个专家团（teamId）", note: "命名空间 team__<teamId>；团内成员互通，团外读不到" },
  { id: "project", label: "项目共享条目", owner: "项目", note: "命名空间 project__…；与金字塔项目级同域，但以**条目**形态存在（可检索）" },
];

/** 按作用域分组（UI 与文档共用，⛔ 别在各处再 filter 一遍）。 */
export function layersByScope(scope) {
  return MEMORY_LAYER_RULES.filter((rule) => rule.scope === scope);
}

/** 按注入档分组。 */
export function layersByInject(tier) {
  return MEMORY_LAYER_RULES.filter((rule) => rule.inject === tier);
}
