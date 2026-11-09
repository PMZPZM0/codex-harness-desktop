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
import { classifyTalkResumeFailure } from "../../../src/lib/team-talk-resume.mjs";
/* ⛔ 群聊回合失败按主对话同一套分类给中文原因（上下文超限 / 沙箱拒绝 / 限流…）。 */
import { describeTurnStop } from "../../../src/lib/turn-stop-reason.mjs";

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

let ledgerChangedHook: (() => void) | null = null;
/* 台账变动旁听（11-09）：桌面宠物据此把「群聊伙伴会话」排除在外（不弹 `[SYSTEM TASK · 工作伙伴消息]`
   那种内部信封气泡）。⛔ 只是通知，回调里**同步**刷新一个 Set 即可，不许在回调里 await 写盘。 */
export function onTalkLedgerChanged(cb: () => void): void {
  ledgerChangedHook = cb;
}

function writeLedger(all: Ledger): void {
  const file = ledgerFile();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(all, null, 2), "utf8");
  renameSync(tmp, file);
  try { ledgerChangedHook?.(); } catch { /* 旁路失败不影响台账 */ }
}

/* ⛔⛔ 11-08 用户令「查一下 resume 失败后重复会话的问题」——
   台账原来是「读快照 → 改 → 整份写回」，两个成员同时开跑时后写的那次会把先写的成员**整条抹掉**
   （实测：一轮里 4 位成员同时开会话，台账最后只剩 1 条，其余下次又要重开一条 ⇒ 侧栏重复会话）。
   ⇒ 所有写操作串行 + **在链内重新读盘**再合并，⛔ 不许拿旧快照整份覆盖。 */
let ledgerChain: Promise<unknown> = Promise.resolve();
function mutateLedger<T>(fn: (all: Ledger) => { all: Ledger; out: T }): Promise<T> {
  const task = ledgerChain.then(() => {
    const { all, out } = fn(readLedger());
    writeLedger(all);
    return out;
  });
  ledgerChain = task.catch(() => undefined);
  return task;
}


/** resume 失败的分类；`busy` / `transient` 抛可识别错误（⛔ 调用方据此**不重建**会话）。 */
async function resumeTalkThread(
  threadId: string,
  options: { sandbox?: string; approvalPolicy?: string; shellEnv?: Record<string, string> },
): Promise<{ ok: true } | { ok: false; kind: "busy" | "missing" | "transient"; message: string }> {
  try {
    const resumed: unknown = await server.request("thread/resume", {
      threadId,
      excludeTurns: false,
      ...(options.sandbox ? { sandbox: options.sandbox } : {}),
      ...(options.approvalPolicy ? { approvalPolicy: options.approvalPolicy } : {}),
      ...talkShellConfig(options.shellEnv),
    });
    const id = String((resumed as { thread?: { id?: unknown } } | null)?.thread?.id ?? "");
    return id ? { ok: true } : { ok: false, kind: "transient", message: "thread/resume 没返回 threadId" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, kind: classifyTalkResumeFailure(message), message };
  }
}

/* CLI 成员的 shell 环境（11-09「必须要真的 cli 智能体」）：与 delegation 同口径 ——
   整表覆盖 + 带上增强 PATH（不写 PATH 会把 config.toml 那份顶掉）。没传 = 不加 config（旧行为）。 */
function talkShellConfig(shellEnv?: Record<string, string>): { config?: Record<string, unknown> } {
  if (!shellEnv || !Object.keys(shellEnv).length) return {};
  return { config: { shell_environment_policy: { inherit: "all", ignore_default_excludes: true, set: shellEnv } } };
}

/** 群聊会话忙/暂时不可用的错误（调用方据此提示"稍后再试"，⛔ 不重建会话）。 */
function talkUnavailable(kind: "busy" | "transient", message: string): Error {
  const error = new Error(kind === "busy"
    ? `这位伙伴正在回复上一条消息，稍后再 @ 他（会话没有重建）`
    : `群聊会话暂时不可用，稍后再试（会话没有重建）：${message || "引擎未就绪"}`);
  (error as Error & { code?: string }).code = kind === "busy" ? "TALK_BUSY" : "TALK_UNAVAILABLE";
  return error;
}

/** 群聊通道的键：`<群 id>::<成员 id>`（同一成员在不同群互不干扰）。 */
export const talkKey = (groupId: string, memberId: string) => `${groupId}::${memberId}`;

