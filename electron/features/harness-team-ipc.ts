/**
 * harness-team · 主进程板块（团队模式 P0，10-05 立）
 *
 * 独立板块：只服务「群 / 伙伴 / 护栏」这一件事，⛔ 不往 expert-teams / delegation 里借住。
 * 判定全部走 `src/lib/team-models.mjs`（纯函数单一真相源），本文件只负责**取路径、读写盘、回 IPC**。
 *
 * 域：harness-team
 * 通道：群 CRUD / 伙伴 / 记忆条目 / 群文件 / 菜单 / 用量账本 / 消息日志（完整清单见 HARNESS_TEAM_CHANNELS）
 *
 * ⛔ 三条纪律：
 *   ① `app.getPath("userData")` **必须在 handle 内惰性取**（模块体里取会拿到默认目录 —— 见守卫【91】）。
 *   ② 配置文件损坏 ⇒ 返回空列表，⛔ 不抛（一个坏文件不能让设置页打不开）。
 *   ③ 写盘走「临时文件 + rename」原子替换，⛔ 直接覆盖会在被杀时留下半截 JSON。
 */
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { app } from "electron";
import { defineFeature } from "../context";
/* ⛔ 11-12 「删必须同步清理干净」：会话级残留的清理函数都在基座层，这里只负责接线。 */
import { removeSessionWorkspace } from "./session-workspace";
import { forgetRoleSession } from "../role-memory";
import { clearSessionPrivateMemory } from "../memory-fabric";
import type { IpcHost } from "../ipc-host";
import {
  addPartner,
  appendGroupMessage,
  createBlockers,
  createGroup,
  parseAgentMentions,
  groupIssues,
  groupThreadId,
  normalizeGroupMessage,
  projectGroupLog,
  projectGroupMessages,
  normalizeGroupFile,
  addMemoryNote,
  removeMemoryNote,
  removePartner,
  setManager,
  setPartnerMuted,
  setMemberAvatar,
  setMessageLayout,
  setReplyMode,
  setMessageForm,
  setDialogFlow,
  /* 11-09 用户令（两条消息路由）：管理员 + 没 @ 时的默认投递目标。⛔ 规则全在 team-models 里，这里只接线。 */
  setAdmin,
  defaultRouteCandidates,
  GROUP_MAX_PARTNERS,
  MAX_GROUP_FILES,
  MAX_GROUP_MEMORY_CHARS,
  MAX_GROUP_MESSAGES,
  teamKidsOf,
  teamAuthorIdOf,
  teamMemberIdOf,
  textsAreNearDuplicate,
  talkPartnerIdentity,
  renameMember,
} from "../../src/lib/team-models.mjs";
import { GROUP_USAGE_TTL_MS, pickUsagePatchIndex, usageFromTokenEvent, usageUsableFor, type GroupUsage } from "../../src/lib/team-usage.mjs";
/* ⛔ 11-10 用户令「界定什么时候收尾、什么时候继续推进」：判据是纯函数，⛔ 不在这里写 if 堆。 */
import { classifyTurn, isInfoRequest, settleHandoffs } from "../../src/lib/team-collab.mjs";
/* ⛔ 11-10「异常落到责任人」的标记解析（纯函数，守卫真跑）。 */
import { dutyKeyOf, parseDuty } from "../../src/lib/team-duty.mjs";
/* ⛔ 11-10 群记忆：按「群类型 + 座位」注入（专家群 / 专家团群 / CLI 智能体群各一套）。
   ⛔ 判定与渲染都在 memory/ 域里，这里只取一段字符串 —— 群聊域不重新判一次群类型。 */
import { buildGroupMemoryBlock } from "../memory/group-memory-inject";
import { normalizeMenu, normalizeMenuPlacement, MENU_MAX_ITEMS } from "../../src/lib/team-menu.mjs";
import {
  MAX_GROUP_SCHEDULES,
  normalizeScheduleEntry,
  normalizeSchedules,
  scheduleBlockers,
} from "../../src/lib/team-schedule.mjs";
/* ⛔ 停止运行复用引擎侧的活动回合表（threadId → turnId）：这是**唯一真相源**，
   别在这里自己记一份"我以为在跑什么"（两处必然漂）。 */
import { codexHome, delegateRegistry, engineActiveTurnIds, server, teamRunStore, threadCwd, threadRuntimeStore } from "../runtime-refs";
/* ⛔ 11-11：团群主理人会话的工具面升级（附录 Z：只能改 rollout 首行，且必须赶在引擎 spawn 之前）。 */
import { syncToolSurfaceAsync } from "../rollout-pool";
import { stopTeamRuns, consumeTalkCancel, clearTalkCancel, type TeamStopInput } from "./harness-team-stop";
import { startTeamQueued, type TeamQueueStartInput } from "./harness-team-queue";
/* ⛔ 定时任务的"下一次什么时候跑"**不在本文件算**：RRULE 构造 / 相位守恒 / 补跑窗口
   的唯一真相源是 electron/scheduler.ts（与「设置 → 自动化」同一个引擎）。 */
import { buildRRuleFromInput, computeNextRunAt } from "../scheduler";
import { buildDispatchCatalog } from "./dispatch-core";
/* ⛔⛔ 11-07 用户令：「群聊是独立板块、独立通道，群聊不需要调度」 ——
   群聊会话/工具/消息投递全在 group-talk/ 里，⛔ 不走外面的 runDelegatedTask 调度链。 */
import { runTalkTurn, ensureTalkThread, peekTalkThread, queueTalkDelivery, buildTalkInput, setGroupTalkHooks, attachGroupTalkEvents, listTalkThreads, forgetTalkThreads, renameTalkMember, planTalkCli, runTalkCliDirect, TALK_HISTORY_LIMIT, evaluateMemberOutput, buildGroupTalkTools, adoptTalkThreadAlias, type TalkMember } from "./group-talk";
import { broadcastHarnessEvent } from "./window-bus";
/* ⛔⛔ 11-11 用户令（「群聊会话仍然拿不到 team_member_invoke，主理人还是靠行首 @名字：派活」）：
   团群主理人的会话要挂**真的**调度工具（工具面只在 thread/start 定死，见附录 Z）。
   ⛔ 只取工具**描述**，执行与权限仍在 team-invoke / team-tool-fallback（⛔ 不在这里调度成员）。 */
import { buildTeamPhaseTool, buildTeamPlanTool, buildTeamStatusTool, buildTeamTools, readUsableExpertTeams } from "../expert-teams";
/* ⛔ 11-11：主理人还要拿得到宿主能力网关（知识库 / 定时任务 / 文件 / 记忆）——
   执行端权限早就按 dispatchOnly 定好了（scheduler_save / knowledge_add 对群聊会话放行），
   缺的只是工具面这一根线。 */
import { buildDelegateHarnessTool } from "../delegate-harness-tool";
import { withStepParam } from "../../src/lib/step-note.mjs";
/* ⛔ 11-07：团队成员产出落群的桥（关面板也照写；见 team-group-bridge.ts） */
import { bindTeamGroup, setTeamGroupAppender, setTeamGroupReader, setTeamGroupRelay } from "../team-group-bridge";
/* ⛔ 11-11：主理人这一轮到底用没用真调度工具 —— 决定催办说哪种话（见下面的 isLeadSelf）。 */
import { teamToolUsedSince } from "../team-tool-fallback";
/* ⛔ 误登记成指挥中枢的伙伴会话要能静默摘掉身份（保留记忆目录）——见 talk-threads 通道。 */
import { unregisterBossSessionQuiet } from "../boss-groups/session-registry";
import {
  appendLedger,
  normalizeLedgerEntry,
  summarizeLedger,
  MAX_LEDGER_ENTRIES,
} from "../../src/lib/team-ledger.mjs";

export const HARNESS_TEAM_CHANNELS = [
  "harness-team:list",
  "harness-team:create",
  "harness-team:rename",
  "harness-team:rename-member",
  "harness-team:add-partner",
  "harness-team:remove-partner",
  "harness-team:mute",
  "harness-team:set-avatar",
  "harness-team:set-guard",
  "harness-team:project",
  "harness-team:messages",
  "harness-team:append-message",
  /* 11-07：手动派活（渲染层只发这一条就返回，主进程跑完整条链 —— 关弹窗不再断） */
  "harness-team:dispatch",
  "harness-team:delete",
  "harness-team:set-memory",
  "harness-team:set-workspace",
  "harness-team:running",
  "harness-team:clear-messages",
  "harness-team:set-files",
  "harness-team:set-manager",
  /* 11-09：群管理员（普通群「用户没 @ 时由谁接话」；专家团群不用） */
  "harness-team:set-admin",
  "harness-team:add-note",
  "harness-team:remove-note",
  "harness-team:set-menu",
  "harness-team:set-menu-placement",
  "harness-team:set-schedule",
  "harness-team:run-schedule",
  "harness-team:log-usage",
  "harness-team:ledger",
  "harness-team:stop",
  "harness-team:queue-start",
  "harness-team:thread-usage",
];

/** 配置文件路径（惰性：每次调用现取，⛔ 不在模块体缓存）。 */
function teamsFile(): string {
  return join(app.getPath("userData"), "harness-teams.json");
}

type GroupShape = ReturnType<typeof createGroup>;

/** 落盘形状（v2 起多一份 per-group 消息日志，P0b）。
 *  ⛔ 老文件（v1，只有 groups）照样能读：messages 缺省即 `{}`。 */
/** 工作伙伴群的一条任务（11-10）：一次 handoff 就是一条任务，派出去 open、被确认 done。
 *  ⛔ 落盘而不是放内存 Map：「活还没干完」是收尾判据的第一依据，不能一重启就忘。 */
type TeamGroupTask = {
  id: string;
  groupId: string;
  title: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  status: "open" | "done";
  at: number;
  doneAt?: number;
};

type StoreShape = {
  version: number;
  groups: GroupShape[];
  messages: Record<string, ReturnType<typeof normalizeGroupMessage>[]>;
  /** 任务账本：key = 任务 id。与 messages 分开，⛔ 不塞进群对象（群配置常常整份改写）。 */
  tasks?: Record<string, TeamGroupTask>;
};

function readStore(): StoreShape {
  const file = teamsFile();
  const empty: StoreShape = { version: 2, groups: [], messages: {} };
  if (!existsSync(file)) return empty;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const rows = Array.isArray(parsed?.groups) ? parsed.groups : [];
    const messages: StoreShape["messages"] = {};
    const rawMessages = parsed?.messages && typeof parsed.messages === "object" ? parsed.messages : {};
    for (const [gid, list] of Object.entries(rawMessages as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      /* ⛔ 过一遍 normalizeGroupMessage：坏条目（缺 id/threadId）当场丢掉，别让它进投影 */
      messages[gid] = list.map((m) => normalizeGroupMessage(m)).filter(Boolean).slice(-MAX_GROUP_MESSAGES);
    }
    const tasks: Record<string, TeamGroupTask> = {};
    const rawTasks = parsed?.tasks && typeof parsed.tasks === "object" ? parsed.tasks : {};
    for (const [tid, row] of Object.entries(rawTasks as Record<string, unknown>)) {
      const r = row as Partial<TeamGroupTask>;
      const gid = String(r?.groupId ?? "");
      if (!tid || !gid || !String(r?.toId ?? "")) continue;
      tasks[tid] = {
        id: tid, groupId: gid, title: String(r.title ?? ""),
        fromId: String(r.fromId ?? ""), fromName: String(r.fromName ?? ""),
        toId: String(r.toId ?? ""), toName: String(r.toName ?? ""),
        status: r.status === "done" ? "done" : "open",
        at: Number(r.at ?? 0), ...(r.doneAt ? { doneAt: Number(r.doneAt) } : {}),
      };
    }
    return {
      version: 2,
      /* ⛔ 过一遍 createGroup：老文件缺字段（新增护栏/目标绑定）也能读出来 */
      groups: rows.map((g: unknown) => createGroup(g as Record<string, unknown>) as GroupShape).filter((g: GroupShape) => Boolean(g.id)),
      messages,
      tasks,
    };
  } catch {
    return empty;
  }
}

function writeStore(store: StoreShape): { ok: boolean } {
  const file = teamsFile();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: 2, groups: store.groups, messages: store.messages, tasks: store.tasks ?? {} }, null, 2), "utf8");
  renameSync(tmp, file);
  return { ok: true };
}

/* ── 用量账本（11-06，豆包 §2.④）─────────────────────────────────────────────
   ⛔ 单独一个文件，**不塞进 harness-teams.json**：账本是 append-only 序列（几千条），
      群配置是"常常整份改写"的对象 —— 混在一起会让"改一次群名"也重写几千条账本。 */
function ledgerFile(): string {
  return join(app.getPath("userData"), "harness-team-ledger.json");
}

type LedgerEntryShape = ReturnType<typeof normalizeLedgerEntry>;

function readLedger(): NonNullable<LedgerEntryShape>[] {
  const file = ledgerFile();
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const rows = Array.isArray(parsed?.entries) ? parsed.entries : [];
    /* ⛔ 过一遍 normalize：坏条目当场丢，别让一条脏数据把汇总算崩 */
    return rows.map((r: unknown) => normalizeLedgerEntry(r)).filter(Boolean).slice(-MAX_LEDGER_ENTRIES) as NonNullable<LedgerEntryShape>[];
  } catch {
    return [];
  }
}

function writeLedger(entries: NonNullable<LedgerEntryShape>[]): { ok: boolean } {
  const file = ledgerFile();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: 1, entries }, null, 2), "utf8");
  renameSync(tmp, file);
  return { ok: true };
}

/** 按 id 找到群；找不到返回 null（调用方决定怎么报错）。 */
function findGroup(groups: GroupShape[], groupId: string): GroupShape | null {
  return groups.find((g) => g.id === String(groupId)) ?? null;
}

/** 落盘并回带最新群对象（渲染层直接用返回值刷新，不用再拉一次全量）。
 *  ⛔ 必须先 readStore 再写，⛔ 不能拿一份没有 messages 的旧结构整份覆盖（会把群聊记录抹掉）。 */
function saveOne(store: StoreShape, next: GroupShape) {
  const merged: StoreShape = { ...store, groups: store.groups.map((g) => (g.id === next.id ? next : g)) };
  writeStore(merged);
  return { ok: true, group: next, issues: groupIssues(next) };
}

/* ── 读-改-写串行队列（11-06 修的真 bug）──────────────────────────────────────
   ⛔ 原来的「readStore → 改 → writeStore」在**并发**下会互相覆盖：一次 @ 两个伙伴，
     两条回复几乎同时回来，各自拿着**同一份旧 store** 整份写回 ⇒ 后写的那次把前一条消息抹掉
     （群视图里少一条，且看不出来是哪一条）。定时任务一次派给多人时同样会撞。
   ⇒ 所有"追加消息 / 记账 / 更新任务时刻"都过这条队列：一次只有一个在读写。 */
let storeChain: Promise<unknown> = Promise.resolve();
function mutateStore<T>(fn: (store: StoreShape) => { store: StoreShape; out: T }): Promise<T> {
  const task = storeChain.then(() => {
    const { store, out } = fn(readStore());
    writeStore(store);
    return out;
  });
  storeChain = task.catch(() => undefined);
  return task;
}

/* ── 清空记录的「代际」（11-08 审查）────────────────────────────────────────
   派活还在跑时用户点了「清空聊天记录」：跑完那次回复原来会**照写回空群**
   （用户看到「我只 @ 了一个，怎么另一个也冒出来了」——11-06 修过一次，
   派活搬进主进程后渲染层的代际守卫成了死代码 ⇒ 回归）。
   ⇒ 清空时记一个时间戳；群聊回合开跑时记下它，写回前发现变新了就只结算、不落盘。 */
const groupClearedAt = new Map<string, number>();

let ledgerChain: Promise<unknown> = Promise.resolve();
function mutateLedger<T>(fn: (rows: NonNullable<LedgerEntryShape>[]) => { rows: NonNullable<LedgerEntryShape>[]; out: T }): Promise<T> {
  const task = ledgerChain.then(() => {
    const { rows, out } = fn(readLedger());
    writeLedger(rows);
    return out;
  });
  ledgerChain = task.catch(() => undefined);
  return task;
}

