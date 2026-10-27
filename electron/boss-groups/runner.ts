/**
 * 创世 boss · 群编排 —— 执行器（派活 / 交活 / 审查 / 打回 / 预算 / 停滞）
 *
 * 三条设计口径（都是被现有代码形状逼出来的，不是偏好）：
 *  ① **派活必须异步**：`runDelegatedTask` 是同步阻塞（等 turn 跑完才返回），
 *     boss 串行等 3 个成员就卡死。这里 turn/start 立刻返回，结果由 `waitForTurnCompletion` 的后台回调收。
 *  ② **群不是一条 thread**：boss 是一条会话，成员各自是常驻复用会话（(groupId, memberId) → threadId），
 *     群消息由宿主**回投**到 boss 会话（`thread/queue/add` + `queue/start`，不打断在跑的回合）。
 *  ③ **审查/打回由宿主做**：模型只被叫醒来看结论。规则全在 state.ts（纯函数、守卫真跑）。
 */
import { hostQueueMessageId, isWatchdogSpamText, queueItemText } from "../../src/lib/host-queue.mjs";
import { execFile } from "node:child_process";
import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { readUsableExpertTeams } from "../expert-teams";
import { bridgeDial } from "../main";
import { readCustomModel } from "../main/01-model-catalog";
import { TURN_WAIT_TIMEOUT_CODE, turnOutputText, waitForTurnCompletion } from "../main/03-turn-summary";
import { ensureProjectAgentsMd } from "../project-conventions";
import { PROVIDER_RETRY_TUNING } from "../provider-retry";
import { safeProviderId } from "../provider-id";
import { engineActiveTurnIds, server, threadCwd } from "../runtime-refs";
import { egoBrowserPath } from "../toolchain";
import { bossStore } from "./store";
import { addMember, addTask, assignTask, createGroup, groupOf, markRunning, memberOf, parseVerdict, pickReassignee, pushEvent, recordReview, removeMember, setPinned, snapshot, submitTask, taskOf } from "./state";
import type { BossGroup, BossState, GroupMember, GroupTask } from "./types";

/** 事件出口（域层注入：本模块在 features/ 之外，不许反向 import 域）。 */
type Sink = (payload: unknown) => void;
let sink: Sink | null = null;
export function setBossEventSink(fn: Sink | null) { sink = fn; }
function emit(payload: unknown) { try { sink?.(payload); } catch { /* 广播失败不影响编排 */ } }

/* ── 回投：往指挥中枢会话投一条群事件（不打断在跑的回合） ───────────────────── */
const POST_QUOTA = new Map<string, { count: number; since: number }>();
const POST_WINDOW_MS = 10 * 60 * 1000;
/** 闲聊类（预算提醒 / 停滞提醒 / 成员变动）：防刷屏，超了就不发。 */
const POST_MAX_PER_WINDOW = 12;
/** 成品与评审请求：量大但**一条都不能丢**，单独一个更宽的窗口。 */
const CRITICAL_MAX_PER_WINDOW = 40;

function quotaOk(key: string, max = POST_MAX_PER_WINDOW): boolean {
  const now = Date.now();
  const rec = POST_QUOTA.get(key);
  if (!rec || now - rec.since > POST_WINDOW_MS) { POST_QUOTA.set(key, { count: 1, since: now }); return true; }
  if (rec.count >= max) return false;
  rec.count += 1;
  return true;
}

/** 这个线程当前有没有回合在跑（引擎侧真相：turnId → threadId，boot 里按 turn/started|completed 记）。 */
function activeTurnOf(threadId: string): string {
  for (const [turnId, owner] of engineActiveTurnIds) if (owner === threadId) return turnId;
  return "";
}

/**
 * 清理中枢线程队列里的**看门狗刷屏条目**（10-26 用户现场：「给老子立刻清空」）。
 *
 * ⛔ 为什么需要：这些提醒走的是引擎的用户消息队列，而引擎**只在线程空闲时**才消化
 *   ⇒ 线程一卡住（回合卡在"运行中"）就无限堆积（真机：57~99 条，全是同一批任务的
 *   「已经 N 秒没有进展 / 已交活 N 分钟仍没有审查结论」）。
 * ⛔ 只删刷屏类（isWatchdogSpamText：停产看门狗 + 预算提醒）—— **成品交活 / 成员进出**那些
 *   是真消息，删了就是丢活。
 * ⛔ 幂等：每 5 秒的 tick 都跑一次 ⇒ 应用一启动就把堆积清掉（用户看到的就是干净的队列）。
 */
export async function pruneBossQueue(group: BossGroup): Promise<number> {
  const boss = String(group.bossThreadId ?? "");
  if (!boss) return 0;
  let list: any;
  try {
    /* ⛔ 线程没加载时队列读不到（空）⇒ 先 resume 再读（postToBoss 也这么做）。
       ⛔ resume 失败不抛：读不到就当没队列。 */
    await server.request("thread/resume", { threadId: boss, excludeTurns: false }).catch(() => undefined);
    list = await server.request("thread/queue/list", { threadId: boss, limit: 200 });
  } catch {
    return 0;   // 线程还没加载/已被卸载 ⇒ 没有队列
  }
  const items = Array.isArray(list?.data) ? list.data : [];
  if (!items.length) return 0;
  let removed = 0;
  for (const item of items) {
    const text = queueItemText(item);
    if (!isWatchdogSpamText(text)) continue;
    try {
      await server.request("thread/queue/delete", { threadId: boss, queuedSubmissionId: String(item.id ?? "") });
      removed += 1;
    } catch { /* 已被引擎取走（不是失败，队列本来就那样） */ }
  }
  if (removed) console.log(`[boss-groups] 清掉 ${removed} 条看门狗刷屏提醒（群「${group.name}」）`);
  return removed;
}

/** 群事件 → 指挥中枢会话。⛔ 用 queue/add（不是 turn/start）：turn/start 会打断正在跑的回合。 */
export async function postToBoss(group: BossGroup, text: string, options: { critical?: boolean } = {}): Promise<boolean> {
  const boss = String(group.bossThreadId ?? "");
  if (!boss) return false;
  /* ⛔ 配额分两档（10-25 审查修 B）：原来成品与闲聊共用 12 条/10 分钟，**超了直接 return false**
     ⇒ 成员多、轮次多的时候，成品会被静默丢掉（调用方也不看返回值）。成品是群聊的本体，
     丢了就等于"活干完了但没人知道"。⇒ critical 走独立窗口，且调用方（出站队列）失败会重试。 */
  const ok = options.critical
    ? quotaOk(`crit:${group.id}`, CRITICAL_MAX_PER_WINDOW)
    : quotaOk(group.id);
  if (!ok) return false;
  try {
    await server.request("thread/resume", { threadId: boss, excludeTurns: false }).catch(() => undefined);
    /* ⛔⛔⛔ 10-26 用户现场：「你阿妈b的啊」「删了重新做这个机制」。
       ── 原机制（错在哪）────────────────────────────────────────────
       群事件一律走引擎的**用户消息队列**（thread/queue/add）。后果：
         ① 引擎视角它就是"用户的排队消息" ⇒ 应用的排队面板把它们当成**你的消息**显示
            （还挂着立即/定时/编辑/删除，而你根本管不了它）；
         ② 引擎**只在线程空闲时**才消化队列 ⇒ 中枢回合一卡住就无限堆积
            （真机：同一个任务堆了几十条，全队列 57~99 条，界面直接"炸"开）；
         ③ 队列里存在"待启动回合" ⇒ 引擎报「thread already has an active or pending turn」
            ⇒ 界面永远显示"运行中"、用户发不出新消息。
       ── 新机制 ───────────────────────────────────────────────────
       **有回合在跑 ⇒ 直接 steer 追加进当前回合**（不进队列）：
         立刻送达（不用等当前回合结束）、不进队列、不产生 pending turn、面板永远干净。
       **中枢空闲 ⇒ 才进队列**（那时引擎会立刻消费，队列不会堆积）。
       ⛔ 两种方式的内容都带 `[群事件]` 标记 ⇒ 时间线按群事件块渲染（不是"你"的气泡）。 */
    const turnId = activeTurnOf(boss);
    if (turnId) {
      const steered = await server.request("turn/steer", {
        threadId: boss,
        expectedTurnId: turnId,
        input: [{ type: "text", text, text_elements: [] }],
      }).then(() => true).catch(() => false);
      if (steered) return true;
      /* steer 失败（回合刚好结束）⇒ 落到下面的队列路径。 */
    }
    await server.request("thread/queue/add", { threadId: boss, input: [{ type: "text", text }], clientUserMessageId: hostQueueMessageId("boss") });
    const list: any = await server.request("thread/queue/list", { threadId: boss, limit: 1 }).catch(() => null);
    const head = list?.data?.[0];
    if (head?.id) await server.request("thread/queue/start", { threadId: boss, queuedSubmissionId: head.id }).catch(() => undefined);
    return true;
  } catch { return false; }
}