/** 反查：这条引擎会话属于哪个群 / 哪位成员（工具应答的身份硬闸，⛔ 不许模型自报）。 */
export function lookupGroupThread(threadId: string): { groupId: string; memberId: string; name: string } | null {
  const tid = String(threadId ?? "");
  if (!tid) return null;
  for (const [key, entry] of Object.entries(readLedger())) {
    if (entry?.threadId !== tid) continue;
    const [groupId, memberId] = key.split("::");
    /* ⛔⛔ 11-08 真机「成员之间艾特不回复」的**真根因**：台账里有一条 `群id::`（成员 id 为空）的脏记录
       ⇒ 反查拿到的 memberId 是空串 ⇒ `group_say` 写群消息时 authorId 为空
       ⇒ 群里出现**没有署名的消息**（用户看到的就是"回了我没看见/没回"）。
       ⇒ 没有 memberId 的台账条目**不当作身份**（宁可让工具报"找不到这个人"）。 */
    if (!String(memberId ?? "").trim()) continue;
    return { groupId, memberId, name: entry.name };
  }
  return null;
}

/** 全部群聊伙伴会话的台账（只读）：侧栏据此给这些**普通会话**打「伙伴」标签。
 *  ⛔ 会话是 `thread/start` 新建的，不走 delegate 登记、也不是中枢群成员 ⇒ 没有别的权威来源；
 *     按标题前缀猜（「伙伴·」）会在用户改名后失效，所以必须暴露台账。
 *  返回按最近活动倒序；`memberId` 是台账键的成员段（团成员为合成 id `team:<团队>:<成员>`）。 */
export function listTalkThreads(): Array<{ threadId: string; groupId: string; memberId: string; name: string; at: number }> {
  return Object.entries(readLedger())
    .map(([key, entry]) => {
      const [groupId, memberId] = key.split("::");
      return {
        threadId: String(entry?.threadId ?? ""),
        groupId: String(groupId ?? ""),
        memberId: String(memberId ?? ""),
        name: String(entry?.name ?? ""),
        at: Number(entry?.at ?? 0) || 0,
      };
    })
    .filter((row) => row.threadId && row.memberId)
    .sort((a, b) => b.at - a.at);
}

/** 群成员改名：台账名字跟上，并把该成员在本群的伙伴会话标题改成「伙伴·新名@群名」。
 *  ⛔ 只动**本群+本成员**这一条台账键（链内重读，别整份覆盖）；没有会话 ⇒ 什么都不做。
 *  @returns 实际改名了的 threadId（调用方据此广播身份刷新） */
export async function renameTalkMember(groupId: string, memberId: string, name: string, groupName: string): Promise<string[]> {
  const key = talkKey(groupId, memberId);
  const threadId = await mutateLedger((all) => {
    const cur = all[key];
    if (!cur?.threadId) return { all, out: "" };
    if (String(cur.name ?? "") === name) return { all, out: cur.threadId };
    all[key] = { ...cur, name };
    return { all, out: cur.threadId };
  });
  if (!threadId) return [];
  /* 会话标题跟随（引擎会发 thread/name/updated，侧栏即时改）；⛔ 不用用户笔名覆盖。 */
  await server.request("thread/name/set", { threadId, name: `伙伴·${name}@${groupName || "群聊"}`.slice(0, 40) }).catch(() => undefined);
  return [threadId];
}

/** 清掉指定的会话台账（解散群 / 自愈时调用；⛔ 只清**删成功**的那些 —— 删失败的留着下次重试）。
 *  ⛔ 不删引擎里的 rollout，那是用户自己的记录（删会话走 thread/delete，另一条链）。 */
export function forgetTalkThreads(threadIds: string[]): number {
  const drop = new Set((Array.isArray(threadIds) ? threadIds : []).map((id) => String(id ?? "")).filter(Boolean));
  if (!drop.size) return 0;
  const all = readLedger();
  const next: Ledger = {};
  let removed = 0;
  for (const [key, entry] of Object.entries(all)) {
    if (drop.has(String(entry?.threadId ?? ""))) { removed += 1; continue; }
    next[key] = entry;
  }
  if (removed) writeLedger(next);
  return removed;
}