/** 追加一条群消息（IPC handler 与定时任务**共用这一份**，⛔ 别各写一套时间/归属口径）。 */
type AppendResult = { ok: boolean; error?: string; rows: ReturnType<typeof projectGroupLog>; entry?: unknown };
async function appendMessageTo(groupId: string, entry: Record<string, unknown>): Promise<AppendResult> {
  const gid = String(groupId ?? "");
  if (!gid) return { ok: false, error: "缺群 id", rows: [] };
  const at = Number(entry?.at ?? 0) || Date.now();
  const id = String(entry?.id ?? "").trim() || `msg_${at.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const authorKind = entry?.authorKind === "bot" ? "bot" : "human";
  /* ⛔ 人的消息挂群自身；伙伴的消息必须带**真实子会话 id**，否则判无效（不造真身） */
  const threadId = String(entry?.threadId ?? "").trim() || (authorKind === "human" ? groupThreadId(gid) : "");
  /* ⛔⛔ 11-08 用户实测（「成员消息不处理完压根不上屏」）：写库原来**不广播** ——
     主进程里 append 后渲染层只有等自己那次 IPC 返回才重读；而接力成员（第 2 跳起）
     根本没人 await ⇒ 消息永远不出现。⇒ 每次成功落盘都把权威 rows 广播给所有窗口。 */
  const result = await mutateStore<AppendResult>((store) => {
    if (!findGroup(store.groups, gid)) return { store, out: { ok: false, error: "群不存在", rows: [] } };
    const prev = store.messages[gid] ?? [];
    const next = appendGroupMessage(prev, { ...entry, id, threadId, at, authorKind });
    const saved = next.find((m) => String(m?.id ?? "") === id) ?? null;
    if (!saved) return { store, out: { ok: false, error: "消息无效（缺子会话归属）", rows: projectGroupLog(prev) } };
    return {
      store: { ...store, messages: { ...store.messages, [gid]: next } },
      out: { ok: true, entry: saved, rows: projectGroupLog(next) },
    };
  });
  if (result.ok) broadcastHarnessEvent({ type: "harness-team-messages", groupId: gid, rows: result.rows } as never);
  /* ⛔ 11-10「异常要落到责任人」：伙伴开口 ⇒ 先关它名下旧的待处理；它这条里若点了责任人 ⇒ 再登记新的。
     顺序不能反（先登记后关闭会把自己刚建的立刻关掉）。⛔ 旁路：失败不影响落盘结果。 */
  if (result.ok && authorKind === "bot") {
    const authorId = String(entry?.authorId ?? "");
    if (authorId) closeOpenTasksOf(gid, authorId);
    void registerResponsibleFrom(gid, { ...entry, authorId }).catch(() => undefined);
  }
  return result;
}

/** 局部更新一条群消息（流式收尾：把最后一条标成 summary / 回填用量）；返回是否真更新。 */
async function patchTalkMessageRow(groupId: string, rowId: string, patch: Record<string, unknown>): Promise<boolean> {
  const id = String(rowId ?? "");
  if (!id) return false;
  const rows = await mutateStore<ReturnType<typeof projectGroupLog> | null>((store) => {
    const cur = store.messages[groupId] ?? [];
    const idx = cur.findIndex((m) => String((m as { id?: unknown })?.id ?? "") === id);
    if (idx < 0) return { store, out: null };
    const next = cur.slice();
    next[idx] = { ...cur[idx], ...patch } as (typeof cur)[number];
    return { store: { ...store, messages: { ...store.messages, [groupId]: next } }, out: projectGroupLog(next) };
  });
  if (rows) broadcastHarnessEvent({ type: "harness-team-messages", groupId, rows } as never);
  return Boolean(rows);
}

/** 记一条用量（失败也记：失败同样烧了 token，失败率本身是最该看的指标）。 */
async function logUsageTo(entry: Record<string, unknown>): Promise<{ ok: boolean; count?: number; error?: string }> {
  const e = normalizeLedgerEntry(entry);
  if (!e) return { ok: false, error: "用量记录无效（缺伙伴 id）" };
  const count = await mutateLedger<number>((rows) => {
    const next = appendLedger(rows, { ...e, at: e.at || Date.now() }) as NonNullable<LedgerEntryShape>[];
    return { rows: next, out: next.length };
  });
  return { ok: true, count };
}

/** 定时任务在群日志里的作者 id（渲染层据此显示「定时任务」而不是"我"）。 */
export const AUTOMATION_ACTOR_ID = "automation";

/* ── 群消息的 token 用量（11-08 Optional 收口）────────────────────────────────
   主对话的用量来自引擎 `thread/tokenUsage/updated` 的 **last 桶**；群聊同一份口径。
   ⛔⛔ 只在回合内挂监听有两个漏口：① 事件若排在 `turn/completed` 之后，`finally` 已摘监听；
   ② 消息已落盘、界面却永远没有页脚。⇒ 用一个**常驻**监听（首次派活时安装）：
     · 运行中：仍走本轮的 liveUsage（最快）；
     · 落盘前：用量已到就带上（`talkUsageFor`，限本轮之后，避免拿上一轮的）；
     · 落盘后：用量才到 ⇒ `patchLatestTalkMessageUsage` 把最后一条同会话的伙伴消息补上并广播 rows。
   纯判定（事件解析 / 该补哪条）在 `src/lib/team-usage.mjs`（可单测），这里只做 IO 与广播。 */
const TALK_USAGE_TTL = GROUP_USAGE_TTL_MS;
const talkUsageByThread = new Map<string, { usage: GroupUsage; at: number }>();
/* 刚收尾的回合（threadId → 群 + 收尾时刻）：用量只在**收尾之后**才补写消息，
   ⛔ 运行中不补 —— 否则会把本轮用量挂到中间那条 group_say 上（最终回复自己也带一份 = 显示两遍）。 */
const finishedTalkRuns = new Map<string, { groupId: string; at: number }>();

function rememberTalkUsage(threadId: string, usage: GroupUsage): void {
  talkUsageByThread.set(threadId, { usage, at: Date.now() });
  if (talkUsageByThread.size <= 300) return;
  /* 有界：超了就丢最旧的一条（只是补写用量用的缓存，不是账本）。 */
  let oldestKey = "";
  let oldestAt = Number.POSITIVE_INFINITY;
  for (const [key, value] of talkUsageByThread) {
    if (value.at < oldestAt) { oldestAt = value.at; oldestKey = key; }
  }
  if (oldestKey) talkUsageByThread.delete(oldestKey);
}

/** 收尾落盘时取用量：优先本轮 live 捕获，其次常驻缓存（⛔ 早于本轮开跑的缓存一律不算）。 */
function talkUsageFor(threadId: string, since: number): GroupUsage | null {
  return usageUsableFor(talkUsageByThread.get(threadId), since);
}

let usageWatcherInstalled = false;
/** 常驻监听（幂等）：用量事件无论早于还是晚于消息落盘，都能落到那条群消息上。 */
function installTalkUsageWatcher(): void {
  if (usageWatcherInstalled) return;
  usageWatcherInstalled = true;
  server.on("event", (event: any) => {
    const hit = usageFromTokenEvent(event);
    if (!hit) return;
    rememberTalkUsage(hit.threadId, hit.usage);
    const run = finishedTalkRuns.get(hit.threadId);
    if (run && Date.now() - run.at <= TALK_USAGE_TTL) {
      void patchLatestTalkMessageUsage(run.groupId, hit.threadId, hit.usage).catch(() => undefined);
    }
  });
}

/** 用量事件晚于消息落盘（引擎时序可能排在本轮收尾之后）：补到最后一条同会话的伙伴消息上。 */
async function patchLatestTalkMessageUsage(groupId: string, threadId: string, usage: GroupUsage): Promise<void> {
  const now = Date.now();
  const store = readStore();
  const list = store.messages[groupId] ?? [];
  const target = pickUsagePatchIndex(list, threadId, now, TALK_USAGE_TTL);
  if (target < 0) return;
  const row = list[target];
  const rows = await mutateStore<ReturnType<typeof projectGroupLog> | null>((s) => {
    const cur = s.messages[groupId] ?? [];
    const idx = cur.findIndex((m) => String((m as { id?: unknown })?.id ?? "") === String((row as { id?: unknown })?.id ?? ""));
    const base = idx >= 0 ? cur[idx] : null;
    if (!base || base.usage) return { store: s, out: null };
    const next = cur.slice();
    next[idx] = { ...base, usage };
    return { store: { ...s, messages: { ...s.messages, [groupId]: next } }, out: projectGroupLog(next) };
  });
  if (rows) broadcastHarnessEvent({ type: "harness-team-messages", groupId, rows } as never);
}

/**
 * 派活目标（群成员 / 专家团成员）。
 *
 * ⛔⛔ 11-07 用户令：「流程跑不通、没有结果回传、我关闭一下群弹窗任务就莫名其妙结束了」——
 *    派活整体搬到**主进程**：渲染层只发一条请求就返回，落群日志 / 派活 / 产出回写 /
 *    互 @ 接力 / 账本全在这里跑完。以前这一整套在渲染层 `02-team-store.dispatch()` 里，
 *    面板一卸载（关群弹窗 / 切设置页）链条就断在半路 —— 用户看到的就是"任务莫名结束"。
 * ⛔ 定时任务与手动派活共用这一份：两处各写一套必然漂（历史上已经漂过）。
 */
type GroupTarget = { id: string; kind: string; name: string; targetKind: string; targetKey: string };

/** 群成员 + 合成 id 的团成员（`team:<teamId>:<memberId>`）。⛔ 口径只在主进程这一处。 */
function resolveGroupTargets(
  group: GroupShape,
  memberIds: string[],
  catalog: unknown[],
): { targets: GroupTarget[]; error?: string } {
  const list = Array.isArray(catalog) ? (catalog as Array<Record<string, unknown>>) : [];
  const bots = group.members.filter((m) => m.kind === "bot");
  const picked = bots.filter((m) => memberIds.includes(m.id));
  const virtuals: GroupTarget[] = [];
  for (const raw of memberIds) {
    const id = String(raw ?? "");
    const parsed = /^team:([^:]+):(.+)$/.exec(id);
    if (!parsed) continue;
    if (virtuals.some((v) => v.id === id)) continue;
    const teamId = parsed[1];
    const memberId = parsed[2];
    /* ⛔⛔ 11-11 真机（用户截图红框：「这名字改不过来吗」，署名显示 `data-analysis-team-lead`）：
       目录里**主理人是 `kind:"expert"`**、团成员才是 `kind:"member"`（dispatch-core 881-890）。
       这里原来只认 member ⇒ @ 主理人 / @ 整团 解析出来的 name 回落成英文 id，
       这个 id 会一路带到流式卡的标题、成员栏、群消息署名上（落盘后渲染层再靠目录映射才救回来）。
       ⇒ 先按 member 找，再按 expert 找（同一张椅子两种 kind，⛔ 不是两套语义）。 */
    const hit = list.find((t) => t
      && t.kind === "member"
      && String(t.teamId ?? "") === teamId
      && (String(t.memberId ?? "") === memberId || String(t.key ?? "") === `${teamId}:${memberId}`))
      ?? list.find((t) => t
      && t.kind === "expert"
      && String(t.teamId ?? "") === teamId
      && (String(t.memberId ?? "") === memberId || String(t.key ?? "") === `${teamId}:${memberId}`));
    virtuals.push({
      id,
      kind: "bot",
      name: String(hit?.name ?? "") || memberId,
      targetKind: "member",
      targetKey: `${teamId}:${memberId}`,
    });
  }
  if (!picked.length && !virtuals.length) {
    /* ⛔ 11-09：没 @ 时**不再一律报错** —— 默认路由的候选在 `prepareGroupDispatch` 里已经试过了
       （上下文 / 团主理人 / 管理员），走到这里说明一个都没成。文案要把两条出路都说清。 */
    return { targets: [], error: "先 @ 一个伙伴；或者在群设置里设个管理员（没 @ 时由它接话）" };
  }
  const targets = [...picked.filter((m) => !m.muted), ...virtuals];
  if (!targets.length) {
    return { targets, error: `「${picked.map((m) => m.name).join("、")}」已静音，先在群设置里取消静音` };
  }
  const unbound = targets.filter((t) => !t.targetKind || !t.targetKey);
  if (unbound.length) {
    return { targets, error: `「${unbound.map((t) => t.name).join("、")}」还没绑定智能体，去群设置里换成列表里的那一个` };
  }
  return { targets };
}

/** 派活的运行参数（输入框上选的模型/档位/沙箱/审批）。 */
type DispatchParams = { model?: string; effort?: string; sandbox?: string; approvalPolicy?: string; /** 话题内派活：话题起点的原文（只进 prompt，⛔ 不落群消息）。 */ topicRoot?: string };

/** 每次派活的生命周期回调（主进程用它广播进度，面板据此显示/收起「处理中」）。 */
type DispatchPhase = (
  phase: "started" | "finished",
  target: GroupTarget,
  info: { ok?: boolean; error?: string; threadId?: string },
) => void;

/** 落「说的那句话」+ 解析目标（毫秒级，同步段）。
 *
 *  ⛔⛔ 11-07 真机：用户发完消息群里显示「这个群还没有说过话」，过几秒才冒出来 ——
 *    因为整个 dispatch 是"先排后台再返回"，渲染层拿到 ok 立刻重读，那时消息**还没落盘**。
 *    ⇒ 拆成两段：`prepareGroupDispatch`（落盘 + 校验，必须在 handler 里 await 完再返回，
 *       并把权威 rows 一起带回去）+ `runDispatchRounds`（慢的派活，后台跑）。
 *    ⛔ 只有"派活命中了目标"才落盘（解析失败时不要在群里留一句没回应的话）。 */
async function prepareGroupDispatch(
  group: GroupShape,
  text: string,
  memberIds: string[],
  source: "human" | "automation",
): Promise<{ targets: GroupTarget[]; catalog: unknown[]; rows: ReturnType<typeof projectGroupLog> } | { error: string }> {
  /* 团成员名录与互 @ 判据：与渲染层共用同一份目录（⛔ 不各自拉一次）。 */
  const catalog = await buildDispatchCatalog().catch(() => []);
  /* ⛔⛔ 11-09 用户令（两条路由需求）：「无需 @ 成员时可直接发消息」。
     ⇒ 没 @ 任何人时按**同一套优先级**挑一个收件人：
        ① 上下文（上一回合是谁回的）→ ② 专家团群的主理人 / 普通群的管理员。
     ⛔ 只对**用户手发**生效：定时任务（automation）必须显式 @ —— 否则到点会莫名叫起一个人。
     ⛔ 候选逐个试而不是直接取第一个：那个人可能已被移出 / 静音 / 未绑定，退到下一个才符合预期。 */
  let effectiveIds = memberIds;
  /* ⛔⛔ 11-10 用户现场（截图）：把一整段任务书贴进群，里面写着「@落纸 先给选题」「@砚云 写正文」——
     那是**写给模型看的流程**，但渲染层按「正文里的 @ = 派活」把它们全解析成目标
     ⇒ 好几个人同时被唤起，各自读完任务书都判断"这段不是我的活"，
     结果群里只剩「我不抢，我等派单」，谁也不动（实测就停在这里）。
     ⇒ 团群里 @ 团内成员**收敛到团**：由团主理人一个人接单，再由它决定派给谁。
       只有用户**单独** @ 一个团成员（并且没 @ 整团）时才直达他本人。
     ⛔ 普通群（没有团槽）不受影响：那儿 @ 多人就是并行派活，是正当用法。 */
  const teamSlot = group.members.find((m) => m.targetKind === "team");
  if (teamSlot && effectiveIds.length) {
    const kidPrefix = `team:${String(teamSlot.targetKey ?? "")}:`;
    const kids = effectiveIds.filter((id) => id.startsWith(kidPrefix));
    if (effectiveIds.includes(teamSlot.id) || kids.length > 1) {
      effectiveIds = [teamSlot.id];
    }
  }
  let routedBy: "context" | "team-lead" | "admin" | "" = "";
  let routeError = "";
  if (!memberIds.length && source === "human") {
    const rows = projectGroupLog(readStore().messages[group.id] ?? []);
    for (const candidate of defaultRouteCandidates({ group, catalog, rows })) {
      const probe = resolveGroupTargets(group, [candidate.id], catalog);
      if (!probe.error && probe.targets.length) {
        effectiveIds = [candidate.id];
        routedBy = candidate.reason;
        break;
      }
      /* 记住**具体**原因（"已静音""还没绑定"比笼统的"先 @ 一个伙伴"有用） */
      if (!routeError && probe.error) routeError = probe.error;
    }
    if (!routedBy && routeError) {
      return { error: routeError };
    }
  }
  const resolved = resolveGroupTargets(group, effectiveIds, catalog);
  if (resolved.error) return { error: resolved.error };
  const targets = resolved.targets;
  /* 路由到的人要让用户看得见（他并没打 @）：靠 `mentions` 让气泡上出现"投给了谁"的 chip；
     同时给主进程日志留一行，排查"为什么它会回"时有据可查。 */
  if (routedBy) {
    console.log(`[harness-team] 无 @ 默认路由 ⇒ ${routedBy === "context" ? "上下文" : routedBy === "team-lead" ? "团主理人" : "管理员"}：${targets.map((t) => t.name).join("、")}`);
  }
  /* ⛔ 11-09 审查：用户发了新消息 = 「不再想停」⇒ 清掉这个群里这些成员残留的停止请求。
     不清的话，上一条停止请求（会话还在建时登记的，60 秒有效）会把**这条新消息**在队列里
     静默吞掉 —— 表现是「我发了话，没人回，也没有任何提示」。 */
  for (const target of targets) clearTalkCancel(group.id, target.name);
  const saved = await appendMessageTo(group.id, {
    authorId: source === "automation" ? AUTOMATION_ACTOR_ID : "local-user",
    authorKind: "human",
    /* ⛔⛔ 11-07 用户令：定时任务不是「用户发的」⇒ 结构化发送者，群视图据此出徽标。 */
    senderKind: source === "automation" ? "automation" : "user",
    /* ⛔⛔ 11-08 用户令：「前面怎么还自动多一个 @」+「我消息气泡里面以透出来这种效果」——
       正文**不再注入 `@名字`**：群日志里就是用户自己敲的那句话（⛔ 不替他改字），
       "这条 @ 了谁"改由气泡里的**提及 chip**（头像 + 名字）表达，与飞书一致。
       ⛔ 别再补回来：补一次就多一个 @，而且用户完全看不出那是系统加的。
       （结构化目标仍在 `mentions` 里 —— 派活、渲染 chip、运行态都靠它。） */
    text,
    mentions: targets.map((m) => m.id),
  });
  if (!saved.ok) return { error: saved.error || "群消息没存上" };
  return { targets, catalog, rows: saved.rows };
}

/** 派活轮次（慢：一轮可能跑几分钟）。⛔ 调用方一律 `void` 它，不许 await。 */
/* ⛔ 删群 / 自愈 / 派活三处共用的「删引擎会话」：先中断在跑的回合（否则引擎拒绝删），
   删失败降级 archive。模块作用域（`runDispatchRounds` 在 setup 之外，也要用它）。 */
/**
 * ⛔⛔ 11-12 用户令「有残留的话机制就再加强一下，删必须同步清理干净」。
 * 删群时 `thread/delete` 只清引擎会话与 rollout；磁盘上的 **团队运行账本**
 * （`team-runs/<leadThreadId>.json`）与 **线程运行时登记**（`thread-runtime.json`）
 * 原来要等下次启动的反向联动 / 自愈才处理，实测就留下了 6 个账本 + 3 条登记。
 * ⇒ 这里在**同一次删除请求里**同步清掉，⛔ 只清引擎会话确实删成功的那些（删失败的留作重试依据）。
 */
async function cleanupThreadArtifacts(ids: string[]): Promise<{ runs: number; runtime: number; failed: string[] }> {
  const out = { runs: 0, runtime: 0, failed: [] as string[] };
  for (const id of [...new Set(ids)].filter(Boolean)) {
    let ok = true;
    try {
      const r = await teamRunStore.forgetThread(id);
      if (!r.ok) ok = false;
      else if (r.runsFile) out.runs += 1;
    } catch { ok = false; }
    try {
      if (await threadRuntimeStore.remove(id)) out.runtime += 1;
    } catch { ok = false; }
    /* ⛔ 会话工作区 / 角色归属 / 私有记忆也是以 threadId 为键的落盘，
       原来只在 boot 的 thread/deleted 分支里 `void` 异步清 ⇒ 删群当时并未清干净。
       这里同步 await；失败不判整个删除失败（启动对账会兜底补齐）。 */
    const userDataDir = app.getPath("userData");
    try {
      const ws = await removeSessionWorkspace(userDataDir, id);
      const memRoot = ws?.projectRoot || threadCwd.get(id) || "";
      if (memRoot) await clearSessionPrivateMemory(memRoot, id).catch(() => undefined);
    } catch { /* 启动对账兜底 */ }
    try { await forgetRoleSession(userDataDir, id); } catch { /* 启动对账兜底 */ }
    if (!ok) out.failed.push(id);
  }
  /* remove() 只是 scheduleSave()（120ms 合并落盘）⇒ 这里显式 flush，才叫"同一次删除里清干净"。 */
  try { await threadRuntimeStore.flush(); } catch { /* 落盘失败：下次启动的反向联动仍会兜底 */ }
  return out;
}

async function deleteEngineThreads(threadIds: string[]): Promise<{ removed: number; failed: string[] }> {
  let removed = 0;
  const failed: string[] = [];
  for (const tid of [...new Set(threadIds)].filter(Boolean)) {
    try {
      for (const [turnId, owner] of engineActiveTurnIds) {
        if (owner !== tid) continue;
        await server.request("turn/interrupt", { threadId: tid, turnId }).catch(() => undefined);
        break;
      }
      await server.request("thread/delete", { threadId: tid });
      removed += 1;
    } catch {
      try { await server.request("thread/archive", { threadId: tid }); removed += 1; }
      catch { failed.push(tid); }
    }
  }
  /* ⛔⛔ 11-09 用户令：「删群时必须跟着删群里产生的子会话，这个联动必须加强」。
     `thread/delete` 返回成功 ≠ 真的没了（引擎侧正被占用 / 墓碑延迟 / 刚 rename 过的竞态，
     都会出现"调用没抛错，但列表里还挂着"）。⇒ 删完**统一复核一次**：
       仍在 `thread/list`（含归档）里出现的，一律记进 failed —— 台账因此保留，
       下次启动的 `healOrphanTalkThreads` 会再试，而不是让它们变成找不到出处的孤儿会话说。
     ⛔ 复核本身失败**不改变结论**（宁可留台账下次再试，也不要谎报已删干净）。 */
  if (failed.length < threadIds.length) {
    try {
      const alive = new Set<string>();
      for (const archived of [false, true]) {
        const res = (await server.request("thread/list", { limit: 500, archived })) as { data?: Array<{ id?: unknown }> } | null;
        for (const row of res?.data ?? []) {
          const id = String((row as { id?: unknown } | null)?.id ?? "");
          if (id) alive.add(id);
        }
      }
      for (const tid of [...new Set(threadIds)].filter(Boolean)) {
        if (alive.has(tid) && !failed.includes(tid)) failed.push(tid);
      }
    } catch { /* 复核失败：保持原结论 */ }
  }
  return { removed, failed };
}

/** ⛔⛔ 11-11 群聊异步排片的收口：成员全部跑完后，宿主把话头交回主理人。
 *  ⛔ 不落"用户消息"—— 直接走 `runDispatchRounds`（它的 text 只进提示词、不落群日志），
 *     所以群里不会凭空多出一条「用户说：成员交回了…」。
 *  ⛔ 复用群聊串行队列（键 = talkAs）⇒ 主理人上一回合没跑完时这一轮会**排队**，
 *     ⛔ 不会并发 resume 同一条会话（引擎会报 busy）。 */
async function relayLeadAfterMembers(groupId: string, teamId: string, note: string): Promise<void> {
  const group = (readStore().groups ?? []).find((g) => String(g.id) === String(groupId));
  if (!group) return;
  const teams = await readUsableExpertTeams().catch(() => []);
  const team = teams.find((t) => String(t?.teamId) === String(teamId)) as
    | { lead?: { id?: string; name?: string } }
    | undefined;
  const leadId = String(team?.lead?.id ?? "");
  if (!leadId) return;
  const target: GroupTarget = {
    id: teamAuthorIdOf(String(teamId), leadId),
    kind: "bot",
    name: String(team?.lead?.name ?? "") || leadId,
    targetKind: "member",
    targetKey: `${teamId}:${leadId}`,
  };
  await runDispatchRounds(group, [target], note, "automation", { allowChain: true });
}

/** ⛔⛔ 11-11：群聊里这两个调度工具是**异步排片**（工具立刻回「已派单」、成员后台跑、
 *  产出各自进群、全部交回后宿主再请主理人验收）；独立团会话才是"一次性返回全部结论"。
 *  ⛔ 但 schema 是同一份 `buildTeamTools / buildTeamPhaseTool`，描述硬写着"一起返回"——
 *     模型在群里会据此以为活已干完，直接写「收口」或把同一批人再派一遍。
 *  ⇒ 只在群聊工具面上覆写 description（纯函数，⛔ 不动独立团会话那份）。 */
function groupAsyncToolCopy(tool: unknown): unknown {
  if (!tool || typeof tool !== "object") return tool;
  const src = tool as Record<string, unknown>;
  /* ⛔⛔ 11-12 审查发现的真 bug：这段文案原来被追加到**所有**工具上 —— 于是
     `team_plan` / `team_status` / `harness_tools` 的描述里都多了一句"群聊里这是异步派单…"，
     模型读到的就是"查进度=异步派单"这种自相矛盾的说明。⇒ 只对**派活**那两个工具改写。 */
  const name = String(src.name ?? "");
  if (name !== "team_member_invoke" && name !== "team_phase_invoke") return tool;
  const text = String(src.description ?? "")
    .replace("宿主会**并发**跑完它们并把全部结论一起返回",
      "宿主会**并发**在后台跑，群里先收到「已派单」回执，成员产出各自以本人署名发进群，全部交回后宿主再请你验收")
    .replace("并返回结构化结果", "并在后台产出（产出以本人署名发进群）");
  return {
    ...src,
    description: text
      + " ⛔ 群聊里这是异步派单：拿到「已派单」就**不要再说话**（不要复述派给谁、不要报进度），"
      + "不要写「收口」、不要重派同一位、不要代写成员产出。",
  };
}

/** 团群主理人会话的完整工具面 = 群聊三件套 + 团队调度两件（⛔ 与 runDispatchRounds 同一份构造口径）。 */
/** ⛔⛔ 11-12 用户裁定（问「主代理该不该自己能干」→ 选 B）：
 *  **主代理保留完整能力**，只是不许一个人包干。所以工具面里 `buildDelegateHarnessTool()` 保留
 *  —— 它自己可以拟提纲、定标准、查资料、做判断；但**可交付物默认派给成员**，
 *  顺序与分工由「计划先行 + 一次一步」那几条约束（见 buildTeamSystemPrompt 的角色段）。
 *  ⛔ 别再走「把它的能力删光」那条路：那不是分工，是把它变成只会转发消息的空壳。 */
function groupLeadSurfaceOf(team: { teamId: string } & Record<string, any>): unknown[] {
  return [
    ...buildGroupTalkTools(),
    ...withStepParam([buildTeamTools(team as never), buildTeamPhaseTool(team as never), buildTeamPlanTool(), buildTeamStatusTool(), buildDelegateHarnessTool()].map(groupAsyncToolCopy)),
  ] as unknown[];
}

/** ⛔⛔ 11-11：启动时把**已有**团群主理人会话的工具面补到最新（附录 Z：引擎只读 rollout 首行）。
 *  ⛔ 必须在**渲染层 resume 之前**调用（boot 在 createWindow 前调）—— 会话一旦被 spawn，
 *     再改首行本次不生效（下次引擎重启才认），模型就会拿着旧工具面调 → `unsupported call`。
 *  ⛔ 失败静默：预升级不成功也不该挡住启动；首次派活时 `ensureTalkThread` 还会再试一次。 */
export async function upgradeGroupLeadSurfaces(): Promise<void> {
  try {
    if (!codexHome) return;
    const groups = (readStore().groups ?? []) as GroupShape[];
    if (!groups.length) return;
    const teams = await readUsableExpertTeams().catch(() => []);
    let patched = 0;
    let merged = 0;
    for (const group of groups) {
      const slot = group.members.find((m) => m.targetKind === "team");
      if (!slot) continue;
      const team = teams.find((e) => String(e.teamId) === String(slot.targetKey));
      if (!team) continue;
      /* ⛔⛔ 主理人的会话键有两种历史形态：**合成 id**（`team:<team>:<leadId>`，从成员栏 @ 主理人）
         与**整团槽 id**（`tgt:team:<team>`，@ 整团）。⛔⛔ 而且**两种可能同时存在**（真机实证：同一个群
         18:58 建了合成 id 那条、19:56 @ 整团又建了整团槽那条）。
         ⛔⛔ 11-11 用户令「@整团 复用主理人那条，只保留一个承枢」⇒ 先合并台账，再升级工具面。
         合并后 @整团 与 @主理人打的是同一条会话（runOne 的 talkAs 也归一到合成 id）。 */
      const leadKey = teamAuthorIdOf(String(team.teamId), String((team as { lead?: { id?: string } }).lead?.id ?? ""));
      const slotId = String(slot.id);
      if (leadKey && slotId && leadKey !== slotId) {
        const adopted = await adoptTalkThreadAlias(group.id, leadKey, slotId).catch(() => null);
        if (adopted?.dropped) {
          /* 被弃置的是「@整团」那条（含 11-11 跑飞的那一轮）。⛔ 只**归档**不删除 ——
             rollout 是用户自己的记录，删了不可逆；归档可恢复，且侧栏不再并排两条。 */
          await server.request("thread/archive", { threadId: adopted.dropped }).catch(() => undefined);
          merged += 1;
          console.log("[group-tools] 主理人会话已合并：保留 " + String(adopted.threadId).slice(0, 8)
            + "（承枢），归档 " + String(adopted.dropped).slice(0, 8) + "（整团槽那条）");
        }
      }
      /* ⛔ 合并后重读：旧快照里那条已被删的台账行不该再被升级（它已经归档了）。 */
      const ledger = listTalkThreads();
      const keys = new Set([leadKey, slotId].filter(Boolean));
      const rows = ledger.filter((r) => String(r.groupId) === String(group.id) && keys.has(String(r.memberId)));
      if (!rows.length) continue;
      for (const row of rows) try {
        const res = await syncToolSurfaceAsync(codexHome, row.threadId, groupLeadSurfaceOf(team as never));
        if (res?.patched) patched += 1;
      } catch { /* 单条失败不影响其它群 */ }
      /* ⛔⛔ 归属**必须在这里补**：`team_member_invoke` 的执行端只认 teamRunStore（模型自报一律不信），
         而运行期登记是防抖写盘 —— 应用被杀/崩溃时那条可能没落盘（真机已见：功能当场成功，
         重启后 team-threads.json 里没有这个小会话 ⇒ 下一轮工具能调、执行端却报「无法确定所属团」）。
         ⛔ 启动时补一次是确定性的；幂等，重复设同值无害。 */
      for (const row of rows) {
        teamRunStore.setThreadTeam(row.threadId, String(team.teamId));
        teamRunStore.setThreadLead(row.threadId);
      }
    }
    if (patched || merged) {
      console.log("[group-tools] 启动预升级 " + patched + " 个团群主理人会话的工具面"
        + (merged ? "；合并 " + merged + " 组「@整团 / @主理人」双会话" : ""));
    }
  } catch { /* 预升级整体失败：不阻断启动 */ }
}

/** 群里的这位站团队哪一环（主理人 / 团成员）+ 同团还有谁。
 *  数据全来自调度目录（`kind: "team" | "expert" | "member"` 带同一个 `teamId`），⛔ 不再去读团队配置：
 *  群聊域只负责"我是谁、旁边是谁"，要不要按 SOP 走由 `collaborationProtocolLines` 的口径决定。
 *  ⛔ 整团那条 member 的 id 是群成员 id（`targetKind === "team"`）；团成员是合成 id `team:<团队>:<成员>`。 */
function teamSeatOf(
  catalog: unknown[],
  selfId: string,
  targetKind?: string,
  targetKey?: string,
): { teamId: string; teamName: string; teamRole: "lead" | "member"; teamPeers: string[]; teamLeadName?: string; teamLeadProfession?: string } | undefined {
  const rows = (Array.isArray(catalog) ? catalog : []) as Array<Record<string, unknown>>;
  /* ⛔ teamId 有**三种**来源，缺一种就会有成员认不出自己的团：
     ① 群里放的是整团 → `targetKind === "team"`、targetKey 就是 teamId；
     ② 群里的团成员（宿主展开的）→ 合成 id `team:<团队>:<成员>`；
     ③ **用户从 @ 面板单独拉进来的成员/主理人** → targetKind 是 `member`/`expert`，
        身上没有 teamId ⇒ 必须拿 targetKey(=catalog 的 memberId) 回目录反查（11-09 补）。 */
  let teamId = "";
  if (targetKind === "team") teamId = String(targetKey ?? "");
  else if (selfId.startsWith("team:")) teamId = selfId.split(":")[1] ?? "";
  else if (targetKey) {
    const mine = rows.find((r) => String(r.kind) === String(targetKind ?? "") && String(r.memberId) === String(targetKey));
    teamId = String(mine?.teamId ?? "");
  }
  if (!teamId) return undefined;
  const teamRow = rows.find((r) => String(r.kind) === "team" && String(r.teamId) === teamId);
  if (!teamRow) return undefined;
  const leadRow = rows.find((r) => String(r.kind) === "expert" && String(r.teamId) === teamId);
  const memberRows = rows.filter((r) => String(r.kind) === "member" && String(r.teamId) === teamId);
  const label = (r?: Record<string, unknown>) => {
    const name = String(r?.name ?? "").trim();
    if (!name) return "";
    const profession = String(r?.profession ?? "").trim();
    return profession ? `${name}（${profession}）` : name;
  };
  /* 主理人三种形态都要认出来：整团条目 / 合成 id / 单独拉进来的主理人（targetKey = lead.memberId）。 */
  const leadMemberId = String(leadRow?.memberId ?? "");
  const isLead = targetKind === "team"
    || (Boolean(leadMemberId) && selfId === teamAuthorIdOf(teamId, leadMemberId))
    || (Boolean(leadMemberId) && String(targetKey ?? "") === leadMemberId && String(targetKind ?? "") === "expert");
  const peers: string[] = [];
  if (!isLead && leadRow) {
    const text = label(leadRow);
    if (text) peers.push(`主理人 ${text}`);
  }
  for (const row of memberRows) {
    const memberId = String(row.memberId ?? "");
    if (!isLead && leadRow && memberId === String(leadRow.memberId ?? "")) continue;
    if (selfId === teamAuthorIdOf(teamId, memberId)) continue;
    const text = label(row);
    if (text) peers.push(text);
  }
  const teamName = String(teamRow.name ?? "").trim();
  if (!teamName) return undefined;
  /* ⛔ 11-10：主理人的**真名**一起下发 —— 群成员槽的名字是团名（「内容创作专家团」），
     只用它当身份，模型就知道不了「用户 @文枢 是在叫我」。 */
  return {
    teamName,
    /* ⛔ 11-11：把算出来的 teamId 一起下发 —— 团群主理人要拿它挂团队工具、落团队归属，
       ⛔ 不让调用方再从群档案里猜一遍（三种来源只有这里判全了）。 */
    teamId,
    teamRole: isLead ? "lead" : "member",
    teamPeers: peers,
    ...(leadRow?.name ? { teamLeadName: String(leadRow.name) } : {}),
    ...(leadRow?.profession ? { teamLeadProfession: String(leadRow.profession) } : {}),
  };
}

/* ── 任务账本（11-10）：一次 handoff = 一条任务，派出去 open、被确认 done ──────────
   ⛔ 为什么不再用内存 Map：`活还没干完` 是收尾判据的第一依据，重启就忘等于判据失效。
   ⛔ 只保留最近 200 条：任务账本会随对话增长，不裁剪会让文件无限大。 */
const HANDOFF_TIMEOUT_MS = 10 * 60 * 1000;

/* ⛔ 审查修（性能）：原来走 readStore + writeStore ⇒ 每次任务读写都把**全部群消息** normalize 一遍、
   再整份写回。成员每说一句就 2~3 次全量正则在热路径上跑，消息一多就卡。
   现在只解析一次原始 JSON、只替换 tasks 字段，groups / messages 原样带过（⛔ 不解析、不 normalize）。 */
function readTasksRaw(): Record<string, TeamGroupTask> {
  const file = teamsFile();
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return (parsed?.tasks && typeof parsed.tasks === "object" ? parsed.tasks : {}) as Record<string, TeamGroupTask>;
  } catch { return {}; }
}

function writeTasksOnly(tasks: Record<string, TeamGroupTask>): void {
  const file = teamsFile();
  mkdirSync(dirname(file), { recursive: true });
  let base: Record<string, unknown> = { version: 2, groups: [], messages: {} };
  try { base = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>; } catch { /* 新文件 */ }
  base.tasks = tasks;
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(base, null, 2), "utf8");
  renameSync(tmp, file);
}

/**
 * 把「异常」落到具体责任人头上（11-10 用户令「继续补上缺口」）。
 *
 * 实测豆包的做法是**两级触达**：群里发总榜 + 私聊点名「你名下…核是否断货」。
 * 我们这边私聊没有载体（用户就在看群），真正的缺口是**异常发在群里没人认领**。
 * ⇒ 约定一条标记：伙伴报异常时写 `【待处理 · 责任人：某人】`，
 *   宿主把它登记成一条任务（open / toId=那个人），群头进度与收尾判据都能看见"还欠谁一件事"。
 * ⛔ 只解析 bot 产出；⛔ 不阻断落盘（登记失败不许影响消息上屏）。
 */
async function registerResponsibleFrom(groupId: string, entry: Record<string, unknown>): Promise<void> {
  /* ⛔ 解析走纯函数（src/lib/team-duty.mjs）：守卫能真跑，⛔ 不在这里再写一条正则。 */
  const duty = parseDuty(String(entry?.text ?? ""));
  if (!duty) return;
  const name = duty.owner;
  const store = readStore();
  const group = findGroup(store.groups, groupId);
  if (!group) return;
  const flat = (v: unknown) => String(v ?? "").replace(/\s+/g, "");
  const to = group.members.find((m) => flat(m.name) === flat(name));
  if (!to) return;
  const title = duty.title;
  const fromId = String(entry?.authorId ?? "");
  const fromName = String(entry?.authorName ?? "") || "群成员";
  /* ⛔ 去重：同一个人 + 同一个标题前 20 字 + 仍未关闭 ⇒ 不重复登记（否则群头数字会虚高）。 */
  mutateTasks((tasks) => {
    const key = dutyKeyOf(to.name, title);
    const dup = Object.values(tasks).some((t) => t.groupId === groupId && t.status === "open" && dutyKeyOf(t.toName, t.title) === key);
    if (dup) return;
    const id = `rt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    tasks[id] = { id, groupId, title, fromId, fromName, toId: to.id, toName: to.name, status: "open", at: Date.now() };
  });
}

