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

export type TeamStopInput = {
  /** 候选会话 id（渲染层：群日志里出现过的成员会话） */
  threadIds?: unknown[];
  /** 目标身份：主进程靠它从委派登记表里找"正在跑的那条" */
  targetKey?: string;
  memberName?: string;
  /** true = 停掉候选里所有正在跑的会话（群里每个伙伴都停） */
  stopAll?: boolean;
};

export type TeamStopResult = {
  ok: boolean;
  error?: string;
  reason?: "idle" | "engine";
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
  const fromRows = given.map((x) => String(x ?? "").trim()).filter(Boolean);
  let fromRegistry: string[] = [];
  try {
    fromRegistry = delegateRegistry?.runningThreadsByMember(memberName, targetKey) ?? [];
  } catch { /* 登记表未就绪：只用渲染层给的候选 */ }
  return [...new Set([...fromRegistry, ...fromRows])].slice(0, 24);
}

export async function stopTeamRuns(input: TeamStopInput): Promise<TeamStopResult> {
  /* ⛔ 收的是**候选会话 id** + 目标身份，不是单个 id：
     · 派活正在跑的时候 `agents:invoke` 还没返回 threadId（它等整个回合）⇒ 渲染层拿不到
       "正在跑的那条会话"；
     · 所以候选 = 渲染层给的（历史消息/上次记的）+ **主进程侧登记表里同目标正在跑的**。
     ⛔ 活动回合表的键是 turnId、值是 threadId（boot.ts `set(id, threadIdOf)`）——
       按 `get(threadId)` 写会永远拿不到（第一版就是这么错的）。 */
  const list = candidatesOf(input);
  if (!list.length) return { ok: false, error: "还没有它的会话（先派一次活）" };

  if (input?.stopAll === true) {
    const hits = [...engineActiveTurnIds].filter(([, owner]) => list.includes(owner));
    if (!hits.length) return { ok: false, error: "群里当前没有在跑的伙伴", reason: "idle" };
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
    return stopped.length
      ? { ok: true, stopped: stopped.length, threads: stopped, failed }
      : { ok: false, error: failed[0] ?? "停止失败", reason: "engine" };
  }

  let hitThread = "";
  let hitTurn = "";
  for (const [tid, owner] of engineActiveTurnIds) {
    if (list.includes(owner)) { hitThread = owner; hitTurn = tid; break; }
  }
  if (!hitTurn) return { ok: false, error: "这个伙伴当前没有在跑", reason: "idle" };
  try {
    await server.request("turn/interrupt", { threadId: hitThread, turnId: hitTurn });
    return { ok: true, threadId: hitThread, turnId: hitTurn };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), reason: "engine" };
  }
}