/**
 * 取（或建）某位成员在这个群里的长期会话。
 * ⛔ 引擎只在 `thread/start` 定死工具面 ⇒ 群聊工具必须在**新建**时挂上；resume 传 dynamicTools 会被整份忽略。
 * ⛔ 不传 model：沿用引擎全局配置（与主会话同一份），⛔ 不在这里另建一套供应商绑定。
 */
export async function ensureTalkThread(
  groupId: string,
  member: TalkMember,
  options: { cwd?: string; groupName?: string; onCreated?: (threadId: string) => void; sandbox?: string; approvalPolicy?: string; shellEnv?: Record<string, string> } = {},
): Promise<{ threadId: string; created: boolean }> {
  /* ⛔ 没有 id 就等于没有身份：建出来的台账键会是 `群id::`，之后所有反查都拿到空 memberId。 */
  if (!String(member?.id ?? "").trim()) throw new Error("群成员缺少 id，无法建立群聊会话");
  const key = talkKey(groupId, member.id);
  const hit = readLedger()[key];
  if (hit?.threadId) {
    /* 自愈：同一个 threadId 若还挂在 `群id::`（成员 id 为空）这种脏键上，搬到正确的键上；
       ⛔ 写台账必须走 mutateLedger（链内重新读盘），否则并发开跑时会把别的成员**整条抹掉**。 */
    await mutateLedger((all) => {
      const cur = all[key];
      if (!cur?.threadId) return { all, out: null };
      let healed = false;
      for (const [k, v] of Object.entries(all)) {
        if (k === key) continue;
        /* ⛔⛔ 11-08 审查（Critical）：脏键清理**必须限定本群** —— 只看「成员 id 为空」的话，
           A 群的自愈会把 B 群同名成员的台账键删掉（跨群串话 / B 群成员被迫重开会话）。 */
        if (String(k.split("::")[0] ?? "") !== String(groupId)) continue;
        if (String(k.split("::")[1] ?? "").trim()) continue;   // 只清"成员 id 为空"的脏键
        if (v?.threadId === cur.threadId || String(v?.name ?? "") === String(member.name ?? "")) {
          delete all[k];
          healed = true;
        }
      }
      if (healed) all[key] = { threadId: cur.threadId, name: member.name, at: cur.at ?? Date.now() };
      return { all, out: null };
    });

    /* ⛔⛔ 11-08 用户令「查一下 resume 失败后重复会话的问题」：
       引擎原话 `cannot resume running thread` —— 会话活着、只是正在跑。旧代码把所有 resume 失败
       都当"会话没了" ⇒ thread/start 新开一条 + 覆盖台账 ⇒ 同一位成员两条会话（侧栏重复）。
       ⇒ 只有引擎**明确说会话不存在**才重建；忙 / 引擎重启 / 超时一律抛可识别错误，绝不新建。 */
    const resumed = await resumeTalkThread(hit.threadId, options);
    if (resumed.ok) return { threadId: hit.threadId, created: false };
    if (resumed.kind !== "missing") throw talkUnavailable(resumed.kind, resumed.message);
  }
  /* 没有正键但有**同名脏键**（成员 id 为空、旧版本留下的）：认领它，别给同一个人再开一个会话。
     ⛔ 认领后必须搬到正键，否则下次反查还是空身份（就是"群里一条没有署名的消息"那个 bug）。 */
  const claimed = await mutateLedger<{ threadId: string } | null>((all) => {
    const orphan = Object.entries(all).find(
      ([k, v]) => String(k.split("::")[0] ?? "") === String(groupId)   // ⛔ 只在**本群**里认领
        && !String(k.split("::")[1] ?? "").trim()
        && String(v?.name ?? "") === String(member.name ?? "")
        && String(v?.threadId ?? ""),
    );
    if (!orphan) return { all, out: null };
    const [orphanKey, orphanEntry] = orphan;
    delete all[orphanKey];
    all[key] = { threadId: String(orphanEntry.threadId), name: member.name, at: orphanEntry.at ?? Date.now() };
    return { all, out: { threadId: String(orphanEntry.threadId) } };
  });
  if (claimed) {
    const resumed = await resumeTalkThread(claimed.threadId, options);
    if (resumed.ok) return { threadId: claimed.threadId, created: false };
    if (resumed.kind !== "missing") throw talkUnavailable(resumed.kind, resumed.message);
  }
  /* 并发兜底：另一位调用方可能刚在链内写好了这条（本函数也在按成员串行的队列里跑，
     这里只是防探活/旧版本留下的竞态）。已有就复用，⛔ 不再新建第二条。 */
  const fresh = readLedger()[key]?.threadId;
  if (fresh && fresh !== hit?.threadId) return { threadId: fresh, created: false };
  /* ⛔ 守卫【171】：所有 thread/start 调用点都要接 ensureProjectAgentsMd（项目约定文件随会话落地）。 */
  ensureProjectAgentsMd(String(options.cwd ?? "").trim() || process.cwd());
  const started: any = await server.request("thread/start", {
    cwd: String(options.cwd ?? "").trim() || process.cwd(),
    /* ⛔ 11-08 审查：群输入框的「完全访问 / 审批档」原来是死控件 —— 这里恒写 workspace-write / never。
       改成按调用方传入（缺省保持旧值，不影响既有行为）。 */
    sandbox: options.sandbox || "workspace-write",
    approvalPolicy: options.approvalPolicy || "never",
    dynamicTools: buildGroupTalkTools(),
    ...talkShellConfig(options.shellEnv),
  });
  const threadId = String(started?.thread?.id ?? "");
  if (!threadId) throw new Error("群聊会话创建失败（引擎没返回 threadId）");
  /* ⛔ 11-07 真机「看不懂，一下两个会话」：群聊会话以前是随机笔名，用户分不清谁是谁。
     统一命名为「伙伴·成员名@群名」，侧栏一眼可辨这是工作伙伴里的哪一位。 */
  await server.request("thread/name/set", {
    threadId,
    name: `伙伴·${member.name}@${options.groupName || "群聊"}`.slice(0, 40),
  }).catch(() => undefined);
  await mutateLedger((all) => {
    all[key] = { threadId, name: member.name, at: Date.now() };
    return { all, out: null };
  });
  options.onCreated?.(threadId);
  return { threadId, created: true };
}

