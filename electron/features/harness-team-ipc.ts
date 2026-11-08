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
  withMentionPrefix,
  GROUP_MAX_PARTNERS,
  MAX_GROUP_FILES,
  MAX_GROUP_MEMORY_CHARS,
  MAX_GROUP_MESSAGES,
  teamKidsOf,
  teamAuthorIdOf,
  teamMemberIdOf,
} from "../../src/lib/team-models.mjs";
import { normalizeMenu, normalizeMenuPlacement, MENU_MAX_ITEMS } from "../../src/lib/team-menu.mjs";
import {
  MAX_GROUP_SCHEDULES,
  normalizeScheduleEntry,
  normalizeSchedules,
  scheduleBlockers,
} from "../../src/lib/team-schedule.mjs";
/* ⛔ 停止运行复用引擎侧的活动回合表（threadId → turnId）：这是**唯一真相源**，
   别在这里自己记一份"我以为在跑什么"（两处必然漂）。 */
import { delegateRegistry, engineActiveTurnIds, server } from "../runtime-refs";
import { stopTeamRuns, type TeamStopInput } from "./harness-team-stop";
import { startTeamQueued, type TeamQueueStartInput } from "./harness-team-queue";
/* ⛔ 定时任务的"下一次什么时候跑"**不在本文件算**：RRULE 构造 / 相位守恒 / 补跑窗口
   的唯一真相源是 electron/scheduler.ts（与「设置 → 自动化」同一个引擎）。 */
import { buildRRuleFromInput, computeNextRunAt } from "../scheduler";
import { buildDispatchCatalog } from "./dispatch-core";
/* ⛔⛔ 11-07 用户令：「群聊是独立板块、独立通道，群聊不需要调度」 ——
   群聊会话/工具/消息投递全在 group-talk/ 里，⛔ 不走外面的 runDelegatedTask 调度链。 */
import { runTalkTurn, buildTalkInput, setGroupTalkHooks, attachGroupTalkEvents, type TalkMember } from "./group-talk";
import { broadcastHarnessEvent } from "./window-bus";
/* ⛔ 11-07：团队成员产出落群的桥（关面板也照写；见 team-group-bridge.ts） */
import { bindTeamGroup, setTeamGroupAppender } from "../team-group-bridge";
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
type StoreShape = {
  version: number;
  groups: GroupShape[];
  messages: Record<string, ReturnType<typeof normalizeGroupMessage>[]>;
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
    return {
      version: 2,
      /* ⛔ 过一遍 createGroup：老文件缺字段（新增护栏/目标绑定）也能读出来 */
      groups: rows.map((g: unknown) => createGroup(g as Record<string, unknown>) as GroupShape).filter((g: GroupShape) => Boolean(g.id)),
      messages,
    };
  } catch {
    return empty;
  }
}

