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
  createGroup,
  groupIssues,
  projectGroupMessages,
  removePartner,
  setPartnerMuted,
  GROUP_MAX_PARTNERS,
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
];

/** 配置文件路径（惰性：每次调用现取，⛔ 不在模块体缓存）。 */
function teamsFile(): string {
  return join(app.getPath("userData"), "harness-teams.json");
}

type GroupShape = ReturnType<typeof createGroup>;

function readAll(): GroupShape[] {
  const file = teamsFile();
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const rows = Array.isArray(parsed?.groups) ? parsed.groups : [];
    /* ⛔ 过一遍 createGroup：老文件缺字段（新增护栏/字段）也能读出来，不会因一处 undefined 整页崩 */
    return rows.map((g: unknown) => createGroup(g as Record<string, unknown>) as GroupShape).filter((g: GroupShape) => Boolean(g.id));
  } catch {
    return [];
  }
}

function writeAll(groups: GroupShape[]): { ok: boolean } {
  const file = teamsFile();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: 1, groups }, null, 2), "utf8");
  renameSync(tmp, file);
  return { ok: true };
}

/** 按 id 找到群；找不到返回 null（调用方决定怎么报错）。 */
function findGroup(groups: GroupShape[], groupId: string): GroupShape | null {
  return groups.find((g) => g.id === String(groupId)) ?? null;
}

/** 落盘并回带最新群对象（渲染层直接用返回值刷新，不用再拉一次全量）。 */
function saveOne(groups: GroupShape[], next: GroupShape) {
  const merged = groups.map((g) => (g.id === next.id ? next : g));
  writeAll(merged);
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
      const groups = readAll();
      return { groups, issues: groups.map((g) => ({ id: g.id, issues: groupIssues(g) })), limit: GROUP_MAX_PARTNERS };
    });

    ipcHost.handle("harness-team:create", async (_event, input: Record<string, unknown>) => {
      const groups = readAll();
      const id = String(input?.id ?? "") || `grp_${Date.now().toString(36)}`;
      if (findGroup(groups, id)) return { ok: false, error: "群 id 已存在" };
      const next = createGroup({ ...input, id }) as GroupShape;
      const issues = groupIssues(next);
      if (issues.length) return { ok: false, error: issues.join("；"), issues };
      writeAll([...groups, next]);
      return { ok: true, group: next, issues };
    });

    ipcHost.handle("harness-team:rename", (_event, groupId: string, name: string) => {
      const groups = readAll();
      const g = findGroup(groups, groupId);
      if (!g) return { ok: false, error: "群不存在" };
      const next = createGroup({ ...g, name: String(name ?? "").trim() || g.name }) as GroupShape;
      return saveOne(groups, next);
    });

    /* 加伙伴：上限/去重判定在纯函数里，这里只负责持久化 */
    ipcHost.handle("harness-team:add-partner", (_event, groupId: string, partner: Record<string, unknown>, addedBy: string) => {
      const groups = readAll();
      const g = findGroup(groups, groupId);
      if (!g) return { ok: false, error: "群不存在" };
      const r = addPartner(g, partner, addedBy) as { ok: boolean; reason?: string; limit?: number; group: GroupShape; changed?: boolean };
      if (!r.ok) {
        const msg = r.reason === "limit" ? `已达上限（最多 ${r.limit} 个伙伴）` : r.reason === "invalid" ? "伙伴信息无效" : "加入失败";
        return { ok: false, error: msg, reason: r.reason, limit: r.limit, group: r.group };
      }
      return { ...saveOne(groups, r.group), changed: r.changed };
    });

    ipcHost.handle("harness-team:remove-partner", (_event, groupId: string, partnerId: string, byId: string) => {
      const groups = readAll();
      const g = findGroup(groups, groupId);
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
      return { ...saveOne(groups, r.group), changed: r.changed };
    });

    ipcHost.handle("harness-team:mute", (_event, groupId: string, partnerId: string, muted: boolean) => {
      const groups = readAll();
      const g = findGroup(groups, groupId);
      if (!g) return { ok: false, error: "群不存在" };
      return saveOne(groups, setPartnerMuted(g, partnerId, muted) as GroupShape);
    });

    ipcHost.handle("harness-team:set-guard", (_event, groupId: string, guard: Record<string, unknown>) => {
      const groups = readAll();
      const g = findGroup(groups, groupId);
      if (!g) return { ok: false, error: "群不存在" };
      const next = createGroup({ ...g, guard: { ...g.guard, ...guard } }) as GroupShape;
      return saveOne(groups, next);
    });

    /* 消息投影：多个子会话 → 群视图（重排 + 去重，⛔ 不造消息） */
    ipcHost.handle("harness-team:project", (_event, sources: unknown) => ({
      rows: projectGroupMessages(sources as never),
    }));

    ctx.effect(() => {
      for (const ch of HARNESS_TEAM_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