/**
 * 只读探测某位成员的群聊会话（给「先挂流式监听」用）。
 * ⛔ **绝不新建会话** —— 并发探测 / 会话正忙时新建，正是"同一位成员两条会话"的来源。
 * 返回 null = 还没有会话或暂时不可用（让排队后的 runTalkTurn 去建）；
 * `busy` = 会话活着但正在跑（此时先不挂流式，否则增量会串到上一轮的内容上）。
 */
export async function peekTalkThread(
  groupId: string,
  member: TalkMember,
  options: { sandbox?: string; approvalPolicy?: string; shellEnv?: Record<string, string> } = {},
): Promise<{ threadId: string; busy: boolean } | null> {
  const hit = readLedger()[talkKey(groupId, member.id)];
  if (!hit?.threadId) return null;
  const resumed = await resumeTalkThread(hit.threadId, options);
  if (resumed.ok) return { threadId: hit.threadId, busy: false };
  if (resumed.kind === "busy") return { threadId: hit.threadId, busy: true };
  return null;
}

/* 同一成员的群聊投递串行：引擎不允许 resume / 并行回合**正在跑**的会话。
   串行后第二条会等第一条跑完再 ensure + turn ⇒ 既不新建重复会话，也不会"回了句已送到、其实没送"。 */
const talkChains = new Map<string, Promise<unknown>>();

/** 把一次群聊投递排进该成员的串行队列（键 = 群 + 成员，不同群互不阻塞；前一条失败不阻塞后一条）。 */
export function queueTalkDelivery<T>(groupId: string, memberId: string, task: () => Promise<T>): Promise<T> {
  const key = talkKey(groupId, memberId);
  const prev = talkChains.get(key) ?? Promise.resolve();
  const run = prev.then(task, task);
  const settled = run.catch(() => undefined);
  talkChains.set(key, settled);
  void settled.then(() => { if (talkChains.get(key) === settled) talkChains.delete(key); });
  return run;
}

/** 上下文超限的统一判定（引擎有几种写法：codexErrorInfo 枚举 / 中英文文案）。 */
function isContextExceeded(error: unknown): boolean {
  const anyErr = error as { code?: string; message?: string } | null;
  if (anyErr?.code === "TALK_CONTEXT_EXCEEDED") return true;
  const text = `${anyErr?.message ?? ""} ${String(error ?? "")}`;
  return /contextWindowExceeded|context window|上下文.{0,6}(超限|超长|超出)/i.test(text);
}

