/**
 * 团队模式 · 状态钩子（P0 / P0b）
 *
 * ⛔ 不引入全局 store（项目纪律）：群状态是**这个面板自己的**，随面板生命周期存在。
 * ⛔ 所有业务判定都走主进程（那里调 `team-models.mjs`）—— 这里只负责调桥、收结果、报错。
 *
 * P0b 加的是一条**真实的派活链路**：
 *   ① 人的那句话先落群日志（主进程），② 每个被 @ 的伙伴调 `invokeAgent`（既有公开桥，
 *   与模型自己调 agent_invoke 走同一套闸与登记），③ 回来的产出再落群日志并投影。
 * ⛔ 派活失败**不写假消息**：没有子会话就没有 threadId，群视图里就不该出现"它说了什么"。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { GroupMessageRow, MenuItem, MemoryNote, TeamGroup } from "./01-team-types";
import { groupContextBlock } from "../../lib/team-models.mjs";

type ListResult = {
  groups: TeamGroup[];
  /** 体检（含建议类，设置页展示用） */
  issues: { id: string; issues: string[] }[];
  /** 结构性硬闸（侧栏徽标只认它；缺字段的老主进程 ⇒ 渲染层按"无问题"处理） */
  blockers?: { id: string; issues: string[] }[];
  limit: number;
};

type MutationResult = { ok: boolean; group?: TeamGroup; error?: string; changed?: boolean; limit?: number };

/** 与 `src/lib/team-ledger.mjs` 的 summarizeLedger 返回一致（只声明界面用到的字段） */
type LedgerBucket = { count: number; chars: number; ms: number; failed: number; avgMs: number };
export type LedgerSummary = {
  window: { since: number; days: number; groupId: string };
  total: LedgerBucket & { partners: number };
  byPartner: Array<LedgerBucket & { memberId: string; name: string }>;
  bySource: Array<LedgerBucket & { source: string }>;
};

type RowsResult = { ok: boolean; rows: GroupMessageRow[]; error?: string; entry?: unknown };

/** 派活回执（`agents:invoke`）——字段与主进程 `runDelegatedTask` 的返回一致。 */
type InvokeResult = { ok: boolean; threadId?: string; name?: string; output?: string; error?: string; reused?: boolean };

/** 一次派活的结果摘要（给面板弹提示用）。 */
export type DispatchSummary = { sent: number; failed: { name: string; error: string }[] };

/** 当前用户在本地的身份（P0 用固定值：群主 = 第一个人类成员；后续接账号库）。 */
export const LOCAL_ACTOR_ID = "local-user";