/**
 * 交活成品**落盘成文件**（10-26 用户令：「我看不见方案内容」）。
 *
 * 背景：成品正文动辄几千字，塞进气泡里既挤又难读（用户原话：「这个群事件展示…太丑了」，
 *   「我看不见方案内容」）。⇒ 落盘成 `.md`，广播文本里带一行 `成品文件：<路径>`，
 *   界面据此出**文件卡** —— 与其它会话里「产物文件点开预览」同一套手感。
 *
 * 落盘位置：**群工作区**（成员干活的那个目录）下的 `群交付/` ⇒ 用户在自己项目里就能找到；
 *   群没有工作区时落到应用数据目录（`<userData>/boss-groups/outputs`）——那里恒在可信根内。
 * ⛔ `app.getPath("userData")` 必须**惰性**求值（主进程在模块体里 setPath 过 userData，
 *   模块体顶层求值会拿到默认目录 —— 记忆里的 91 号坑）。
 */
async function saveDeliverableFile(group: BossGroup, task: GroupTask, body: string): Promise<string> {
  try {
    const workspace = String(group.workspace ?? "").trim();
    const base = workspace || path.join(app.getPath("userData"), "boss-groups", "outputs");
    const dir = path.join(base, "群交付");
    await fs.mkdir(dir, { recursive: true });
    const safeTitle = String(task.title ?? "").replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 40) || "交付";
    const file = path.join(dir, `${task.id}-${safeTitle}.md`);
    const header = `# ${task.title}\n\n> 成员交活 · ${new Date().toLocaleString("zh-CN")}\n\n`;
    await fs.writeFile(file, header + body, "utf8");
    return file;
  } catch (error: any) {
    console.warn("[boss-groups] 成品落盘失败：", String(error?.message ?? error).slice(0, 160));
    return "";
  }
}

/* ── 出站队列：成品/评审请求**不丢、也不刷屏**（10-25 审查修 B）────────────────
   问题：每个成员交活会连发两条消息（成品 + 评审请求）。3 个成员并发就是 6 条，
   撞上 12 条/10 分钟的老配额后，后面的直接被丢。
   做法：交活/评审先进本队列，600ms 内合并成**一条**投给指挥中枢；
   · 只有 1 条成品、且这批里没有评审请求 ⇒ 全文照发（跟以前一样）；
   · 与评审请求同批 ⇒ 成品给 240 字摘要，但**评审正文里带着完整成品**（最多 16000 字）⇒ 信息不丢；
   · 多条 ⇒ 每条 240 字摘要 + 提示"完整成品在群内消息流里，用 group_status 读"；
   · 配额用尽 ⇒ **放回队列**、45 秒后重试，⛔ 不丢。
   ⛔ 10-26 追加：**成品同时落盘成文件**（`群输出/<task>-<n>-<标题>.md`），
      广播文本里带一行 `成品文件：<路径>` ⇒ 界面上出**文件卡**（点开右栏预览），
      用户不用在几千字气泡里找方案正文（用户原话：「我看不见方案内容」）。 */
type OutItem = { kind: "deliverable" | "review"; taskId: string; title: string; who?: string; body: string; file?: string };
type OutBox = { items: OutItem[]; timer: NodeJS.Timeout | null; retryAt: number; flushing: boolean };
const OUTBOX = new Map<string, OutBox>();
const OUTBOX_FLUSH_MS = 600;
const OUTBOX_MAX_BATCH = 20;

function enqueueBoss(groupId: string, item: OutItem): void {
  const box = OUTBOX.get(groupId) ?? { items: [], timer: null, retryAt: 0, flushing: false };
  OUTBOX.set(groupId, box);
  box.items.push(item);
  if (box.timer) return;
  box.timer = setTimeout(() => { box.timer = null; void flushOutbox(groupId); }, OUTBOX_FLUSH_MS);
  box.timer.unref?.();
}

function outboxText(items: OutItem[]): string {
  const deliverables = items.filter((i) => i.kind === "deliverable");
  const reviews = items.filter((i) => i.kind === "review");
  const parts: string[] = [];
  if (deliverables.length === 1 && !reviews.length) {
    parts.push(`[群事件] ${deliverables[0].who ?? "成员"} 交活：「${deliverables[0].title}」\n${deliverables[0].file ? `成品文件：${deliverables[0].file}\n` : ""}${deliverables[0].body}`);
  } else if (deliverables.length) {
    parts.push(`[群事件] 本轮 ${deliverables.length} 条交活（成品全文在群内消息流里，需要细节用 group_status 读）：
${deliverables.map((d) => `- 「${d.title}」（${d.who ?? "成员"}）：${d.body.replace(/\s+/g, " ").slice(0, 240)}…${d.file ? `\n  成品文件：${d.file}` : ""}`).join("\n")}`);
  }
  if (reviews.length === 1) {
    parts.push(reviews[0].body);
  } else if (reviews.length > 1) {
    parts.push(`[群事件] 有 ${reviews.length} 条任务已交活待你判：
${reviews.map((r) => `· taskId=${r.taskId}「${r.title}」`).join("\n")}

⛔ 用你自己的**评审技能**逐条对照各任务的验收标准判（group_status 里能拿到每条任务的 criteria 与成品全文）。
⛔ 判完逐条回填：group_review(taskId=…, verdict="approved" | "rejected", reasons=[逐条写清未满足验收标准的哪一条])。`);
  }
  return parts.join("\n\n");
}

/** ⛔ 进程退出时队列里还没发出去的消息会丢（事件已落盘，指挥中枢可用 group_status 补读）——
    这是可接受的取舍：为了它去阻塞 app 退出不值得。 */
async function flushOutbox(groupId: string): Promise<void> {
  const box = OUTBOX.get(groupId);
  if (!box || !box.items.length) return;
  if (box.flushing) return;                                   // ⛔ 串行化：两个 flush 交错会把顺序搞反
  if (Date.now() < box.retryAt) return;                       // 上次被配额挡下，等窗口
  box.flushing = true;
  try {
    const state = await bossStore.load();
    const group = state.groups[groupId];
    if (!group) { box.items = []; return; }
    const items = box.items.splice(0, OUTBOX_MAX_BATCH);
    const sent = await postToBoss(group, outboxText(items), { critical: true });
    if (!sent) {
      box.items.unshift(...items);                            // ⛔ 不丢：原样放回队首（顺序不乱）
      box.retryAt = Date.now() + 45_000;
      if (!box.timer) {
        box.timer = setTimeout(() => { box.timer = null; void flushOutbox(groupId); }, 45_500);
        box.timer.unref?.();
      }
      return;
    }
    box.retryAt = 0;
    if (box.items.length && !box.timer) {                     // 一次没扫完（>20 条）⇒ 立刻续发
      box.timer = setTimeout(() => { box.timer = null; void flushOutbox(groupId); }, 200);
      box.timer.unref?.();
    }
  } finally {
    box.flushing = false;
  }
}

/**
 * 你在群对话框里说的话 → boss 线程（turn/start，等 boss 回）。
 * ⛔ 这就是「点击 BOSS 会话直接进入对话框」的落点：说话不新建会话、不新建回合入口，
 *    boss 的回复由 watchBossReplies 镜像进群流。
 */
