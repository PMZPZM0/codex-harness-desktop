/**
 * session-kind —— **会话类型（kind）与能力矩阵**的唯一真相源（2026-11-12 立项）。
 *
 * ── 用户令（11-12）────────────────────────────────────────────────────
 *   「普通会话，中枢会话，专家团会话，专家会话，工作伙伴会话，全用 ID 隔离开，
 *     禁止串，工具也是，全部更新，联动全部隔离」
 *
 * ── 改前为什么「串」────────────────────────────────────────────────────
 *   改造前只有一个布尔：`restrictedThreadRole()` 返回 `{restricted, dispatchOnly, label}`。
 *   五类会话被压成「受限 / 不受限」两档，于是：
 *     · 工具面只按这个布尔开合 ⇒ 工作伙伴主理人拿到了 BOSS 群编排工具，
 *       自己建演示群自导自演（11-12 实测事故）；
 *     · 派发 / 定时 / 知识库 / CLI 安装四处闸各自写 `restricted && !dispatchOnly`，
 *       同一个问题在四个地方各判一次，加一类会话就要改四处（漏一处 = 又串一条）；
 *     · 「中枢」在两侧都没有权威标识 —— 渲染层靠 localStorage（boss-home-thread）、
 *       主进程只认「有群的 bossThreadId」，无群的中枢两侧看法不一致。
 *
 * ── 本模块的契约 ──────────────────────────────────────────────────────
 *   ① 类型判定只看 **ID 归属**（谁把这条线程登记进哪张表），⛔ 不看标题前缀、
 *      ⛔ 不看 cwd、⛔ 不猜「像不像」——猜出来的身份就是串的入口。
 *   ② 能力矩阵**只有这一份**。渲染层（注册哪些工具）与主进程（执行端硬闸）都读它，
 *      ⛔ 任何一侧都不许再写 `restricted && !dispatchOnly` 这种第二套判据。
 *   ③ 隔离维度按会话 id / 团 id 落地（fabric `private__<threadId>` / `team__<teamId>`、
 *      会话工作区 `<project>/.codex-harness/sessions/<threadId>/`）——本模块只**声明**
 *      边界（memory / workspace 两列），存储实现不在这里。
 *
 * ── 为什么放 `src/lib/*.mjs`（基座层）──────────────────────────────────
 *   两侧都要读：渲染层注册工具面、主进程执行端硬闸。而 `electron/` → `src/lib/` 是
 *   允许的单向依赖（同款先例：`memory-scope-rules.mjs` 被记忆中心与主进程同时消费）。
 *   ⛔ 反向（src 域层 → electron）仍然禁止。
 */

/** 六类会话。前五类 = 用户点名的那五类；`delegate` = 被派活的临时子会话（兜底，必须有）。
 *  ⛔ 顺序即优先级（见 sessionKindOf）。 */
export const SESSION_KINDS = ["normal", "hub", "expertTeam", "expert", "workPartner", "delegate"];

/** 类型 → 展示文案（顶栏限制提示 / 记忆中心 / 日志共用，⛔ 别在别处再写一份）。 */
export const SESSION_KIND_LABEL = {
  normal: "普通会话",
  hub: "指挥中枢",
  expertTeam: "专家团会话",
  expert: "专家会话",
  workPartner: "工作伙伴会话",
  delegate: "被调度的子会话",
};

/** 类型 → 一句话说明（给用户看的「为什么这里没有那个能力」）。 */
export const SESSION_KIND_HINT = {
  normal: "你自己的项目会话：可派活、可建群、可建定时任务、可写知识库",
  hub: "指挥中枢：普通会话 + boss 角色 + 群归属；记忆与工作区走自己的中枢目录",
  expertTeam: "专家团里的会话：只在团内协作，不对外派活、不建定时、不写知识库",
  expert: "单个专家的直达会话：专家自己的记忆独立一份，不对外派活",
  workPartner: "工作伙伴群的伙伴会话：只关对外派活；团内节奏（定时任务）与知识库照旧",
  delegate: "被派活开的临时子会话：只干这一件活，不派活、不建定时、不写知识库",
};

