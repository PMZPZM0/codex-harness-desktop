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
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import {
  addPartner,
  appendGroupMessage,
  createBlockers,
  createGroup,
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
import { normalizeMenu, MENU_MAX_ITEMS } from "../../src/lib/team-menu.mjs";
/* ⛔ 停止运行复用引擎侧的活动回合表（threadId → turnId）：这是**唯一真相源**，
   别在这里自己记一份"我以为在跑什么"（两处必然漂）。 */
import { delegateRegistry, engineActiveTurnIds, server } from "../runtime-refs";
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
  "harness-team:delete",
  "harness-team:set-memory",
  "harness-team:set-files",
  "harness-team:set-manager",
  "harness-team:add-note",
  "harness-team:remove-note",
  "harness-team:set-menu",
  "harness-team:log-usage",
  "harness-team:ledger",
  "harness-team:stop",
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

    /* 记一条用量（渲染层每次派活完成/失败各调一次）。
       ⛔ 失败也记：失败也烧了 token，且失败率本身是最该看的指标。 */
    ipcHost.handle("harness-team:log-usage", (_event, entry: Record<string, unknown>) => {
      const e = normalizeLedgerEntry(entry);
      if (!e) return { ok: false, error: "用量记录无效（缺伙伴 id）" };
      const next = appendLedger(readLedger(), { ...e, at: e.at || Date.now() });
      writeLedger(next as NonNullable<LedgerEntryShape>[]);
      return { ok: true, count: next.length };
    });

    /* 用量汇总：按 (agent, 来源) 两个维度拆（豆包实测口径）。 */
    ipcHost.handle("harness-team:ledger", (_event, groupId: string, days: number) => {
      const list = readLedger();
      return {
        ok: true,
        ...summarizeLedger(list, { groupId: String(groupId ?? ""), days: Number(days ?? 7) || 7 }),
      };
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

    /* 解散群（11-06 补）：只删群与它的**群消息日志**，⛔ 不碰任何子会话 ——
       伙伴的会话是独立资产（它们可能被别的群/主会话复用），删群不该连带删会话。 */
    ipcHost.handle("harness-team:delete", (_event, groupId: string) => {
      const store = readStore();
      const gid = String(groupId ?? "");
      const g = findGroup(store.groups, gid);
      if (!g) return { ok: false, error: "群不存在" };
      const messages = { ...store.messages };
      delete messages[gid];
      writeStore({ groups: store.groups.filter((x) => x.id !== gid), messages, version: 2 });
      return { ok: true, id: gid };
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

    ipcHost.handle("harness-team:append-message", (_event, groupId: string, entry: Record<string, unknown>) => {
      const store = readStore();
      const gid = String(groupId ?? "");
      if (!gid) return { ok: false, error: "缺群 id", rows: [] };
      if (!findGroup(store.groups, gid)) return { ok: false, error: "群不存在", rows: [] };
      const at = Number(entry?.at ?? 0) || Date.now();
      const id = String(entry?.id ?? "").trim() || `msg_${at.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      const authorKind = entry?.authorKind === "bot" ? "bot" : "human";
      /* ⛔ 人的消息挂群自身；伙伴的消息必须带**真实子会话 id**，否则判无效（不造真身） */
      const threadId = String(entry?.threadId ?? "").trim() || (authorKind === "human" ? groupThreadId(gid) : "");
      const next = appendGroupMessage(store.messages[gid] ?? [], {
        ...entry,
        id,
        threadId,
        at,
        authorKind,
      });
      const saved = next.find((m) => String(m?.id ?? "") === id) ?? null;
      if (!saved) return { ok: false, error: "消息无效（缺子会话归属）", rows: projectGroupLog(store.messages[gid] ?? []) };
      writeStore({ ...store, messages: { ...store.messages, [gid]: next } });
      return { ok: true, entry: saved, rows: projectGroupLog(next) };
    });

    ctx.effect(() => {
      for (const ch of HARNESS_TEAM_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