/** 责任人开口了 ⇒ 它名下未关闭的"待处理"自动关闭（这就是闭环，⛔ 不需要人手动勾）。 */
function closeOpenTasksOf(groupId: string, memberId: string): number {
  if (!groupId || !memberId) return 0;
  let closed = 0;
  mutateTasks((tasks) => {
    for (const task of Object.values(tasks)) {
      if (task.groupId !== groupId || task.toId !== memberId || task.status !== "open") continue;
      task.status = "done";
      task.doneAt = Date.now();
      closed += 1;
    }
  });
  return closed;
}

/** 某成员名下还没关闭的待办（按时间升序）—— 注入到它自己的会话里，等于"私聊提醒"。 */
function openDutiesOf(groupId: string, memberId: string): Array<{ title: string; fromName: string; at: number }> {
  if (!groupId || !memberId) return [];
  const tasks = readTasksRaw();
  return Object.values(tasks)
    .filter((task) => task.groupId === groupId && task.toId === memberId && task.status === "open")
    .sort((a, b) => a.at - b.at)
    .slice(0, 8)
    .map((task) => ({ title: task.title, fromName: task.fromName, at: task.at }));
}

function mutateTasks(mutate: (tasks: Record<string, TeamGroupTask>) => void): void {
  const tasks = readTasksRaw();
  mutate(tasks);
  const rows = Object.entries(tasks).sort((a, b) => Number(a[1]?.at ?? 0) - Number(b[1]?.at ?? 0));
  if (rows.length > 200) for (const [id] of rows.slice(0, rows.length - 200)) delete tasks[id];
  writeTasksOnly(tasks);
}

