/**
 * 旧会话「补种」（10-26 用户令：「那要适配一下旧会话，用户很多都是旧会话有任务的」）。
 *
 * 为什么需要：这一版把两段提示词换成了**只在建会话时生效**的位置 ——
 *   · 指挥中枢的角色说明 → `thread/start` 的 developerInstructions（part08/01-seg.tsx 的 bossRoleSeed）；
 *   · 专家团铁律（不亲自干活 / 先派活）→ `buildTeamSystemPrompt`，只在团队会话首条里拼一次。
 * ⇒ 升级前建的会话**永远拿不到**这两段，而用户手上"很多旧会话还在跑任务"。
 *
 * 做法：不动引擎、不改工具面（都改不了，工具面/指令在 spawn 时定死），
 *   在**该会话下一次发送**时把缺的那段作为一次性注入带进去（显示层按标记剥掉，用户看不见）。
 *   每人每条会话只补一次 ⇒ 用 localStorage 记账（与 readStoredExpertRole 同一套路），带版本号，
 *   以后改文案只需把版本 +1，旧会话会再补一次。
 *
 * ⛔ 中枢会话在**新建时**就会 `markSeeded`（它已经拿到 developerInstructions）⇒ 不会重复注入；
 *   团队会话由主进程创建、渲染层没有创建时刻的钩子 ⇒ 新版团队会话也会多收一次补充（约 200 字，
 *   内容一致，无害）。这是刻意的取舍：宁可多一次，也不能漏掉旧会话。
 */

/** 中枢角色说明的注入版本（改 BOSS_ROLE_PROMPT 文案时 +1）。 */
export const BOSS_SEED_VERSION = 2;
/** 团队纪律补充的注入版本（改下面的补充文案时 +1）。 */
export const TEAM_SEED_VERSION = 2;

const STORE_KEY = "prompt-seeds-v1";
const MAX_ENTRIES = 600;

/**
 * 团队纪律补充（补发给旧团队会话）。
 * ⛔ 与 `electron/expert-teams/06-team-tools.ts` 的「协作铁律 0/1」必须同义 ——
 *    那边是新建会话时拼进系统提示词，这里是旧会话补发；守卫 11f 会比对两句锚点。
 */
export const TEAM_DISPATCH_SUPPLEMENT = `【团队工作纪律 · 补发】
0. ⛔ 你不亲自干活：只做拆解、派活、验收、汇总。任何可交付物（代码 / 文案 / 方案 / 数据 / 测试）必须由成员产出，你自己不写成品；人不够就说缺哪一类，别顶上去自己干。
1. ⛔ 先派活，再说话：拿到需求的第一件事是拆解 + 调人（能并行的一次性用 team_phase_invoke 发出去），不要先自己动手做一版再"补流程"。
2. 汇总里不许出现你没派出去、自己写的内容。`;

/* ⛔ 存储口可替换：渲染层走 localStorage；回归脚本（node，没有 localStorage）走内存表。
   没有这层的话，守卫里对补种行为的断言根本跑不起来。 */
const MEM = new Map();

function store() {
  try {
    if (typeof localStorage !== "undefined" && localStorage) return localStorage;
  } catch { /* 访问 localStorage 本身可能抛（隐私模式） */ }
  return {
    getItem: (k) => (MEM.has(k) ? MEM.get(k) : null),
    setItem: (k, v) => MEM.set(k, v),
  };
}

/** 仅供回归脚本：清掉记账，让每条用例从头开始。 */
export function _resetPromptSeeds() {
  MEM.clear();
  try {
    if (typeof localStorage !== "undefined" && localStorage) localStorage.removeItem(STORE_KEY);
  } catch { /* 同上 */ }
}

function readMap() {
  try {
    const raw = store().getItem(STORE_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch { return {}; }
}

function writeMap(map) {
  try {
    /* 容量兜底：会话删了不会通知到这里 ⇒ 超过上限就丢掉最早的那批，
       避免 localStorage 无限长（记账只是"补过没"，丢了最多再补一次，不影响正确性）。 */
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
      const keep = keys.slice(-MAX_ENTRIES);
      const next = {};
      for (const key of keep) next[key] = map[key];
      store().setItem(STORE_KEY, JSON.stringify(next));
      return;
    }
    store().setItem(STORE_KEY, JSON.stringify(map));
  } catch { /* 存不下就当没记过：最多下次再补一遍 */ }
}

/* ── 团队**主理人**会话集合（跨重启）────────────────────────────────────────
   ⛔ 为什么不能只靠 bag.teamThreadConfigRef：那是**内存 ref**，重开应用就空了 ⇒ 旧会话补种
      永远不触发（正是要修的场景）。主进程把主理人会话持久化在 team-runs 的 threads 文档里
      （`team-threads:map` 的 leads 字段，复用既有通道，不新增 IPC）。 */
const LEADS = new Set();

/** 由 part02 在拿到 teamThreadsMap() 后灌入（含"本次启动没打开过的会话"）。 */
export function setTeamLeadThreads(ids) {
  LEADS.clear();
  for (const id of ids ?? []) if (id) LEADS.add(String(id));
}

export function isTeamLeadThread(threadId) {
  const id = String(threadId ?? "").trim();
  return Boolean(id) && LEADS.has(id);
}

/** 已补过的版本号（0 = 从没补过）。 */
export function seededVersion(threadId, kind) {
  const id = String(threadId ?? "").trim();
  if (!id) return 0;
  const entry = readMap()[`${kind}:${id}`];
  return typeof entry === "number" ? entry : 0;
}

/** 这条会话在这个版本下还需要补种吗。 */
export function needsSeed(threadId, kind, version) {
  return seededVersion(threadId, kind) < Number(version ?? 1);
}

/** 记账（补种已注入；⛔ 在同一次发送里立刻记，避免同一段每轮重发）。 */
export function markSeeded(threadId, kind, version) {
  const id = String(threadId ?? "").trim();
  if (!id) return;
  const map = readMap();
  map[`${kind}:${id}`] = Number(version ?? 1);
  writeMap(map);
}
