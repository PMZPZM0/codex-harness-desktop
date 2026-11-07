/**
 * 工作伙伴 · 群聊独立通道（11-07 用户令：「群聊是群聊，构建独立的群聊通道，跟外面的会话区分开，
 * 群聊不需要调度……文件都独立」）。
 *
 * ⛔⛔ 这个板块**完全不碰外面的调度链**：
 *   · 不调 `runDelegatedTask` / `delegateRegistry` / `canDispatchFrom`；
 *   · 不注入 `delegateScopeBlock` / `SUBCONV_NOTE` / 「没有调度权限」那套会话级指令；
 *   · 不写 delegate 台账、不产生「被调度会话」标签。
 *   ⇒ 群里的每个人是**一条普通的、长期的引擎会话**（thread/start 一次，之后 resume + turn/start），
 *     群消息就是它的输入，它的回复就是群消息。成员之间能互相说话，因为宿主会把那句话
 *     **投递进对方的会话**（不是给它派一个新任务）。
 *
 * 台账独立落盘 `group-talk-threads.json`：⛔ 与 `harness-teams.json`（群配置+消息）分开，
 * 也⛔ 不写进 delegate 台账 —— 群会话不参与外面的「调度来源 / 上级」推导。
 */
import { ensureProjectAgentsMd } from "../../project-conventions";
import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { server } from "../../runtime-refs";
import { turnOutputText, waitForTurnCompletion } from "../../main/03-turn-summary";
import { buildGroupTalkTools } from "./02-tools";

export type TalkMember = {
  id: string;
  name: string;
  targetKind?: string;
  targetKey?: string;
  targetProfession?: string;
};

type Entry = { threadId: string; name: string; at: number };
type Ledger = Record<string, Entry>;

/** ⛔ 惰性求值：app.setPath("userData") 在 main.ts 模块体，被 import 的模块体先于它运行。 */
function ledgerFile(): string {
  return join(app.getPath("userData"), "group-talk-threads.json");
}

function readLedger(): Ledger {
  const file = ledgerFile();
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed as Ledger : {};
  } catch {
    return {};
  }
}

function writeLedger(all: Ledger): void {
  const file = ledgerFile();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(all, null, 2), "utf8");
  renameSync(tmp, file);
}

export const talkKey = (groupId: string, memberId: string) => `${groupId}::${memberId}`;

/** 反查：这条引擎会话属于哪个群 / 哪位成员（工具应答的身份硬闸，⛔ 不许模型自报）。 */
export function lookupGroupThread(threadId: string): { groupId: string; memberId: string; name: string } | null {
  const tid = String(threadId ?? "");
  if (!tid) return null;
  for (const [key, entry] of Object.entries(readLedger())) {
    if (entry?.threadId !== tid) continue;
    const [groupId, memberId] = key.split("::");
    return { groupId, memberId, name: entry.name };
  }
  return null;
}

/** 清掉某个群的会话台账（解散群时调用；⛔ 不删引擎里的 rollout，那是用户自己的记录）。 */
export function forgetGroupThreads(groupId: string): number {
  const all = readLedger();
  const before = Object.keys(all).length;
  const next: Ledger = {};
  for (const [key, entry] of Object.entries(all)) if (!key.startsWith(`${groupId}::`)) next[key] = entry;
  if (Object.keys(next).length !== before) writeLedger(next);
  return before - Object.keys(next).length;
}

/**
 * 取（或建）某位成员在这个群里的长期会话。
 * ⛔ 引擎只在 `thread/start` 定死工具面 ⇒ 群聊工具必须在**新建**时挂上；resume 传 dynamicTools 会被整份忽略。
 * ⛔ 不传 model：沿用引擎全局配置（与主会话同一份），⛔ 不在这里另建一套供应商绑定。
 */
export async function ensureTalkThread(
  groupId: string,
  member: TalkMember,
  options: { cwd?: string; groupName?: string; onCreated?: (threadId: string) => void } = {},
): Promise<{ threadId: string; created: boolean }> {
  const key = talkKey(groupId, member.id);
  const all = readLedger();
  const hit = all[key];
  if (hit?.threadId) {
    /* 台账说有，但引擎可能已经不认（会话被删）⇒ resume 失败就重建成新会话。 */
    const resumed: any = await server.request("thread/resume", { threadId: hit.threadId, excludeTurns: false }).catch(() => null);
    if (resumed?.thread?.id) return { threadId: hit.threadId, created: false };
  }
  /* ⛔ 守卫【171】：所有 thread/start 调用点都要接 ensureProjectAgentsMd（项目约定文件随会话落地）。 */
  ensureProjectAgentsMd(String(options.cwd ?? "").trim() || process.cwd());
  const started: any = await server.request("thread/start", {
    cwd: String(options.cwd ?? "").trim() || process.cwd(),
    sandbox: "workspace-write",
    approvalPolicy: "never",
    dynamicTools: buildGroupTalkTools(),
  });
  const threadId = String(started?.thread?.id ?? "");
  if (!threadId) throw new Error("群聊会话创建失败（引擎没返回 threadId）");
  /* ⛔ 11-07 真机「看不懂，一下两个会话」：群聊会话以前是随机笔名，用户分不清谁是谁。
     统一命名为「伙伴·成员名@群名」，侧栏一眼可辨这是工作伙伴里的哪一位。 */
  await server.request("thread/name/set", {
    threadId,
    name: `伙伴·${member.name}@${options.groupName || "群聊"}`.slice(0, 40),
  }).catch(() => undefined);
  all[key] = { threadId, name: member.name, at: Date.now() };
  writeLedger(all);
  options.onCreated?.(threadId);
  return { threadId, created: true };
}

/** 一轮群聊：把一条消息送进成员会话，等它说完，把最终文本还回来。 */
export async function runTalkTurn(
  groupId: string,
  member: TalkMember,
  inputText: string,
  options: { cwd?: string; groupName?: string; effort?: string } = {},
): Promise<{ ok: boolean; text: string; threadId: string; error?: string }> {
  const { threadId } = await ensureTalkThread(groupId, member, { cwd: options.cwd, groupName: options.groupName });
  const turn: any = await server.request("turn/start", {
    threadId,
    input: [{ type: "text", text: inputText, text_elements: [] }],
    ...(options.effort ? { effort: options.effort } : {}),
  });
  const turnId = String(turn?.turn?.id ?? "");
  if (!turnId) throw new Error("群聊回合启动失败（没返回 turnId）");
  const completed = await waitForTurnCompletion(threadId, turnId);
  let text = turnOutputText(completed);
  if (!text) {
    const resumed: any = await server.request("thread/resume", { threadId, excludeTurns: false }).catch(() => null);
    text = turnOutputText(resumed?.thread?.turns?.find((entry: any) => entry.id === turnId));
  }
  return {
    ok: true,
    /* ⛔ 群聊会话没有「办公室 / 头像轨」那套概念，别把调度链的「转后台」公文腔塞进群。 */
    text: String(text || "").trim(),
    threadId,
  };
}
