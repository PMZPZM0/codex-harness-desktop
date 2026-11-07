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
  groupContextBlock,
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
  GROUP_MAX_PARTNERS,
  MAX_GROUP_FILES,
  MAX_GROUP_MEMORY_CHARS,
  MAX_GROUP_MESSAGES,
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
/* ⛔ 定时任务的"下一次什么时候跑"**不在本文件算**：RRULE 构造 / 相位守恒 / 补跑窗口
   的唯一真相源是 electron/scheduler.ts（与「设置 → 自动化」同一个引擎）。 */
import { buildRRuleFromInput, computeNextRunAt } from "../scheduler";
import { runDelegatedTask } from "./delegation";
import { buildDispatchCatalog } from "./dispatch-core";
import { broadcastHarnessEvent } from "./window-bus";
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

async function dispatchGroupText(
  group: GroupShape,
  text: string,
  memberIds: string[],
  source: "human" | "automation",
  options: { params?: DispatchParams; allowChain?: boolean; onPhase?: DispatchPhase } = {},
): Promise<{ ok: boolean; sent: number; failed: string[] }> {
  /* 团成员名录与互 @ 判据：与渲染层共用同一份目录（⛔ 不各自拉一次）。 */
  const catalog = await buildDispatchCatalog().catch(() => []);
  const resolved = resolveGroupTargets(group, memberIds, catalog);
  if (resolved.error) return { ok: false, sent: 0, failed: [resolved.error] };
  const targets = resolved.targets;
  const saved = await appendMessageTo(group.id, {
    authorId: source === "automation" ? AUTOMATION_ACTOR_ID : "local-user",
    authorKind: "human",
    /* ⛔⛔ 11-07 用户令：定时任务不是「用户发的」⇒ 结构化发送者，群视图据此出徽标。 */
    senderKind: source === "automation" ? "automation" : "user",
    text,
    mentions: targets.map((m) => m.id),
  });
  if (!saved.ok) return { ok: false, sent: 0, failed: [saved.error || "群消息没存上"] };

  const failed: string[] = [];
  const ranIds = new Set<string>();
  /* 伙伴之间互相 @ 的预算（手动派活才接力；定时任务不递归 —— 无人值守再互 @ 就是烧钱）。
     ⛔ 两条护栏：只走**一跳** + 一轮总量 4，防两个伙伴互 @ 无限对烧。 */
  let chainBudget = options.allowChain ? 4 : 0;
  const params = options.params ?? {};
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
      /* 团伙伴按 team 写身份块（成员名单 / 互 @ 规则），单人伙伴按自己的角色写。 */
      const ctx = groupContextBlock(group, { forMemberId: partner.id, forTeam: partner.targetKind === "team", catalog });
      const query = ctx ? `${ctx}\n\n---\n\n${bodyText}` : bodyText;
      options.onPhase?.("started", partner, {});
      const res = await runDelegatedTask({
        kind: partner.targetKind as "expert" | "team" | "member" | "subagent" | "cli",
        name: partner.targetKey,
        query,
        cwd: group.workspace || undefined,
        /* ⛔ originThreadId 留空：群聊没有"群主会话"，闸与复用都按这个口径走。 */
        originThreadId: "",
        /* ⛔ 侧栏「群调度」标签的判据（群派活 / 群定时任务同口径）。 */
        source: "group",
        /* ⛔⛔ 11-07：origin 为空 ≠ 本地用户。定时任务 / 伙伴互 @ 各带真实身份下去。 */
        sender: source === "automation"
          ? { kind: "automation", name: "定时任务" }
          : hop > 0
            ? { kind: "member", name: caller?.name ?? partner.name }
            : { kind: "user" },
        ...(params.model ? { model: params.model } : {}),
        ...(params.effort ? { effort: params.effort } : {}),
        ...(params.sandbox ? { sandbox: params.sandbox } : {}),
        ...(params.approvalPolicy ? { approvalPolicy: params.approvalPolicy } : {}),
      });
      if (!res?.ok || !res?.threadId) {
        errMsg = res?.error || "派活失败";
        failed.push(`${partner.name}：${errMsg}`);
        options.onPhase?.("finished", partner, { ok: false, error: errMsg });
        return;
      }
      threadId = res.threadId;
      const output = String(res.output ?? "").trim();
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
          chainBudget -= 1;
          /* ⛔ 不 await：主回复先上屏，被叫的人稍后自己进来（否则一个人卡住整条链）。
             ⛔ 以前把整条原消息又发一遍，被叫的人不知道自己要做什么。 */
          void runOne(next, 1, { id: partner.id, name: partner.name }, `（${partner.name} 在群里叫你）${ask.ask}`);
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
  return { ok: failed.length < targets.length, sent: targets.length - failed.length, failed };
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

    /* 停止某个伙伴当前这一次运行（用户：`@成员 /stop`）。
       ⛔ 只中断**这一回合**（turn/interrupt），不删会话、不影响下一次派活；
       ⛔ 拿不到 turnId 就明确说"它现在没在跑"，别假装发了个停止信号。 */
    ipcHost.handle("harness-team:stop", async (_event, input: Record<string, unknown>) => {
      /* ⛔ 收的是**候选会话 id** + 目标身份，不是单个 id：
         · 派活正在跑的时候 `agents:invoke` 还没返回 threadId（它等整个回合）⇒ 渲染层拿不到
           "正在跑的那条会话"；
         · 所以候选 = 渲染层给的（历史消息/上次记的）+ **主进程侧登记表里同目标正在跑的**。
         ⛔ 活动回合表的键是 turnId、值是 threadId（boot.ts `set(id, threadIdOf)`）——
           按 `get(threadId)` 写会永远拿不到（第一版就是这么错的）。 */
      const given = Array.isArray(input?.threadIds) ? (input.threadIds as unknown[]) : [];
      const targetKey = String(input?.targetKey ?? "");
      const memberName = String(input?.memberName ?? "");
      const fromRows = given.map((x) => String(x ?? "").trim()).filter(Boolean);
      let fromRegistry: string[] = [];
      try {
        fromRegistry = delegateRegistry?.runningThreadsByMember(memberName, targetKey) ?? [];
      } catch { /* 登记表未就绪：只用渲染层给的候选 */ }
      const list = [...new Set([...fromRegistry, ...fromRows])].slice(0, 24);
      if (!list.length) return { ok: false, error: "还没有它的会话（先派一次活）" };
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
    });

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
      /* 前置校验在**返回前**做完：@ 了没绑定的伙伴 / 全被静音，用户要立刻看到原因，
         而不是"发送成功"然后群里毫无动静。 */
      const catalog = await buildDispatchCatalog().catch(() => []);
      const resolved = resolveGroupTargets(g, memberIds, catalog);
      if (resolved.error) return { ok: false, error: resolved.error };
      void dispatchGroupText(g, text, memberIds, "human", {
        params,
        /* 手动派活允许伙伴互相 @（一跳 + 总量 4，护栏在 dispatchGroupText 里）。 */
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
        .catch((err) => broadcastHarnessEvent({
          type: "team-dispatch-done",
          groupId: gid,
          sent: 0,
          failed: [err instanceof Error ? err.message : String(err)],
        } as never));
      return { ok: true, queued: resolved.targets.length };
    });

    /* 到点扫描：30s 一拍（与「设置 → 自动化」同一个节奏）。
       ⛔ 不用事件驱动/秒级轮询：这是"群里的闹钟"，精度到分钟就够，白烧 CPU 的轮询是负担。
       ⛔ 启停跟着 feature 生命周期走（`ctx.effect` 的清理函数里 clearInterval）。 */
    const timer = setInterval(() => { void tickGroupSchedules().catch(() => undefined); }, 30_000);

    ctx.effect(() => () => clearInterval(timer));
    ctx.effect(() => {
      for (const ch of HARNESS_TEAM_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