/** 派出去一条任务（A 点了 B）。 */
function openTaskFor(groupId: string, from: { id: string; name: string }, to: { id: string; name: string }, title: string): void {
  if (!groupId || !to?.id) return;
  mutateTasks((tasks) => {
    const id = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    tasks[id] = {
      id, groupId, title: String(title ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
      fromId: String(from?.id ?? ""), fromName: String(from?.name ?? ""),
      toId: String(to.id), toName: String(to.name ?? to.id),
      status: "open", at: Date.now(),
    };
  });
}

/** 某人交了产出 ⇒ 所有派给他的 open 任务算完成。返回完成了几条（判据据此算推进）。 */
function closeTasksFor(groupId: string, toId: string): number {
  let done = 0;
  mutateTasks((tasks) => {
    for (const task of Object.values(tasks)) {
      if (task.groupId !== groupId || task.toId !== toId || task.status !== "open") continue;
      task.status = "done"; task.doneAt = Date.now(); done += 1;
    }
  });
  return done;
}

/** 还在等回话的任务；顺便把超时（10 分钟没回）的关掉 —— ⛔ 不能让"对方崩了"永久挂住整条链。 */
function pendingHandoffsOf(groupId: string) {
  const now = Date.now();
  const store = readStore();
  const open = Object.values(store.tasks ?? {}).filter((x) => x.groupId === groupId && x.status === "open");
  const stale = open.filter((x) => now - Number(x.at ?? 0) > HANDOFF_TIMEOUT_MS);
  if (stale.length) {
    mutateTasks((tasks) => {
      for (const s of stale) { const cur = tasks[s.id]; if (cur && cur.status === "open") { cur.status = "done"; cur.doneAt = now; } }
    });
  }
  return open
    .filter((x) => !stale.includes(x))
    .map((x) => ({ to: x.toId, toName: x.toName, from: x.fromId, at: x.at, state: "pending" as const }));
}

/** 群里还剩几个活没结束（收尾判据用）。 */
function openTaskCountOf(groupId: string): number {
  /* ⛔⛔ 11-10 自查抓到的死循环：原来这里直接数 `status === "open"`，**不排除超时**。
     后果：某个成员崩了 / 一直没回 ⇒ 那条任务永远 open ⇒ 判据永远返回 continue，
     而 continue 又会触发 overBudget 扩容 ⇒ **无限跑下去烧 token**。
     ⇒ 超时的先关掉（和 pendingHandoffsOf 同一口径），再数"真正在等"的。 */
  const now = Date.now();
  const store = readStore();
  const open = Object.values(store.tasks ?? {}).filter((x) => x.groupId === groupId && x.status === "open");
  const expired = open.filter((x) => now - Number(x.at ?? 0) > HANDOFF_TIMEOUT_MS);
  if (expired.length) {
    mutateTasks((tasks) => {
      for (const e of expired) { const cur = tasks[e.id]; if (cur && cur.status === "open") { cur.status = "done"; cur.doneAt = now; } }
    });
  }
  return open.length - expired.length;
}

async function runDispatchRounds(
  group: GroupShape,
  targets: GroupTarget[],
  text: string,
  source: "human" | "automation",
  options: { params?: DispatchParams; allowChain?: boolean; onPhase?: DispatchPhase; catalog?: unknown[] } = {},
): Promise<{ ok: boolean; sent: number; failed: string[] }> {
  const catalog = Array.isArray(options.catalog) ? options.catalog : await buildDispatchCatalog().catch(() => []);
  const failed: string[] = [];
  /* ⛔⛔ 11-10 用户现场（「回两个就没」「懂什么叫沟通交流吗」「根据实时任务来」）：
     原来这里有两道**硬闸**把讨论掐死 ——
       ① `ranIds` 是 Set：**同一位成员一轮只能说一次** ⇒ 主理人说完、成员答完，
          主理人再也叫不回来（它已在 ranIds 里）⇒ 「主理人→成员→主理人→下一位」这条
          最基本的来回永远走不到第二轮；
       ② `chainBudget = 4`：整轮只够 4 次，连三个人各回一次都不够。
     ⇒ 改成**按推进算**：同一位最多 MAX_TURNS_PER_MEMBER 回合（他要能接着被问第二次、第三次），
       总额提到 CHAIN_BUDGET_MANUAL，安全阀仍然是这两个数（防两个伙伴互 @ 无限对烧）。
     ⛔ 不要退回"每人一次"：那正是"回一次就终止"的根源。 */
  const MAX_TURNS_PER_MEMBER = 3;
  /* ⛔ 主持人要多开口：每次轮次推进它都要说话，3 回合不够（11-10）。 */
  const MAX_TURNS_ADMIN = 6;
  const CHAIN_BUDGET_MANUAL = 12;
  /* ⛔ 预算最多续两次（每次 4）—— 再多就该停下来问人，而不是自己一直跑。 */
  const MAX_BUDGET_EXTENSIONS = 2;
  const ranCount = new Map<string, number>();
  /* ⛔ 11-10 用户令「让主理人自己排下一轮」：主持人（管理员）需要更多回合，
     否则它说两三轮就到顶 ⇒ 剩下的人没人调度，链又断。 */
  let adminIdForRounds = "";
  const limitOf = (id: unknown) => (adminIdForRounds && String(id) === adminIdForRounds ? MAX_TURNS_ADMIN : MAX_TURNS_PER_MEMBER);
  const canRun = (id: unknown) => (ranCount.get(String(id)) ?? 0) < limitOf(id);
  const markRan = (id: unknown) => ranCount.set(String(id), (ranCount.get(String(id)) ?? 0) + 1);
  /* 伙伴之间互相 @ 的预算（手动派活才接力；定时任务不递归 —— 无人值守再互 @ 就是烧钱）。 */
  let chainBudget = options.allowChain ? CHAIN_BUDGET_MANUAL : 0;
  /* ⛔⛔ 11-11 真机（用户：「出完方案，主代理人死了吗」「任务都不推进」）：
     团群里主理人一次 @ 多人 ⇒ 宿主按它写的顺序串行跑完，链路就**停在最后一位成员的产出**，
     主理人再也不回来 —— 没有阶段进度、没有验收、没有最终结论，而 UI 的交接台账已 2/2 全 done。
     ⇒ 排片跑完 / 成员交完活，必须把话头交回主理人；只有它有权收口。这两道计数是安全阀。 */
  const MAX_LEAD_CATCH_UPS = 3;
  let leadCatchUps = 0;
  /* ⛔ 主理人自己那一轮「没派任何人、没写收口」时只催办一次（防自循环烧钱）。 */
  const MAX_LEAD_SELF_NUDGES = 1;
  let leadSelfNudges = 0;  /* ⛔ 主持人排片串行执行期间，别让中途某位成员的回合把话头抢回主理人（会把剩下的排片冲散）。 */
  let relayInFlight = false;
  const params = options.params ?? {};
  /* ⛔ 群聊名册：群成员 + 展开的团成员（合成 id）—— 每位都有自己的长期会话，
     所以团成员之间也能互相说话，不再需要「主理人代转」。 */
  /* ⛔ 11-10：管理员身份只有一个真相源（群档案），团群不启用 ⇒ 一律不标。 */
  const isTeamGroup = group.members.some((m) => m.targetKind === "team");
  const teamSlot = isTeamGroup ? group.members.find((m) => m.targetKind === "team") : undefined;
  /* ⛔⛔ 11-11 用户令（「群聊会话仍然拿不到 team_member_invoke，主理人还是靠行首 @名字：派活」）：
     团群主理人必须拿到**真的**调度工具。原来群聊会话的工具面只有 group_say / group_read /
     group_members（01-channel 新建时写死的），主理人拿着"编排整团"的 SOP 却没有调人的工具
     ⇒ 只能把成员发言自己编出来，或者用行首 @ 让宿主代转（那条链只让它说一句话，不算调度）。
     ⇒ ① 建会话时把团队工具挂上去；② 老会话 resume 前改写 rollout 首行（附录 Z）；
       ③ 团队的「线程 → 团」归属落到 teamRunStore（执行端唯一认的真相源）。
     ⛔ 只给主理人：成员拿到就是绕过「只有主理人能调度」的硬闸（执行端会拒，但别白给）。 */
  const groupTeamId = String(teamSlot?.targetKey ?? "");
  const groupTeam = groupTeamId
    ? (await readUsableExpertTeams().catch(() => [])).find((t) => String(t.teamId) === groupTeamId) ?? null
    : null;
  /* ⛔⛔ 11-12 用户裁定 B：主理人保留完整能力（能用 harness 网关自己查、自己拟），
     只是不许一个人包干 —— 那靠「计划先行 + 一次一步」约束，⛔ 不靠删工具。 */
  const leadDispatchTools = groupTeam
    ? withStepParam([buildTeamTools(groupTeam), buildTeamPhaseTool(groupTeam), buildTeamPlanTool(), buildTeamStatusTool(), buildDelegateHarnessTool()].map(groupAsyncToolCopy))
    : [];
  const leadToolNames = groupTeam ? ["team_plan", "team_status", "team_member_invoke", "team_phase_invoke", "harness_tools"] : [];
  /* ⛔ 成员产出落群：`team_member_invoke` 起的是**团队会话**，产出靠 team-group-bridge 回写群；
     不绑 `groupOfTeam(teamId)` 就返回空串 ⇒ 产出静默丢掉（只有主理人看得到工具返回值）。 */
  if (groupTeam) bindTeamGroup(groupTeamId, group.id);
  /* ⛔⛔ 11-12 用户：「管理员设置就不能再展示普通标了」「管理员设置后多了哪些工具联动」。
     管理员升成**群级身份**：团群由团主理人担任（团槽那一行就是管理员），普通群仍是 adminId。
     ⇒ 名册 / group_members / group_say 的「管理员」别名 / 不 @ 时的默认收件人，
       全部读同一个 `adminId`，⛔ 不再"团群恒空"。 */
  const teamSlotMember = group.members.find((m) => m.targetKind === "team");
  const adminId = isTeamGroup
    ? String(teamSlotMember?.id ?? "")
    : String(group.adminId ?? "");
  const roster: TalkMember[] = [
    ...group.members.map((m) => ({
      id: m.id, name: m.name, targetKind: m.targetKind, targetKey: m.targetKey, targetProfession: m.targetProfession,
      ...(adminId && m.id === adminId ? { isAdmin: true } : {}),
      /* ⛔ 11-09：团成员/主理人要拿到"我在团队里的位置"，否则群里只能凭职业名瞎猜分工。 */
      ...(teamSeatOf(catalog, m.id, m.targetKind, m.targetKey) ?? {}),
    })),
    ...teamKidsOf(group, catalog).map((kid) => {
      const memberId = teamMemberIdOf(kid as unknown as Record<string, unknown>);
      const teamId = String(group.members.find((m) => m.targetKind === "team")?.targetKey ?? "");
      const id = teamAuthorIdOf(teamId, memberId);
      return {
        id, name: String(kid.name), targetKind: "member", targetKey: memberId,
        targetProfession: String((kid as unknown as Record<string, unknown>).profession ?? ""),
        ...(teamSeatOf(catalog, id, "member", memberId) ?? {}),
      };
    }),
  ];
  /* ⛔ 11-10：主持人不只是「管理员」—— 团群没有管理员，团主理人就是主持人。
     只认 isAdmin 的话，团群的闭环回喂永远找不到人（管理员为空 ⇒ 链断在成员最后一句）。 */
  /* ⛔ 直属上级：团成员 → 团主理人；普通群 → 群档案里的 managerId。
     ⛔ 自己不能是自己的上级（团主理人没有上级）。 */
  const leadMember = roster.find((m) => m.teamRole === "lead");
  for (const m of roster) {
    if (m.teamRole === "lead") continue;
    const byManager = String((group.members.find((x) => x.id === m.id)?.managerId ?? "")).trim();
    const boss = byManager ? roster.find((x) => x.id === byManager) : leadMember;
    if (boss && boss.id !== m.id) m.managerName = boss.name;
  }
  adminIdForRounds = String(
    roster.find((m) => m.isAdmin === true)?.id
    ?? roster.find((m) => m.teamRole === "lead")?.id
    ?? "",
  );
  const talkOptions = {
    groupId: group.id,
    groupName: group.name,
    cwd: group.workspace || undefined,
    memory: String((group as unknown as Record<string, unknown>).memory ?? ""),
    roster,
    group: group as unknown as Record<string, unknown>,
    catalog,
  };
  /* ⛔ 11-08 用户问「群成员，都能看到群会话内容吗」：群里最近的消息由**这一份**读出，
     既给每轮注入的共享上下文、也给 group_read 工具 —— 两处口径必须同一份，否则模型
     主动读到的与默认看到的会对不上。纯读盘、不写、不联网。 */
  const readGroupHistory = (limit: number): { speaker: string; text: string }[] => {
    const rows = readStore().messages?.[group.id] ?? [];
    return rows.filter(Boolean).slice(-Math.max(1, Math.min(50, limit))).map((raw) => {
      const m = raw as unknown as Record<string, unknown>;
      const authorId = String(m.authorId ?? "");
      return {
        speaker: roster.find((x) => x.id === authorId)?.name ?? (authorId === "local-user" ? "我" : authorId),
        text: String(m.text ?? ""),
      };
    });
  };
  /* 工具 hooks：模型在会话里主动调 group_say(to=名字) ⇒ 这里把话投递进对方会话。 */
  setGroupTalkHooks(group.id, {
    append: (gid: string, entry: Record<string, unknown>) => appendMessageTo(gid, entry),
    relay: (gid: string, fromId: string, fromName: string, toName: string, msg: string) => {
      /* ⛔ 11-10 用户「配套好群聊工具」：group_say(to="管理员") 直接找到管理员，
         不用先查名册再写名字；⛔ 团群不启用管理员 ⇒ 别名查不到，如实回失败。 */
      const aliasAdmin = /^@?\s*(管理员|admin)\s*$/i.test(String(toName));
      const to = aliasAdmin
        ? roster.find((m) => m.isAdmin)
        : roster.find((m) => String(m.name).replace(/\s+/g, "") === String(toName).replace(/\s+/g, ""));
      if (!to) return Promise.resolve({ ok: false, error: `群里没有叫「${toName}」的人` });
      /* ⛔ 11-08 审查确认（真缺陷）：runOne 对**本轮已派过**的成员会静默早退，而工具却回
         「已经说给 X 了」—— 模型以为送达、群里实际没有任何反应（这句只进了群日志）。
         ⇒ 按事实回失败，模型会改口/晚点再说，而不是骗用户。 */
      if (!canRun(to.id)) {
        return Promise.resolve({ ok: false, error: `这位伙伴本轮已经说了 ${MAX_TURNS_PER_MEMBER} 次（到上限了），缓一缓再说` });
      }
      /* ⛔ 11-08 用户（截图：「群成员 伙伴转交」看不出是谁发的）：名册里查不到 id 时用**台账里的名字**兜底，
         ⛔ 不再退化成通用的「群成员」—— 被叫的会话头部与模型都要看到真实发送者。 */
      const from = roster.find((m) => m.id === fromId) ?? { id: fromId, name: String(fromName ?? "").trim() || "群成员" };
      /* ⛔⛔ 11-09 用户：「让团队真正运作起来」——原来是**两条路不一样长**：
         行首 `@名字：` 走 hop=1（再 @ 就不接力了），`group_say` 走 hop=0（能一直接力），
         而且 `group_say` 这条路**不扣预算**。同样是"成员之间沟通"，能走多远却不同 ⇒ 统一：
         两条路都 hop=0（都允许继续接力），但**都扣同一份预算**（`chainBudget`，手动派活 4 次）。
         `ranCount` 再保证同一个人最多 MAX_TURNS_PER_MEMBER 回合 ⇒ 能来回问答，又不会对烧。 */
      if (chainBudget <= 0) {
        return Promise.resolve({ ok: false, error: `这一轮的接力用完了（最多 ${CHAIN_BUDGET_MANUAL} 次）——下一条消息再叫他，或者你自己接着做` });
      }
      chainBudget -= 1;
      /* ⛔ 不 await：工具调用立刻返回，被叫的人稍后自己在群里回话。 */
      void runOne(to as unknown as GroupTarget, 0, { id: from.id, name: from.name }, msg).catch(() => undefined);
      return Promise.resolve({ ok: true });
    },
    /* ⛔ 11-08 用户问「群里超长上下文怎么办」：`group_read` 原来把整段原文塞进工具结果，
       limit=50 碰上长消息时一条回复就能把成员会话撑爆。⇒ 单条截断 + 总量封顶
       （注入口径本来就有 400 字/条，这里对齐工具口径；要看全文让对方重发）。 */
    readMessages: (limit: number) => Promise.resolve((() => {
      const rows = readGroupHistory(limit);
      const out: { speaker: string; text: string }[] = [];
      let used = 0;
      for (const row of rows) {
        const text = row.text.length > 1200 ? `${row.text.slice(0, 1200)}…（已截断，需要全文请让对方重发）` : row.text;
        if (used + text.length > 12_000) break;
        used += text.length;
        out.push({ ...row, text });
      }
      return out;
    })()),
    /* ⛔ 11-10：group_members 要能回答「谁是管理员 / 谁负责什么」。 */
    members: () => Promise.resolve(roster.map((m) => ({
      id: m.id, name: m.name, profession: m.targetProfession,
      admin: m.isAdmin === true,
      role: m.teamRole === "lead" ? "团主理人" : m.teamRole === "member" ? "团成员" : "",
    }))),
  });
  /* ⛔⛔ 11-10 用户令「直接优化到 100 分」：判据要的三样**必须是真值**，不许再写常量。
     · lastOpenTasks 滚动比对 ⇒ 这一轮有没有新任务；
     · idleRounds ⇒ 连续多少轮零推进（用于收尾）；
     · acked ⇒ 这一轮确认掉几条 handoff。 */
  /* ⛔ 工作伙伴群没有任务表（StoreShape 只有 groups + messages）⇒ "未完成的活"只能取两个真值：
     还在等回话的 handoff 数、以及连续多少轮没有任何确认。⛔ 别再写 idleRounds:0 这种假值。 */
  let idleRounds = 0;
  /* ⛔ 续期必须限次：活没干完就续、续完还没完又续 ⇒ 无人值守时会一直烧。 */
  let budgetExtensions = 0;
  const runOne = async (
    partner: GroupTarget,
    hop = 0,
    caller?: { id: string; name: string },
    bodyText = text,

  ): Promise<void> => {
    if (!partner || !canRun(partner.id)) return;
    /* ⛔ 11-08 审查确认：群可能在派活排队期间被删 —— 迟到的 runOne 仍会 ensure 出会话并写回
       已删群的台账 ⇒ 侧栏多一条没有出处的「伙伴」会话（自愈本进程只跑一次，救不回来）。
       ⇒ 开跑前按群档案复核，群没了直接放弃；建完会话后再复核一次（排队那条会晚建）。 */
    if (!readStore().groups.some((g) => String(g.id) === String(group.id))) return;
    markRan(partner.id);
    /* 常驻用量监听（幂等）：本轮之后的用量事件即使晚到，也能补到落盘的那条消息上。 */
    installTalkUsageWatcher();
    const startedAt = Date.now();
    let chars = 0;
    let threadId = "";
    let okFlag = false;
    let errMsg = "";
    /* ⛔ 11-11：可见身份在 try 里按 talkAs 赋值，finally 收尾还要用 ⇒ 声明必须在 try 之外。 */
    let speakerId = partner.id;
    let speakerName = partner.name;
    /* 群聊流式广播（见下）：回合结束后必须摘监听 + 发 finished。 */
    let liveThreadId = "";
    let talkDelta: ((event: any) => void) | null = null;
    /* ⛔ 11-08 审查优化：每一轮派活有**显式代次**（成员 + 起跑时刻）。
       渲染层按它认卡：finished 只摘自己那一轮，接力/排队的新卡不会被误删
       （⛔ 不再只看时间戳先后，两个窗口的时钟/迟到事件都不参与判定）。 */
    const runId = `${partner?.id ?? ""}:${startedAt}`;
    /* 11-08：本回合 token 用量（与主对话页脚一致；引擎 thread/tokenUsage/updated 的 last 桶）。 */
    let liveUsage: { inputTokens: number; outputTokens: number; cachedTokens: number; totalTokens: number } | null = null;
    /* 落盘那一刻是否已把用量写进消息（false ⇒ 收尾再补一次，防事件卡在 append 与 finally 之间）。 */
    let usageWritten: boolean | null = null;
    let wroteMessage = false;
    /* ⛔⛔ 11-09 用户令（两条：「现在每个正文输出一个新消息有点刷屏」「图二效果一模一样，直接把主对话那一套接过来」）：
       撤回 11-08 的「每条 agentMessage 落一条群消息」——**一个回合只落一条成品消息**（= 主对话的一轮），
       过程/正文/文件卡由渲染层按**回合**整体渲染（群视图直接复用主对话的 TurnView）。
       ⛔ 运行中仍然逐字上屏（走 group-talk-live delta 的流式卡），只是不再把每条正文写成独立群消息。 */
    /* 本轮开始时的「清空代际」：中途用户清空聊天记录 ⇒ 后续落盘全部丢弃（与收尾落盘同一判据）。 */
    const clearedMark = groupClearedAt.get(group.id) ?? 0;
    try {
      /* ⛔⛔ 11-07 用户令：群聊走**独立通道**。这里给成员的是「群里有人对你说了一句」，
         不是任务派发：不注入 groupContextBlock 的协作协议、不调 runDelegatedTask、
         不产生「被调度会话」和它那套「没有调度权限」的会话级指令。 */
      const fromTalk: TalkMember = caller
        ? { id: caller.id, name: caller.name }
        : (source === "automation" ? { id: AUTOMATION_ACTOR_ID, name: "定时任务" } : { id: "local-user", name: "我" });
      /* ⛔ 每轮都重读群日志：接力到第 2 跳时，前面那位刚说的话已经在群里了，
         不重读就等于「后来的人看不到前面人说了什么」——正是成员之间接不上话的根因。 */
      /* ⛔ 11-10：群记忆按「群类型 + 这个人的座位」现算 —— 团群给团级规则优先、
         平级专家群把互相矛盾的结论摆出来、CLI 群只给纯文本片段（它读不了文件）。
         座位从 roster 取（partner 只是派活目标，没有 teamRole/isAdmin）。 */
      const seatSelf = roster.find((m) => String(m.id) === String(partner.id));
      /* ⛔⛔ 11-11：判「这位是不是本团主理人」**不能只靠 catalog 的座位推断** —— `teamSeatOf` 要求
         调度目录里有 `kind:"team"` 那一行，缺一行（团被改过名 / 目录没刷新）整条就断，
         结果是「工具面静默不挂、模型调就 unsupported call」，比报错更难查（真机已踩一次）。
         群里的**整团槽本身就是主理人**（`prepareGroupDispatch` 把团群 @ 收敛到它，语义同源）⇒ 按 id 判。
         座位字段（teamRole / teamName）仍优先取 catalog 的，取不到用团队配置兜底。 */
      /* ⛔ 注意两种 id：用户 @ 成员栏里的「主理人」⇒ partner.id = `team:<team>:<leadId>`（合成 id）；
         @ 整团槽 ⇒ partner.id = `tgt:team:<team>`。⛔ 只判整团槽 = 主流路径永远不挂工具（真机踩过）。 */
      const leadAuthorId = groupTeam ? teamAuthorIdOf(String(groupTeam.teamId), String(groupTeam.lead?.id ?? "")) : "";
      const isLeadSeat = seatSelf?.teamRole === "lead"
        || Boolean(teamSlot && String(partner.id) === String(teamSlot.id))
        || Boolean(leadAuthorId && String(partner.id) === leadAuthorId);
      const partnerTools = isLeadSeat ? leadDispatchTools : [];
      const partnerToolNames = isLeadSeat ? leadToolNames : [];
      /* ⛔⛔ 11-11 用户令「@整团 与 @主理人复用同一条会话，只保留一个承枢」：
         整团槽 `tgt:team:<团>` 只是**派活入口**，真正说话的人是主理人 ⇒ 引擎会话身份归一到
         主理人的合成 id。⛔ 派活目标（partner.id）一律不动 —— 界面那一行、任务账本、消息 authorId
         仍按原样走，只有"用哪条会话"这一层统一。 */
      const talkAs = isLeadSeat && leadAuthorId ? leadAuthorId : "";
      /* ⛔⛔ 落到群里的「发言人」也必须是这个人：@ 整团时原来的 authorId / 流式卡的 memberId 用的是
         整团槽 id ⇒ 群里同一个承枢有两个身份（两个头像、@ 到的是另一个 id、任务账本也分裂）。
         ⛔ 用 talkAs 归一（没归一需求的成员 talkAs 为空 ⇒ 行为不变）。 */
      speakerId = talkAs || partner.id;
      const leadDisplayName = String((groupTeam as { lead?: { name?: string } } | null)?.lead?.name ?? "");
      speakerName = talkAs && leadDisplayName ? leadDisplayName : partner.name;
      /* ⛔ `partner` 只是派活目标（GroupTarget），没有 teamRole / teamName / isAdmin ⇒ 原来
         buildTalkInput 里「你在团队里的位置」「你是主持人」两段**永远不生效**（主理人不知道自己是谁）。
         座位信息 roster 里已经算好，这里合并进去；⛔ id / name 仍以 partner 为准（别被 roster 改掉）。 */
      const me: TalkMember = {
        ...(partner as TalkMember),
        ...(seatSelf ?? {}),
        id: partner.id,
        name: partner.name,
        ...(isLeadSeat && groupTeam
          ? { teamRole: "lead" as const, teamName: groupTeam.displayName.zh, teamId: String(groupTeam.teamId) }
          : {}),
        ...(partnerToolNames.length ? { dispatchTools: partnerToolNames, harnessGateway: true } : {}),
      };
      /* 真机排障用：主理人这一轮到底挂没挂团队工具（⛔ 不刷屏，只在团群主理人回合打一条）。 */
      if (isLeadSeat) {
        console.log("[group-tools] 主理人「" + partner.name + "」工具面："
          + (partnerTools.length ? "已挂 " + partnerToolNames.join("/") : "⛔ 没挂（groupTeam=" + Boolean(groupTeam) + "）"));
      }
      const groupMemory = await buildGroupMemoryBlock({
        workspace: group.workspace || undefined,
        group,
        seat: seatSelf?.isAdmin ? "admin" : seatSelf?.teamRole === "lead" ? "lead" : partner.targetKind === "cli" ? "cli" : "member",
        query: bodyText,
      }).catch(() => null);
      const query = buildTalkInput(
        talkOptions as Parameters<typeof buildTalkInput>[0],
        me,
        fromTalk,
        bodyText,
        readGroupHistory(TALK_HISTORY_LIMIT),
        /* ⛔ 11-09 用户令：「里面的 agent 必须知道自己在话题里面」——
           话题内派活带 root 原文，prompt 里就会有一段「你在话题里 + 重要内容怎么汇报到群主流」。 */
        params.topicRoot ? { rootText: String(params.topicRoot) } : null,
        groupMemory?.text ?? null,
        /* ⛔ 私聊 = 它自己的会话：把名下待办直接摆到眼前（用户令「我们的私聊就是那个来源对话」）。 */
        openDutiesOf(group.id, speakerId),
      );
      /* ⛔⛔ 11-09 用户令「必须要真的 cli 智能体」：CLI 成员接真链路 ——
         角色提示词（命令引擎去跑本机 bin / 没装就如实报没装）拼在输入最前，
         shell 环境（PATH + 供应商/Key/模型）注入会话，子进程才真的拿得到 CLI 与配置。
         ⛔ 非 CLI 成员 planTalkCli 返回 null，完全走旧路径。 */
      const cliPlan = await planTalkCli(partner as TalkMember);
      /* ⛔⛔ 11-09 用户令「直接本地 CLI 回复，不要转交/代跑」：CLI 成员**完全绕过引擎会话** ——
         群消息直接喂本机 CLI 的单轮非交互命令，CLI 的 stdout 就是这位成员的群回复；
         没装就如实回「本机没有安装 X + 安装入口」，绝不拿主会话模型顶替。
         ⛔ 非 CLI 成员 cliPlan=null，走下面旧的引擎会话路径，零影响。 */
      if (cliPlan) {
        const liveId = `cli:${group.id}:${partner.id}`;
        options.onPhase?.("started", partner, {});
        broadcastHarnessEvent({ type: "group-talk-live", phase: "started", groupId: group.id, memberId: speakerId, name: speakerName, threadId: liveId, runId, at: Date.now() } as never);
        const res = cliPlan.installed
          ? await queueTalkDelivery(group.id, partner.id, () => runTalkCliDirect(cliPlan.cli, String(bodyText ?? "").trim() || query, {
            scopeId: `${group.id}::${partner.id}`,
            cwd: group.workspace || undefined,
            shellEnv: cliPlan.shellEnv,
            onDelta: (text) => broadcastHarnessEvent({ type: "group-talk-live", phase: "delta", groupId: group.id, memberId: speakerId, name: speakerName, threadId: liveId, runId, text, at: Date.now() } as never),
          }))
          : { ok: true, text: cliPlan.text };
        chars = query.length + res.text.length;
        const clearedDuringRun = (groupClearedAt.get(group.id) ?? 0) > clearedMark;
        let wrote: { ok: boolean; error?: string } = { ok: true };
        /* ⛔ 跑到一半群被解散：不再往已删除的群写孤儿消息（群日志键会留下来）。 */
        const groupGone = !readStore().groups.some((g) => String(g.id) === String(group.id));
        if (!clearedDuringRun && !groupGone) {
          wrote = await appendMessageTo(group.id, {
            authorId: speakerId,
            authorKind: "bot",
            senderKind: "member",
            /* 合成 id：CLI 直跑没有引擎会话；用 `cli:` 前缀让渲染层知道"无来源会话/无回合"。 */
            threadId: `cli:${group.id}:${partner.id}`,
            text: res.text || "（CLI 没有输出）",
            via: caller ? { memberId: caller.id, name: caller.name } : null,
            runId,
            runFirst: true,
            summary: true,
          });
        }
        wroteMessage = !clearedDuringRun && Boolean(wrote.ok);
        okFlag = Boolean(wrote.ok) && res.ok;
        if (!wrote.ok) { errMsg = wrote.error || "产出没能写进群聊记录"; failed.push(`${partner.name}：${errMsg}`); }
        broadcastHarnessEvent({ type: "group-talk-live", phase: "finished", groupId: group.id, memberId: speakerId, name: speakerName, threadId: liveId, runId, at: Date.now() } as never);
        options.onPhase?.("finished", partner, { ok: okFlag, error: errMsg || undefined, threadId: "" });
        return;
      }
      /* ⛔ 保留团 → 群的绑定（团成员若仍由 team_member_invoke 起，产出照样落群）。 */
      if (partner.targetKind === "team") bindTeamGroup(partner.targetKey, group.id);
      /* ⛔ 11-08 用户实测「过程半天才出来」：成员会话建立（thread/start+改名）本身要 1~3 秒，
         这段时间界面原来什么都不显示。⇒ 「运行中」先报（busy 立刻亮），threadId 由 group-talk-live 补。 */
      options.onPhase?.("started", partner, {});
      /* ⛔⛔ 11-08 用户实测（「谁在运行一点反馈都没有」「回复了就要立刻看到」）：
         群聊回合也要像主对话一样**逐字上屏**。先**只读探测**这位成员的会话（⛔ 绝不在这里新建 ——
         探测式新建正是"同一位成员两条会话"的来源），再订阅它的 agentMessage 增量。
         会话正忙（上一轮还没跑完）时先不挂：排队后的那一轮会自己把内容发进群。 */
      const liveThread = await peekTalkThread(group.id, partner as TalkMember, {
        sandbox: params.sandbox,
        approvalPolicy: params.approvalPolicy,
        /* ⛔ 探测到的会话就是这一轮要用的那条（拿到 threadId 后不再 ensure）⇒ 升级口必须在这里。 */
        ...(partnerTools.length ? { extraTools: partnerTools } : {}),
        ...(talkAs ? { talkAs } : {}),
      }).catch(() => null);
      /* ⛔⛔ 11-08 用户令「跟主对话实时同步」：监听器必须在**会话已确定**时就挂上 ——
         新建会话（首条消息）时 peek 拿不到 threadId，原来整轮都没有流式事件（只能收尾一次性落盘）。
         ⇒ `attachLive(tid)` 在「探测到空闲」与「队列内 ensure 完」两处调用。 */
      const attachLive = (tid: string) => {
        if (!tid || liveThreadId) return;
        liveThreadId = tid;
        /* ⛔⛔ 11-11：主理人的群聊会话**就是**团队主理人会话 —— 必须落「线程 → 团」归属。
           否则 team_member_invoke 的执行端（team-tool-fallback → invokeTeamMemberCore）会以
           「无法确定会话所属的专家团」「当前会话是子会话，没有调度权限」拒掉。
           ⛔ 这是执行端**唯一**认的真相源（模型自报的 teamId 一律不信）。 */
        if (partnerTools.length && groupTeam) {
          teamRunStore.setThreadTeam(tid, groupTeam.teamId);
          teamRunStore.setThreadLead(tid);
        }
        /* ⛔ 团队成员的会话按主理人会话的 cwd 建（invokeTeamMemberCore 用 threadCwd）。
           群聊会话不登记 ⇒ 成员会话落到 process.cwd()（应用安装目录）⇒ 产物写错地方。 */
        if (String(group.workspace ?? "").trim()) threadCwd.set(tid, String(group.workspace).trim());
        /* 上一轮的收尾标记在本轮开跑时摘掉（否则中途 group_say 那条会被当成收尾后补写、用量挂两遍）。 */
        finishedTalkRuns.delete(tid);
        broadcastHarnessEvent({ type: "group-talk-live", phase: "started", groupId: group.id, memberId: speakerId, name: speakerName, threadId: liveThreadId, runId, at: Date.now() } as never);
        let lastTickAt = 0;
        talkDelta = (event: any) => {
          if (event?.kind !== "notification") return;
          const p = event.params ?? {};
          if (String(p.threadId ?? "") !== liveThreadId) return;
          const method = String(event.method ?? "");
          if (method === "thread/tokenUsage/updated") {
            const hit = usageFromTokenEvent(event);
            if (hit) liveUsage = hit.usage;
            return;
          }
          if (method === "item/started") {
            const item = p.item ?? null;
            if (item && String(item.type ?? "") === "agentMessage") {
              /* 新一条正文开始：让流式卡清空（否则整回合的文字会叠在卡里和已落盘消息重复）。 */
              broadcastHarnessEvent({ type: "group-talk-live", phase: "item-start", groupId: group.id, memberId: speakerId, name: speakerName, threadId: liveThreadId, runId, itemId: String(item.id ?? ""), at: Date.now() } as never);
            }
            /* 继续走下面 tick（过程块要跟着刷新） */
          }
          if (method === "item/completed") {
            const item = p.item ?? null;
            if (item && String(item.type ?? "") === "agentMessage") {
              const itemId = String(item.id ?? "");
              broadcastHarnessEvent({ type: "group-talk-live", phase: "item-done", groupId: group.id, memberId: speakerId, name: speakerName, threadId: liveThreadId, runId, itemId, at: Date.now() } as never);
            }
          }
          if (method === "item/agentMessage/delta") {
            const delta = String(p.delta ?? "");
            if (delta) broadcastHarnessEvent({ type: "group-talk-live", phase: "delta", groupId: group.id, memberId: speakerId, name: speakerName, threadId: liveThreadId, runId, text: delta, at: Date.now() } as never);
            return;
          }
          /* ⛔ 11-08 用户令「跟主对话完全一致」：过程块不再 2.5s 轮询 ——
             成员回合里任何 item/turn 事件都通知渲染层重拉（200ms 合并，防工具输出高频刷屏）。 */
          if (!/^item\//.test(method) && !/^turn\//.test(method)) return;
          const now = Date.now();
          if (now - lastTickAt < 200) return;
          lastTickAt = now;
          broadcastHarnessEvent({ type: "group-talk-tick", groupId: group.id, memberId: speakerId, threadId: liveThreadId, method, at: now } as never);
        };
        server.on("event", talkDelta);
      };
      if (liveThread && !liveThread.busy) attachLive(liveThread.threadId);
      /* ⛔ 11-08 审查：模型 / 沙箱 / 审批档原来在这里被丢掉（只传了 effort）⇒ 群输入框三个控件全是死的。
         群聊会话与主对话同口径：模型逐回合下发、沙箱与审批档建/复会话时落、审批档再逐回合兜一次。 */
      /* ⛔⛔ 11-08 用户令「查一下 resume 失败后重复会话的问题」：同一成员的消息**串行投递** ——
         引擎不允许 resume/并行回合正在跑的会话，旧代码撞上就新建一条（重复会话）或直接失败。
         排队后第二条会等第一条跑完再 ensure + turn；超时也从**真正开跑**时算（⛔ 不含排队等待）。 */
      /* ⛔ 串行键也用会话身份：@整团 与 @主理人打的是同一条会话，⛔ 两个键各排一条队列
         就会并发 resume 同一条 ⇒ 引擎报 busy / 直接失败。 */
      const res = await queueTalkDelivery(group.id, talkAs || partner.id, async () => {
        /* ⛔ 11-08 用户实测（点停止报「还没有它的会话」）：排队期间用户点了停止 ⇒
           建会话/开跑之前就放弃（别发出那条不该存在的消息）。 */
        if (consumeTalkCancel(group.id, partner.name)) {
          return { ok: false, cancelled: true, text: "", threadId: "" } as never;
        }
        if (!liveThreadId) {
          const ensured = await ensureTalkThread(group.id, partner as TalkMember, {
            cwd: group.workspace || undefined,
            groupName: group.name,
            sandbox: params.sandbox,
            approvalPolicy: params.approvalPolicy,
            ...(partnerTools.length ? { extraTools: partnerTools } : {}),
            ...(talkAs ? { talkAs } : {}),
          }).catch(() => null);
          if (ensured?.threadId) attachLive(ensured.threadId);
          /* ⛔ 11-09 审查：建会话要 1~3 秒 —— 排队入口那次消费之后、会话建好之前用户点了停止，
             到这里才看得到。补这一次消费，真正放弃这一轮（否则「已停止」但消息照样发出）。 */
          if (consumeTalkCancel(group.id, partner.name)) {
            return { ok: false, cancelled: true, text: "", threadId: "" } as never;
          }
        }
        return withDispatchTimeout(runTalkTurn(group.id, partner as TalkMember, query, {
          cwd: group.workspace || undefined,
          groupName: group.name,
          /* ⛔ 探测到空闲会话就交给它，runTalkTurn 不再 resume 第二遍。 */
          ...(liveThreadId ? { threadId: liveThreadId } : {}),
          ...(params.model ? { model: params.model } : {}),
          ...(params.effort ? { effort: params.effort } : {}),
          ...(params.sandbox ? { sandbox: params.sandbox } : {}),
          ...(params.approvalPolicy ? { approvalPolicy: params.approvalPolicy } : {}),
          ...(partnerTools.length ? { extraTools: partnerTools } : {}),
          ...(talkAs ? { talkAs } : {}),
        }), partner.name, partnerTools.length ? LEAD_DISPATCH_TIMEOUT_MS : undefined);
      });
      if ((res as { cancelled?: boolean } | null)?.cancelled) {
        options.onPhase?.("finished", partner, { ok: true });
        return;
      }
      if (!res?.ok || !res?.threadId) {
        errMsg = "群聊会话没起来";
        failed.push(`${partner.name}：${errMsg}`);
        options.onPhase?.("finished", partner, { ok: false, error: errMsg });
        return;
      }
      threadId = res.threadId;
      /* 排队后才知道真实 threadId 的那一轮：同样摘掉上一轮的收尾标记（见上面的注释）。 */
      finishedTalkRuns.delete(threadId);
      /* 排队期间群被删 ⇒ 刚建出来的会话没人要了：删掉它、清台账并放弃落盘
         （⛔ 只删引擎会话会留下一条指向死会话的台账 ⇒ 侧栏还挂「伙伴」标签）。 */
      if (!readStore().groups.some((g) => String(g.id) === String(group.id))) {
        void deleteEngineThreads([threadId]);
        if (forgetTalkThreads([threadId])) broadcastHarnessEvent({ type: "team-talk-threads-changed", at: Date.now() } as never);
        return;
      }
      const output = String(res.text ?? "").trim();
      chars = query.length + output.length;
      /* ⛔ 清空发生在这一回合开始之后 ⇒ 只结算、不落盘（运行照跑完、账照记，11-06 口径）。 */
      const clearedDuringRun = (groupClearedAt.get(group.id) ?? 0) > clearedMark;
      /* ⛔ 11-08 用户实测（「成员消息为啥重复」）：成员一回合里既调了 group_say（已把回复发进群）、
         又写了最终回复 —— 两条都落盘就是群里两份。这一回合已通过工具说过话、且最终回复与它高度重合 ⇒ 不再重复落盘。 */
      /* ⛔ 11-10：一份群日志只读一次，同回合判重与代码层硬约束共用 groupRows。 */
      const groupRows = (readStore().messages?.[group.id] ?? []) as Array<{ id?: string; authorId?: string; authorKind?: string; text?: string; at?: number }>;
      const spokenRows = groupRows
        .filter((row) => String(row.authorId ?? "") === speakerId && Number(row.at ?? 0) >= startedAt)
        .map((row) => ({ id: String(row.id ?? ""), text: String(row.text ?? "") }));
      /* ⛔⛔ 11-10 用户令「不能光靠模型自觉」：硬约束在**每条产出的唯一收口**生效。
         边界（10-26 事故）：只硬拦动作、把事实摆出来；⛔ 不加定时器/巡检/自动催办，
         ⛔ 不替模型判断「写得好不好、该不该做」——那是模型的事，宿主越权只会刷屏。 */
      const guard = evaluateMemberOutput({
        text: output,
        recentRows: groupRows,
        /* 本回合自己通过 group_say 已落的那条由上面的同回合判重处理，别重复记账。 */
        excludeIds: new Set(spokenRows.map((row) => row.id)),
        rosterNames: [...roster.map((m) => m.name), "管理员"],
        selfName: partner.name,
      });
      /* 只有汇报行时 mainText 为空 ⇒ 不落一条占位正文（汇报行下面单独发）。 */
      const outputForStore = guard.announcements.length ? guard.mainText : (guard.mainText || output);
      const duplicateRow = spokenRows.filter((row) => row.text && textsAreNearDuplicate(row.text, output)).at(-1) ?? null;
      const duplicated = Boolean(duplicateRow);
      /* 用量：本轮 live 捕获优先；没赶上就用常驻缓存（限本轮之后）—— 都拿不到就不写页脚。 */
      const usageForMessage = liveUsage ?? talkUsageFor(threadId, startedAt);
      /* ⛔⛔⛔ 11-12 用户（连着两条）：「硬伤就是主代理和管理员，光靠自己一个人框框框框输出」。
         根因不是提示词不够狠，而是**宿主从不拦**：主理人这一轮一件活都没派，却写了一大篇成品，
         宿主照单落群 —— 用户看到的就是"它一个人把活全干了"，成员形同虚设。
         ⇒ 硬闸（只拦这一种动作，⛔ 不判断写得好不好）：
           团群里 · 说话的是主理人 · 这一轮没调任何团队工具 · 输出 ≥400 字且像成品
           （有标题 / 代码块 / ≥4 个列表项）· 用户那句不是提问
           ⇒ **不落群**，回喂一条纠偏要它拆成任务派出去。
         ⛔ 每个会话只纠偏一次（防自循环）；⛔ 问句/寒暄不拦（那是正常对话）。 */
      let wrote: { ok: boolean; error?: string } = { ok: true };
      if (clearedDuringRun) {
        wrote = { ok: true };
      } else if (duplicateRow) {
        /* 最终回复已经通过 group_say 落过 ⇒ 不再发第二条；把它标成 summary 并回填用量
           （文件卡 / 页脚挂在收尾那条上 = 一轮的唯一一条）。 */
        if (duplicateRow.id) {
          const patched = await patchTalkMessageRow(group.id, duplicateRow.id, {
            summary: true,
            ...(usageForMessage ? { usage: usageForMessage } : {}),
          });
          wrote = patched ? { ok: true } : { ok: false, error: "产出没能写进群聊记录" };
        }
      } else if (!guard.mainText && guard.announcements.length) {
        /* ⛔ 只有汇报行：不落占位正文、不假装"有成品消息"，汇报行下面单独发进群主流。 */
        wrote = { ok: true };
      } else {
        wrote = await appendMessageTo(group.id, {
          authorId: speakerId,
          authorKind: "bot",
          senderKind: "member",
          /* ⛔ 11-12：群聊 @ 链同样要写下游收件人 —— 否则成员交回后群里看不到"交给谁"，
             主理人也未必被叫醒。⛔ 主理人自己那两条 id（整团槽 / 合成 id）都不标。 */
          ...(isTeamGroup && leadAuthorId && speakerId !== leadAuthorId
            && speakerId !== String(teamSlot?.id ?? "") ? { handoffTo: leadAuthorId } : {}),
          threadId,
          text: outputForStore || "（没有返回文本内容）",
          via: caller ? { memberId: caller.id, name: caller.name } : null,
          /* 一个回合只落这一条（收尾），渲染层按回合渲染过程 / 正文 / 文件卡。 */
          runId,
          runFirst: true,
          summary: true,
          ...(usageForMessage ? { usage: usageForMessage } : {}),
        });
      }
      usageWritten = Boolean(usageForMessage);
      wroteMessage = !clearedDuringRun && !duplicated && Boolean(wrote.ok) && Boolean(outputForStore);
      /* ⛔ 空产出原来会落一句「（没有返回文本内容）」并算成功 ⇒ 用户以为任务做完了。 */
      okFlag = Boolean(wrote.ok) && guard.countsAsOutput;
      if (!guard.countsAsOutput) {
        errMsg = "这一轮没有返回任何正文";
        failed.push(`${partner.name}：${errMsg}`);
      }
      /* ⛔⛔ 11-10：补上 prompt 早就承诺、代码却没做的「汇报行额外发到群主流」。
         主产出去掉汇报行后落盘 ⇒ 其余内容仍归话题；汇报单独一条带前缀 ⇒ 分组判据让它在主流独立显示。
         ⛔ 不合并、不改写、作者仍是这位成员；⛔ 一条汇报一条消息，最多靠 prompt 约束行数。 */
      if (!clearedDuringRun && wrote.ok) {
        for (const body of guard.announcements) {
          await appendMessageTo(group.id, {
            authorId: speakerId,
            authorKind: "bot",
            senderKind: "member",
            threadId,
            text: `【群里汇报】${body}`,
            via: caller ? { memberId: caller.id, name: caller.name } : null,
            runId,
          }).catch(() => undefined);
        }
      }
      /* ⛔ 无效 @ 原来静默失效（一行第二个 @ 被丢 / 点了不存在的人没反应 / 点了自己）。
         ⇒ 明确回执，每条产出最多一条（runOne 只评估一次），不刷屏；⛔ 只陈述事实不替模型改口。 */
      const mentionNotices = [
        guard.mentionIssues.multiple.length ? `${guard.mentionIssues.multiple.length} 行写了多个 @（只有第一个会生效）` : "",
        guard.mentionIssues.unknown.length ? `群里没有：${guard.mentionIssues.unknown.join("、")}` : "",
        guard.mentionIssues.self.length ? `点到了自己：${guard.mentionIssues.self.join("、")}` : "",
      ].filter(Boolean);
      if (mentionNotices.length && !clearedDuringRun) {
        await appendMessageTo(group.id, {
          id: `sys-guardrail:${runId}`,
          authorId: "system",
          authorKind: "bot",
          senderKind: "system",
          text: `${partner.name} 的回复有 ${mentionNotices.length} 处 @ 没生效：\n${mentionNotices.map((n) => `· ${n}`).join("\n")}`,
        }).catch(() => undefined);
      }
      if (!wrote.ok) {
        errMsg = wrote.error || "产出没能写进群聊记录";
        failed.push(`${partner.name}：${errMsg}`);
      }
      /* ⛔ 11-10：这条产出就是"回了"——把所有等他的 handoff 标 done（成败都算回了）。 */
      const ackedThisTurn = closeTasksFor(group.id, partner.id);
      /* ⛔ 只留 idleRounds：progressTotal 原来只加不读，是死变量（审查发现）。 */
      idleRounds = ackedThisTurn > 0 ? 0 : idleRounds + 1;
      options.onPhase?.("finished", partner, { ok: okFlag, error: errMsg || undefined, threadId });
      /* ⛔ 11-10 硬闸：与群里已有结论近重复的产出**不再拉起一串人**（防刷屏式接力）。 */
      if (hop === 0 && chainBudget > 0 && okFlag && output && guard.allowRelay) {
        const queue: Array<{ next: GroupTarget; ask: { ask: string } }> = [];
        const asks = parseAgentMentions(output, group, {
          excludeId: partner.id,
          alreadyRan: [...ranCount.entries()].filter(([, n]) => n >= MAX_TURNS_PER_MEMBER).map(([id]) => id),
          max: chainBudget,
          catalog,
        });
        for (const ask of asks) {
          const next = (ask.target ?? group.members.find((m) => m.id === ask.memberId)) as unknown as GroupTarget | undefined;
          if (!next || !canRun(next.id)) continue;
          /* ⛔⛔ 11-07 真机：同一位团成员被**派了两次**（群里两条几乎一样的自我介绍，同一会话跑了两轮）。
             根因：主理人回复里行首 @ 了四位成员 —— 它自己在回合内已经用 `team_member_invoke` 派过一遍，
             宿主又按"行首点名"重派一遍。
             ⇒ 主理人（team）@ 的**团成员**交给它自己的工具去编排；宿主只接力"非团成员"目标
               （别的专家 / 子智能体 / 另一个团）。团成员之间的互 @ 仍由成员那条回合触发（下面照走）。
             ⛔ 不要把这一条删掉换成"靠主理人自觉"：重复一次就是双倍 token + 群里两条一样的消息。 */
          /* ⛔⛔ 11-08 真机「成员之间艾特不回复」的**第二个根因**：这里原本直接跳过
             「团队 @ 团成员」，理由是"主理人回合内已用 team_member_invoke 派过一遍"。
             但群聊这条链走的是 `runTalkTurn` —— 那个会话的工具面里**没有** team_member_invoke
             （只有 group_say / group_read 那套）⇒ 主理人在群里 `@构梁：…` 永远没人接。
             ⇒ 改成**按事实判重**：这一轮里如果那位成员已经自己发过话（60s 内），才跳过；
               否则照常把他的这半句投递过去（这才是"成员之间互相沟通"）。 */
          /* ⛔⛔ 11-08 审查：判重窗口必须是**本轮开始之后**（之前一分钟也算 = 上一轮刚说过话的
             成员会被静默跳过，正是"艾特不回"的复发点）。 */
          const spokeRecently = (readStore().messages?.[group.id] ?? []).some(
            (row) => String((row as { authorId?: unknown })?.authorId ?? "") === next.id
              && Number((row as { at?: unknown })?.at ?? 0) >= startedAt,
          );
          if (spokeRecently) continue;
          chainBudget -= 1;
          /* ⛔ 不 await：主回复先上屏，被叫的人稍后自己进来（否则一个人卡住整条链）。
             ⛔ 以前把整条原消息又发一遍，被叫的人不知道自己要做什么。 */
          /* ⛔ hop 统一 0（原来传 1）：团队要能"主理人 → 成员 A → 成员 B"往下走，
             ⛔ 别再靠 hop 截断 —— 截断交给 `chainBudget` + `ranCount`（每人最多几回合）。 */
          openTaskFor(group.id, { id: partner.id, name: partner.name }, { id: next.id, name: next.name }, String(ask.ask ?? "").slice(0, 120));
          /* ⛔ 先收集，再决定并行还是串行（见循环后的排片）。 */
          queue.push({ next, ask });
        }
        /* ⛔⛔ 11-10「让主理人自己排下一轮」：主持人一次回合里可能点了好几个人 ——
           **按它说的顺序串行执行**（后台链，不阻塞它这一轮的收尾），观感上就是它在排片；
           其他人点的人照旧并行（互不依赖，等一个人会浪费）。 */
        if (queue.length) {
          const caller = { id: partner.id, name: partner.name };
          if (String(partner.id) === adminIdForRounds) {
            void (async () => {
              relayInFlight = true;
              for (const item of queue) {
                await runOne(item.next, 0, caller, item.ask.ask).catch(() => undefined);
              }
              relayInFlight = false;
              /* ⛔⛔ 11-12 用户截图「这样没有后续了呀」「断之前好像也没有接力」—— 真因在这里：
                 原来用 `teamRunStore.activeRunList().some(run => run.teamId === groupTeamId)` 判
                 "还有人在跑"，但**同一个专家团可以同时被多个群调用** ⇒ A 群排片跑完，
                 看到 B 群有 run 在跑就 return，A 群永远停在最后一位成员的产出上（用户看到"没接力"）。
                 ⛔ `queue` 上面已经 `await` 全部跑完，这里根本不需要再判一次"还有没有人在跑"。
                 ⇒ 排片跑完就回交主理人，只保留次数 / 预算 / canRun 三道安全阀。 */
              const lead = roster.find((m) => m.teamRole === "lead");
              if (lead && chainBudget > 0 && leadCatchUps < MAX_LEAD_CATCH_UPS && canRun(lead.id)) {
                leadCatchUps += 1;
                chainBudget -= 1;
                void runOne(lead as unknown as GroupTarget, 0, caller,
                  `[系统] 你这一轮排的 ${queue.length} 位成员都交回产出了。按 SOP 推进：`
                  + "① 验收成员产出，不合格就点名打回重做；"
                  + "② 还有下一阶段就另起一行 @ 名字继续派；"
                  + "③ 只有全部阶段验收完，才写「收口」并按「结论 / 依据 / 还剩什么没做」给用户最终结论。"
                  + "⛔ 群里不要报进度（用户明确不要刷屏），不要只回「收到」，也不要代写成员的产出。")
                  .catch(() => undefined);
              }
            })();
          } else {
            for (const item of queue) void runOne(item.next, 0, caller, item.ask.ask);
          }
        }
        /* ⛔⛔ 11-10 闭环（用户：「成员之间持续沟通」「界定收尾条件」）：
           这条产出**没点任何人** —— 原来这里就是链路自然死亡的地方（群里停在最后一句）。
           ⇒ 按判据决定"继续 or 收尾"：continue 则把话头交回管理员（它决定下一步点谁/收口），
             wrap 则不再拉人（收口词已在产出里，管理员那句就是结论）。
           ⛔ 管理员自己说的不往回喂（否则自循环）；⛔ 它也有回合上限（canRun）。 */
        if (!asks.length) {
          /* ⛔ 11-10：团群不设管理员（adminId 恒空）⇒ 原来这里永远找不到人，
             闭环在团群里其实是**死的**。兜底到团主理人（它就是团里的主持人）。 */
          const admin = roster.find((m) => m.isAdmin === true) ?? roster.find((m) => m.teamRole === "lead");
          const verdict = classifyTurn({
            text: output, handoffTo: "",
            handoffs: pendingHandoffsOf(group.id),
            budgetLeft: chainBudget,
            idleRounds,
            openTasks: openTaskCountOf(group.id),
            /* 有内容且不是纯寒暄才算一份产出（长度门槛由判据侧统一看，这里只给事实）。 */
            progress: { ackedHandoffs: ackedThisTurn, writtenFiles: 0, createdTasks: 0 },
          });
          /* ⛔ 活没干完但预算见底 ⇒ 不许悄悄收尾：续一段并在群里说清楚（用户能看到为什么还在跑）。 */
          if ((verdict as { overBudget?: boolean }).overBudget && budgetExtensions < MAX_BUDGET_EXTENSIONS) {
            budgetExtensions += 1;
            chainBudget += 4;
            await appendMessageTo(group.id, {
              id: "sys-budget:" + runId, authorId: "system", authorKind: "bot", senderKind: "system",
              text: "还有任务没结束，接力预算用尽 —— 已自动续 4 次继续推进（想停就说「收口」）。",
            }).catch(() => undefined);
          }
          /* ⛔⛔ 11-11：团群里**只有主理人有权收口**。成员产出里带「已完成 / 已交付」会让
             classifyTurn 判 wrap，原来链路就死在成员那一句 —— 主理人再也不回来报进度、不汇总。
             ⇒ 团群 + 成员回合 + 排片没在跑 ⇒ 强制回喂主理人一次（次数/预算/回合上限三道安全阀）。 */
          /* ⛔⛔ 11-11 真机（用户截图：一句「在呢」，执矩回了两条，第二条 via 指向它自己）：
             @整团（`tgt:team:X`）与 @主理人（`team:X:lead`）是**同一张椅子**，id 却是两个。
             「是不是同一个人」必须按椅子判，⛔ 不能按 id 字符串 —— 否则主理人这一轮会被当成
             「某位成员交回了产出」（admin 是整团槽、partner 是合成 id）⇒ 宿主强制回喂它一次，
             群里就多一条几乎一样的回复。这一条与催办无关（催办另有 taskLike 门），是两条独立路径。 */
          const sameSeat = (a: string, b: string) => {
            const x = String(a ?? ""), y = String(b ?? "");
            if (x === y) return true;
            if (!leadAuthorId) return false;
            const leadSeats = new Set([leadAuthorId, String(teamSlot?.id ?? "")].filter(Boolean));
            return leadSeats.has(x) && leadSeats.has(y);
          };
          /* ⛔⛔ 11-12 同一处串群误判：原来这里也按 `teamId` 判"还有成员在跑"，
             别的群在跑同一个团就会把本群的回交吞掉。⇒ 只看 `relayInFlight`（**本次排片**是否在跑）
             就够了：排片在跑时由上面的收尾统一回交，排片外的成员单独交回则这里回交。 */
          const mustHandBack = Boolean(isTeamGroup && admin && !sameSeat(admin.id, partner.id)
            && !relayInFlight && chainBudget > 0 && leadCatchUps < MAX_LEAD_CATCH_UPS && canRun(admin.id));
          if ((verdict.action === "continue" || mustHandBack) && admin && !sameSeat(admin.id, partner.id) && canRun(admin.id)) {
            if (mustHandBack) leadCatchUps += 1;
            chainBudget -= 1;
            const ask = mustHandBack
              ? `[系统] ${partner.name} 交回了这一环的产出。按 SOP 推进：验收这一环，合格就继续下一阶段（行首 @ 名字），全部阶段完成才写「收口」给最终结论（结论 / 依据 / 还剩什么没做）。⛔ 群里不要报进度（用户明确不要刷屏），不要只回「收到」，也不要代写成员产出。`
              : `[系统] ${partner.name} 说完了（${verdict.reason}）。你决定：下一步点谁（行首 @ 名字），或者收口给结论。`;
            void runOne(admin as unknown as GroupTarget, 0, { id: partner.id, name: partner.name }, ask)
              .catch(() => undefined);
          }
          /* ⛔⛔ 11-11 真机（截图）：主理人把四位成员的发言**全自己代写**进一条消息里，
             一个行首 @ 都没有 ⇒ asks 为空；而团群的「主持人」就是它自己，原来的
             「自己说的不往回喂（防自循环）」于是让整条链停在这句方案上 ——
             用户看到的就是「出完方案，主代理人死了」「任务都不推进」。
             ⇒ 团群里主理人自己没派人、也没写收口时，宿主催办**一次**（只一次，不自循环）：
             要它按 SOP 真正把下一阶段派出去、先报阶段进度，别再代写成员发言。 */
          const isLeadSelf = Boolean(isTeamGroup && admin && sameSeat(admin.id, partner.id));
          /* ⛔⛔ 11-11 真机（用户截图「这又是啥情况，看不懂」+ rollout 里实证 2 条 `[系统]` 注入）：
             用户只发了一个「在」，主理人回「我在，团队四个人都在位…你丢一句要干嘛」——
             这是**正常应答**，不是"该推进了"。但 classifyTurn 对寒暄也判非 wrap ⇒ 催办再跑一轮
             ⇒ 群里出现两条几乎一样的开场白，用户以为出了故障。
             ⇒ 只有「这一轮用户真的给了活」才催办：去掉 @ 之后的正文 ≥6 字，且不是纯应答词。 */
          const leadTurnTaskLike = (() => {
            /* ⛔⛔ 11-12 用户截图（同一个问题，回复两次）：用户问「告诉我你的团队擅长什么」，
               主理人答完一条信息，宿主又催它一轮 ⇒ 它再解释「这是信息答复，没有成品要派，收口」。
               根因：旧判据只看**行首**问句词 + 一张窄词表，「…擅长什么」这种问句词在句中、
               又不在词表里的，全被当成"给了活"。⇒ 问句判定收进纯函数 isInfoRequest
               （问句词任意位置 + 信息类动词，守卫真值表钉死），⛔ 不在这里再写第二套。
               ⛔ 宁可漏催一次，也不能把"回答"当成"该推进了"。 */
            if (isInfoRequest(text)) return false;
            const plain = String(text ?? "").replace(/@[^\s：:]+/g, "").replace(/\s+/g, "");
            if (plain.length < 6) return false;
            return !/^(在|在吗|好|好的|行|嗯|收到|可以|ok|OK|继续|你好|谢谢)[。！!？?~～.…]*$/.test(plain);
          })();
          if (isLeadSelf && verdict.action !== "wrap" && leadTurnTaskLike && !relayInFlight
            && leadSelfNudges < MAX_LEAD_SELF_NUDGES && chainBudget > 0 && canRun(partner.id)) {
            leadSelfNudges += 1;
            chainBudget -= 1;
            /* ⛔⛔ 11-11：它这一轮**已经调过** team_member_invoke / team_phase_invoke 的话，
               ⛔ 别再叫它「另起一行 @名字」——那会把它推回"行首 @ 演戏"（群里说一句、没人真干活）。
               同一件事，两种口径：有真工具就用真工具往下推。 */
            const usedTool = teamToolUsedSince(threadId, startedAt);
            void runOne(admin as unknown as GroupTarget, 0, { id: partner.id, name: partner.name },
              usedTool
                ? "[系统] 你这一轮已经调过团队工具，但还没写「收口」。按 SOP 继续：先用 team_member_invoke / "
                  + "team_phase_invoke 把下一阶段真的派出去（⛔ 不用行首 @ 派活，那只是群里说了一句话）；"
                  + "只有全部阶段验收完才写「收口」给最终结论。"
                : "[系统] 你这一轮没有派任何成员，也没有写「收口」。按 SOP 继续推进："
                  + "用 team_member_invoke 把当前这一步真正派出去（⛔ 不要自己代写成员的成品）；"
                  + "只有全部阶段验收完才写「收口」给最终结论。")
              .catch(() => undefined);
          }
        }
      }
    } catch (err) {
      errMsg = err instanceof Error ? err.message : String(err);
      failed.push(`${partner.name}：${errMsg}`);
      options.onPhase?.("finished", partner, { ok: false, error: errMsg });
    } finally {
      if (talkDelta) { server.off("event", talkDelta); talkDelta = null; }
      if (liveThreadId) {
        broadcastHarnessEvent({ type: "group-talk-live", phase: "finished", groupId: group.id, memberId: speakerId, name: speakerName, threadId: liveThreadId, runId, at: Date.now() } as never);
      }
      /* ⛔ 11-08 审查：收尾标记按**真实会话 id**记（`liveThreadId || threadId`）——
         会话在开跑时正忙 / 走排队分支时 liveThreadId 是空的，只记 liveThreadId 会让这一轮
         的迟到用量永远补不上（页脚缺失）；开跑前已 `finishedTalkRuns.delete` 过，不会串轮。 */
      const finishedThreadId = liveThreadId || threadId;
      if (finishedThreadId) {
        finishedTalkRuns.set(finishedThreadId, { groupId: group.id, at: Date.now() });
        if (finishedTalkRuns.size > 200) {
          const oldest = [...finishedTalkRuns.entries()].sort((a, b) => a[1].at - b[1].at)[0];
          if (oldest) finishedTalkRuns.delete(oldest[0]);
        }
        /* 卡在 append 与 finally 之间的用量：消息已落盘但从没带上 ⇒ 补到最后那条上。 */
        if (wroteMessage && usageWritten === false && liveUsage) {
          void patchLatestTalkMessageUsage(group.id, finishedThreadId, liveUsage).catch(() => undefined);
        }
      }
      const tokens = delegateRegistry?.tokensOf(threadId) ?? null;
      await logUsageTo({
        groupId: group.id,
        groupName: group.name,
        memberId: partner.id,
        partnerName: partner.name,
        source,
        threadId,
        chars,
        inputTokens: tokens?.input ?? 0,
        outputTokens: tokens?.output ?? 0,
        totalTokens: tokens?.total ?? 0,
        ms: Date.now() - startedAt,
        ok: okFlag,
        error: errMsg,
      });
    }
  };
  await Promise.all(targets.map((partner) => runOne(partner, 0)));
  /* ⛔⛔ 11-07 用户真机：「跑不通、没有结果回传」——派活失败原来只落在 `team-dispatch-done`
     广播里，而**面板关着时没人接**⇒ 群里一片安静，用户以为任务"莫名其妙结束了"。
     ⇒ 失败也写成一条群里的系统消息（面板开着关着都看得到，重开也在）。
     ⛔ 成功不加系统消息（产出本身就是结果）；⛔ 不写多个人的重复原因（按行列出即可）。 */
  if (failed.length) {
    await appendMessageTo(group.id, {
      id: `sys-dispatch-failed:${Date.now()}`,
      authorId: "system",
      authorKind: "bot",
      senderKind: "system",
      /* ⛔⛔ 11-10：把「谁没交」连同「谁负责推进」作为**事实**摆出来。
         ⛔ 不是看门狗、不自动重派、不下指令（10-26 事故）；让管理员/主理人自己判断要不要接。 */
      text: `派活未完成（${failed.length}/${targets.length}）：\n${failed.map((f) => `· ${f}`).join("\n")}\n`
        + (group.members.some((m) => m.targetKind === "team")
          ? "本群推进人：专家团主理人"
          : (() => {
            const adminId = String((group as { adminId?: unknown }).adminId ?? "");
            const admin = group.members.find((m) => m.id === adminId);
            return admin ? `本群推进人：${admin.name}（管理员）` : "未设置推进人（可在群设置里指定管理员）";
          })()),
    }).catch(() => undefined);
  }
  return { ok: failed.length < targets.length, sent: targets.length - failed.length, failed };
}

/** 定时任务那条路要"一次调完"：落消息 + 派活 + 等结果（无人值守本来就要等账本）。 */
/**
 * 派活超时兜底（11-07 真机）：实测「引擎起不来」时 `runDelegatedTask` 会**无声挂住**
 * （群日志里只有用户那句话，delegates/账本全空，用户看到的就是「跑不通、没结果回传」）。
 * ⇒ 15 分钟还没回来就判失败并留痕 —— ⛔ 不假装成功，也不让人一直等。
 * ⛔ 超时只负责"给用户一个结论"，不保证引擎侧那轮被取消（那属于停止键的职责）。
 */
/* ⛔ 可用环境变量压短（只给探针/验收用）：默认 15 分钟；改小只是更快给结论，语义不变。 */
const DISPATCH_TIMEOUT_MS = Number(process.env.CODEX_DISPATCH_TIMEOUT_MS) > 0
  ? Number(process.env.CODEX_DISPATCH_TIMEOUT_MS)
  : 15 * 60 * 1000;
/* ⛔⛔ 11-11：团群主理人现在真的会调 team_member_invoke —— 那是一个**同步等成员跑完**的调用
   （单个成员最多 10 分钟），一轮里串行调两三个就超过 15 分钟 ⇒ 用户会看到"派活超时"，
   而引擎其实还在跑（超时只给结论、不取消回合）⇒ 界面报错 + 后面又冒出一条消息。
   ⇒ 只有「拿着团队工具的那一轮」放宽到 40 分钟；其他群聊回合维持原值。 */
const LEAD_DISPATCH_TIMEOUT_MS = 40 * 60 * 1000;
async function withDispatchTimeout<T>(task: Promise<T>, name: string, timeoutMs = DISPATCH_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${name} 派活超时（${Math.round(timeoutMs / 60000)} 分钟）—— 引擎可能没起来，去「设置 → 模型」看凭据/状态`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function dispatchGroupText(
  group: GroupShape,
  text: string,
  memberIds: string[],
  source: "human" | "automation",
  options: { params?: DispatchParams; allowChain?: boolean; onPhase?: DispatchPhase } = {},
): Promise<{ ok: boolean; sent: number; failed: string[] }> {
  const opened = await prepareGroupDispatch(group, text, memberIds, source);
  if ("error" in opened) return { ok: false, sent: 0, failed: [opened.error] };
  return runDispatchRounds(group, opened.targets, text, source, { ...options, catalog: opened.catalog });
}

type ScheduleShape = NonNullable<ReturnType<typeof normalizeScheduleEntry>>;

/** 下一次运行时刻（⛔ 只做"构造入参 + 调引擎"，算术在 scheduler.ts 里）。 */
function computeScheduleNextRunAt(entry: ScheduleShape, baseMs: number): number | null {
  const rrule = entry.kind === "once"
    ? ""
    : buildRRuleFromInput(entry.kind as "interval" | "daily" | "weekly", entry.timeOfDay, entry.weekdays, 60);
  const task = {
    id: entry.id,
    name: entry.name,
    prompt: entry.prompt,
    workspace: "",
    effort: "",
    intervalMinutes: entry.kind === "interval" ? 60 : entry.kind === "weekly" ? 10_080 : 1440,
    enabled: true,
    nextRunAt: null,
    kind: entry.kind,
    timeOfDay: entry.timeOfDay,
    weekdays: entry.weekdays,
    rrule: rrule || undefined,
    scheduleType: entry.scheduleType,
    scheduledAt: entry.scheduledAt || undefined,
    createdAt: entry.createdAt || Date.now(),
  };
  try {
    /* ⛔ 取整：引擎的 jitter 会带小数毫秒，落盘里出现 `.9783` 既难看又会让"相等比较"变得脆弱 */
    const next = computeNextRunAt(task as never, baseMs, entry.lastRunAt);
    return next === null ? null : Math.round(next);
  } catch {
    return null; // 非法 RRULE（老数据）⇒ 不排下次，界面上会显示"下一次 —"
  }
}

/** 正在跑的定时任务（`群id:任务id`）：⛔ 同一任务不许叠跑（会同时开两条子会话）。 */
const runningSchedules = new Set<string>();

/**
 * 执行一条定时任务：到点 ⇒ 派活 ⇒ 落群日志 ⇒ 记账 ⇒ 推进 `nextRunAt`。
 * ⛔ 无论成功失败都推进（否则失败任务会每分钟重试一次，把 token 烧光）。
 */
async function executeGroupSchedule(groupId: string, scheduleId: string, runKind: "scheduled" | "manual") {
  const key = `${groupId}:${scheduleId}`;
  if (runningSchedules.has(key)) return { ok: false, error: "这个任务正在跑" };
  const snapshot = readStore();
  const group = findGroup(snapshot.groups, groupId);
  const entry = group?.schedules.find((s) => s.id === scheduleId);
  if (!group || !entry) return { ok: false, error: "定时任务已不存在" };
  const blockers = scheduleBlockers(group, entry);
  if (blockers.length) return { ok: false, error: blockers.join("；") };

  runningSchedules.add(key);
  let error = "";
  try {
    const r = await dispatchGroupText(group, entry.prompt, entry.memberIds, "automation");
    error = r.failed.length ? r.failed.join("；") : "";
    return { ok: r.ok, sent: r.sent, error: error || undefined, runKind };
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    return { ok: false, error, runKind };
  } finally {
    runningSchedules.delete(key);
    const finishedAt = Date.now();
    await mutateStore((store) => {
      const g = findGroup(store.groups, groupId);
      if (!g) return { store, out: null };
      const schedules = g.schedules.map((s) => {
        if (s.id !== scheduleId) return s;
        const updated: ScheduleShape = { ...s, lastRunAt: finishedAt, lastError: error || undefined };
        updated.nextRunAt = computeScheduleNextRunAt(updated, finishedAt);
        return updated;
      });
      return {
        store: { ...store, groups: store.groups.map((x) => (x.id === groupId ? { ...g, schedules } : x)) },
        out: null,
      };
    });
    /* 面板开着就立刻能看到新消息与新的"下次运行"（⛔ 不靠 1s 轮询：那是白烧 CPU） */
    broadcastHarnessEvent({ type: "team-schedule-ran", groupId, scheduleId, ok: !error, error: error || undefined, runKind, at: Date.now() } as never);
  }
}

/** 到点扫描（30s 一拍）：跑所有 `enabled && nextRunAt <= now` 的任务。 */
async function tickGroupSchedules() {
  let store: StoreShape;
  try {
    store = readStore();
  } catch {
    return;
  }
  const now = Date.now();
  for (const group of store.groups) {
    for (const entry of group.schedules ?? []) {
      if (!entry.enabled) continue;
      const due = Number(entry.nextRunAt);
      if (!Number.isFinite(due) || due > now) continue;
      if (runningSchedules.has(`${group.id}:${entry.id}`)) continue;
      void executeGroupSchedule(group.id, entry.id, "scheduled").catch(() => undefined);
    }
  }
}

export const harnessTeamFeature = defineFeature<null>({
  id: "harness-team",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("harness-team: 缺少 ipc 服务（宿主未提供）");

    /* 列表：群 + 两套判据（⛔ 别混用）
       · issues   = 体检（含"还没有伙伴"这类**建议**）⇒ 设置页里展示给人看
       · blockers = 结构性硬闸（缺 id / 无成员 / 群主不在表）⇒ 侧栏徽标只认它
       ⛔ 11-06 修：rail 原来拿 issues.length 判「待处理」，于是**每个新群永久顶着"待处理"**
         （新群本来就没伙伴），用户看到的是"这功能有问题吧"。 */
    ipcHost.handle("harness-team:list", () => {
      const store = readStore();
      const groups = store.groups;
      return {
        groups,
        issues: groups.map((g) => ({ id: g.id, issues: groupIssues(g) })),
        blockers: groups.map((g) => ({ id: g.id, issues: createBlockers(g) })),
        limit: GROUP_MAX_PARTNERS,
      };
    });

    ipcHost.handle("harness-team:create", async (_event, input: Record<string, unknown>) => {
      const store = readStore();
      const groups = store.groups;
      const id = String(input?.id ?? "") || `grp_${Date.now().toString(36)}`;
      if (findGroup(groups, id)) return { ok: false, error: "群 id 已存在" };
      const next = createGroup({ ...input, id }) as GroupShape;
      /* ⛔ 建群闸只看**结构性**问题：新群还没有伙伴是正常的（以前拿 groupIssues 当闸 ⇒ 建群永远失败） */
      const blockers = createBlockers(next);
      if (blockers.length) return { ok: false, error: blockers.join("；"), issues: groupIssues(next) };
      writeStore({ ...store, groups: [...groups, next] });
      return { ok: true, group: next, issues: groupIssues(next) };
    });

    ipcHost.handle("harness-team:rename", (_event, groupId: string, name: string) => {
      const store = readStore();
      const g = findGroup(store.groups, groupId);
      if (!g) return { ok: false, error: "群不存在" };
      const next = createGroup({ ...g, name: String(name ?? "").trim() || g.name }) as GroupShape;
      return saveOne(store, next);
    });

    /* 群成员改名（11-09 用户令「群里的成员都加上支持改名字，联动会话改名 / 成员识别同步」）。
       ⛔ 名字只有这一个真相源：群消息署名 / @ / 队列 / 资料卡 / 外面伙伴会话的身份都按 id 现算；
       ⛔ 同时把该成员在本群的伙伴会话标题改成「伙伴·新名@群名」（引擎 title 会广播给侧栏）。
       团成员（targetKind=team）的显示名来自专家目录，群内改名不影响展示 ⇒ 不支持（返回原因）。 */
    ipcHost.handle("harness-team:rename-member", async (_event, groupId: string, memberId: string, name: string) => {
      const store = readStore();
      const g = findGroup(store.groups, groupId);
      if (!g) return { ok: false, error: "群不存在" };
      const r = renameMember(g, memberId, name) as { ok: boolean; changed?: boolean; reason?: string; group: GroupShape };
      if (!r.ok) {
        const msg = r.reason === "empty" ? "名字不能为空" : r.reason === "duplicate" ? "这个名字已经有人用了" : r.reason === "not_member" ? "成员不存在" : "改名失败";
        return { ok: false, error: msg, reason: r.reason, group: r.group };
      }
      const saved = saveOne(store, r.group);
      const member = r.group.members.find((m) => String(m.id) === String(memberId));
      if (member?.kind === "bot" && member?.targetKind !== "team" && r.changed) {
        const threads = await renameTalkMember(String(groupId), String(memberId), member.name, String(r.group.name ?? ""));
        if (threads.length) broadcastHarnessEvent({ type: "team-talk-threads-changed", at: Date.now() } as never);
      }
      /* 其他窗口 / 群面板同步：成员名变了 ⇒ 消息署名、@ 候选、排队卡按新名重算。 */
      broadcastHarnessEvent({ type: "harness-team-groups", groupId: String(groupId), at: Date.now() } as never);
      return { ...saved, changed: Boolean(r.changed) };
    });

    /* 加伙伴：上限/去重判定在纯函数里，这里只负责持久化 */
    ipcHost.handle("harness-team:add-partner", (_event, groupId: string, partner: Record<string, unknown>, addedBy: string) => {
      const store = readStore();
      const g = findGroup(store.groups, groupId);
      if (!g) return { ok: false, error: "群不存在" };
      const r = addPartner(g, partner, addedBy) as { ok: boolean; reason?: string; limit?: number; group: GroupShape; changed?: boolean };
      if (!r.ok) {
        const msg = r.reason === "limit" ? `已达上限（最多 ${r.limit} 个伙伴）` : r.reason === "invalid" ? "伙伴信息无效" : "加入失败";
        return { ok: false, error: msg, reason: r.reason, limit: r.limit, group: r.group };
      }
      return { ...saveOne(store, r.group), changed: r.changed };
    });

    ipcHost.handle("harness-team:remove-partner", (_event, groupId: string, partnerId: string, byId: string) => {
      const store = readStore();
      const g = findGroup(store.groups, groupId);
      if (!g) return { ok: false, error: "群不存在" };
      const r = removePartner(g, partnerId, byId) as { ok: boolean; reason?: string; group: GroupShape; changed?: boolean };
      if (!r.ok) {
        const msg =
          r.reason === "forbidden" ? "只有群主和添加者可以移除该伙伴"
            : r.reason === "is_lead" ? "群主不能被移除"
              : r.reason === "not_partner" ? "只能移除伙伴（人类成员请从成员管理里处理）"
                : "移除失败";
        return { ok: false, error: msg, reason: r.reason, group: r.group };
      }
      return { ...saveOne(store, r.group), changed: r.changed };
    });

    ipcHost.handle("harness-team:mute", (_event, groupId: string, partnerId: string, muted: boolean) => {
      const store = readStore();
      const g = findGroup(store.groups, groupId);
      if (!g) return { ok: false, error: "群不存在" };
      return saveOne(store, setPartnerMuted(g, partnerId, muted) as GroupShape);
    });

    /* 群内成员头像（11-07 用户令「加一个群内的成员头像自定义修改功能」）。
       ⛔ 只改**这个群**的成员表：同一个专家在 A 群可以一张脸、B 群另一张；
         专家中心 / 用户中心的形象不受影响（那是另一个作用域）。
       ⛔ 空串 = 恢复默认；非法值由 `normalizeMemberAvatar` 清成空（⛔ 不把奇怪字符串写进盘）。 */
    ipcHost.handle("harness-team:set-avatar", (_event, groupId: string, memberId: string, avatar: string) => {
      const store = readStore();
      const g = findGroup(store.groups, groupId);
      if (!g) return { ok: false, error: "群不存在" };
      const saved = saveOne(store, setMemberAvatar(g, memberId, avatar) as GroupShape);
      /* ⛔ 11-09：群内换头像要**当场**同步到外面那条伙伴会话（它订阅 team-talk-threads-changed 重拉身份），
         不用等 8s 轮询、更不用重启应用。 */
      broadcastHarnessEvent({ type: "team-talk-threads-changed", at: Date.now() } as never);
      return saved;
    });

    /* 群消息排版（11-07 用户令：进群设置、卡片选择，换机/重装也要保留）——
       落进群 JSON（⛔ 不再只存在 localStorage）。 */
    ipcHost.handle("harness-team:set-message-layout", (_event, groupId: string, layout: string) => {
      const store = readStore();
      const g = findGroup(store.groups, String(groupId ?? ""));
      if (!g) return { ok: false, error: "群不存在" };
      return saveOne(store, setMessageLayout(g, layout) as GroupShape);
    });

    /* 群回复模式（11-08 用户令：群设置里加选项）—— 落群 JSON，与消息排版同一条写法。
       `process` = 运行时展示过程（默认折叠，可展开）；`placeholder` = 只显示「图标+名字」占位。 */
    ipcHost.handle("harness-team:set-reply-mode", (_event, groupId: string, mode: string) => {
      const store = readStore();
      const g = findGroup(store.groups, String(groupId ?? ""));
      if (!g) return { ok: false, error: "群不存在" };
      return saveOne(store, setReplyMode(g, mode) as GroupShape);
    });

    /* 群消息形式（11-08 用户令：话题模式单独成项，不挤在回复模式一排）。 */
    ipcHost.handle("harness-team:set-message-form", (_event, groupId: string, form: string) => {
      const store = readStore();
      const g = findGroup(store.groups, String(groupId ?? ""));
      if (!g) return { ok: false, error: "群不存在" };
      return saveOne(store, setMessageForm(g, form) as GroupShape);
    });

    /* 群对话流（11-09 用户令）：`simple` = 运行中过程折叠（默认，点开看）；
       `detail` = 运行中直接把过程步骤铺开。只影响运行中的呈现，收尾后的整轮折叠不变。 */
    ipcHost.handle("harness-team:set-dialog-flow", (_event, groupId: string, mode: string) => {
      const store = readStore();
      const g = findGroup(store.groups, String(groupId ?? ""));
      if (!g) return { ok: false, error: "群不存在" };
      return saveOne(store, setDialogFlow(g, mode) as GroupShape);
    });

    /* ⛔ 11-09 用户令：「为普通群聊增加设置管理员功能，管理员 agent 负责推动工作进度」。
       ⛔ 专家团群不启用：`setAdmin` 只落数据，是否**用它**由 `defaultRouteCandidates` 决定
         （团群有主理人就走主理人，不读 adminId）；界面也不给团群这个入口。
       ⛔ 成环/自指那些约束不适用于这里（只是"谁先接话"，没有链）。 */
    ipcHost.handle("harness-team:set-admin", (_event, groupId: string, memberId: string) => {
      const store = readStore();
      const g = findGroup(store.groups, String(groupId ?? ""));
      if (!g) return { ok: false, error: "群不存在" };
      const r = setAdmin(g, String(memberId ?? "")) as { ok: boolean; reason?: string; group: GroupShape; changed?: boolean };
      if (!r.ok) {
        return { ok: false, error: r.reason === "not_member" ? "管理员只能是这个群里的伙伴" : "设置失败" };
      }
      return saveOne(store, r.group);
    });

    /* ⛔ 11-10 用户令「提升到 100 分」：群内进度必须能一眼看到 —— 别让人靠读消息猜。
       `waiting` 是"派出去还没人回"的条数，和 open 不同（open 含正在跑的）。 */
    ipcHost.handle("harness-team:group-progress", (_event, groupId: string) => {
      const gid = String(groupId ?? "");
      if (!gid) return { ok: false, error: "缺少 groupId" };
      const rows = Object.values(readStore().tasks ?? {}).filter((x) => x.groupId === gid);
      const open = rows.filter((x) => x.status === "open").length;
      /* ⛔ 11-11 补缺口：群头原来只出数字、点不开看清单 ⇒ 一并返回未结束的任务。
         ⛔ 只回 open、最多 12 条（按时间正序 = 最先欠的最先处理）：全量会随群龄无限涨，
            浮层读不完，IPC 也跟着变重。 */
      const items = rows
        .filter((x) => x.status === "open")
        .sort((a, b) => a.at - b.at)
        .slice(0, 12)
        .map((x) => ({ id: x.id, title: x.title, toName: x.toName, fromName: x.fromName, at: x.at }));
      return { ok: true, total: rows.length, open, done: rows.length - open, waiting: pendingHandoffsOf(gid).length, items };
    });

    ipcHost.handle("harness-team:set-guard", (_event, groupId: string, guard: Record<string, unknown>) => {
      const store = readStore();
      const g = findGroup(store.groups, groupId);
      if (!g) return { ok: false, error: "群不存在" };
      const next = createGroup({ ...g, guard: { ...g.guard, ...guard } }) as GroupShape;
      return saveOne(store, next);
    });

    /* 群记忆：这个群的共享背景，派活时注入给每个伙伴（豆包 baseline.md 的群级等价物）。
       ⛔ 上限在主进程截断：渲染层可能传超长文本（粘贴），⛔ 不能靠前端自觉。 */
    ipcHost.handle("harness-team:set-memory", (_event, groupId: string, text: string) => {
      const store = readStore();
      const g = findGroup(store.groups, String(groupId ?? ""));
      if (!g) return { ok: false, error: "群不存在" };
      const next = createGroup({ ...g, memory: String(text ?? "") }) as GroupShape;
      return saveOne(store, next);
    });

    /* 项目地址（群的工作目录）：派活时作为子会话 cwd。
       ⛔ 必须**当场校验**（11-06 实测撞到脏值 `"测试"`）：相对路径交给引擎会变成
         `<进程 cwd>/测试`，目录不存在 ⇒ thread/start 直接报一个看不懂的错。
         ⛔ 但不建目录（用户说在哪就在哪，⛔ 不替他在磁盘上造东西）；空串 = 跟随应用默认。 */
    ipcHost.handle("harness-team:set-workspace", (_event, groupId: string, workspace: string) => {
      const store = readStore();
      const g = findGroup(store.groups, String(groupId ?? ""));
      if (!g) return { ok: false, error: "群不存在" };
      const raw = String(workspace ?? "").trim();
      if (raw) {
        if (!isAbsolute(raw)) return { ok: false, error: "项目地址要选一个绝对路径（如 D:////项目////xxx）" };
        let isDir = false;
        try { isDir = statSync(raw).isDirectory(); } catch { isDir = false; }
        if (!isDir) return { ok: false, error: `这个目录不存在：${raw}` };
      }
      const next = createGroup({ ...g, workspace: raw }) as GroupShape;
      return saveOne(store, next);
    });

    /* 群文件：只存路径 + 说明（⛔ 不搬文件、不读内容）。整组替换语义 —— UI 增删后一次提交，
       ⛔ 不做 add/remove 两条通道：两条通道会让"并发改同一个群"的合并规则变成猜的。 */
    ipcHost.handle("harness-team:set-files", (_event, groupId: string, files: unknown) => {
      const store = readStore();
      const g = findGroup(store.groups, String(groupId ?? ""));
      if (!g) return { ok: false, error: "群不存在" };
      if (files != null && !Array.isArray(files)) return { ok: false, error: "文件清单格式不对" };
      const list = (Array.isArray(files) ? files : []).map(normalizeGroupFile).filter(Boolean);
      if (list.length > MAX_GROUP_FILES) return { ok: false, error: `最多 ${MAX_GROUP_FILES} 个参考文件` };
      const next = createGroup({ ...g, files: list }) as GroupShape;
      return saveOne(store, next);
    });

    /* 上下级（豆包 `managerId`）：只改组织关系，⛔ 不动任何会话。
       ⛔ 成环/自指在纯函数里拦（setManager），这里只负责落盘。 */
    ipcHost.handle("harness-team:set-manager", (_event, groupId: string, memberId: string, managerId: string) => {
      const store = readStore();
      const g = findGroup(store.groups, String(groupId ?? ""));
      if (!g) return { ok: false, error: "群不存在" };
      const r = setManager(g, memberId, managerId) as { ok: boolean; reason?: string; group: GroupShape; changed?: boolean };
      if (!r.ok) {
        const msg =
          r.reason === "self" ? "不能把自己设成自己的上级"
            : r.reason === "cycle" ? "这样会绕成环（A 是 B 的上级、B 又是 A 的上级）"
              : r.reason === "no_manager" ? "这个上级不在群里"
                : "设置失败";
        return { ok: false, error: msg, reason: r.reason, group: r.group };
      }
      return { ...saveOne(store, r.group), changed: r.changed };
    });

    /* ── 群记忆条目（豆包 §2.②：带 type + origin 的结论，不是一大段随笔）──────────
       ⛔ id/at/origin 一律在**主进程**补：渲染层各写一套时间/来源口径，多面板时必漂。 */
    ipcHost.handle("harness-team:add-note", (_event, groupId: string, note: Record<string, unknown>) => {
      const store = readStore();
      const gid = String(groupId ?? "");
      const g = findGroup(store.groups, gid);
      if (!g) return { ok: false, error: "群不存在" };
      const at = Date.now();
      const r = addMemoryNote(g, {
        ...note,
        id: String(note?.id ?? "").trim() || `note_${at.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        at,
        origin: {
          groupId: gid,
          actorId: String(note?.actorId ?? "local-user"),
          threadId: String(note?.threadId ?? ""),
        },
      }) as { ok: boolean; reason?: string; group: GroupShape; dropped?: string[] };
      if (!r.ok) return { ok: false, error: "记忆内容无效（不能为空）" };
      return { ...saveOne(store, r.group), dropped: r.dropped ?? [] };
    });

    ipcHost.handle("harness-team:remove-note", (_event, groupId: string, noteId: string) => {
      const store = readStore();
      const g = findGroup(store.groups, String(groupId ?? ""));
      if (!g) return { ok: false, error: "群不存在" };
      const r = removeMemoryNote(g, noteId) as { group: GroupShape; changed?: boolean };
      return { ...saveOne(store, r.group), changed: r.changed };
    });

    /* 群菜单（飞书 §3：menuItems 树，`needShowMenuButton = items.length > 0`）。
       ⛔ 整份替换语义：菜单是"一屏能看完的树"，增量合并的规则只会让人猜。 */
    ipcHost.handle("harness-team:set-menu", (_event, groupId: string, items: unknown) => {
      const store = readStore();
      const g = findGroup(store.groups, String(groupId ?? ""));
      if (!g) return { ok: false, error: "群不存在" };
      if (items != null && !Array.isArray(items)) return { ok: false, error: "菜单格式不对" };
      const menu = normalizeMenu(items);
      if (Array.isArray(items) && items.length > 0 && menu.length === 0) {
        return { ok: false, error: "菜单项无效（每项要有 key/label，叶子还要有 prompt）" };
      }
      if (menu.length > MENU_MAX_ITEMS) return { ok: false, error: `最多 ${MENU_MAX_ITEMS} 个一级菜单` };
      const next = createGroup({ ...g, menu }) as GroupShape;
      return saveOne(store, next);
    });

    /* 菜单展示形态（飞书 §3 `INPUT_FIRST` / `FLOAT`）：只改一个枚举值，⛔ 不动菜单内容。 */
    ipcHost.handle("harness-team:set-menu-placement", (_event, groupId: string, placement: string) => {
      const store = readStore();
      const g = findGroup(store.groups, String(groupId ?? ""));
      if (!g) return { ok: false, error: "群不存在" };
      const next = createGroup({ ...g, menuPlacement: normalizeMenuPlacement(placement) }) as GroupShape;
      return saveOne(store, next);
    });

    /* ── 群定时任务（豆包 §③「自动化定时任务」）──────────────────────────────
       ⛔ 整组替换语义（与菜单/文件一致）：列表是一条条"闹钟"，增量合并的规则只会让人猜。
       ⛔ `nextRunAt` 在这里算（主进程），⛔ 渲染层不许自己推算调度时刻。 */
    ipcHost.handle("harness-team:set-schedule", (_event, groupId: string, list: unknown) => {
      const store = readStore();
      const g = findGroup(store.groups, String(groupId ?? ""));
      if (!g) return { ok: false, error: "群不存在" };
      if (list != null && !Array.isArray(list)) return { ok: false, error: "定时任务格式不对" };
      const rows = Array.isArray(list) ? list : [];
      const normalized: ScheduleShape[] = [];
      for (const raw of rows) {
        const entry = normalizeScheduleEntry(raw);
        if (!entry) return { ok: false, error: "定时任务无效（缺 id 或指令内容）" };
        normalized.push(entry);
      }
      if (normalized.length > MAX_GROUP_SCHEDULES) return { ok: false, error: `最多 ${MAX_GROUP_SCHEDULES} 个定时任务` };
      const now = Date.now();
      const existing = new Map((g.schedules ?? []).map((s) => [s.id, s]));
      const schedules = normalizeSchedules(normalized.map((entry) => {
        const old = existing.get(entry.id);
        /* 调度口径没变 ⇒ 沿用旧的下次时刻（改个名字不该把这一轮推掉）；
           变了/新任务 ⇒ 以现在为基准重算。 */
        const keep = old && old.nextRunAt && old.kind === entry.kind && old.timeOfDay === entry.timeOfDay
          && old.scheduledAt === entry.scheduledAt && JSON.stringify(old.weekdays) === JSON.stringify(entry.weekdays);
        const nextRunAt = entry.enabled ? (keep ? old!.nextRunAt : computeScheduleNextRunAt(entry, now)) : (entry.nextRunAt ?? null);
        return { ...entry, createdAt: entry.createdAt || old?.createdAt || now, lastRunAt: old?.lastRunAt, lastError: old?.lastError, nextRunAt };
      }));
      const next = createGroup({ ...g, schedules }) as GroupShape;
      return saveOne(store, next);
    });

    /* 手动立刻跑一次（用户点「立即运行」）。⛔ 不影响 nextRunAt 的口径 —— 跑完照旧推进一个周期。 */
    ipcHost.handle("harness-team:run-schedule", async (_event, groupId: string, scheduleId: string) =>
      executeGroupSchedule(String(groupId ?? ""), String(scheduleId ?? ""), "manual"));

    /* 记一条用量（渲染层每次派活完成/失败各调一次）。
       ⛔ 失败也记：失败也烧了 token，且失败率本身是最该看的指标。 */
    ipcHost.handle("harness-team:log-usage", async (_event, entry: Record<string, unknown>) => logUsageTo(entry ?? {}));

    /* 用量汇总：按 (agent, 来源) 两个维度拆（豆包实测口径）。 */
    ipcHost.handle("harness-team:ledger", (_event, groupId: string, days: number) => {
      const list = readLedger();
      return {
        ok: true,
        ...summarizeLedger(list, { groupId: String(groupId ?? ""), days: Number(days ?? 7) || 7 }),
      };
    });

    /* 本群此刻**正在跑**的伙伴（面板关掉再打开时恢复"处理中"与已输出的那段文本）。
       ⛔ 真相源是主进程的委派登记表（delegateRegistry 的 running 记录持续累积 output）；
         渲染层的 busy/流式卡是**临时态**，面板一卸载就没了 —— 11-06 用户实测：
         「群弹窗一关就看不见了，要等回复完才能看见」。 */
    ipcHost.handle("harness-team:running", async (_event, groupId: string) => {
      const store = readStore();
      const g = findGroup(store.groups, String(groupId ?? ""));
      if (!g) return { ok: false, error: "群不存在", runs: [] };
      let records: Awaited<ReturnType<NonNullable<typeof delegateRegistry>["listAll"]>> = [];
      try {
        records = (await delegateRegistry?.listAll()) ?? [];
      } catch { /* 登记表未就绪：当成"没人在跑" */ }
      const bots = g.members.filter((m) => m.kind === "bot");
      /* ⛔ targetKey 不同形：成员存的是 `team:member` 那种，登记表存 `${kind}:${key}` ⇒ 双向包含 */
      const loose = (a: string, b: string) => Boolean(a && b) && (a === b || a.includes(b) || b.includes(a));
      const runs = [];
      for (const r of records) {
        if (!r || r.status !== "running") continue;
        const hit = (r.targetKey ? bots.find((m) => m.targetKey && loose(m.targetKey, String(r.targetKey))) : undefined)
          ?? bots.find((m) => m.name === r.name);
        if (!hit) continue;
        runs.push({
          memberId: hit.id,
          name: hit.name,
          threadId: r.threadId,
          text: String(r.output ?? ""),
          startedAt: Number(r.startedAt ?? 0) || Date.now(),
        });
      }
      return { ok: true, runs };
    });

    /* 停止运行（用户：`@成员 /stop`；11-08 起也承担「群运行中点停止 = 全群停」）。
       ⛔ 实现体在 `harness-team-stop.ts`（本文件已到棘轮上限，且那段逻辑不依赖 ipc 宿主）；
          两种用法共用同一套候选口径与引擎校验，详见该文件头注释。 */
    ipcHost.handle("harness-team:stop", async (_event, input: Record<string, unknown>) =>
      stopTeamRuns(input as TeamStopInput));

    /* 排队消息的「立即」（11-08 用户令「插队消息」）：
       能插队就 steer 进正在跑的那个回合（并把队列里那条删掉），插不了就按新回合启动。
       ⛔ 活动回合表的唯一真相在主进程，所以这个动作不能留给渲染层自己拼 expectedTurnId。 */
    ipcHost.handle("harness-team:queue-start", async (_event, input: Record<string, unknown>) =>
      startTeamQueued(input as TeamQueueStartInput));

    /* 某个委派会话最近一轮的**真实 token**（引擎 `thread/tokenUsage/updated` 的 last 桶）。
       ⛔ 拿不到就返回 null —— 别返回 0 冒充"用了 0 token"（那是两种完全不同的含义）。 */
    ipcHost.handle("harness-team:thread-usage", (_event, threadId: string) => {
      const id = String(threadId ?? "").trim();
      if (!id) return { ok: false, error: "缺会话 id" };
      const tokens = delegateRegistry?.tokensOf(id) ?? null;
      return { ok: Boolean(tokens), tokens };
    });

    /* 群聊伙伴会话台账（只读）：侧栏据此给这些**普通会话**打「伙伴」标签。
       ⛔ 它们在侧栏既没有 delegate 记录、也不属于中枢群 ⇒ 只能由群聊台账认；
          ⛔ 不许按标题前缀「伙伴·」猜（用户改名后就不成立了）。 */
    ipcHost.handle("harness-team:talk-threads", () => {
      /* 侧栏每次拉台账顺带自愈一次（幂等）：群已删、台账还留着的伙伴会话会被删掉并清账。 */
      void healOrphanTalkThreads().catch(() => undefined);
      /* ⛔ 11-09 用户令「群聊名字/头像实时同步给外面会话的伙伴会话」：
         名字/头像**不存快照**，每次按群成员表现算（群里改名/换头像 ⇒ 外面会话当场跟上）；
         群已删 ⇒ 回退台账名字，不至于把会话显示成空名。 */
      const store = readStore();
      const groups = new Map(store.groups.map((g) => [String(g.id), g]));
      const threads = listTalkThreads().map((row) => {
        const group = groups.get(String(row.groupId)) ?? null;
        return {
          ...row,
          ...talkPartnerIdentity(row, group),
          groupName: String(group?.name ?? ""),
        };
      });
      /* ⛔⛔ 11-09 用户截图「还被识别成中枢会话」：10-25 的中枢登记标记是全局 ref，
         点了「指挥中枢」后**改点已有会话**时它仍然为真 ⇒ 下一条出现的会话（这里正是伙伴会话）
         被登记进 BOSS 名单，侧栏徽标、中枢欢迎页、记忆路由全跟着串。
         现在：① 登记守卫在渲染层（pending + 伙伴台账双判据）；② 这里把**已经**误登记的历史条目静默摘掉。
         ⛔ 只摘身份、不删记忆目录 —— 误登记期间写进去的正是这位伙伴的记忆。 */
      void (async () => {
        let changed = false;
        for (const row of threads) {
          if (await unregisterBossSessionQuiet(row.threadId)) changed = true;
        }
        if (changed) broadcastHarnessEvent({ type: "boss-group", at: Date.now() } as never);
      })().catch(() => undefined);
      return { ok: true, threads };
    });