export function useTeamGroups() {
  const [groups, setGroups] = useState<TeamGroup[]>([]);
  const [issues, setIssues] = useState<Record<string, string[]>>({});
  /** 结构性阻断（rail 徽标判据） */
  const [blockers, setBlockers] = useState<Record<string, string[]>>({});
  const [limit, setLimit] = useState(8);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  /** 每个群的群视图行（投影，真身在子会话） */
  const [rowsByGroup, setRowsByGroup] = useState<Record<string, GroupMessageRow[]>>({});
  /** 正在跑活的伙伴 id（每个群一份） */
  const [busyByGroup, setBusyByGroup] = useState<Record<string, string[]>>({});
  /** 上次派活的失败说明（⛔ 与群日志分开：那是"没派出去"，不是"它说了什么"） */
  const [dispatchError, setDispatchError] = useState("");
  /** 当前群的用量汇总（按 (伙伴, 来源) 拆；豆包 §2.④ 口径） */
  const [ledger, setLedger] = useState<LedgerSummary | null>(null);
  /** ⛔ 卸载后不许再 setState（派活可能跑几分钟） */
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = (await window.codex.harnessTeamList()) as ListResult;
      setGroups(Array.isArray(res?.groups) ? res.groups : []);
      setIssues(Object.fromEntries((res?.issues ?? []).map((i) => [i.id, i.issues])));
      setBlockers(Object.fromEntries((res?.blockers ?? []).map((i) => [i.id, i.issues])));
      setLimit(Number(res?.limit ?? 8));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => { alive.current = false; };
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

  /** 读某个群的群视图行（**主进程才是权威**：每次进来都重读，不靠本地拼） */
  const loadMessages = useCallback(async (groupId: string) => {
    if (!groupId) return;
    try {
      const res = (await window.codex.harnessTeamMessages(groupId)) as RowsResult;
      if (!alive.current) return;
      setRowsByGroup((prev) => ({ ...prev, [groupId]: Array.isArray(res?.rows) ? res.rows : [] }));
    } catch {
      /* 读失败保持上一次的行：⛔ 不要清空成"什么都没有"，那会让人以为记录丢了 */
    }
  }, []);

  /** 落一条消息（主进程补 at/id 并回带整份投影） */
  const appendMessage = useCallback(async (groupId: string, entry: Record<string, unknown>) => {
    const res = (await window.codex.harnessTeamAppendMessage(groupId, entry)) as RowsResult;
    if (alive.current && Array.isArray(res?.rows)) {
      setRowsByGroup((prev) => ({ ...prev, [groupId]: res.rows }));
    }
    return res;
  }, []);

  /**
   * 记一条用量。⛔ 记账失败**不许影响派活结果**（账本是旁路观测，不是主链路）。
   * ⛔ 失败也记：失败同样烧了 token，失败率本身是最该看的指标。
   */
  const logUsage = useCallback(async (entry: Record<string, unknown>) => {
    try {
      await window.codex.harnessTeamLogUsage({ ...entry, at: Date.now() });
    } catch {
      /* 静默：账本写不进不该让用户看到"派活失败" */
    }
  }, []);

  const loadLedger = useCallback(async (groupId: string, days = 7) => {
    try {
      const res = (await window.codex.harnessTeamLedger(groupId, days)) as LedgerSummary & { ok: boolean };
      setLedger(res?.ok ? res : null);
    } catch {
      setLedger(null);
    }
  }, []);

  /**
   * 派活：@ 了谁就把同一句话交给谁，各自落各自的子会话。
   * ⛔ 并发（不是串行）：两个伙伴同时开工，回复按**各自完成时间**进同一条时间轴。
   * ⛔ 未绑定调度目标的伙伴直接拒（老群手工加的），⛔ 不静默降级成"发送成功"。
   */
  const dispatch = useCallback(
    async (group: TeamGroup, partnerIds: string[], text: string): Promise<{ ok: boolean; error?: string; summary?: DispatchSummary }> => {
      const body = String(text ?? "").trim();
      if (!body) return { ok: false, error: "说点什么再发" };
      const picked = group.members.filter((m) => m.kind === "bot" && partnerIds.includes(m.id));
      if (!picked.length) return { ok: false, error: "先 @ 至少一个伙伴" };
      /* 静音 = 不打扰：@ 了也不派（⛔ 但要说清是"被静音"而不是"没选"） */
      const targets = picked.filter((m) => !m.muted);
      if (!targets.length) return { ok: false, error: `「${picked.map((m) => m.name).join("、")}」已静音，先在群设置里取消静音` };
      /* ⛔ 专家团成员/团需要「专家团」许可，而应用没有这个开关 ⇒ 提前说清，
         别让它走到主进程再回一条"去顶栏打开专家团"（那个开关不存在）。 */
      const gated = targets.filter((m) => m.targetKind === "member" || m.targetKind === "team");
      if (gated.length) {
        return {
          ok: false,
          error: `「${gated.map((m) => m.name).join("、")}」是专家团成员/团，需要「专家团」许可；应用目前没有这个开关，派不出去。请在群设置里换成「专家」。`,
        };
      }
      const unbound = targets.filter((m) => !m.targetKind || !m.targetKey);
      if (unbound.length) {
        return { ok: false, error: `「${unbound.map((m) => m.name).join("、")}」还没绑定智能体，去群设置里换成列表里的那一个` };
      }

      setDispatchError("");
      /* ⛔ 注入块按**每个伙伴**生成（上下级不同），所以放进循环里；群日志只存用户原话。 */

      /* ① 人的那句话先上屏（真身 = 群日志），这样 @ 谁都能看见自己说了什么。
         ⛔ 存不上就**不发**：否则群里会出现"有回答没有提问"的断头记录。 */
      try {
        const saved = await appendMessage(group.id, {
          authorId: LOCAL_ACTOR_ID,
          authorKind: "human",
          text: body,
          /* @ 了谁（飞书：mention 是单独一类对象，不是普通文本）—— 群视图据此渲染高亮 chip */
          mentions: targets.map((m) => m.id),
        });
        if (!saved?.ok) return { ok: false, error: saved?.error || "群消息没存上" };
      } catch (err) {
        return { ok: false, error: `群消息没存上：${err instanceof Error ? err.message : String(err)}` };
      }

      setBusyByGroup((prev) => ({ ...prev, [group.id]: targets.map((m) => m.id) }));
      const failed: DispatchSummary["failed"] = [];

      await Promise.all(
        targets.map(async (partner) => {
          const startedAt = Date.now();
          let chars = 0;
          let threadId = "";
          let okFlag = false;
          let errMsg = "";
          try {
            const ctx = groupContextBlock(group, { forMemberId: partner.id });
            const query = ctx ? `${ctx}\n\n---\n\n${body}` : body;
            const res = (await window.codex.invokeAgent({
              kind: partner.targetKind as "expert" | "team" | "member" | "subagent" | "cli",
              name: partner.targetKey,
              query,
              /* ⛔ originThreadId 留空：群聊没有"群主会话"这条线（P0b 有意不做），
                 空 origin 在主进程侧等价于"发起方是本地用户"，闸与复用都按这个口径走。 */
              originThreadId: "",
            })) as InvokeResult;
            if (!res?.ok || !res?.threadId) {
              errMsg = res?.error || "派活失败";
              failed.push({ name: partner.name, error: errMsg });
              return;
            }
            threadId = res.threadId;
            /* ② 产出落群日志：threadId = 真实子会话，itemId 由主进程补 —— 点开能回到原子会话 */
            const wrote = await appendMessage(group.id, {
              authorId: partner.id,
              authorKind: "bot",
              threadId: res.threadId,
              text: String(res.output ?? "").trim() || "（没有返回文本内容）",
            });
            /* ⛔ 落盘失败也要说出来（典型场景：跑的过程中群被解散了），⛔ 不许当成功 */
            if (!wrote?.ok) {
              errMsg = wrote?.error || "产出没能写进群聊记录";
              failed.push({ name: partner.name, error: errMsg });
            } else {
              okFlag = true;
            }
            /* 用量口径：输入（注入块 + 用户原话）+ 输出 的**字符数**，⛔ 不是 token（引擎没回 usage） */
            chars = query.length + String(res.output ?? "").length;
          } catch (err) {
            errMsg = err instanceof Error ? err.message : String(err);
            failed.push({ name: partner.name, error: errMsg });
          } finally {
            void logUsage({
              groupId: group.id,
              groupName: group.name,
              memberId: partner.id,
              partnerName: partner.name,
              source: "human",
              threadId,
              chars,
              ms: Date.now() - startedAt,
              ok: okFlag,
              error: errMsg,
            });
            if (alive.current) {
              setBusyByGroup((prev) => ({ ...prev, [group.id]: (prev[group.id] ?? []).filter((id) => id !== partner.id) }));
            }
          }
        }),
      );

      /* ③ 收尾再读一次权威行：并发写回的中间态可能少一条，这里兜平 */
      await loadMessages(group.id);
      if (failed.length) setDispatchError(failed.map((f) => `${f.name}：${f.error}`).join("；"));
      return { ok: true, summary: { sent: targets.length - failed.length, failed } };
    },
    [appendMessage, loadMessages],
  );

  const create = useCallback(
    async (input: { name: string; members?: unknown[]; leadId?: string }) => {
      const res = (await window.codex.harnessTeamCreate(input)) as MutationResult;
      /* ⛔ 回带 id：建完群要立刻读它的消息（否则用户还得手点一下才看到空态） */
      return { ...apply(res), id: res.group?.id };
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

  /** 解散群：只删群与其群消息日志（主进程侧），⛔ 伙伴的子会话一条都不动 */
  const removeGroup = useCallback(async (groupId: string) => {
    const res = (await window.codex.harnessTeamDelete(groupId)) as { ok: boolean; id?: string; error?: string };
    if (res?.ok) {
      setGroups((prev) => prev.filter((g) => g.id !== groupId));
      setRowsByGroup((prev) => {
        const next = { ...prev };
        delete next[groupId];
        return next;
      });
    }
    return { ok: Boolean(res?.ok), error: res?.error };
  }, []);

  /** 群记忆（落主进程；返回的 group 直接替换本地那份） */
  const setMemory = useCallback(
    async (groupId: string, text: string) => apply((await window.codex.harnessTeamSetMemory(groupId, text)) as MutationResult),
    [apply],
  );

  /** 上下级（豆包 managerId；成环/自指由纯函数拦，这里只发） */
  const setManagerOf = useCallback(
    async (groupId: string, memberId: string, managerId: string) =>
      apply((await window.codex.harnessTeamSetManager(groupId, memberId, managerId)) as MutationResult),
    [apply],
  );

  /** 加一条记忆（type + origin 由主进程补；这里只传正文与类型） */
  const addNote = useCallback(
    async (groupId: string, note: { text: string; type: MemoryNote["type"]; threadId?: string }) =>
      apply((await window.codex.harnessTeamAddNote(groupId, note)) as MutationResult),
    [apply],
  );

  const removeNote = useCallback(
    async (groupId: string, noteId: string) =>
      apply((await window.codex.harnessTeamRemoveNote(groupId, noteId)) as MutationResult),
    [apply],
  );

  /** 群菜单（整份替换：菜单是"一屏能看完的树"，增量合并规则只会让人猜） */
  const saveMenu = useCallback(
    async (groupId: string, items: MenuItem[]) =>
      apply((await window.codex.harnessTeamSetMenu(groupId, items)) as MutationResult),
    [apply],
  );

  /** 群文件（整组替换：UI 增删后一次提交，⛔ 不做并发合并的猜测） */
  const saveFiles = useCallback(
    async (groupId: string, files: unknown[]) => apply((await window.codex.harnessTeamSetFiles(groupId, files)) as MutationResult),
    [apply],
  );

  const setGuard = useCallback(
    async (groupId: string, guard: Record<string, unknown>) =>
      apply((await window.codex.harnessTeamSetGuard(groupId, guard)) as MutationResult),
    [apply],
  );

  return {
    groups, issues, blockers, limit, loading, error,
    rowsByGroup, busyByGroup, dispatchError, ledger,
    refresh, create, rename, addPartner, removePartner, mute, setGuard, removeGroup,
    setMemory, addNote, removeNote, saveFiles, saveMenu, setManagerOf,
    loadMessages, appendMessage, dispatch, loadLedger,
  };
}
