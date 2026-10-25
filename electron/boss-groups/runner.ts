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
import { hostQueueMessageId } from "../../src/lib/host-queue.mjs";
import { execFile } from "node:child_process";
import { readUsableExpertTeams } from "../expert-teams";
import { bridgeDial } from "../main";
import { readCustomModel } from "../main/01-model-catalog";
import { TURN_WAIT_TIMEOUT_CODE, turnOutputText, waitForTurnCompletion } from "../main/03-turn-summary";
import { ensureProjectAgentsMd } from "../project-conventions";
import { PROVIDER_RETRY_TUNING } from "../provider-retry";
import { safeProviderId } from "../provider-id";
import { server, threadCwd } from "../runtime-refs";
import { egoBrowserPath } from "../toolchain";
import { bossStore } from "./store";
import { addMember, addTask, assignTask, checkBudget, createGroup, groupOf, markReviewStalled, markRunning, markStalled, memberOf, parseVerdict, pickReassignee, pushEvent, recordReview, removeMember, setPinned, snapshot, submitTask, taskOf } from "./state";
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
    /* ⛔⛔ 10-26 用户现场：「成员同步发出来的消息，还要排队吗」——
       群消息走的是引擎的**用户消息队列**，引擎视角它就是"排队的用户消息"
       ⇒ 应用的排队面板会把它显示成「排队中 1/3」的用户消息卡。
       打上宿主保留前缀 ⇒ 渲染层按前缀过滤（引擎照收，投递链路不变）。 */
    await server.request("thread/queue/add", { threadId: boss, input: [{ type: "text", text }], clientUserMessageId: hostQueueMessageId("boss") });
    const list: any = await server.request("thread/queue/list", { threadId: boss, limit: 1 }).catch(() => null);
    const head = list?.data?.[0];
    if (head?.id) await server.request("thread/queue/start", { threadId: boss, queuedSubmissionId: head.id }).catch(() => undefined);
    return true;
  } catch { return false; }
}

/* ── 出站队列：成品/评审请求**不丢、也不刷屏**（10-25 审查修 B）────────────────
   问题：每个成员交活会连发两条消息（成品 + 评审请求）。3 个成员并发就是 6 条，
   撞上 12 条/10 分钟的老配额后，后面的直接被丢。
   做法：交活/评审先进本队列，600ms 内合并成**一条**投给指挥中枢；
   · 只有 1 条成品、且这批里没有评审请求 ⇒ 全文照发（跟以前一样）；
   · 与评审请求同批 ⇒ 成品给 240 字摘要，但**评审正文里带着完整成品**（最多 16000 字）⇒ 信息不丢；
   · 多条 ⇒ 每条 240 字摘要 + 提示"完整成品在群内消息流里，用 group_status 读"；
   · 配额用尽 ⇒ **放回队列**、45 秒后重试，⛔ 不丢。 */
