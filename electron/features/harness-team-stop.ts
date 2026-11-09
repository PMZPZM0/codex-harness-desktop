/**
 * 团队模式 · 停止运行（`harness-team:stop` 的实现体，11-08 从 harness-team-ipc.ts 抽出）
 *
 * 为什么独立成文件：ipc 注册宿主已经 986 净行（棘轮硬上限 1000），加「一次停全群」这条
 * 逻辑就会破线。⛔ 这两个函数本来也不依赖任何 ipc 宿主上下文，只认引擎（server）与两张表。
 *
 * 两种用法共用一套候选口径：
 *   · 单人（`@成员 /stop`）：候选 = 该伙伴的会话，命中活动回合就中断这一个；
 *   · 全群（输入框那个停止键）：`stopAll: true`，候选里**每一条正在跑的**都中断（按 thread 去重）。
 * ⛔ 候选只来自渲染层给的 threadIds + 委派登记表里同目标正在跑的会话；
 *    不在活动回合表里的一律不碰 —— 不会误伤主对话或别的群。
 */
import { delegateRegistry, engineActiveTurnIds, server } from "../runtime-refs";
import { killTalkCliRuns, listTalkThreads } from "./group-talk";

export type TeamStopInput = {
  /** 候选会话 id（渲染层：群日志里出现过的成员会话） */
  threadIds?: unknown[];
  /** 目标身份：主进程靠它从委派登记表里找"正在跑的那条" */
  targetKey?: string;
  memberName?: string;
  /** 群 id：主进程据此从**群聊台账**补候选（渲染层在第一条消息落盘前拿不到 threadId）。 */
  groupId?: string;
  /** true = 停掉候选里所有正在跑的会话（群里每个伙伴都停） */
  stopAll?: boolean;
};

/* ⛔⛔ 11-08 用户实测（截图：点停止弹出「还没有它的会话（先派一次活）」）：
   会话创建要 1~3 秒，这期间既没有台账条目、也没有活动回合 ⇒ 无可中断的目标。
   ⇒ 记一条「取消请求」，`runOne` 建完会话/开跑前看到就直接放弃（并删掉刚建的会话）。 */
const talkCancelRequests = new Map<string, number>();
const TALK_CANCEL_TTL = 60_000;
const talkCancelKey = (groupId: string, memberName: string) => `${groupId}::${memberName}`;

/** 记下「用户点了停止」：只对尚未开跑的那一轮生效，60s 后自动作废。 */
export function requestTalkCancel(groupId: string, memberName: string): void {
  const gid = String(groupId ?? "");
  const name = String(memberName ?? "");
  if (!gid || !name) return;
  const now = Date.now();
  for (const [key, at] of talkCancelRequests) if (now - at > TALK_CANCEL_TTL) talkCancelRequests.delete(key);
  talkCancelRequests.set(talkCancelKey(gid, name), now);
}

/** 取一次取消请求（一次性）：`runOne` 在开跑前调用，命中就放弃这一轮。 */
export function consumeTalkCancel(groupId: string, memberName: string): boolean {
  const key = talkCancelKey(String(groupId ?? ""), String(memberName ?? ""));
  const at = talkCancelRequests.get(key) ?? 0;
  if (!at) return false;
  talkCancelRequests.delete(key);
  return Date.now() - at <= TALK_CANCEL_TTL;
}

/** 作废待生效的停止请求（11-09 审查）。
 *  ⛔ 为什么必须有：停止请求只在「会话还没建出来」那 1~3 秒里登记，60 秒内有效；
 *     若用户按完停止又发了一条新消息，那条请求会把**新消息**在队列里静默吞掉
 *     （第一道 `runOne` 开跑前就命中 ⇒ 整轮放弃、用户只看到自己的气泡没人回）。
 *     ⇒ 新消息落盘时按成员清掉这个群里残留的请求（不带 memberName 则整群清）。 */
export function clearTalkCancel(groupId: string, memberName?: string): void {
  const gid = String(groupId ?? "");
  if (!gid) return;
  if (memberName === undefined) {
    const prefix = `${gid}::`;
    for (const key of [...talkCancelRequests.keys()]) if (key.startsWith(prefix)) talkCancelRequests.delete(key);
    return;
  }
  talkCancelRequests.delete(talkCancelKey(gid, String(memberName ?? "")));
}

export type TeamStopResult = {
  ok: boolean;
  error?: string;
  /** `starting` = 会话还在建、已登记取消请求（不是失败，UI 给中性提示）。 */
  reason?: "idle" | "starting" | "engine" | "cli";
  threadId?: string;
  turnId?: string;
  stopped?: number;
  threads?: string[];
  failed?: string[];
};

