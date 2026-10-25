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
import { randomUUID } from "node:crypto";
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
import { addMember, addTask, assignTask, checkBudget, createGroup, groupOf, markRunning, markStalled, memberOf, parseVerdict, pickReassignee, pushEvent, recordReview, removeMember, setPinned, snapshot, submitTask, taskOf } from "./state";
import type { BossGroup, BossState, GroupMember, GroupTask } from "./types";

/** 事件出口（域层注入：本模块在 features/ 之外，不许反向 import 域）。 */
type Sink = (payload: unknown) => void;
let sink: Sink | null = null;
export function setBossEventSink(fn: Sink | null) { sink = fn; }
function emit(payload: unknown) { try { sink?.(payload); } catch { /* 广播失败不影响编排 */ } }

/* ── 回投：往 boss 会话投一条群事件（不打断在跑的回合） ───────────────────────── */
const POST_QUOTA = new Map<string, { count: number; since: number }>();
const POST_WINDOW_MS = 10 * 60 * 1000;
const POST_MAX_PER_WINDOW = 12;

function quotaOk(key: string): boolean {
  const now = Date.now();
  const rec = POST_QUOTA.get(key);
  if (!rec || now - rec.since > POST_WINDOW_MS) { POST_QUOTA.set(key, { count: 1, since: now }); return true; }
  if (rec.count >= POST_MAX_PER_WINDOW) return false;
  rec.count += 1;
  return true;
}

/** 群事件 → boss 会话。⛔ 用 queue/add（不是 turn/start）：turn/start 会打断 boss 正在跑的回合。 */
export async function postToBoss(group: BossGroup, text: string): Promise<boolean> {
  const boss = String(group.bossThreadId ?? "");
  if (!boss) return false;
  if (!quotaOk(group.id)) return false;      // 防刷：群事件再多也不会把 boss 刷成刷屏机
  try {
    await server.request("thread/resume", { threadId: boss, excludeTurns: false }).catch(() => undefined);
    await server.request("thread/queue/add", { threadId: boss, input: [{ type: "text", text }], clientUserMessageId: randomUUID() });
    const list: any = await server.request("thread/queue/list", { threadId: boss, limit: 1 }).catch(() => null);
    const head = list?.data?.[0];
    if (head?.id) await server.request("thread/queue/start", { threadId: boss, queuedSubmissionId: head.id }).catch(() => undefined);
    return true;
  } catch { return false; }
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

/** CLI 成员的派遣：起子进程跑命令模板，stdout 尾部作为成品走同一条审查流水。 */
async function runCliMember(group: BossGroup, member: GroupMember, task: GroupTask): Promise<void> {
  const command = String(member.cliCommand ?? "").replace("{prompt}", memberPrompt(group, member, task, task.attempts[task.attempts.length - 1]?.n ?? 1).replace(/"/g, "'"));
  try {
    await new Promise<void>((resolve, reject) => {
      execFile("cmd", ["/c", command], { cwd: group.workspace || process.cwd(), timeout: 600_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
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
        走同一条 交活→独立评审 流水。 */
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
  pushEvent(state, {
    groupId: group.id, taskId, memberId: task.assignee, kind: "chat-member",
    text: String(output ?? "").slice(0, 600) || "（没有文本产出）",
  });
  bossStore.save();
  emit({ type: "boss-group", phase: "task", groupId: group.id, taskId, status: "reviewing" });
  if (alreadyLeftRunning) await reviewTask(taskId);   // 重复回调（已不在 running）⇒ 不再审
}

const REVIEW_PROMPT = (task: GroupTask, output: string) => `[SYSTEM TASK · 独立评审]
你是独立评审，**只能看到验收标准与成品**，看不到执行过程（这是故意的）。

=== 验收标准 ===
${task.criteria}

=== 成品 ===
${output.slice(0, 16000)}

=== 要求 ===
逐条对照验收标准判断是否满足。只输出一个 JSON，不要任何解释文字：
{"pass": true|false, "reasons": ["未满足的具体条 + 证据（一句话）"]}
- pass=true 时 reasons 必须是空数组；
- pass=false 时 reasons 至少一条，且必须指向验收标准里的具体条目，不要写"不够好""可以更好"这种空话。`;

/** 同一任务同时只允许一次评审（settleSubmission 重复回调 / 人工与自动撞车 ⇒ 后到的直接跳过）。 */
const inFlightReviews = new Set<string>();

/** 独立评审：用一个**新鲜上下文**的会话判，判完落 verdict。 */
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
    const env = await providerEnv();
    const model = env.model;
    if (!model) throw new Error("未配置模型，无法评审");
    const started: any = await server.request("thread/start", {
      model, cwd: group.workspace || process.cwd(), approvalPolicy: "never", sandbox: "read-only",
      modelProvider: env.provider, config: env.config,
    });
    const reviewThreadId = String(started.thread.id);
    try { await server.request("thread/name/set", { threadId: reviewThreadId, name: `${group.name}·评审` }); } catch { /* 忽略 */ }
    const turn: any = await server.request("turn/start", { threadId: reviewThreadId, input: [{ type: "text", text: REVIEW_PROMPT(task, output), text_elements: [] }], model, effort: "medium" });
    const turnId = turn?.turn?.id;
    if (!turnId) throw new Error("评审会话没有返回 turnId");
    const completed = await waitForTurnCompletion(reviewThreadId, turnId);
    const text = turnOutputText(completed) || "";
    const verdict = parseVerdict(text);
    const record = recordReview(state, taskId, { by: "fresh", verdict: verdict.verdict, reasons: verdict.reasons });
    bossStore.save();
    emit({ type: "boss-group", phase: "review", groupId: group.id, taskId, verdict: verdict.verdict });
    // 通过 → 通知 boss；打回 → 自动换人重做（作者锁已在 recordReview 里落实）
    if (verdict.verdict === "approved") {
      await postToBoss(group, `[群事件] 「${task.title}」审查通过（尝试 ${attempt?.n ?? 1}）。`);
    } else if (record.status === "rejected") {
      const next = pickReassignee(state, record);
      bossStore.save();
      if (next) {
        await postToBoss(group, `[群事件] 「${task.title}」被打回：${verdict.reasons.join("；")}\n已换人重做：${next.name}（原作者 ${memberOf(group, record.assignee).name} 本轮锁定，不许自改）。`);
        // 延迟一点再派：同一 tick 里连派容易和刚结束的回合抢引擎
        setTimeout(() => { void dispatchTask(taskId, { memberId: next.id }); }, 1200);
      }
    } else if (record.status === "escalated") {
      await postToBoss(group, `[群事件] 「${task.title}」已升级给你：${verdict.reasons.join("；")}\n可选：换模型重做 / 放宽标准 / 你自己接手（告诉我哪个）。`);
    }
    return { ok: true, verdict: verdict.verdict };
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
