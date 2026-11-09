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
      /* 11-09：会话里显示伙伴身份要用的字段（主进程按群成员表现算，群内改名/换头像即时变）。 */
      avatar: String(row?.avatar ?? ""),
      kind: String(row?.kind ?? "bot"),
      targetKind: String(row?.targetKind ?? ""),
      targetKey: String(row?.targetKey ?? ""),
      groupName: String(row?.groupName ?? ""),
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
      if (type === "harness-team-messages" || type === "team-member-run" || type === "team-dispatch-done" || type === "team-talk-threads-changed") void load();
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

/** 伙伴会话在界面上要显示的身份（可直接喂 `MemberAvatar`）；不是伙伴会话 ⇒ null。
 *  ⛔ 只读快照，别在外面另拼一份 kind/targetKey 映射（群视图与外面会话必须同一套口径）。 */
export function teamTalkIdentityOf(threadId) {
  const row = teamTalkThreadOf(threadId);
  if (!row) return null;
  return {
    id: row.memberId,
    name: row.name,
    avatar: row.avatar,
    kind: row.kind,
    targetKind: row.targetKind,
    targetKey: row.targetKey,
  };
}
