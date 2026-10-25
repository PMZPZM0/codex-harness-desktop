/**
 * BOSS 会话线程的**共享识别**（渲染层单例 store，10-25 立）。
 *
 * 为什么需要：BOSS 会话现在就是一个**普通会话**（`openThread(群.bossThreadId)`），
 * 但界面有多处要「知道这是不是 BOSS 会话」：
 *   · 侧栏按钮选中态 + 点它跳到哪；
 *   · 顶栏成员图标（只在这个会话出现）；
 *   · 顶栏调度开关（BOSS 会话有独立调度工具 ⇒ 要隐藏）；
 *   · 时间线空态文案（「你好 BOSS…」）；
 *   · 侧栏给群成员会话打「BOSS 调度」标签。
 * 各自轮询会重复请求，这里做**一份**：单例定时刷新 + boss-group 事件即时刷新，
 * 订阅者用 useSyncExternalStore 读。
 *
 * `homeId` = 还没建群时的「BOSS 会话」锚点（localStorage）。用户点 BOSS 会话时如果
 * 一个群都还没有，就新建一个会话并把它记成 home —— 之后点按钮永远回到同一个会话，
 * ⛔ 不会每点一次就多一个「未命名任务」（用户 10-25：「就这个 BOSS 会话一直走」）。
 */
const HOME_KEY = "boss-home-thread";

let state = { groups: [], bossIds: [], memberIds: [], homeId: "", pending: false, loaded: false };
const listeners = new Set();
let timer = null;
let off = null;

function emit() { for (const fn of listeners) fn(); }

function readHome() {
  try { return localStorage.getItem(HOME_KEY) ?? ""; } catch { return ""; }
}

export function setBossHomeThreadId(id) {
  const next = String(id || "");
  try {
    if (next) localStorage.setItem(HOME_KEY, next);
    else localStorage.removeItem(HOME_KEY);
  } catch { /* 隐私模式：忽略 */ }
  state = { ...state, homeId: next, pending: false };
  emit();
}

/** 「刚点 BOSS 会话、还没群也没 home」的过渡态：空会话要显示 BOSS 欢迎语（10-25 用户令）。 */
export function setBossPending(pending) {
  state = { ...state, pending: Boolean(pending) };
  emit();
}

async function load() {
  try {
    const list = await window.codex.listBossGroups();
    const groups = Array.isArray(list) ? list : [];
    state = {
      groups,
      bossIds: groups.map((g) => String(g.bossThreadId ?? "")).filter(Boolean),
      /* 群成员会话 id：侧栏据此打「BOSS 调度」标签（成员会话由派活时新建，不走 delegate 通道） */
      memberIds: groups.flatMap((g) => (Array.isArray(g.memberThreadIds) ? g.memberThreadIds : []).map(String)),
      homeId: readHome(),
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
