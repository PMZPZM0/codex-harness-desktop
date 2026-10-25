/**
 *指挥中枢线程的**共享识别**（渲染层单例 store，10-25 立）。
 *
 * 为什么需要：指挥中枢现在就是一个**普通会话**（`openThread(群.bossThreadId)`），
 * 但界面有多处要「知道这是不是指挥中枢」：
 *   · 侧栏按钮选中态 + 点它跳到哪；
 *   · 顶栏成员图标（只在这个会话出现）；
 *   · 顶栏调度开关（指挥中枢有独立调度工具 ⇒ 要隐藏）；
 *   · 时间线空态文案（「你好中枢…」）；
 *   · 侧栏给群成员会话打「中枢调度」标签。
 * 各自轮询会重复请求，这里做**一份**：单例定时刷新 + boss-group 事件即时刷新，
 * 订阅者用 useSyncExternalStore 读。
 *
 * `homeId` = 还没建群时的「指挥中枢」锚点（localStorage）。用户点指挥中枢时如果
 * 一个群都还没有，就新建一个会话并把它记成 home —— 之后点按钮永远回到同一个会话，
 * ⛔ 不会每点一次就多一个「未命名任务」（用户 10-25：「就这个指挥中枢一直走」）。
 */
const HOME_KEY = "boss-home-thread";

let state = { groups: [], bossIds: [], memberIds: [], homeId: "", sessionIds: [], sessionMemoryDirs: {}, homeDir: "", pending: false, loaded: false };
const listeners = new Set();
let timer = null;
let off = null;

function emit() { for (const fn of listeners) fn(); }

function readSessionIds() {
  try {
    const raw = JSON.parse(String(localStorage.getItem("boss-session-ids") || "[]"));
    return Array.isArray(raw) ? raw.map((x) => String(x)).filter(Boolean) : [];
  } catch { return []; }
}
function readHome() {
  try { return localStorage.getItem(HOME_KEY) ?? ""; } catch { return ""; }
}

export function setBossHomeThreadId(id) {
  const next = String(id || "");
  try {
    if (next) localStorage.setItem(HOME_KEY, next);
    else localStorage.removeItem(HOME_KEY);
    /* 10-25 用户令：「我每次新建，就是全新的，跟旧的不要有任何关系」⇒ homeId **只当身份标记**
       （最近那个指挥中枢），**不再用于复用**。这里把 id 登记进 sessionIds：哪些会话是指挥中枢。 */
    if (next) {
      const ids = readSessionIds().filter((x) => x !== next);
      ids.push(next);
      localStorage.setItem("boss-session-ids", JSON.stringify(ids.slice(-50)));
      state = { ...state, sessionIds: ids };
      /* ⛔⛔ 10-25：「记忆板块里加一个中枢会话记忆板块，跟普通会话完全拆开」——
         名单必须**同步到主进程**：记忆层的捕获写入在主进程跑，它要知道这个 thread
         是指挥中枢才能把记忆写进它自己的目录（否则会写进用户选的项目目录）。
         主进程那份是唯一真相源（boss-groups/session-registry.ts），localStorage 只是缓存。 */
      void window.codex?.bossGroupSession?.({ action: "add", id: next })?.catch?.(() => undefined);
    }
  } catch { /* 隐私模式：忽略 */ }
  state = { ...state, homeId: next, pending: false };
  emit();
}

/** 删除指挥中枢时把它从身份登记里摘掉（10-25 用户令：「我要经常删了指挥中枢，重新建」——
 *  不摘的话旧 id 会一直留在 sessionIds 里，新建的会话就被当成"旧的"）。 */
export function removeBossSessionId(id) {
  const target = String(id || "");
  if (!target) return;
  try {
    const ids = readSessionIds().filter((x) => x !== target);
    localStorage.setItem("boss-session-ids", JSON.stringify(ids));
    if (readHome() === target) localStorage.setItem(HOME_KEY, ids[ids.length - 1] ?? "");
    state = { ...state, sessionIds: ids, homeId: ids[ids.length - 1] ?? "" };
    emit();
    /* ⛔ 同步注销到主进程：删了指挥中枢，它的记忆目录也一起清掉
       （用户令：「删除了中枢会话，这里就同步更新」）。 */
    void window.codex?.bossGroupSession?.({ action: "remove", id: target })?.catch?.(() => undefined);
  } catch { /* 隐私模式：忽略 */ }
}