function writeStore(store: StoreShape): { ok: boolean } {
  const file = teamsFile();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: 2, groups: store.groups, messages: store.messages }, null, 2), "utf8");
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
  return mutateStore<AppendResult>((store) => {
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
    const hit = list.find((t) => t
      && t.kind === "member"
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
  if (!picked.length && !virtuals.length) return { targets: [], error: "先 @ 至少一个伙伴" };
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
type DispatchParams = { model?: string; effort?: string; sandbox?: string; approvalPolicy?: string };

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
  const resolved = resolveGroupTargets(group, memberIds, catalog);
  if (resolved.error) return { error: resolved.error };
  const targets = resolved.targets;
  const saved = await appendMessageTo(group.id, {
    authorId: source === "automation" ? AUTOMATION_ACTOR_ID : "local-user",
    authorKind: "human",
    /* ⛔⛔ 11-07 用户令：定时任务不是「用户发的」⇒ 结构化发送者，群视图据此出徽标。 */
    senderKind: source === "automation" ? "automation" : "user",
    /* ⛔⛔ 11-07 真机「艾特@看不见」：@ 是结构化 memberIds，正文里没有 @名字 ⇒
       消息里一个提及都渲染不出来。把目标名字补进正文开头（同源、只一份）。 */
    text: withMentionPrefix(text, targets.map((m) => m.name)),
    mentions: targets.map((m) => m.id),
  });
  if (!saved.ok) return { error: saved.error || "群消息没存上" };
  return { targets, catalog, rows: saved.rows };
}

/** 派活轮次（慢：一轮可能跑几分钟）。⛔ 调用方一律 `void` 它，不许 await。 */
async function runDispatchRounds(
  group: GroupShape,
  targets: GroupTarget[],
  text: string,
  source: "human" | "automation",
  options: { params?: DispatchParams; allowChain?: boolean; onPhase?: DispatchPhase; catalog?: unknown[] } = {},
): Promise<{ ok: boolean; sent: number; failed: string[] }> {
  const catalog = Array.isArray(options.catalog) ? options.catalog : await buildDispatchCatalog().catch(() => []);
  const failed: string[] = [];
  const ranIds = new Set<string>();
  /* 伙伴之间互相 @ 的预算（手动派活才接力；定时任务不递归 —— 无人值守再互 @ 就是烧钱）。
     ⛔ 两条护栏：只走**一跳** + 一轮总量 4，防两个伙伴互 @ 无限对烧。 */
  let chainBudget = options.allowChain ? 4 : 0;
  const params = options.params ?? {};
  /* ⛔ 群聊名册：群成员 + 展开的团成员（合成 id）—— 每位都有自己的长期会话，
     所以团成员之间也能互相说话，不再需要「主理人代转」。 */
  const roster: TalkMember[] = [
    ...group.members.map((m) => ({
      id: m.id, name: m.name, targetKind: m.targetKind, targetKey: m.targetKey, targetProfession: m.targetProfession,
    })),
    ...teamKidsOf(group, catalog).map((kid) => ({
      id: teamAuthorIdOf(String(group.members.find((m) => m.targetKind === "team")?.targetKey ?? ""), teamMemberIdOf(kid as unknown as Record<string, unknown>)),
      name: String(kid.name), targetKind: "member", targetKey: teamMemberIdOf(kid as unknown as Record<string, unknown>),
      targetProfession: String((kid as unknown as Record<string, unknown>).profession ?? ""),
    })),
  ];
  const talkOptions = {
    groupId: group.id,
    groupName: group.name,
    cwd: group.workspace || undefined,
    memory: String((group as unknown as Record<string, unknown>).memory ?? ""),
    roster,
    group: group as unknown as Record<string, unknown>,
    catalog,
  };
  /* 工具 hooks：模型在会话里主动调 group_say(to=名字) ⇒ 这里把话投递进对方会话。 */
  setGroupTalkHooks(group.id, {
    append: (gid: string, entry: Record<string, unknown>) => appendMessageTo(gid, entry),
    relay: (gid: string, fromId: string, toName: string, msg: string) => {
      const to = roster.find((m) => String(m.name).replace(/\s+/g, "") === String(toName).replace(/\s+/g, ""));
      if (!to) return Promise.resolve({ ok: false, error: `群里没有叫「${toName}」的人` });
      const from = roster.find((m) => m.id === fromId) ?? { id: fromId, name: "群成员" };
      /* ⛔ 不 await：工具调用立刻返回，被叫的人稍后自己在群里回话。 */
      /* ⛔ hop=0：工具发起的对话也要能继续接力（只跳一跳就变成「说一句就断」）。 */
      void runOne(to as unknown as GroupTarget, 0, { id: from.id, name: from.name }, msg).catch(() => undefined);
      return Promise.resolve({ ok: true });
    },
    readMessages: (limit: number) => {
      const rows = readStore().messages?.[group.id] ?? [];
      return Promise.resolve(rows.filter(Boolean).slice(-Math.max(1, Math.min(50, limit))).map((raw) => {
        const m = raw as unknown as Record<string, unknown>;
        const authorId = String(m.authorId ?? "");
        return {
          speaker: roster.find((x) => x.id === authorId)?.name ?? (authorId === "local-user" ? "我" : authorId),
          text: String(m.text ?? ""),
        };
      }));
    },
    members: () => Promise.resolve(roster.map((m) => ({ id: m.id, name: m.name, profession: m.targetProfession }))),
  });
  const runOne = async (
    partner: GroupTarget,
    hop = 0,
    caller?: { id: string; name: string },
    bodyText = text,

  ): Promise<void> => {
    if (!partner || ranIds.has(partner.id)) return;
    ranIds.add(partner.id);
    const startedAt = Date.now();
    let chars = 0;
    let threadId = "";
    let okFlag = false;
    let errMsg = "";
    try {
      /* ⛔⛔ 11-07 用户令：群聊走**独立通道**。这里给成员的是「群里有人对你说了一句」，
         不是任务派发：不注入 groupContextBlock 的协作协议、不调 runDelegatedTask、
         不产生「被调度会话」和它那套「没有调度权限」的会话级指令。 */
      const fromTalk: TalkMember = caller
        ? { id: caller.id, name: caller.name }
        : (source === "automation" ? { id: AUTOMATION_ACTOR_ID, name: "定时任务" } : { id: "local-user", name: "我" });
      const query = buildTalkInput(talkOptions as Parameters<typeof buildTalkInput>[0], partner as TalkMember, fromTalk, bodyText);
      /* ⛔ 保留团 → 群的绑定（团成员若仍由 team_member_invoke 起，产出照样落群）。 */
      if (partner.targetKind === "team") bindTeamGroup(partner.targetKey, group.id);
      options.onPhase?.("started", partner, {});
      const res = await withDispatchTimeout(runTalkTurn(group.id, partner as TalkMember, query, {
        cwd: group.workspace || undefined,
        groupName: group.name,
        ...(params.effort ? { effort: params.effort } : {}),
      }), partner.name);
      if (!res?.ok || !res?.threadId) {
        errMsg = "群聊会话没起来";
        failed.push(`${partner.name}：${errMsg}`);
        options.onPhase?.("finished", partner, { ok: false, error: errMsg });
        return;
      }
      threadId = res.threadId;
      const output = String(res.text ?? "").trim();
      chars = query.length + output.length;
      const wrote = await appendMessageTo(group.id, {
        authorId: partner.id,
        authorKind: "bot",
        senderKind: "member",
        threadId,
        text: output || "（没有返回文本内容）",
        via: caller ? { memberId: caller.id, name: caller.name } : null,
      });
      okFlag = Boolean(wrote.ok);
      if (!wrote.ok) {
        errMsg = wrote.error || "产出没能写进群聊记录";
        failed.push(`${partner.name}：${errMsg}`);
      }
      options.onPhase?.("finished", partner, { ok: okFlag, error: errMsg || undefined, threadId });
      if (hop === 0 && chainBudget > 0 && okFlag && output) {
        const asks = parseAgentMentions(output, group, {
          excludeId: partner.id,
          alreadyRan: [...ranIds],
          max: chainBudget,
          catalog,
        });
        for (const ask of asks) {
          const next = (ask.target ?? group.members.find((m) => m.id === ask.memberId)) as unknown as GroupTarget | undefined;
          if (!next || ranIds.has(next.id)) continue;
          /* ⛔⛔ 11-07 真机：同一位团成员被**派了两次**（群里两条几乎一样的自我介绍，同一会话跑了两轮）。
             根因：主理人回复里行首 @ 了四位成员 —— 它自己在回合内已经用 `team_member_invoke` 派过一遍，
             宿主又按"行首点名"重派一遍。
             ⇒ 主理人（team）@ 的**团成员**交给它自己的工具去编排；宿主只接力"非团成员"目标
               （别的专家 / 子智能体 / 另一个团）。团成员之间的互 @ 仍由成员那条回合触发（下面照走）。
             ⛔ 不要把这一条删掉换成"靠主理人自觉"：重复一次就是双倍 token + 群里两条一样的消息。 */
          if (partner.targetKind === "team" && String(next.targetKind) === "member") continue;
          chainBudget -= 1;
          /* ⛔ 不 await：主回复先上屏，被叫的人稍后自己进来（否则一个人卡住整条链）。
             ⛔ 以前把整条原消息又发一遍，被叫的人不知道自己要做什么。 */
          void runOne(next, 1, { id: partner.id, name: partner.name }, ask.ask);
        }
      }
    } catch (err) {
      errMsg = err instanceof Error ? err.message : String(err);
      failed.push(`${partner.name}：${errMsg}`);
      options.onPhase?.("finished", partner, { ok: false, error: errMsg });
    } finally {
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
      text: `派活失败（${failed.length}/${targets.length}）：\n${failed.map((f) => `· ${f}`).join("\n")}`,
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
async function withDispatchTimeout<T>(task: Promise<T>, name: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${name} 派活超时（${Math.round(DISPATCH_TIMEOUT_MS / 60000)} 分钟）—— 引擎可能没起来，去「设置 → 模型」看凭据/状态`)),
          DISPATCH_TIMEOUT_MS,
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
      return saveOne(store, setMemberAvatar(g, memberId, avatar) as GroupShape);
    });

    /* 群消息排版（11-07 用户令：进群设置、卡片选择，换机/重装也要保留）——
       落进群 JSON（⛔ 不再只存在 localStorage）。 */
    ipcHost.handle("harness-team:set-message-layout", (_event, groupId: string, layout: string) => {
      const store = readStore();
      const g = findGroup(store.groups, String(groupId ?? ""));
      if (!g) return { ok: false, error: "群不存在" };
      return saveOne(store, setMessageLayout(g, layout) as GroupShape);
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
      /* 群日志里的人类消息 threadId 是 `group:<群id>`（不是真会话）；只剩伙伴的真实子会话。 */
      const threads = [...new Set(
        (store.messages[gid] ?? [])
          .map((row) => String((row as { threadId?: unknown } | null)?.threadId ?? ""))
          .filter((id) => id && !id.startsWith("group:")),
      )];
      const messages = { ...store.messages };
      delete messages[gid];
      writeStore({ groups: store.groups.filter((x) => x.id !== gid), messages, version: 2 });

      let removed = 0;
      const failed: string[] = [];
      for (const tid of threads) {
        try {
          /* 正在跑的回合不打断，引擎会拒绝删（报 turn in progress）⇒ 先中断这一回合。 */
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
      return { ok: true, id: gid, removedThreads: removed, totalThreads: threads.length, failed };
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
    setTeamGroupAppender((gid, entry) => appendMessageTo(gid, entry));
    /* ⛔ 群聊会话的工具调用由独立板块自己应答（它的事件会被 filterForRenderer 裁掉）。 */
    ctx.effect(attachGroupTalkEvents(server));
    ctx.effect(() => () => setTeamGroupAppender(null));
    ctx.effect(() => {
      for (const ch of HARNESS_TEAM_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
