/**
 * 团队模式 · 状态钩子（P0）
 *
 * ⛔ 不引入全局 store（项目纪律）：群状态是**这个面板自己的**，随面板生命周期存在。
 * ⛔ 所有业务判定都走主进程（那里调 `team-models.mjs`）—— 这里只负责调桥、收结果、报错。
 */
import { useCallback, useEffect, useState } from "react";
import type { TeamGroup } from "./01-team-types";

type ListResult = {
  groups: TeamGroup[];
  issues: { id: string; issues: string[] }[];
  limit: number;
};

type MutationResult = { ok: boolean; group?: TeamGroup; error?: string; changed?: boolean; limit?: number };

/** 当前用户在本地的身份（P0 用固定值：群主 = 第一个人类成员；后续接账号库）。 */
export const LOCAL_ACTOR_ID = "local-user";

export function useTeamGroups() {
  const [groups, setGroups] = useState<TeamGroup[]>([]);
  const [issues, setIssues] = useState<Record<string, string[]>>({});
  const [limit, setLimit] = useState(8);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  const refresh = useCallback(async () => {
    try {
      const res = (await window.codex.harnessTeamList()) as ListResult;
      setGroups(Array.isArray(res?.groups) ? res.groups : []);
      setIssues(Object.fromEntries((res?.issues ?? []).map((i) => [i.id, i.issues])));
      setLimit(Number(res?.limit ?? 8));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** 统一收尾：成功就用返回的群替换本地那份（避免整表重拉），失败把后端的原话带出来。 */
  const apply = useCallback((res: MutationResult): { ok: boolean; error?: string } => {
    if (!res?.ok) return { ok: false, error: res?.error || "操作失败" };
    if (res.group) {
      const next = res.group;
      setGroups((prev) => (prev.some((g) => g.id === next.id) ? prev.map((g) => (g.id === next.id ? next : g)) : [...prev, next]));
    }
    return { ok: true };
  }, []);

  const create = useCallback(
    async (input: { name: string; members?: unknown[]; leadId?: string }) => {
      const res = (await window.codex.harnessTeamCreate(input)) as MutationResult;
      return apply(res);
    },
    [apply],
  );

  const rename = useCallback(
    async (groupId: string, name: string) => apply((await window.codex.harnessTeamRename(groupId, name)) as MutationResult),
    [apply],
  );

  const addPartner = useCallback(
    async (groupId: string, partner: Record<string, unknown>, addedBy = LOCAL_ACTOR_ID) =>
      apply((await window.codex.harnessTeamAddPartner(groupId, partner, addedBy)) as MutationResult),
    [apply],
  );

  const removePartner = useCallback(
    async (groupId: string, partnerId: string, byId = LOCAL_ACTOR_ID) =>
      apply((await window.codex.harnessTeamRemovePartner(groupId, partnerId, byId)) as MutationResult),
    [apply],
  );

  const mute = useCallback(
    async (groupId: string, partnerId: string, muted: boolean) =>
      apply((await window.codex.harnessTeamMute(groupId, partnerId, muted)) as MutationResult),
    [apply],
  );

  const setGuard = useCallback(
    async (groupId: string, guard: Record<string, unknown>) =>
      apply((await window.codex.harnessTeamSetGuard(groupId, guard)) as MutationResult),
    [apply],
  );

  return { groups, issues, limit, loading, error, refresh, create, rename, addPartner, removePartner, mute, setGuard };
}
