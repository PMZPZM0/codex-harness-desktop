/**
 * harness-team · 主进程板块（团队模式 P0，10-05 立）
 *
 * 独立板块：只服务「群 / 伙伴 / 护栏」这一件事，⛔ 不往 expert-teams / delegation 里借住。
 * 判定全部走 `src/lib/team-models.mjs`（纯函数单一真相源），本文件只负责**取路径、读写盘、回 IPC**。
 *
 * 域：harness-team
 * 通道：list / create / rename / add-partner / remove-partner / mute / set-guard / project
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
  removePartner,
  setPartnerMuted,
  GROUP_MAX_PARTNERS,
  MAX_GROUP_MESSAGES,
} from "../../src/lib/team-models.mjs";

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

    /* 列表：群 + 每个群的一致性问题（设置页直接显示文案，不用自己算） */
    ipcHost.handle("harness-team:list", () => {
      const store = readStore();
      const groups = store.groups;
      return { groups, issues: groups.map((g) => ({ id: g.id, issues: groupIssues(g) })), limit: GROUP_MAX_PARTNERS };
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