export async function sayToGroup(input: { groupId: string; text: string }): Promise<{ ok: boolean; error?: string }> {
  const state = await bossStore.load();
  const text = String(input.text ?? "").trim();
  if (!text) return { ok: false, error: "说点啥再发" };
  try {
    const group = groupOf(state, String(input.groupId ?? ""));
    pushEvent(state, { groupId: group.id, kind: "chat-user", text: text.slice(0, 600) });
    bossStore.save();
    emit({ type: "boss-group", phase: "chat", groupId: group.id });
    const boss = String(group.bossThreadId ?? "");
    if (!boss) return { ok: false, error: "这个群没有 boss 会话" };
    const env = await providerEnv();
    void server.request("turn/start", {
      threadId: boss,
      input: [{ type: "text", text, text_elements: [] }],
      model: env.model,
      effort: "high",
    }).catch(() => undefined);
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

/* ── 结算：引擎事件驱动（⛔ 不再依赖进程内 Promise） ───────────────────────────
   ⛔⛔⛔ 10-26 用户现场：「成员正在干活，我都没有发任务」——
   真机取证（`<userData>/boss-groups.json`）：3 个任务 status=running 且 attempt.endedAt=null，
   对应成员 status=busy ⇒ 界面上永远是「正在做」。
   根因：结算**只**靠 `waitForTurnCompletion(...).then()` 那个进程内 Promise ——
   应用一重启（我杀 app-server 那次）所有等待回调全部丢失 ⇒ 任务永远 running、成员永远 busy。
   ⛔ 而且"谁该做什么"本来就是 Codex（指挥中枢）自己的判断 —— 宿主不该用看门狗去催（用户原话：
     「你不要加看门狗，Codex 自己哪有那么傻」）。

   ── 新机制 ───────────────────────────────────────────────────────────────
   ① **引擎事件驱动**：全局监听 `turn/completed`，按 turnId 反查任务 → 结算。
      不依赖任何进程内等待 ⇒ 应用重启后新回合照样能结算。
   ② **启动对账**：启动时拿引擎真相（`thread/turns/list`）核对残留的 running 任务 ——
      回合早已结束 ⇒ 补结算；引擎里根本没这一回合（从没跑起来）⇒ 标失败并释放成员。
   ⛔ 两��都不产生任何"催中枢"的消息（那正是刷屏的根源）。 */

/** turnId → 任务 id（派活时登记；引擎事件按它反查）。 */
const taskTurnIndex = new Map<string, string>();
/** 正在结算的任务（防同一回合重复结算）。 */
const settlingTasks = new Set<string>();

function indexTaskTurn(taskId: string, turnId: string) {
  if (turnId) taskTurnIndex.set(turnId, taskId);
}

/**
 * 取回合的成品文本 —— **事件里的 turn 常常不带 items**，必须能补拉。
 *
 * ⛔⛔ 10-26 真机实测（真实任务端到端）：`turn/completed` 事件的 `params.turn` 只有
 *   id/status 这类字段，`items` 为空 ⇒ `turnOutputText()` 返回空 ⇒ 交活正文变成
 *   「（成员没有返回文本产出）」，落盘文件、投递给中枢的群事件、界面上的文件卡**全是空的**。
 *   ⇒ 事件里拿不到就按 `itemsView: "full"` 补拉一次 `thread/turns/list`（与启动对账同一口径）。
 *   ⛔ 只在「拿不到」时补拉：能拿到时不多打一次引擎往返（这是交活热路径）。
 */
async function outputTextOf(threadId: string, turnId: string, turn: any): Promise<string> {
  const direct = turnOutputText(turn);
  if (direct) return direct;
  const page: any = await server.request("thread/turns/list", {
    threadId, limit: 20, sortDirection: "desc", itemsView: "full",
  }).catch(() => null);
  const turns = Array.isArray(page?.data) ? page.data : [];
  const hit = turns.find((t: any) => String(t?.id ?? "") === turnId);
  return turnOutputText(hit);
}

/** 引擎回合结束 → 结算对应任务（**只认 turn/completed**：aborted/failed 另走 failedTask）。 */
function onEngineTurnCompleted(threadId: string, turnId: string, turn: any) {
  const taskId = taskTurnIndex.get(turnId);
  if (!taskId) return;
  /* ⛔ 幂等闸：引擎事件与 Promise 兜底**两条路**都会走到这里 ⇒ 同一回合只结算一次。 */
  if (settlingTasks.has(taskId)) return;
  settlingTasks.add(taskId);
  const finish = () => {
    settlingTasks.delete(taskId);
    taskTurnIndex.delete(turnId);
  };
  /* ⛔⛔ 10-26 真机实测（真实任务端到端）：**失败的回合也走 turn/completed**，只是
     `turn.status = "failed"`。原实现不看 status ⇒ 把一次模型调用失败当成"成员交活"，
     结果是：落盘一个空 md、给中枢投一条「（成员没有返回文本产出）」、任务卡在 reviewing
     永远等不到结论。⇒ 非 completed 一律按失败处理（释放成员 + 回投原因），不产生交活。 */
  const status = String(turn?.status ?? "");
  if (status && status !== "completed") {
    const detail = turn?.error?.message ?? turn?.error ?? "";
    void failTask(taskId, `成员回合${status === "failed" ? "失败" : `未正常结束（${status}）`}${detail ? `：${String(detail).slice(0, 200)}` : ""}`)
      .catch(() => undefined)
      .finally(finish);
    return;
  }
  void outputTextOf(threadId, turnId, turn)
    .then((text) => settleSubmission(taskId, text || "（成员没有返回文本产出）"))
    .catch(() => undefined)
    .finally(finish);
}

let settleWatchStarted = false;
/** 引擎是否就绪（app-server 起来后才 true）。 */
let engineIsReady = false;

/** 引擎就绪了吗（对账的前置闸）。 */
export function engineReady(): boolean { return engineIsReady; }

/** 挂引擎事件监听（全局只挂一次）。 */
export function watchMemberSettlements(): void {
  if (settleWatchStarted) return;
  settleWatchStarted = true;
  server.on("event", (event: any) => {
    /* 引擎就绪信号 ⇒ 记下来（对账的前置闸）。 */
    if (event?.kind === "status" && event.status === "ready") {
      engineIsReady = true;
      /* ⛔ 就绪后再对账一次：setup 那次必然被闸住（引擎还没起来）⇒ 残留任务在这里补。 */
      void reconcileRunningTasks().catch(() => undefined);
      return;
    }
    if (event?.kind !== "notification" || event.method !== "turn/completed") return;
    const turnId = String(event.params?.turn?.id ?? "");
    const threadId = String(event.params?.threadId ?? "");
    if (!turnId || !threadId) return;
    onEngineTurnCompleted(threadId, turnId, event.params?.turn);
  });
}

/**
 * 启动对账：把**残留**的 running 任务与引擎真相对齐（⛔ 不发任何催办消息）。
 *
 * 情形 A：引擎里这个回合**已经结束** ⇒ 补结算（交活 → 评审）。
 * 情形 B：引擎里**没有**这个回合（派活后从没跑起来 / 回合被取消）⇒ 标失败 + 释放成员
 *         （⛔ 否则成员永远 busy，界面永远"正在做"，而且再也不能接新活）。
 */
export async function reconcileRunningTasks(): Promise<number> {
  /* ⛔⛔ 引擎没就绪 ⇒ **直接跳过**（10-26 修正）。
     boss 域的 setup 跑在引擎起来之前 ⇒ 那时 `thread/turns/list` 会全部失败。
     ⛔ 若不闸住：所有"读不到"都会走成"回合不存在" ⇒ 把正在跑的任务全标失败。 */
  if (!engineReady()) return 0;
  const state = await bossStore.load();
  /* ⛔ 启动时清一次历史遗留的刷屏队列条目（看门狗删了 ⇒ 不会再产生新的）。
     ⛔ 清理在**显示层判定**之外真删引擎队列（否则引擎会逐条当用户消息消费）。 */
  for (const group of Object.values(state.groups)) {
    await pruneBossQueue(group).catch(() => undefined);
  }
  const running = Object.values(state.tasks).filter((t) => t.status === "running");
  if (!running.length) return 0;
  let fixed = 0;
  for (const task of running) {
    const attempt = task.attempts[task.attempts.length - 1];
    const threadId = String(attempt?.threadId ?? "");
    const turnId = String(attempt?.turnId ?? "");
    /* CLI 成员没有引擎会话（stdout 就是成品）⇒ 对账不了，跳过（它有子进程收尾）。 */
    if (!threadId || threadId.startsWith("cli:")) continue;
    /* ⛔ 读不到 ⇒ **跳过**（不动状态）：可能是引擎还没就绪 / 网络抖动 / 会话正在加载。
       ⛔⛔ 绝不能因为"读不到"就判失败 —— 那会把**正在跑的任务**误杀（更糟：用户看到
          "我什么都没派，成员却失败退出"）。判失败只认引擎**明确说没有这一回合**。 */
    const page = await server.request("thread/turns/list", { threadId, limit: 20, sortDirection: "desc", itemsView: "full" })
      .catch(() => null);
    if (!page) continue;
    const turns = Array.isArray((page as any)?.data) ? (page as any).data : [];
    /* ⛔ 索引是进程内的（重启后丢）⇒ 这里按残留任务的 turnId **重建**，
       否则重启后这一批任务永远收不到引擎事件。 */
    if (turnId) indexTaskTurn(task.id, turnId);
    const hit = turnId ? turns.find((t: any) => String(t?.id ?? "") === turnId) : undefined;
    if (!hit) {
      /* 引擎明确说：这条会话里没有这个回合 ⇒ 派活后从没跑起来（或被取消）⇒ 释放成员。
         ⛔ 静默（不回投中枢）：这是纠正残留，不是新失败。 */
      await failTask(task.id, "这次派活的回合在引擎里没有找到（没能跑起来）", true).catch(() => undefined);
      fixed += 1;
      continue;
    }
    const status = String(hit?.status ?? "");
    const finished = ["completed", "failed", "aborted", "interrupted", "cancelled", "canceled"].includes(status);
    if (!finished) continue;   /* 引擎那边还在跑 ⇒ 保持 running（真正常在干活） */
    const text = turnOutputText(hit) || "（成员没有返回文本产出）";
    await settleSubmission(task.id, text).catch(() => undefined);
    fixed += 1;
  }
  if (fixed) console.log(`[boss-groups] 启动对账：修正 ${fixed} 条残留任务（成员不再卡「正在做」）`);
  return fixed;
}

let bossWatchStarted = false;
const mirroredTurns = new Set<string>();
/** boss 线程的回复 → 群流（「在群里回」的实现：boss 在群里说话，而不是只在外面）。 */
export function watchBossReplies(): void {
  if (bossWatchStarted) return;
  bossWatchStarted = true;
  server.on("event", (event: any) => {
    if (event?.kind !== "notification" || event.method !== "turn/completed") return;
    const threadId = String(event.params?.threadId ?? "");
    const turn = event.params?.turn;
    if (!threadId || !turn?.id) return;
    void (async () => {
      try {
        const state = await bossStore.load();
        const group = Object.values(state.groups).find((g) => g.bossThreadId === threadId);
        if (!group) return;
        const key = `${threadId}:${turn.id}`;
        if (mirroredTurns.has(key)) return;
        mirroredTurns.add(key);
        if (mirroredTurns.size > 400) { const first = mirroredTurns.values().next().value; if (first) mirroredTurns.delete(first); }
        const text = turnOutputText(turn);
        if (!text) return;
        pushEvent(state, { groupId: group.id, kind: "chat-boss", text: text.slice(0, 600) });
        bossStore.save();
        emit({ type: "boss-group", phase: "chat", groupId: group.id });
      } catch { /* 镜像失败不影响主流程 */ }
    })();
  });
}

/* ── 模型 / 会话 ──────────────────────────────────────────────────────────── */
async function providerEnv() {
  const custom = await readCustomModel();
  const provider = custom?.provider ?? "openai";
  const baseUrl = custom?.baseUrl;
  return {
    model: String(custom?.model ?? ""),
    provider,
    config: baseUrl
      ? { model_provider: safeProviderId(provider), model_providers: { [safeProviderId(provider)]: { name: custom?.name ?? provider, base_url: bridgeDial(provider, baseUrl), env_key: "CODEX_HARNESS_API_KEY", wire_api: "responses", requires_openai_auth: false, ...PROVIDER_RETRY_TUNING } } }
      : undefined,
  };
}

/** 成员的常驻会话：同一 (群, 成员) 永远同一线程 —— 成员因此记得自己之前做过什么。 */
async function ensureMemberThread(group: BossGroup, member: GroupMember): Promise<string> {
  if (member.threadId) {
    const resumed: any = await server.request("thread/resume", { threadId: member.threadId, excludeTurns: false }).catch(() => null);
    if (resumed?.thread?.id) {
      threadCwd.set(member.threadId, group.workspace || process.cwd());
      return member.threadId;
    }
  }
  const env = await providerEnv();
  const model = member.model || env.model;
  if (!model) throw new Error("尚未配置模型，无法派活（先在设置 → 模型里配一个）");
  const cwd = group.workspace || process.cwd();
  ensureProjectAgentsMd(cwd);
  const started: any = await server.request("thread/start", {
    model,
    cwd,
    approvalPolicy: member.approvalPolicy || "on-request",
    sandbox: member.sandbox || "workspace-write",
    modelProvider: env.provider,
    config: env.config,
  });
  const threadId = String(started.thread.id);
  threadCwd.set(threadId, cwd);
  try { await server.request("thread/name/set", { threadId, name: `${group.name}·${member.name}` }); } catch { /* 命名失败不阻塞派活 */ }
  member.threadId = threadId;
  member.threadName = `${group.name}·${member.name}`;
  bossStore.save();
  return threadId;
}

/* ── 本机外部 CLI agent（10-25 群聊重构：zcode/qoder/WorkBuddy/DeepSeek/豆包…） ── */
/** 内置登记表：command 模板里 {prompt} 替换任务全文。检测/覆盖都允许 —— 拉人时探测，缺了会明说。 */
const CLI_AGENT_REGISTRY: { name: string; role: string; command: string }[] = [
  { name: "zcode", role: "本机 CLI agent（zcode）", command: 'zcode -p "{prompt}"' },
  { name: "qoder", role: "本机 CLI agent（qoder）", command: 'qoder "{prompt}"' },
  { name: "workbuddy", role: "本机 CLI agent（WorkBuddy）", command: 'workbuddy "{prompt}"' },
  { name: "deepseek", role: "本机 CLI agent（DeepSeek harness）", command: 'deepseek "{prompt}"' },
  { name: "doubao", role: "本机 CLI agent（豆包）", command: 'doubao "{prompt}"' },
];

function whereExe(exe: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("where", [exe], { timeout: 5000 }, (error) => resolve(!error));
  });
}

