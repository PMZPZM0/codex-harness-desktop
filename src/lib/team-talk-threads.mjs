/**
 * 群聊伙伴会话识别（渲染层单例 store，11-08 用户令）
 *
 * 用户（截图）：「群里会话的伙伴标签没出来」。群聊伙伴会话是 `thread/start` 新建的
 * **普通会话**：既没有 delegate 登记、也不是中枢群成员 ⇒ 侧栏原有的两套徽标来源都认不出它。
 * 唯一权威来源 = 主进程群聊台账（`group-talk-threads.json`，会话建立时写入）。
 * ⛔ 不许按标题前缀「伙伴·」猜 —— 用户改名后就不成立（同类事故见 thread-source.mjs 的注释）。
 *
 * 与 boss-threads-store 同款：单例 + 定时刷新 + 群聊事件即时刷新，订阅方用 useSyncExternalStore 读。
 */

let state = { byId: {}, loaded: false };
const listeners = new Set();
let timer = null;
let off = null;

function emit() {
  for (const fn of listeners) fn();
}

function norm(rows) {
  const byId = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row?.threadId ?? "");
    if (!id) continue;
    byId[id] = {
      groupId: String(row?.groupId ?? ""),
      memberId: String(row?.memberId ?? ""),
      name: String(row?.name ?? ""),
    };
  }
  return byId;
}

async function load() {
  try {
    const res = await window.codex.harnessTeamTalkThreads?.();
    state = { byId: norm(res?.threads), loaded: true };
    emit();
  } catch {
    /* 主进程未就绪 / 旧版本：保持上一份快照，下一轮再试 */
  }
}

/** 订阅群聊伙伴台账（首次订阅才起轮询；群聊写消息/成员开跑时即时刷新）。 */
export function subscribeTeamTalkThreads(fn) {
  listeners.add(fn);
  if (!timer) {
    void load();
    timer = setInterval(() => { void load(); }, 8000);
    off = window.codex?.onEvent?.((event) => {
      const type = String(event?.type ?? "");
      if (type === "harness-team-messages" || type === "team-member-run" || type === "team-dispatch-done") void load();
    }) ?? null;
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
      off?.();
      off = null;
    }
  };
}

export function getTeamTalkThreads() {
  return state;
}

/** 这个会话是不是群聊伙伴会话（是 ⇒ 返回台账行，否则 null）。 */
export function teamTalkThreadOf(threadId) {
  return state.byId[String(threadId ?? "")] ?? null;
}