function candidatesOf(input: TeamStopInput): string[] {
  const given = Array.isArray(input?.threadIds) ? input.threadIds : [];
  const targetKey = String(input?.targetKey ?? "");
  const memberName = String(input?.memberName ?? "");
  const gid = String(input?.groupId ?? "");
  const fromRows = given.map((x) => String(x ?? "").trim()).filter(Boolean);
  let fromRegistry: string[] = [];
  try {
    fromRegistry = delegateRegistry?.runningThreadsByMember(memberName, targetKey) ?? [];
  } catch { /* 登记表未就绪：只用渲染层给的候选 */ }
  /* ⛔ 11-08：候选还要并上**群聊台账**里本群的会话 —— 渲染层在第一条消息落盘前
     `threadsOf(memberId)` 是空的（会话 id 只在 group-talk-live 里出现过，可能还没到）。
     台账在主进程、会话一建就有，按 memberName（或 stopAll）匹配。 */
  let fromTalk: string[] = [];
  if (gid) {
    const rows = listTalkThreads().filter((row) => row.groupId === gid);
    const want = input?.stopAll === true
      ? rows
      : rows.filter((row) => !memberName || row.name === memberName);
    fromTalk = want.map((row) => row.threadId);
  }
  return [...new Set([...fromRegistry, ...fromTalk, ...fromRows])].slice(0, 24);
}

/** 停掉团聊在跑的回合：入参是**候选会话 id 列表 + 目标身份**（派活未返回 threadId 时渲染层拿不到那条），并与主进程登记表里同目标的在跑会话合并。 */
export async function stopTeamRuns(input: TeamStopInput): Promise<TeamStopResult> {
  /* ⛔ 收的是**候选会话 id** + 目标身份，不是单个 id：
     · 派活正在跑的时候 `agents:invoke` 还没返回 threadId（它等整个回合）⇒ 渲染层拿不到
       "正在跑的那条会话"；
     · 所以候选 = 渲染层给的（历史消息/上次记的）+ **主进程侧登记表里同目标正在跑的**。
     ⛔ 活动回合表的键是 turnId、值是 threadId（boot.ts `set(id, threadIdOf)`）——
       按 `get(threadId)` 写会永远拿不到（第一版就是这么错的）。 */
  const list = candidatesOf(input);
  /* ⛔ CLI 直跑是**本机子进程**、没有引擎回合 —— turn/interrupt 停不掉，必须单独杀。 */
  const cliKilled = killTalkCliRuns(String(input?.groupId ?? ""));
  if (!list.length) {
    /* ⛔ 11-08 用户实测（截图红字「还没有它的会话（先派一次活）」）：点停止时会话还在建（1~3 秒），
       既没有台账条目也没有活动回合。⇒ 记一条取消请求，`runOne` 开跑前命中就整轮放弃；
       对用户来说就是「停住了」，⛔ 不再弹一句像是让他去派活的错误。 */
    if (cliKilled > 0) return { ok: true, reason: "cli", stopped: cliKilled };
    if (String(input?.groupId ?? "") && String(input?.memberName ?? "") && input?.stopAll !== true) {
      requestTalkCancel(String(input.groupId), String(input.memberName));
      return { ok: true, reason: "starting" };
    }
    return { ok: true, reason: "idle" };
  }

  if (input?.stopAll === true) {
    const hits = [...engineActiveTurnIds].filter(([, owner]) => list.includes(owner));
    if (!hits.length) {
      if (cliKilled > 0) return { ok: true, reason: "cli", stopped: cliKilled };
      return { ok: false, error: "群里当前没有在跑的伙伴", reason: "idle" };
    }
    const stopped: string[] = [];
    const failed: string[] = [];
    for (const [turnId, owner] of hits) {
      if (stopped.includes(owner)) continue;
      try {
        await server.request("turn/interrupt", { threadId: owner, turnId });
        stopped.push(owner);
      } catch (err) {
        failed.push(`${owner}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const total = stopped.length + cliKilled;
    return total
      ? { ok: true, stopped: total, threads: stopped, failed }
      : { ok: false, error: failed[0] ?? "停止失败", reason: "engine" };
  }

  let hitThread = "";
  let hitTurn = "";
  for (const [tid, owner] of engineActiveTurnIds) {
    if (list.includes(owner)) { hitThread = owner; hitTurn = tid; break; }
  }
  if (!hitTurn) {
    if (cliKilled > 0) return { ok: true, reason: "cli", stopped: cliKilled };
    return { ok: false, error: "这个伙伴当前没有在跑", reason: "idle" };
  }
  try {
    await server.request("turn/interrupt", { threadId: hitThread, turnId: hitTurn });
    return { ok: true, threadId: hitThread, turnId: hitTurn };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), reason: "engine" };
  }
}