/**
 * 能力矩阵（唯一一份）。四列布尔 = 四类闸门；两列字符串 = 隔离边界声明。
 *
 * `dispatch`    agent_invoke / agent_archive_sessions / agent_list_children
 * `bossGroup`   group_create / assign / status / review / escalate / add / remove / browser
 * `scheduler`   定时任务（scheduler_save / list / run / delete）
 * `knowledge`   知识库写入（knowledge_add）；读取不受限
 * `cliInstall`  本机 CLI 的安装 / 卸载（仍需用户显式确认）
 * `memory`      private = 本会话独立命名空间；team = 团共享命名空间
 * `workspace`   project = 项目根；hub = `<userData>/boss-home`；session = 会话专属目录
 * `ownsGroups`  是否拥有群（只有中枢拥有；普通会话能用编排工具是为了兼容
 *               「从任意会话建群」的老路径，群主仍是中枢）
 */
export const SESSION_CAPS = Object.freeze({
  normal: Object.freeze({
    dispatch: true, bossGroup: true, scheduler: true, knowledge: true, cliInstall: true,
    memory: "private", workspace: "project", ownsGroups: false,
  }),
  hub: Object.freeze({
    dispatch: true, bossGroup: true, scheduler: true, knowledge: true, cliInstall: true,
    memory: "private", workspace: "hub", ownsGroups: true,
  }),
  expertTeam: Object.freeze({
    dispatch: false, bossGroup: false, scheduler: false, knowledge: false, cliInstall: false,
    memory: "team", workspace: "session", ownsGroups: false,
  }),
  expert: Object.freeze({
    /* 单人专家 = 只有主理人一个人的团 ⇒ 团层里只有它自己一份，语义上等同私有；
       ⛔ 别写成 team（会让人以为别的会话读得到）。 */
    dispatch: false, bossGroup: false, scheduler: false, knowledge: false, cliInstall: false,
    memory: "private", workspace: "session", ownsGroups: false,
  }),
  workPartner: Object.freeze({
    /* ⛔ 11-07 用户原话「只关调度权限，不要动工作伙伴里面的群聊机制」：
       伙伴会话不许对外派活，但**团队自己按节奏推进**要在（定时任务）、知识库照旧。
       记忆按 `private__<threadId>` 物理隔离（群成员各一份，⛔ 不是团层）。 */
    dispatch: false, bossGroup: false, scheduler: true, knowledge: true, cliInstall: true,
    memory: "private", workspace: "session", ownsGroups: false,
  }),
  delegate: Object.freeze({
    dispatch: false, bossGroup: false, scheduler: false, knowledge: false, cliInstall: false,
    memory: "private", workspace: "session", ownsGroups: false,
  }),
});

/**
 * 类型判定（纯函数）。入参是**归属事实**，由调用方从各自的台账取值：
 *
 * `delegate`    在 delegateRegistry（被 agent_invoke 派出来的临时会话）
 * `team`        teamRunStore.teamOfThread 有值（主理人 / 成员直达 / 委托成员线程都算）
 * `teamSolo`    该团只有主理人（单人专家）⇒ 归 `expert`，可读性上要分开
 * `supervised`  别名表里有 supervisorThreadId（有上级 ⇒ 子会话）
 * `groupMember` 在 boss-groups.json 的 members[].threadId 里
 * `groupThread` 在工作伙伴群台账里（group-talk lookupGroupThread）
 * `hub`         已登记为指挥中枢（群 bossThreadId 或 localStorage 已登记中枢）
 *
 * ⛔ 优先级即语义：越「派生」的类型越先判 —— 一条线程同时在两三张表里是常态
 *   （工作伙伴的团成员既是群成员、又是团成员、还有上级），先判最外层的派生类型，
 *   才能保证「派生会话一定拿不到主会话的能力」。
 */
export function sessionKindOf(facts = {}) {
  const f = facts || {};
  if (f.delegate) return "delegate";
  /* ⛔ 团（含单人专家）优先于群：专家团成员的会话可能同时挂在工作伙伴群里，
     但它在团队表里 ⇒ 只做团内协作。 */
  if (f.team) return f.teamSolo ? "expert" : "expertTeam";
  if (f.supervised) return "delegate";
  if (f.groupMember || f.groupThread) return "workPartner";
  if (f.hub) return "hub";
  return "normal";
}