type OutItem = { kind: "deliverable" | "review"; taskId: string; title: string; who?: string; body: string };
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
    parts.push(`[群事件] ${deliverables[0].who ?? "成员"} 交活：「${deliverables[0].title}」\n${deliverables[0].body}`);
  } else if (deliverables.length) {
    parts.push(`[群事件] 本轮 ${deliverables.length} 条交活（成品全文在群内消息流里，需要细节用 group_status 读）：
${deliverables.map((d) => `- 「${d.title}」（${d.who ?? "成员"}）：${d.body.replace(/\s+/g, " ").slice(0, 240)}…`).join("\n")}`);
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
  experts: { teamId: string; teamName: string; memberId: string; name: string; role: string; model?: string; effort?: string }[];
  cliAgents: { name: string; role: string; command: string; detected: boolean }[];
}> {
  let experts: { teamId: string; teamName: string; memberId: string; name: string; role: string; model?: string; effort?: string }[] = [];
  try {
    const teams = await readUsableExpertTeams();
    for (const t of teams ?? []) {
      for (const m of [t.lead, ...(t.members ?? [])]) {
        if (!m?.id) continue;
        const role = (m as any).profession?.zh ?? (m as any).description ?? "专家";
        const teamName = (t as any).displayName?.zh ?? (t as any).displayName ?? t.teamId;
        experts.push({ teamId: t.teamId, teamName, memberId: m.id, name: m.name, role, model: m.model, effort: m.effort });
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
    bossStore.save();
    emit({ type: "boss-group", phase: "task", groupId: group.id, taskId: task.id, memberId: member.id, status: "running" });
    // 后台收尾：不 await（这就是"异步派活"的全部实现）
    void waitForTurnCompletion(threadId, turnId).then((completed: any) => {
      const text = turnOutputText(completed) || "（成员没有返回文本产出）";
      void settleSubmission(task.id, text);
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

async function failTask(taskId: string, reason: string) {
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
  if (group) await postToBoss(group, `[群事件] 「${task.title}」执行失败：${String(reason).slice(0, 300)}\n需要你决定：换模型重做 / 放宽标准 / 你自己接手。`);
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
     ⛔ 走出站队列（合并投递 + 失败重试），不再直接 post：并发交活时既不刷屏，也不会被配额丢掉。 */
  const deliverer = memberOf(group, task.assignee);
  enqueueBoss(group.id, {
    kind: "deliverable", taskId, title: task.title, who: deliverer.name,
    body: deliverable.slice(0, 4000),
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
    const before = group.paused;
    const budget = checkBudget(state, group.id);
    if (group.paused !== before) {
      dirty = true;
      await postToBoss(group, `[群事件] 群「${group.name}」预算用尽（${Math.round(budget.usedMinutes)} 分钟），已暂停自动派活。`);
    } else if (budget.warn === "80" && group.paused !== true) {
      // 同一个群 10 分钟内只提醒一次（配额闸复用回投那套，别每个 tick 刷）
      if (quotaOk(`budget80:${group.id}`)) {
        dirty = true;
        await postToBoss(group, `[群事件] 群「${group.name}」预算已用 80%（${Math.round(budget.usedMinutes)}/${group.policy.budgetMinutes} 分钟）。`);
      }
    }
  }
  for (const item of markStalled(state)) {
    const task = state.tasks[item.taskId];
    const group = state.groups[item.groupId];
    if (!task || !group) continue;
    const key = `stall:${task.id}`;
    if (quotaOk(key)) {
      dirty = true;
      emit({ type: "boss-group", phase: "task", groupId: group.id, taskId: task.id, status: "stalled" });
      await postToBoss(group, `[群事件] 「${task.title}」已经 ${Math.round(item.idleMs / 1000)} 秒没有进展（无进展 ×1），需要你看一眼。`);
    }
  }
  /* 待审看门狗（审查修的缺口 C）：评审交给会话自己判 ⇒ 它那一轮没看见、或忘了调 group_review，
     任务会永远停在 reviewing（看板一直"等审查"，成品其实早交了）。这里按"多久没动静"再催一次。
     ⛔ 只催，不替它下结论；同一个任务 10 分钟最多催一次（配额闸复用）。 */
  for (const item of markReviewStalled(state)) {
    const task = state.tasks[item.taskId];
    const group = state.groups[item.groupId];
    if (!task || !group) continue;
    if (!quotaOk(`review:${task.id}`)) continue;
    dirty = true;
    pushEvent(state, {
      groupId: group.id, taskId: task.id, kind: "note",
      text: `「${task.title}」已交活 ${Math.round(item.idleMs / 60_000)} 分钟仍无审查结论，已再次提醒指挥中枢`,
    });
    emit({ type: "boss-group", phase: "task", groupId: group.id, taskId: task.id, status: "review-stale" });
    await postToBoss(group, `[群事件] 「${task.title}」已交活 ${Math.round(item.idleMs / 60_000)} 分钟，仍没有审查结论。
⛔ 别再等：现在就用你的评审技能对照验收标准判，然后调 group_review(taskId="${task.id}", verdict="approved" | "rejected", reasons=[…])。
（成品全文用 group_status 或在群消息流里看）`);
  }
  /* 出站队列兜底：定时器可能因为进程挂起而丢，tick 时补一次 flushed。 */
  for (const groupId of Array.from(OUTBOX.keys())) await flushOutbox(groupId);
  if (dirty) bossStore.save();
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
}): Promise<{ ok: boolean; member?: { id: string; name: string; role: string; status: string; source?: string }; error?: string }> {
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
        addInput = {
          name: m.name, role: m.profession?.zh ?? "专家", systemPrompt: m.systemPrompt,
          model: m.model, effort: m.effort, sandbox: m.sandbox, approvalPolicy: m.approvalPolicy,
          source: "engine",
        };
      } else if (input.from === "cli") {
        const reg = CLI_AGENT_REGISTRY.find((a) => a.name === String(input.cliName ?? input.name ?? "").toLowerCase());
        const command = String(input.cliCommand ?? reg?.command ?? "").trim();
        if (!command) return { ok: false, error: `拉 CLI agent 需要命令模板（cliCommand，{prompt} 会替换成任务全文）；登记表里没有「${input.cliName ?? ""}」` };
        addInput = {
          name: String(input.name ?? input.cliName ?? reg?.name ?? "cli-agent"),
          role: String(input.role ?? reg?.role ?? "本机 CLI agent"),
          systemPrompt: `你是从本机命令行 agent（${String(input.cliName ?? reg?.name ?? "")}）拉进群的成员。你的成品由宿主执行你的命令行得到，回答请直接给结论与依据。`,
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
    bossStore.save();
    const group = groupOf(state, String(input.groupId ?? ""));
    emit({ type: "boss-group", phase: "member", groupId: group.id, memberId: member.id, status: member.status });
    /* ⛔⛔ 10-25 用户实测：「用户移除的群成员没有真实生效，Codex 不知道我移除了」。
       成员变动必须**回投给 BOSS 会话**，否则模型只在自己查 group_status 时才可能看到，
       而且那是旧口径（会把 removed 也数进去）。这里把增/移都主动告诉 BOSS。 */
    if (input.action === "add") {
      void postToBoss(group, `[群事件] 新成员进群：${member.name}（${member.role}${member.source === "cli" ? "，本机 CLI agent" : ""}，id=${member.id}）。`);
    } else {
      void postToBoss(group, `[群事件] 成员已被用户移出群：${member.name}（${member.role}，id=${member.id}）。\nTA **不在当前成员名单里、不再接任何新活**（会话与轨迹保留）；已在跑的任务不打断，交活后照常回投与审查。此后你 group_status 看到的成员数不含 TA。`);
    }
    return { ok: true, member: { id: member.id, name: member.name, role: member.role, status: member.status, source: member.source ?? "engine" } };
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