/** 可拉名单：专家（teams 登记表，lead+成员）+ 本机 CLI agent（登记表，附 where 探测）。 */
export async function poolForBoss(): Promise<{
  experts: {
    teamId: string; teamName: string; memberId: string; name: string; role: string;
    description?: string; model?: string; effort?: string;
    sandbox?: string; approvalPolicy?: string; isLead?: boolean;
  }[];
  cliAgents: { name: string; role: string; command: string; detected: boolean }[];
}> {
  let experts: {
    teamId: string; teamName: string; memberId: string; name: string; role: string;
    description?: string; model?: string; effort?: string;
    sandbox?: string; approvalPolicy?: string; isLead?: boolean;
  }[] = [];
  try {
    const teams = await readUsableExpertTeams();
    for (const t of teams ?? []) {
      for (const [m, isLead] of [[t.lead, true], ...(t.members ?? []).map((x: any) => [x, false])] as any[]) {
        if (!m?.id) continue;
        const role = (m as any).profession?.zh ?? (m as any).description ?? "专家";
        const teamName = (t as any).displayName?.zh ?? (t as any).displayName ?? t.teamId;
        /* ⛔⛔ 10-26 用户令：「展示成员列表」「帮 cli 成员配置好模型等等」——
           这里必须把**完整配置**带出去（model/effort/sandbox/approvalPolicy），
           否则手动拉人加进来的成员是"半配置" ⇒ 派活时只能吃默认值（甚至派不出去）。
           ⛔ 顺带带上 profession（渲染层据此选头像图标）与 isLead（区分组长）。 */
        experts.push({
          teamId: t.teamId, teamName, memberId: m.id, name: m.name, role,
          description: (m as any).description,
          model: m.model, effort: m.effort,
          sandbox: (m as any).sandbox, approvalPolicy: (m as any).approvalPolicy,
          isLead: Boolean(isLead),
        });
      }
    }
  } catch { /* 专家登记表读不到就只给 CLI 名单 */ }
  const cliAgents = await Promise.all(CLI_AGENT_REGISTRY.map(async (a) => ({
    ...a,
    detected: await whereExe(a.name),
  })));
  return { experts, cliAgents };
}

