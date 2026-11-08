/**
 * 「团队成员产出 → 群里那条消息」的落点（11-07）。
 *
 * ⛔⛔ 用户真机判据：「关掉群弹窗，任务就莫名其妙结束了 / 没结果回传」——
 *    成员产出原来是**渲染层**在 `team-run finished` 分支里写进群日志的：
 *    面板一卸载就没人接了，群里只剩主理人自己那条。主进程照跑，但产出落不了盘。
 *
 * ⛔ 这里只做两件事（**不 import 群存储**，避免 harness-team-ipc ↔ team-invoke 成环）：
 *   ① 记住「哪个团此刻在哪个群里干活」（群派活时登记，2 小时自动失效）；
 *   ② 暴露一个由群存储注入的"写一条群消息"回调（挂载时 `setTeamGroupAppender`）。
 *
 * ⛔ 落群 id 必须与渲染层同一个（`team-run:<runId>`）：两边都写时按 id 覆盖，天然幂等，
 *    不会出现"面板开着时写一条、主进程又写一条"的双份。
 */

/* ⛔ 11-08 审查：第三个参数 = 这次派活的**开跑时刻**。群存储按它判「开跑后用户清空过记录」⇒ 只结算不落盘。 */
type AppendFn = (groupId: string, entry: Record<string, unknown>, since?: number) => Promise<{ ok: boolean; error?: string }>;

let appendFn: AppendFn | null = null;

/** 群存储挂载时注入（见 harness-team-ipc 的 mount）。 */
export function setTeamGroupAppender(fn: AppendFn | null): void {
  appendFn = fn;
}

/** teamId → 群 id（派活期间有效）。⛔ 只记最近一次派活的群：同一个团在同一时刻只在一个群里干活。 */
const boundGroupByTeam = new Map<string, { groupId: string; at: number }>();

/** 绑定有效期：团队任务可能跑很久（成员串行 + 重试），2 小时足够，超时即视为"不在群里"。 */
const BIND_TTL_MS = 2 * 60 * 60 * 1000;

/** 群派活时登记：这个团接下来在哪个群里干活。 */
export function bindTeamGroup(teamId: string, groupId: string): void {
  const t = String(teamId ?? "");
  const g = String(groupId ?? "");
  if (!t || !g) return;
  boundGroupByTeam.set(t, { groupId: g, at: Date.now() });
}

/** 反查：这个团此刻绑在哪个群（没有/过期 ⇒ 空串，⛔ 不猜）。 */
export function groupOfTeam(teamId: string): string {
  const key = String(teamId ?? "");
  if (!key) return "";
  const hit = boundGroupByTeam.get(key);
  if (!hit) return "";
  if (Date.now() - hit.at > BIND_TTL_MS) {
    boundGroupByTeam.delete(key);
    return "";
  }
  return hit.groupId;
}

/** 把成员产出写进群日志（幂等 id 由调用方给）。⛔ 没接线就返回 ok:false，⛔ 不静默当成功。 */
export async function appendMemberOutputToGroup(
  groupId: string,
  entry: Record<string, unknown>,
  since?: number,
): Promise<{ ok: boolean; error?: string }> {
  const gid = String(groupId ?? "");
  if (!gid) return { ok: false, error: "没有绑定的群" };
  if (!appendFn) return { ok: false, error: "群存储没接线" };
  try {
    const res = await appendFn(gid, entry, since);
    return { ok: Boolean(res?.ok), error: res?.error };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