/* 一次性自愈：群档案里已经不存在的群，台账却还留着它的伙伴会话
   （用户实测：删群后侧栏仍挂着「伙伴」会话，点开是一段没有出处的对话）。
   ⛔ 只在群档案**存在且能解析**时动手 —— 文件缺失/损坏时 readStore() 会返回空群列表，
      拿它当依据会把所有伙伴会话误删。删不掉的下次启动会再试（台账留着即重试依据）。 */
let orphanTalkHealed = false;
async function healOrphanTalkThreads(): Promise<void> {
  if (orphanTalkHealed) return;
  const file = teamsFile();
  if (!existsSync(file)) return;
  try { JSON.parse(readFileSync(file, "utf8")); } catch { return; }
  const live = new Set(readStore().groups.map((g) => String(g.id)));
  const orphans = listTalkThreads().filter((row) => row.groupId && !live.has(row.groupId));
  orphanTalkHealed = true;
  if (!orphans.length) return;
  const { failed } = await deleteEngineThreads(orphans.map((row) => row.threadId));
  /* 只清删成功的；失败的留台账，下次启动再试（删成功但台账没清 = 标签永远摘不掉）。 */
  const failedSet = new Set(failed);
  forgetTalkThreads(orphans.map((row) => row.threadId).filter((tid) => !failedSet.has(tid)));
  broadcastHarnessEvent({ type: "team-talk-threads-changed", at: Date.now() } as never);
}