/** 跑一轮并等结果。⛔ 回合「completed 但带 error」同样按失败抛 ——
 *  旧实现只看有没有正文，引擎把「上下文超限 / 沙箱拒绝」写在 `turn.error` 里时，
 *  群里只会出现「（没有返回文本内容）」，用户完全不知道发生了什么。 */
async function runTalkTurnOnce(
  threadId: string,
  inputText: string,
  options: { model?: string; effort?: string; approvalPolicy?: string },
): Promise<string> {
  const turn: any = await server.request("turn/start", {
    threadId,
    input: [{ type: "text", text: inputText, text_elements: [] }],
    ...(options.model ? { model: options.model } : {}),
    ...(options.effort ? { effort: options.effort } : {}),
    /* ⛔ 逐回合下发审批档（与主对话同口径）：resume 的 sandbox/approval 可能没及时生效。 */
    ...(options.approvalPolicy ? { approvalPolicy: options.approvalPolicy } : {}),
  });
  const turnId = String(turn?.turn?.id ?? "");
  if (!turnId) throw new Error("群聊回合启动失败（没返回 turnId）");
  const completed = await waitForTurnCompletion(threadId, turnId);
  const turnError = completed?.error ?? null;
  if (turnError) {
    const stop = describeTurnStop({ status: "failed", error: turnError });
    const err = new Error(stop.detail || stop.label || "引擎没给失败原因");
    (err as Error & { code?: string }).code = stop.kind === "contextWindowExceeded" ? "TALK_CONTEXT_EXCEEDED" : "TALK_TURN_FAILED";
    throw err;
  }
  let text = turnOutputText(completed);
  if (!text) {
    const resumed: any = await server.request("thread/resume", { threadId, excludeTurns: false }).catch(() => null);
    text = turnOutputText(resumed?.thread?.turns?.find((entry: any) => entry.id === turnId));
  }
  /* ⛔ 群聊会话没有「办公室 / 头像轨」那套概念，别把调度链的「转后台」公文腔塞进群。 */
  return String(text || "").trim();
}

/** 一轮群聊：把一条消息送进成员会话，等它说完，把最终文本还回来。
 *  ⛔ 11-08 用户问「群里超长上下文怎么办」：正常长对话由引擎按全局阈值**自动压缩**；
 *     自愈只兜「压缩后仍装不下 / 单轮请求本身超窗」这种残余情况 ——
 *     清台账 + 删旧会话 + 新建一条再试一次。群历史与身份是**每轮重新注入**的
 *     （buildTalkInput），重建不会失忆，成员照样接得上话。 */
export async function runTalkTurn(
  groupId: string,
  member: TalkMember,
  inputText: string,
  options: {
    cwd?: string; groupName?: string; effort?: string; model?: string; sandbox?: string; approvalPolicy?: string;
    /** CLI 成员的 shell 环境（真 CLI 链路）：建/复用会话时注入，子进程才拿得到供应商与 PATH。 */
    shellEnv?: Record<string, string>;
    /** 调用方已解析好的会话（先用 `ensureTalkThread` 拿到再过进来）⇒ ⛔ 不再重复 resume 一次。 */
    threadId?: string;
  } = {},
): Promise<{ ok: boolean; text: string; threadId: string; error?: string }> {
  let threadId = options.threadId
    || (await ensureTalkThread(groupId, member, { cwd: options.cwd, groupName: options.groupName, sandbox: options.sandbox, approvalPolicy: options.approvalPolicy, shellEnv: options.shellEnv })).threadId;
  try {
    return { ok: true, text: await runTalkTurnOnce(threadId, inputText, options), threadId };
  } catch (error) {
    if (!isContextExceeded(error)) throw error;
    forgetTalkThreads([threadId]);
    try {
      await server.request("thread/delete", { threadId });
    } catch {
      await server.request("thread/archive", { threadId }).catch(() => undefined);
    }
    threadId = (await ensureTalkThread(groupId, member, { cwd: options.cwd, groupName: options.groupName, sandbox: options.sandbox, approvalPolicy: options.approvalPolicy, shellEnv: options.shellEnv })).threadId;
    return { ok: true, text: await runTalkTurnOnce(threadId, inputText, options), threadId };
  }
}