/** 会话重建（rollout 丢失自愈）时把身份登记从旧 id 换成新 id。 */
export function renameBossSessionId(previousId, nextId) {
  const prev = String(previousId || "");
  const next = String(nextId || "");
  if (!prev || !next) return;
  try {
    const ids = readSessionIds().filter((x) => x !== prev);
    ids.push(next);
    localStorage.setItem("boss-session-ids", JSON.stringify(ids.slice(-50)));
    if (readHome() === prev) localStorage.setItem(HOME_KEY, next);
    state = { ...state, sessionIds: ids, homeId: readHome() };
    emit();
    /* ⛔ 同步改名到主进程（会话重建 ⇒ 身份与记忆目录一起搬过去，别丢记忆）。 */
    void window.codex?.bossGroupSession?.({ action: "rename", previousId: prev, id: next })?.catch?.(() => undefined);
  } catch { /* 隐私模式：忽略 */ }
}

/** 「刚点指挥中枢、还没群也没 home」的过渡态：空会话要显示中枢欢迎语（10-25 用户令）。 */
export function setBossPending(pending) {
  state = { ...state, pending: Boolean(pending) };
  emit();
}

/** 指挥中枢自己的目录：`<userData>/boss-home`（主进程在 list 时顺手 mkdir，这里只拼路径）。
 *  ⛔ 用户令「指挥中枢完全独立」：它跑在这里 ⇒ 项目记忆 / 项目技能 / logs 都不跟任何项目共享。 */
async function resolveHomeDir() {
  try {
    const ud = await window.codex.getUserData();
    return ud ? `${String(ud).replace(/[\\/]+$/, "")}/boss-home` : "";
  } catch { return ""; }
}

async function load() {
  try {
    const [list, homeDir, sessionList] = await Promise.all([
      window.codex.listBossGroups(),
      resolveHomeDir(),
      /* ⛔ 指挥中枢身份名单（主进程是唯一真相源）：顺带拿各自的**记忆目录**，
         渲染层注入记忆时要按它取（⇒中枢记忆与普通会话完全拆开）。 */
      Promise.resolve(window.codex.bossGroupSession?.({ action: "list" })?.catch?.(() => null) ?? null),
    ]);
    const sessions = Array.isArray(sessionList?.sessions) ? sessionList.sessions : [];
    const sessionMemoryDirs = {};
    for (const entry of sessions) {
      const id = String(entry?.id ?? "");
      const dir = String(entry?.memoryDir ?? "");
      if (id && dir) sessionMemoryDirs[id] = dir;
    }
    const groups = Array.isArray(list) ? list : [];
    /* ⛔⛔ 10-26 用户现场：「中枢会话也会变成普通会话」。
       根因：**身份名单只从 localStorage 读**，而主进程那份登记表
       （electron/boss-groups/session-registry.ts → <userData>/boss-sessions.json）
       才是声明过的**唯一真相源**（localStorage 只是它的缓存）。
       ⇒ localStorage 一旦丢（清缓存 / 换源 / 重启丢写入），中枢身份就没了 ⇒
          同一个会话在界面上退化成普通会话（顶栏成员图标、中枢空态引导、中枢记忆路由全失效）。
       ⇒ 这里改成：**主进程登记表为准，localStorage 做并集兜底**（两边任一在就算中枢）。
       ⛔ 家目录锚点（homeId）同理：localStorage 读不到时用登记表里最后一个当 home，
          保住「点指挥中枢回到同一个会话」的行为。 */
    const registryIds = sessions.map((entry) => String(entry?.id ?? "")).filter(Boolean);
    const cachedIds = readSessionIds();
    const sessionIds = [...new Set([...registryIds, ...cachedIds])];
    const homeId = readHome() || (sessionIds.length ? sessionIds[sessionIds.length - 1] : "");
    state = {
      groups,
      bossIds: groups.map((g) => String(g.bossThreadId ?? "")).filter(Boolean),
      /* 群成员会话 id：侧栏据此打「中枢调度」标签（成员会话由派活时新建，不走 delegate 通道） */
      memberIds: groups.flatMap((g) => (Array.isArray(g.memberThreadIds) ? g.memberThreadIds : []).map(String)),
      homeId,
      sessionIds,
      sessionMemoryDirs,
      homeDir: homeDir || state.homeDir,
      pending: state.pending,
      loaded: true,
    };
    emit();
  } catch { /* 主进程未就绪：下一轮再试 */ }
}