/** 类型归一化：不在矩阵里的值一律当普通会话（⛔ 用 hasOwn，别让 `__proto__` / `constructor`
 *  这类原型链键取到 Object.prototype —— 那样 caps 会变成空对象、label 变成对象，UI 直接崩）。 */
export function normalizeSessionKind(kind) {
  return Object.hasOwn(SESSION_CAPS, kind) ? kind : "normal";
}

/** 能力矩阵取值。⛔ 未知类型回落 `normal` —— 与渲染层「拿不到角色不误禁」一致；
 *  主进程的工具调用执行端每次都用 `restrictedThreadRole` 按 ID 重新判一次（见 dispatch-core），
 *  ⛔ 不依赖调用方传进来的 kind，所以这里回落不会把权限放给派生会话。 */
export function capabilitiesOf(kind) {
  return SESSION_CAPS[normalizeSessionKind(kind)];
}

/** 这类会话能不能对外派活（旧布尔 `restricted` 的唯一来源）。 */
export function isRestrictedKind(kind) {
  return capabilitiesOf(kind).dispatch !== true;
}

/** 「只关调度」：受限但仍可建定时任务（工作伙伴会话）。旧 `dispatchOnly` 的唯一来源。 */
export function isDispatchOnlyKind(kind) {
  const caps = capabilitiesOf(kind);
  return caps.dispatch !== true && caps.scheduler === true;
}

/**
 * 这条会话的工具面是否由**宿主**负责登记（渲染层 dynamicTools + 主进程附加的三批）。
 *
 * ⛔⛔ 11-12 二次真机（用户「群聊压根运行不起来」的第二层）：引擎只在 spawn 时读 rollout
 *   首行 `session_meta.dynamic_tools`，而宿主通用 `thread/resume` 会把首行整份改写成宿主
 *   工具面（实测 95 个）。派生会话（专家团 / 专家 / 工作伙伴 / 被调度）的工具面归**各自域**
 *   （team-run / group-talk / delegate）管，被宿主改写一次就永久失去派活与群聊工具。
 *
 * ⛔ 判据必须按**会话类型**：上版只查 group-talk 台账（`lookupGroupThread`），
 *   漏了 boss-groups 的群成员（两套群台账并存），日志里 `01a1cf0b` 照样被升成 95 个工具 ——
 *   一次启动就把刚自愈的会话又污染回去。类型真相源只有这一个模块。
 *
 * @param {string} kind 会话类型
 * @returns {boolean} true = 宿主工具面归宿主（normal / hub）
 */
export function ownsHostToolSurface(kind) {
  const k = normalizeSessionKind(kind);
  return k === "normal" || k === "hub";
}

/** 工具面开关（渲染层注册用）：一个能力一个键，⛔ 别在注册处再判 kind。 */
export function toolGatesOf(kind) {
  const caps = capabilitiesOf(kind);
  return {
    dispatch: caps.dispatch === true,
    bossGroup: caps.bossGroup === true,
    scheduler: caps.scheduler === true,
    knowledge: caps.knowledge === true,
    cliInstall: caps.cliInstall === true,
  };
}

/**
 * 造「会话角色」快照（两侧共用：主进程 IPC 返回、渲染层 bag 状态都是这一个形状）。
 * ⛔ 旧字段 `restricted` / `dispatchOnly` 由矩阵推出，**保留只为兼容既有读点**；
 *   新代码一律读 `caps` 或 `toolGatesOf(kind)`，⛔ 别再对这两个布尔做二次组合。
 */
export function roleOfKind(kind) {
  const safe = normalizeSessionKind(kind);
  const caps = SESSION_CAPS[safe];
  return {
    restricted: caps.dispatch !== true,
    dispatchOnly: caps.dispatch !== true && caps.scheduler === true,
    label: SESSION_KIND_LABEL[safe],
    kind: safe,
    caps,
  };
}