/**
 * 命令模板里 {prompt} 的替换值 —— ⛔ 必须净化为**单行、无 shell 元字符**：
 *  · 命令交给系统 shell 解析，提示词里的 `& | < > ^ %` 会变成命令分隔 / 重定向 / 变量展开
 *    ⇒ 任务说明或验收标准里只要出现 `& del ...` 这类内容，就是一条命令注入（两者都来自外部输入）。
 *  · 换行会把命令截断（运行态压测实测：整条参数被截坏）。
 *  ⇒ 压成单行 + 去掉元字符（提示词本质是自然语言，去掉这些符号不损失语义）。
 */
function promptForCli(text: string): string {
  return String(text ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/["`]/g, "'")
    .replace(/[&|<>^%]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** CLI 成员的派遣：起子进程跑命令模板，stdout 尾部作为成品走同一条审查流水。 */
async function runCliMember(group: BossGroup, member: GroupMember, task: GroupTask): Promise<void> {
  const command = String(member.cliCommand ?? "").replace("{prompt}", promptForCli(memberPrompt(group, member, task, task.attempts[task.attempts.length - 1]?.n ?? 1)));
  try {
    await new Promise<void>((resolve, reject) => {
      /* ⛔⛔ 运行态压测实测（10-25）：`execFile("cmd", ["/c", command])` 会把整串命令**再包一层引号**
         ⇒ 命令里的 `"C:\…\fake-cli-agent.js"` 变成 `"\"C:\…\fake-cli-agent.js\""`，
         子进程收到带引号的路径，直接 `Cannot find module`。内置模板 `zcode -p "{prompt}"` 全都带引号
         ⇒ **这条路径此前根本没跑通过**（拉得进来、派得出去、成品是报错）。`windowsVerbatimArguments`
         让参数原样交给 shell，不再二次加引号。 */
      execFile("cmd", ["/c", command], { cwd: group.workspace || process.cwd(), timeout: 600_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, windowsVerbatimArguments: true }, (error, stdout, stderr) => {
        const text = String(stdout ?? "").trim() || String(stderr ?? "").trim();
        if (error && !text) { reject(new Error(`CLI「${member.name}」执行失败：${String(error.message ?? error).slice(0, 200)}`)); return; }
        void settleSubmission(task.id, text.slice(0, 16_000) || "（CLI 没有输出）");
        resolve();
      });
    });
  } catch (error: any) {
    void failTask(task.id, String(error?.message ?? error));
  }
}

/* ── 浏览器：ego lite（每个会话天然一个独立 TaskSpace） ─────────────────────── */
export function browserStatus() {
  const cli = egoBrowserPath();
  return {
    installed: Boolean(cli),
    cli: cli ?? "",
    hint: cli
      ? "每个会话（成员）各自一个 `codex-<线程id>` TaskSpace，天然互不冲突；先跑 `ego-browser skill` 读当前版本 API。"
      : "未安装 Ego Lite：调 group_browser_setup 会打开官方下载页，装完回来重新检测；⛔ 不要自己编命令装。",
  };
}

/** 浏览器成员的系统提示附录：装了才教它怎么用；没装就明确"别假设能用"。 */
function browserAppendix(): string {
  const st = browserStatus();
  if (!st.installed) {
    return "\n\n【浏览器】本机未安装 Ego Lite。需要浏览器时先向主理人说明「需要安装 Ego Lite」，不要假设有浏览器工具。";
  }
  return "\n\n【浏览器】网页自动化一律走 `ego-browser`（ego lite）：每个会话**天然一个独立 TaskSpace**（`codex-<你的线程 id>`），"
    + "同群其它成员各用各的、互不冲突。先跑 `ego-browser skill` 拿当前版本 API，再写 .mjs 用 `ego-browser nodejs` 执行；"
    + "⛔ 不要用 Playwright / 不要让用户共享你的浏览器窗口。";
}

/* ── 派活 ─────────────────────────────────────────────────────────────────── */
function memberPrompt(group: BossGroup, member: GroupMember, task: GroupTask, attemptNo: number): string {
  return `[SYSTEM TASK · 群成员会话]
你是「${group.name}」群里的 **${member.name}**（${member.role}）。
${member.systemPrompt ? `${member.systemPrompt}\n` : ""}
=== 本次任务（第 ${attemptNo} 次尝试）===
标题：${task.title}
说明：${task.brief || "（无补充说明）"}
验收标准：${task.criteria}
=== END ===

请**直接交成品**（产物或结论 + 依据），不要复述流程、不要问"要不要我继续"。
你的最终回答文本会被原样交给审查，不通过会说明原因并换人重做。${browserAppendix()}`;
}

/** 派活：占位（assign）→ 建/复用线程 → turn/start（不等）→ 后台收结果。 */
export async function dispatchTask(taskId: string, options: { memberId?: string } = {}): Promise<{ ok: boolean; taskId?: string; memberId?: string; error?: string }> {
  const state = await bossStore.load();
  try {
    const task = taskOf(state, taskId);
    const group = groupOf(state, task.groupId);
    if (group.paused) return { ok: false, error: `群「${group.name}」已暂停（预算或用户叫停）` };
    const member = options.memberId ? memberOf(group, options.memberId) : (pickReassignee(state, task) ?? memberOf(group, task.assignee));
    assignTask(state, task.id, member.id);
    bossStore.save();
    const attempt = task.attempts[task.attempts.length - 1];
    /* ⛔ CLI 成员（本机外部 agent）没有引擎会话：起子进程跑命令行，stdout 就是它的成品，
        走同一条 交活→BOSS 自评 流水。 */
    if (member.source === "cli") {
      markRunning(state, task.id, { threadId: `cli:${member.name}` });
      bossStore.save();
      emit({ type: "boss-group", phase: "task", groupId: group.id, taskId: task.id, memberId: member.id, status: "running" });
      void runCliMember(group, member, task);
      return { ok: true, taskId: task.id, memberId: member.id };
    }
    const threadId = await ensureMemberThread(group, member);
    const env = await providerEnv();
    const model = member.model || env.model;
    const turn: any = await server.request("turn/start", {
      threadId,
      input: [{ type: "text", text: memberPrompt(group, member, task, attempt.n), text_elements: [] }],
      model,
      effort: member.effort || "high",
    });
    const turnId = turn?.turn?.id;
    if (!turnId) throw new Error("引擎没有返回 turnId（派活失败）");
    markRunning(state, task.id, { threadId, turnId });
    /* ⛔ 登记 turnId → task（引擎事件驱动结算靠它；不依赖进程内 Promise）。 */
    indexTaskTurn(task.id, turnId);
    bossStore.save();
    emit({ type: "boss-group", phase: "task", groupId: group.id, taskId: task.id, memberId: member.id, status: "running" });
    /* ⛔ 后台收尾：**结算走引擎事件**（onEngineTurnCompleted），这里只做**兜底**。
       ⛔⛔ 原实现在这里 `waitForTurnCompletion(...).then(() => settleSubmission(...))` ——
          那是**进程内 Promise**，应用一重启所有等待回调全部丢失
          ⇒ 任务永远 running、成员永远 busy（真机 3 条残留，界面永远「正在做」）。
       ⇒ 现在：引擎事件是主路径（重启后依然有效），Promise 只在事件没来时兜底，
          且**走同一道幂等闸**（settlingTasks）⇒ 两条路不会重复结算。 */
    void waitForTurnCompletion(threadId, turnId).then((completed: any) => {
      /* ⛔ 文本由 onEngineTurnCompleted 统一取（含"事件里没 items 就补拉"那条路）——
         原来这里先算一次 `text` 却从没用过（死变量），真取文本的地方在那边。 */
      onEngineTurnCompleted(threadId, turnId, completed);
    }).catch((error: any) => {
      if (error?.code === TURN_WAIT_TIMEOUT_CODE) {
        // ⛔ 等待到点 ≠ 失败：回合还在引擎里跑，交给停滞扫描与下次打开时对账。
        void postToBoss(group, `[群事件] ${member.name} 的「${task.title}」超过同步等待上限，转后台继续；完成后面再回报。`);
        emit({ type: "boss-group", phase: "task", groupId: group.id, taskId: task.id, memberId: member.id, status: "background" });
        return;
      }
      void failTask(task.id, String(error?.message ?? error));
    });
    return { ok: true, taskId: task.id, memberId: member.id };
  } catch (error: any) {
    bossStore.save();
    return { ok: false, error: String(error?.message ?? error) };
  }
}

/**
 * 任务失败（释放成员）。
 *
 * @param quiet ⛔ 静默模式（启动对账用）：只改状态、释放成员、**不回投中枢**。
 *   ⛔ 对账是在纠正"上次没结算完的残留"，不是新失败 ⇒ 往中枢回一条
 *   「执行失败」等于凭空造一件用户没经历的事（而且这条投递走用户消息队列）。
 */
async function failTask(taskId: string, reason: string, quiet = false) {
  const state = await bossStore.load();
  const task = state.tasks[taskId];
  if (!task) return;
  task.status = "failed";
  task.updatedAt = Date.now();
  const group = state.groups[task.groupId];
  /* ⛔⛔ 释放成员（压测连带发现）：原来只把任务标 failed，成员还留在 busy。
     加了「一次只能派一条活」的并发闸之后，这条不修就会**永久占死这个成员**（他手上那条任务已经
     failed，却永远算"在办"）⇒ 之后所有派活都报"手上还有没做完的"。 */
  const member = group?.members.find((m) => m.id === task.assignee);
  if (member && member.status === "busy") {
    member.status = member.lockedTaskIds.length ? "locked" : "idle";
  }
  bossStore.save();
  emit({ type: "boss-group", phase: "task", groupId: task.groupId, taskId, status: "failed" });
  if (group && !quiet) await postToBoss(group, `[群事件] 「${task.title}」执行失败：${String(reason).slice(0, 300)}\n需要你决定：换模型重做 / 放宽标准 / 你自己接手。`);
}

/* ── 交活 → 审查 → 通过 / 打回 → 换人 ─────────────────────────────────────── */
/** 提交成品；返回「这条提交是否有效」（重复回调 ⇒ false，调用方据此跳过评审）。 */
function submitTaskSafe(state: BossState, taskId: string, output: string): boolean {
  try { submitTask(state, taskId, output); return true; } catch { return false; }
}
export async function settleSubmission(taskId: string, output: string): Promise<void> {
  const state = await bossStore.load();
  const task = state.tasks[taskId];
  if (!task) return;
  const group = state.groups[task.groupId];
  if (!group) return;
  /* ⛔⛔ 10-27：成员已被移出群 ⇒ 他的会话已删、任务已在 removeMember 里结清。
     这条回调只可能是删除会话之前的半截回合（或迟到的 turn/completed）——
     ⛔ 不能再把它的产出投进群（否则群里冒出一条「已移出的人交活」，还会把任务拉回 reviewing）。 */
  if (group.members.find((m) => m.id === task.assignee)?.status === "removed") return;
  const alreadyLeftRunning = submitTaskSafe(state, taskId, output);
  /* ⛔⛔ 10-25 用户实测：「成员会话的汇总消息为什么没有发送到主对话，都是各种会话里面回复，
     这叫什么群聊」。原来：成品只进了**成员自己的会话**（引擎回合）与群事件（还只截 600 字），
     主对话里什么也没有 ⇒ 看起来就是"各说各话"。 */
  const deliverable = String(output ?? "").trim() || "（没有文本产出）";
  pushEvent(state, {
    groupId: group.id, taskId, memberId: task.assignee, kind: "chat-member",
    text: deliverable.slice(0, 4000),
  });
  bossStore.save();
  emit({ type: "boss-group", phase: "task", groupId: group.id, taskId, status: "reviewing" });
  /* 成品**汇总到主对话**（指挥中枢会话）—— 这是群聊的本体：成员干完活，成果出现在群里。
     ⛔ 走出站队列（合并投递 + 失败重试），不再直接 post：并发交活时既不刷屏，也不会被配额丢掉。
     ⛔ 10-26：同时**落盘成文件**（`群交付/<task>-<标题>.md`）⇒ 界面出文件卡，正文可预览。 */
  const deliverer = memberOf(group, task.assignee);
  const deliverableFile = await saveDeliverableFile(group, task, deliverable);
  enqueueBoss(group.id, {
    kind: "deliverable", taskId, title: task.title, who: deliverer.name,
    body: deliverable.slice(0, 4000),
    file: deliverableFile,
  });
  if (alreadyLeftRunning) await reviewTask(taskId);   // 重复回调（已不在 running）⇒ 不再审
}


/** 同一任务同时只允许一次评审（settleSubmission 重复回调 / 人工与自动撞车 ⇒ 后到的直接跳过）。 */
const inFlightReviews = new Set<string>();

/** 评审：**不再另开会话**（10-25 用户令：评审由会话自己用技能做）。这里只把交活回投给 BOSS。 */
export async function reviewTask(taskId: string): Promise<{ ok: boolean; verdict?: "approved" | "rejected"; error?: string }> {
  if (inFlightReviews.has(taskId)) return { ok: false, error: "该任务已有一轮评审在进行，跳过重复触发" };
  const state = await bossStore.load();
  const task = state.tasks[taskId];
  if (!task) return { ok: false, error: "任务不存在" };
  /* ⛔ 幂等闸（10-24 用户报「评审自动重试，正常也重试」）：只有 reviewing 状态才真正开评审；
     approved / running / done / escalated 的重复触发一律跳过 —— 评审不是重试器。 */
  if (task.status !== "reviewing" && task.status !== "submitted") {
    return { ok: false, error: `任务当前是 ${task.status}，不需要评审（跳过重复触发）` };
  }
  inFlightReviews.add(taskId);
  try {
    return await runReview(state, taskId);
  } finally {
    inFlightReviews.delete(taskId);
  }
}

async function runReview(state: BossState, taskId: string): Promise<{ ok: boolean; verdict?: "approved" | "rejected"; error?: string }> {
  const task = state.tasks[taskId];
  const group = state.groups[task.groupId];
  if (!group) return { ok: false, error: "群不存在" };
  const attempt = task.attempts[task.attempts.length - 1];
  const output = attempt?.output ?? "";
  try {
    /* ⛔⛔ 10-25 用户令：「这个子成员都触发一次评审？评审机制有问题…评审上下文子智能体不要默认，
       删掉了，让 codex 自己创建」。
       原来这里 thread/start 开一个**新鲜上下文的评审会话**（侧栏一堆独立评审会话）。
       ⇒ 改成：把验收标准 + 成品**回投给 BOSS 会话**，由 Codex 自己判断；
         要独立上下文/子智能体时**它自己创建**（系统不再自动开评审会话）。
       ⇒ 结论由 Codex 调 group_review 回填（该通道已含 recordReview + 换人重做 + 回投，闭环不断）。 */
    /* ⛔ 评审请求也走出站队列：与成品合并成**一条**消息（同一任务的成品 + 裁决要求一起到），
       既省掉一半消息量，也保证配额吃紧时不会只剩成品、丢掉"请你判一下"这句指令。 */
    enqueueBoss(group.id, {
      kind: "review", taskId, title: task.title,
      body: `[群事件] 任务「${task.title}」已交活，请**用你自己的评审技能**判一下。

=== 验收标准（criteria）===
${task.criteria}

=== 成品 ===
${output.slice(0, 16000)}

⛔ 用你自己的**评审技能**逐条对照验收标准判（⛔ 系统不再另开评审会话/子智能体，你要用就自己创建）。
⛔ 判完把结论记回来：通过就调 group_review(taskId="${taskId}", verdict="approved")；
   不通过就 verdict="rejected"，reasons 逐条写清**未满足验收标准的哪一条**（别写"不够好"这种空话）。`,
    });
    return { ok: true };
  } catch (error: any) {
    const message = String(error?.message ?? error);
    // 评审自己挂掉：宁可当"打回 + 理由写明"，也不要静默判通过（静默通过 = 制度失效）
    try {
      const record = recordReview(state, taskId, { by: "fresh", verdict: "rejected", reasons: [`评审未能给出结论：${message.slice(0, 120)}`] });
      bossStore.save();
      if (record.status === "rejected") {
        const next = pickReassignee(state, record);
        if (next) setTimeout(() => { void dispatchTask(taskId, { memberId: next.id }); }, 1200);
      }
    } catch { /* 状态已变，忽略 */ }
    return { ok: false, error: message };
  }
}

/* ── 定时扫描：预算 / 停滞 ─────────────────────────────────────────────────── */
export async function tickAll(): Promise<void> {
  const state = await bossStore.load();
  let dirty = false;
  for (const group of Object.values(state.groups)) {
    /* ⛔⛔ 10-26：队列清理**从每 5 秒改成只在启动对账时跑一次**。
       原实现每个 tick 都对每个群 resume + list 队列（两次引擎往返 × 群数 × 每 5 秒）
       —— 而这只是为了清"看门狗刷屏"那批历史遗留；看门狗删掉后**不会再产生新的**。
       ⇒ 启动清一次即可；之后由渲染层读队列时顺手清（那里本来就在读）。 */
    const before = group.paused;
    /* ⛔⛔ 10-26 用户现场：「这什么狗几把玩意，一直刷屏，每次启动应用，进去就弹，给我删掉这玩意」。
       预算照旧只做**静默执行**（80% 不吭声、100% 自动暂停），⛔ 不再往中枢会话回投任何预算提醒。
       原实现 80% 每 10 分钟最多回投 12 条、tick 每 5 秒一次 ⇒ 真机一屏全是同一条；
       而且配额表是进程内的，每次启动重新计数 ⇒ 每次开机又刷一批。 */
    if (group.paused !== before) dirty = true;
  }
  /* ⛔⛔⛔ 10-26 用户现场：「你不要加看门狗，Codex 自己哪有那么傻」。
     停滞看门狗（markStalled）**整体删除**：
       原实现每隔几秒扫一遍 running 任务，超过阈值就往中枢会话回投「已经 N 秒没有进展」——
       而这条投递走引擎的**用户消息队列**，引擎只在线程空闲时才消化 ⇒ 线程一卡就无限堆积
       （真机：同一任务堆了几十条，全队列 57~99 条，界面直接"炸"开）。
     ⛔ 判定"该不该做"是 Codex（指挥中枢）自己的事 —— 它看得见成员会话在不在动。
        宿主替代模型判断 = 制造噪声 + 卡死队列。**这里不再有任何看门狗。** */
  /* ⛔⛔⛔ 10-26 用户现场：「你不要加看门狗」—— **待审看门狗也整体删除**。
     原实现：任务停在 reviewing 超过 10 分钟就往中枢回投「仍没有审查结论，请你现在判」。
     ⛔ 同样的坑：回投走用户消息队列 ⇒ 卡住时无限堆积（真机 57~99 条）。
     ⛔ 而且"该不该审、审没审"是中枢自己的判断（它那一轮没看见就再看一眼的事），
        宿主定时催 = 越权 + 噪声。**这里不再有任何看门狗。** */
  /* 出站队列兜底：定时器可能因为进程挂起而丢，tick 时补一次 flushed。 */
  for (const groupId of Array.from(OUTBOX.keys())) await flushOutbox(groupId);
  if (dirty) bossStore.save();
  /* ⛔⛔ 这里**不再**跑对账（10-26 修正）：每 5 秒对每个 running 任务做一次
     `thread/turns/list` 引擎往返 = 常驻开销；而结算的主路径已经是**引擎事件**
     （watchMemberSettlements）+ 启动对账（reconcileRunningTasks，在 boss 域启动时跑一次）。
     ⛔ 对账是"启动时纠正上次残留"，不是常驻轮询 —— 那正是看门狗的形态。 */
}

/* ── 给 boss 工具用的门面 ─────────────────────────────────────────────────── */
export async function createGroupForBoss(input: { name: string; workspace: string; bossThreadId: string; members: any[]; policy?: any }) {
  const state = await bossStore.load();
  const group = createGroup(state, input);
  bossStore.save();
  emit({ type: "boss-group", phase: "group", groupId: group.id, status: "created" });
  return { ok: true, group: snapshot(state, group.id) };
}

export async function addTaskForBoss(input: { groupId: string; title: string; brief: string; criteria: string; assignee?: string; autoDispatch?: boolean }) {
  const state = await bossStore.load();
  const task = addTask(state, { groupId: input.groupId, title: input.title, brief: input.brief, criteria: input.criteria, assignee: input.assignee });
  bossStore.save();
  if (input.autoDispatch !== false) {
    const result = await dispatchTask(task.id, input.assignee ? { memberId: input.assignee } : {});
    return { ok: result.ok, taskId: task.id, dispatched: result.ok, error: result.error };
  }
  return { ok: true, taskId: task.id, dispatched: false };
}

/** 拉人 / 移人（boss 工具与群视图面板共用这一条通道）。 */
export async function memberForBoss(input: {
  groupId: string; action: "add" | "remove";
  name?: string; role?: string; systemPrompt?: string; model?: string; effort?: string; memberId?: string;
  /** 拉人来源（10-25）：expert = 从专家/专家团登记表拉；cli = 本机外部 CLI agent；缺省 = 自定义。 */
  from?: "custom" | "expert" | "cli";
  expertTeamId?: string; expertMemberId?: string;
  cliName?: string; cliCommand?: string;
}): Promise<{ ok: boolean; member?: { id: string; name: string; role: string; status: string; source?: string }; removedThreadId?: string; error?: string }> {
  const state = await bossStore.load();
  try {
    let addInput: Parameters<typeof addMember>[2] | null = null;
    if (input.action === "add") {
      if (input.from === "expert") {
        const teams = await readUsableExpertTeams();
        const team = (teams ?? []).find((t) => t.teamId === String(input.expertTeamId ?? ""));
        const pool = team ? [team.lead, ...(team.members ?? [])] : [];
        const m = pool.find((x) => x?.id === String(input.expertMemberId ?? "")) ?? pool.find((x) => x?.name === String(input.name ?? ""));
        if (!m) return { ok: false, error: `专家名单里找不到「${input.expertMemberId || input.name}」（teamId=${input.expertTeamId ?? ""}），先用 group_status 看可拉名单` };
        /* ⛔⛔ 10-26：专家成员的**完整配置**一起带进来（sandbox / approvalPolicy 原来就带了，
           这里补上 isLead 语义与 description；关键是 model/effort 必须有 ——
           缺了就是"半配置成员"，派活时只能吃全局默认，用户看着像没生效）。 */
        /* ⛔⛔ 10-26 用户令：「帮 cli 成员配置好模型等等，最后能干活和派遣」
           ⛔ 真机取证：13 个专家团 61 个专家，`model/effort` **全是 null**
              ⇒ 手动拉进来后成员是"半配置"（界面显示不出模型、派活只能吃全局默认）。
           ⇒ 拉人时**当场补齐**：登记表没写 model 就落**当前默认模型**（与其它成员同口径），
              effort/sandbox/approvalPolicy 同理给默认值。
           ⛔ 这样成员身上就有一份**完整可改**的配置（换模型/调权限时才有东西可改）。 */
        const env = await providerEnv();
        addInput = {
          name: m.name, role: m.profession?.zh ?? "专家", systemPrompt: m.systemPrompt,
          model: m.model || env.model || undefined,
          effort: m.effort || "high",
          sandbox: m.sandbox || "workspace-write",
          approvalPolicy: m.approvalPolicy || "on-request",
          source: "engine",
        };
      } else if (input.from === "cli") {
        const reg = CLI_AGENT_REGISTRY.find((a) => a.name === String(input.cliName ?? input.name ?? "").toLowerCase());
        const command = String(input.cliCommand ?? reg?.command ?? "").trim();
        if (!command) return { ok: false, error: `拉 CLI agent 需要命令模板（cliCommand，{prompt} 会替换成任务全文）；登记表里没有「${input.cliName ?? ""}」` };
        /* ⛔⛔ 10-26 用户令：「cli成员就让Codex添加就行，帮cli成员配置好模型等等，最后能干活和派遣」
           ⛔ 原来 CLI 成员的 model / effort / sandbox / approvalPolicy **全空** ⇒
              界面显示不出配置、派活时只能吃默认值，而且"配置"这件事压根不存在。
           ⇒ 这里把**当前默认模型**与执行参数**一起配齐**（CLI 自己跑自己的模型，
              但宿主这边的配置要完整 —— 换模型/调权限时才有东西可改）。
           ⛔ model 从 providerEnv() 取当前默认（与其它成员同一口径）。 */
        const env = await providerEnv();
        const cliName = String(input.cliName ?? reg?.name ?? "");
        addInput = {
          name: String(input.name ?? input.cliName ?? reg?.name ?? "cli-agent"),
          role: String(input.role ?? reg?.role ?? "本机 CLI agent"),
          systemPrompt: `你是从本机命令行 agent（${cliName}）拉进群的成员。你的成品由宿主执行你的命令行得到，回答请直接给结论与依据。`,
          model: env.model || undefined,
          effort: "high",
          sandbox: "workspace-write",
          approvalPolicy: "on-request",
          source: "cli", cliCommand: command,
        };
      } else {
        addInput = {
          name: String(input.name ?? ""), role: String(input.role ?? ""),
          systemPrompt: input.systemPrompt, model: input.model, effort: input.effort,
        };
      }
    }
    const member = input.action === "add"
      ? addMember(state, String(input.groupId ?? ""), addInput!)
      : removeMember(state, String(input.groupId ?? ""), String(input.memberId ?? ""));
    /* 移人会把在办任务一并结清（见 state.removeMember）⇒ 这里接住标题，回投时告诉中枢。 */
    const terminatedTasks: string[] = (member as { terminatedTasks?: string[] }).terminatedTasks ?? [];
    bossStore.save();
    const group = groupOf(state, String(input.groupId ?? ""));
    emit({ type: "boss-group", phase: "member", groupId: group.id, memberId: member.id, status: member.status });
    /* ⛔⛔ 10-25 用户实测：「用户移除的群成员没有真实生效，Codex 不知道我移除了」。
       成员变动必须**回投给 BOSS 会话**，否则模型只在自己查 group_status 时才可能看到，
       而且那是旧口径（会把 removed 也数进去）。这里把增/移都主动告诉 BOSS。 */
    /* 10-27 用户令：「codex 移除了群成员，这个旧的群成员回合就同步删除掉会话，同步自动刷新会话列表」
       ⇒ 移人时把**成员会话 id**一起回给渲染层（它会走 deleteThreadCore：引擎 thread/delete + 墓碑 +
          侧栏剔行 + 失效成员快照），主进程不自己删文件（删除入口只有渲染层那一条链路）。
       ⛔ 保留 `removedThreadId` 字段名：渲染层据此判断"要不要顺手删会话"。 */
    const removedThreadId = input.action === "add" ? "" : String(member.threadId ?? "");
    if (input.action === "add") {
      void postToBoss(group, `[群事件] 新成员进群：${member.name}（${member.role}${member.source === "cli" ? "，本机 CLI agent" : ""}，id=${member.id}）。`);
    } else {
      const ended = terminatedTasks.length
        ? `\nTA 手上 ${terminatedTasks.length} 条在办任务已随会话一并终止（任务标失败，可重新派给别人）：${terminatedTasks.map((t) => `「${t}」`).join("、")}。`
        : "";
      void postToBoss(group, `[群事件] 成员已被用户移出群：${member.name}（${member.role}，id=${member.id}）。\nTA **不在当前成员名单里、不再接任何新活**，TA 的成员会话已被删除（按用户要求：移出即清会话）。${ended}此后你 group_status 看到的成员数不含 TA。`);
    }
    return {
      ok: true,
      member: { id: member.id, name: member.name, role: member.role, status: member.status, source: member.source ?? "engine" },
      removedThreadId: removedThreadId || undefined,
    };
  } catch (error: any) {
    bossStore.save();
    return { ok: false, error: String(error?.message ?? error) };
  }
}

/** 可拉名单（专家 + 本机 CLI agent）——group_status / 群面板共用。 */
export async function poolForBossIpc() {
  return poolForBoss();
}

/** 置顶 / 取消置顶某条群事件（群视图卡带用）。 */
export async function pinForBoss(input: { groupId: string; eventId: string; pinned: boolean }): Promise<{ ok: boolean; pinnedEventIds?: string[]; error?: string }> {
  const state = await bossStore.load();
  try {
    const group = setPinned(state, String(input.groupId ?? ""), String(input.eventId ?? ""), input.pinned === true);
    bossStore.save();
    emit({ type: "boss-group", phase: "pin", groupId: group.id });
    return { ok: true, pinnedEventIds: group.pinnedEventIds ?? [] };
  } catch (error: any) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

export function statusForBoss(groupId: string) {
  return snapshot(bossStore.get(), groupId);
}

/**
 * 删除群（10-27 用户令：「群编排没有管理功能，codex 自己也删不掉… 但这个删要联动 codex 那边，
 * 不然光界面删了，codex 那边不知道群删了不行」）。
 *
 * ⛔⛔ **先回投中枢、再清账**：`postToBoss` 要靠 group.bossThreadId 才找得到那条会话，
 *    群一删就再也通知不到了 ⇒ 顺序不能反。回投的是 `[群事件]`，模型下一回合就知道这个群没了，
 *    不会拿着旧 groupId 继续派活/审查（那才是用户说的"两边不一致"）。
 * ⛔ 只删群账本（群 / 任务 / 事件）——**会话不删**：成员会话里的成品与轨迹仍可回看，
 *    产出文件也都在群 workspace 里（用户明确要「群真的消失，会话与产出保留」，看 delete 前那版界面文案）。
 * ⛔ 立即 `flush()`：删群是销毁性操作，不能等 120ms 合并写（崩在中间 = 界面已消失、账本还在）。
 */
export async function deleteGroupForBoss(input: { groupId: string; by?: "user" | "boss"; reason?: string }): Promise<{
  ok: boolean;
  error?: string;
  deleted?: { id: string; name: string; tasks: number; events: number; running: number; notified: boolean };
}> {
  const state = await bossStore.load();
  const group = state.groups[String(input.groupId ?? "")];
  if (!group) return { ok: false, error: "群不存在（可能已经被删掉了）" };

  const tasks = Object.values(state.tasks).filter((task) => task.groupId === group.id);
  const running = tasks.filter((task) => ["queued", "assigned", "running", "submitted", "reviewing"].includes(task.status)).length;
  const events = (state.events ?? []).filter((event) => event.groupId === group.id).length;
  const who = input.by === "boss" ? "中枢" : "用户";

  /* ① 先通知中枢（群还在，才找得到 boss 会话） */
  const notified = await postToBoss(
    group,
    `[群事件] 群「${group.name}」(id=${group.id}) 已被${who}删除。\n`
    + `⛔ 该群的 ${tasks.length} 条任务账本与 ${events} 条事件记录已一并清除`
    + `${running ? `，其中 ${running} 条未完成的活已终止` : ""}。\n`
    + `${String(input.reason ?? "").trim() ? `删除原因：${String(input.reason).trim().slice(0, 200)}\n` : ""}`
    + `此后不要再对这个 groupId 派活 / 审查 / 查状态；需要继续就重新 group_create 建群。`
    + `成员会话与产出文件都保留，可在侧栏回看。`,
    /* critical：这条**不能**被闲聊配额吃掉 —— 模型不知道群没了，就会拿旧 groupId 继续派活。 */
    { critical: true },
  ).catch(() => false);

  /* ② 再清账（群 / 任务 / 事件三处，缺一处就会在列表或状态里"诈尸"） */
  for (const task of tasks) delete state.tasks[task.id];
  state.events = (state.events ?? []).filter((event) => event.groupId !== group.id);
  delete state.groups[group.id];
  bossStore.save();
  await bossStore.flush();
  emit({ type: "boss-group", phase: "group", groupId: group.id, status: "deleted" });

  return { ok: true, deleted: { id: group.id, name: group.name, tasks: tasks.length, events, running, notified } };
}