/* 解散群（11-06 补 / 11-07 用户令「删除群，对应的会话没有删除，外面对话框还能看见，遗留的」）。
       ⛔⛔ 旧口径是「只删群与群消息日志，一条子会话都不碰（会话是独立资产）」——
          用户实测的后果就是：群没了，但那些伙伴会话还挂在侧栏里，点开是一段**没有出处**的对话。
          ⇒ 现在删群**连带删掉本群派生出来的那些会话**。判据不是"按成员扫全部会话"（那会误删
          用户在主对话里派的活），而是**群日志里出现过的 threadId**：它们才是"这个群说过的那些话"。
       ⛔ 顺序：群记录先落盘（用户点了确认，不能因为某条会话删不掉就把群留着），会话尽力删；
          删不掉的降级 archive，别让它们继续出现在"未归档"列表里。
       ⛔ 磁盘残留 / 墓碑 / 委派登记表由 boot.ts 的 `thread/deleted` 分支统一收拾（另一条入口），
          这里只管发引擎请求。 */
    ipcHost.handle("harness-team:delete", async (_event, groupId: string) => {
      const store = readStore();
      const gid = String(groupId ?? "");
      const g = findGroup(store.groups, gid);
      if (!g) return { ok: false, error: "群不存在" };
      /* 群日志里的人类消息 threadId 是 `group:<群id>`（不是真会话）；只剩伙伴的真实子会话。
         ⛔⛔ 11-08 用户实测（删群后伙伴会话全留在侧栏：「联动性太差了」）：
            只按「群消息里出现过哪些 threadId」删会话是不够的 —— 聊天记录清空过 / 消息被去重掉时
            那里一条都没有。**群聊台账才是归属的权威来源**（`group-talk-threads.json`）⇒ 并上。 */
      const ledgerThreads = listTalkThreads().filter((row) => row.groupId === gid).map((row) => row.threadId);
      const threads = [...new Set([
        ...(store.messages[gid] ?? [])
          .map((row) => String((row as { threadId?: unknown } | null)?.threadId ?? ""))
          /* `group:` 是群投影、`cli:` 是本地 CLI 直跑的合成 id —— 都不是引擎会话，⛔ 不去删引擎。 */
          .filter((id) => id && !id.startsWith("group:") && !id.startsWith("cli:")),
        ...ledgerThreads,
      ])];
      const messages = { ...store.messages };
      delete messages[gid];
      writeStore({ groups: store.groups.filter((x) => x.id !== gid), messages, version: 2 });
      const { removed, failed } = await deleteEngineThreads(threads);
      /* 只清**删成功**的台账：删失败的留着，渲染层的「伙伴」标签会一直挂着 —— 这正是提醒
         （下次启动自愈会再试），⛔ 不能一把清光让它们变成永远没人管的孤儿会话。 */
      const failedSet = new Set(failed);
      const removedIds = threads.filter((tid) => !failedSet.has(tid));
      forgetTalkThreads(removedIds);
      /* ⛔ 同步清磁盘残留：运行账本 / 线程运行时登记，不等下次启动自愈。 */
      const artifacts = await cleanupThreadArtifacts(removedIds);
      broadcastHarnessEvent({ type: "team-talk-threads-changed", at: Date.now() } as never);
      return { ok: true, id: gid, removedThreads: removed, totalThreads: threads.length, failed, artifacts };
    });

    /* 清空聊天记录（用户 11-06：「没有清空记录功能」）。
       ⛔ 只清**群日志**（群视图的投影索引），伙伴的子会话与它们的真实产出一条都不动 ——
         这和「删群」同一个口径：群是视图，子会话是资产。 */
    ipcHost.handle("harness-team:clear-messages", (_event, groupId: string) => {
      const store = readStore();
      const gid = String(groupId ?? "");
      if (!findGroup(store.groups, gid)) return { ok: false, error: "群不存在", cleared: 0 };
      const cleared = (store.messages[gid] ?? []).length;
      writeStore({ ...store, messages: { ...store.messages, [gid]: [] } });
      groupClearedAt.set(gid, Date.now());
      return { ok: true, cleared };
    });

    /* 消息投影：多个子会话 → 群视图（重排 + 去重，⛔ 不造消息） */
    ipcHost.handle("harness-team:project", (_event, sources: unknown) => ({
      rows: projectGroupMessages(sources as never),
    }));

    /* ── P0b：群消息日志 ─────────────────────────────────────────────────────
       渲染层每派一次活就落两条：人的那句（threadId = `group:<群id>`，群本身就是真身）
       与伙伴的回复（threadId = 真实子会话 id）。⛔ 这里的 `at/id` 缺省在**主进程**补，
       免得渲染层各写一套时间口径（跨窗口/多面板时最容易漂）。 */
    ipcHost.handle("harness-team:messages", (_event, groupId: string) => {
      const store = readStore();
      const gid = String(groupId ?? "");
      if (!gid) return { ok: false, error: "缺群 id", rows: [] };
      return { ok: true, rows: projectGroupLog(store.messages[gid] ?? []) };
    });

    ipcHost.handle("harness-team:append-message", async (_event, groupId: string, entry: Record<string, unknown>) =>
      appendMessageTo(groupId, entry ?? {}));

    /* 手动派活（11-07 用户令「流程跑不通 / 关个弹窗任务就结束」）。
       ⛔⛔ 派活链**整体在主进程**：落用户消息 → 并发派活 → 成员产出回写群 → 互 @ 接力 → 账本。
          渲染层只发这一条就返回；⛔ 不 await 派活（一轮可能跑几分钟，等它 = 又回到老病）。
       ⛔ 面板关掉后这里照跑，产出照样进群日志 —— 这是"关弹窗任务不消失"的结构性保证。
       ⛔ 进度用广播（team-member-run）驱动，不靠渲染层的 Promise 生命周期。 */
    ipcHost.handle("harness-team:dispatch", async (_event, groupId: string, input: Record<string, unknown>) => {
      const store = readStore();
      const gid = String(groupId ?? "");
      const g = findGroup(store.groups, gid);
      if (!g) return { ok: false, error: "群不存在" };
      const text = String(input?.text ?? "").trim();
      if (!text) return { ok: false, error: "说点什么再发" };
      const memberIds = Array.isArray(input?.memberIds)
        ? (input.memberIds as unknown[]).map((x) => String(x ?? "")).filter(Boolean)
        : [];
      const params = (input?.params && typeof input.params === "object" ? input.params : {}) as DispatchParams;
      /* ⛔⛔ 11-07 真机：用户发完消息群里显示「这个群还没有说过话」——
         因为整个 dispatch 是"先排后台再返回"，渲染层拿到 ok 立刻重读时消息还没落盘。
         ⇒ 落盘 + 校验这段**必须 await 完再返回**，并把权威 rows 一起带回去（一次渲染到位）。 */
      const opened = await prepareGroupDispatch(g, text, memberIds, "human");
      if ("error" in opened) return { ok: false, error: opened.error };
      void runDispatchRounds(g, opened.targets, text, "human", {
        params,
        catalog: opened.catalog,
        /* 手动派活允许伙伴互相 @（一跳 + 总量 4，护栏在 runDispatchRounds 里）。 */
        allowChain: true,
        onPhase: (phase, target, info) => {
          broadcastHarnessEvent({
            type: "team-member-run",
            phase,
            groupId: gid,
            memberId: target.id,
            name: target.name,
            ok: info.ok,
            error: info.error,
            threadId: info.threadId,
            at: Date.now(),
          } as never);
        },
      })
        .then((r) => broadcastHarnessEvent({ type: "team-dispatch-done", groupId: gid, sent: r.sent, failed: r.failed } as never))
        .catch((err) => {
          /* ⛔ 整段派活炸了（不是单个成员失败）也要留痕：面板关着时这是用户唯一能看到的原因。 */
          const reason = err instanceof Error ? err.message : String(err);
          void appendMessageTo(gid, {
            id: `sys-dispatch-failed:${Date.now()}`,
            authorId: "system",
            authorKind: "bot",
            senderKind: "system",
            text: `派活中断：${reason}`,
          }).catch(() => undefined);
          broadcastHarnessEvent({ type: "team-dispatch-done", groupId: gid, sent: 0, failed: [reason] } as never);
        });
      return { ok: true, queued: opened.targets.length, rows: opened.rows };
    });

    /* 到点扫描：30s 一拍（与「设置 → 自动化」同一个节奏）。
       ⛔ 不用事件驱动/秒级轮询：这是"群里的闹钟"，精度到分钟就够，白烧 CPU 的轮询是负担。
       ⛔ 启停跟着 feature 生命周期走（`ctx.effect` 的清理函数里 clearInterval）。 */
    const timer = setInterval(() => { void tickGroupSchedules().catch(() => undefined); }, 30_000);

    ctx.effect(() => () => clearInterval(timer));

    /* ⛔⛔ 11-07「关掉群弹窗就没结果回传」的结构性修复：
       把「写一条群消息」注入给 `team-group-bridge` —— 团队成员回合结束时（`team-invoke`）
       用同一个幂等 id（`team-run:<runId>`，与渲染层一致）把产出落进群日志，**不再依赖面板开着**。 */
    /* ⛔ 11-08 审查：主理人工具派活的产出也过清空代际 —— 开跑后用户清空过记录就只结算、不落盘。 */
    setTeamGroupAppender((gid, entry, since) => {
      const cleared = groupClearedAt.get(gid) ?? 0;
      if (since && cleared > since) return Promise.resolve({ ok: true });
      return appendMessageTo(gid, entry);
    });
    /* ⛔ 11-11：群聊会话的团队派活已异步排片 —— 成员全部跑完后由这里把话头交回主理人。
       ⛔ 只注入"通知"函数，真正的回合仍走 runDispatchRounds（自带串行队列与安全阀）。 */
    setTeamGroupRelay((gid, teamId, note) => {
      void relayLeadAfterMembers(gid, teamId, note).catch(() => undefined);
    });
    /* ⛔⛔ 11-12 用户：「模型不知道自己要干什么，成员也不知道自己要干什么，团队是散的，
       互相不了解对方的能力和擅长领域」。⇒ 成员开跑时（team-invoke）要能读到群里的**共享上下文**
       （主理人刚发的计划 / 上一环交回了什么）。这里只注入只读口，⛔ 不让 team-invoke import 群存储。 */
    setTeamGroupReader((gid) => (readStore().messages?.[gid] ?? []) as never);
    /* ⛔ 群聊会话的工具调用由独立板块自己应答（它的事件会被 filterForRenderer 裁掉）。 */
    ctx.effect(attachGroupTalkEvents(server));
    ctx.effect(() => () => { setTeamGroupAppender(null); setTeamGroupRelay(null); setTeamGroupReader(null); });
    ctx.effect(() => {
      for (const ch of HARNESS_TEAM_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