export function subscribeBossThreads(fn) {
  listeners.add(fn);
  if (!timer) {
    void load();
    timer = setInterval(() => { void load(); }, 8000);
    off = window.codex.onEvent((event) => { if (event?.type === "boss-group") void load(); });
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size && timer) { clearInterval(timer); timer = null; off?.(); off = null; }
  };
}

export function getBossThreads() { return state; }

/**
 * 当前界面是不是「指挥中枢上下文」（**顶栏图标与时间线空态共用同一份判定**）。
 *
 * ⛔ 为什么要有这个函数：顶栏（成员图标 /「?」）与时间线（中枢空态引导）以前各写一份
 *   「是不是指挥中枢」的判断，条件差一点点 ⇒ 同一个会话在两处的表现不一致
 *   （10-25 用户实测：欢迎界面出来了、顶栏的成员图标却没有）。
 *   ⇒ 收成一份，两边都问它。
 *
 * 三种入口都算指挥中枢：
 *   ① 群里的 boss 线程（bossIds）；
 *   ② 已登记的指挥中枢（sessionIds，含 home 锚点会话）；
 *   ③ 刚点「指挥中枢」、**还没发出第一条消息**（pending ⇒ 引擎还没分配 thread id）。
 *
 * @param state   store 状态（通常直接传 getBossThreads() 的返回值）
 * @param threadId 当前会话 id（空串 = 还没拿到 id）
 */
export function isBossSessionContext(state, threadId) {
  const s = state ?? {};
  const id = String(threadId ?? "");
  if (id) {
    if ((s.bossIds ?? []).includes(id)) return true;
    if ((s.sessionIds ?? []).includes(id)) return true;
    return false;
  }
  /* pending 只在「还没选中任何会话」时算数 —— 否则 pending 残留会把普通会话也染成中枢。 */
  return Boolean(s.pending);
}

/** 这个指挥中枢的**专属记忆目录**（空串 = 不是指挥中枢 / 名单还没同步）。 */
export function bossMemoryWorkspaceFor(threadId) {
  const id = String(threadId ?? "");
  if (!id) return "";
  return state.sessionMemoryDirs?.[id] ?? "";
}

/** 名单可能还没同步到（刚建会话的第一次发送）⇒ 主动拉一次。 */
export async function ensureBossMemoryWorkspace(threadId) {
  const id = String(threadId ?? "");
  if (!id) return "";
  const hit = bossMemoryWorkspaceFor(id);
  if (hit) return hit;
  try {
    const res = await window.codex.bossGroupSession?.({ action: "list" });
    const sessions = Array.isArray(res?.sessions) ? res.sessions : [];
    const dirs = {};
    for (const entry of sessions) {
      const sid = String(entry?.id ?? "");
      const dir = String(entry?.memoryDir ?? "");
      if (sid && dir) dirs[sid] = dir;
    }
    state = { ...state, sessionMemoryDirs: dirs };
    emit();
    return dirs[id] ?? "";
  } catch { return ""; }
}

/** 确保主进程名单里有这个指挥中枢（幂等）。
 *  ⛔ **只在确认它是指挥中枢时调用**（sessionIds 命中）—— 否则普通会话会被误登记，
 *     它的记忆就会被路由到中枢目录（那就成了串台）。
 *  ⛔ 时序：指挥中枢首条消息时线程 id 刚分配，侧栏 effect 的登记可能晚一步 ⇒ 这里补一次。 */
export async function ensureBossSessionRegistered(threadId) {
  const id = String(threadId ?? "").trim();
  if (!id) return false;
  if (!(state.sessionIds ?? []).includes(id)) return false;
  try {
    await window.codex.bossGroupSession?.({ action: "add", id });
    return true;
  } catch { return false; }
}
