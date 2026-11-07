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
import { parseTeamAuthorId, teamAuthorIdOf } from "../../lib/team-models.mjs";
import type { TeamRunParams } from "./10-team-composer";

/* ⛔⛔ 11-07：**合成 id → 可派活目标**只保留主进程一份（`harness-team-ipc.ts` 的
   `resolveGroupTargets`）。渲染层不再自己拼 target —— 派活已经整体搬去主进程
   （关面板不中断），这里再留一份"虚拟伙伴"就是第二套口径，必然漂。 */

type ListResult = {
  groups: TeamGroup[];
  /** 体检（含建议类，设置页展示用） */
  issues: { id: string; issues: string[] }[];
  /** 结构性硬闸（侧栏徽标只认它；缺字段的老主进程 ⇒ 渲染层按"无问题"处理） */
  blockers?: { id: string; issues: string[] }[];
  limit: number;
};

type MutationResult = { ok: boolean; group?: TeamGroup; error?: string; changed?: boolean; limit?: number };

/**
 * 一条**流式**的伙伴输出（飞书 §2.4「按 cardId 原地刷新」的等价物）。
 * ⛔ key = 派活会话的 threadId：同一次运行的所有增量都更新**同一张卡**，不新建消息。
 */
export type LiveRun = {
  threadId: string;
  memberId: string;
  name: string;
  text: string;
  startedAt: number;
  status: "running" | "done" | "failed";
  error?: string;
};

type RowsResult = { ok: boolean; rows: GroupMessageRow[]; error?: string; entry?: unknown };

/** 派活回执（`agents:invoke`）——字段与主进程 `runDelegatedTask` 的返回一致。 */
type InvokeResult = { ok: boolean; threadId?: string; name?: string; output?: string; error?: string; reused?: boolean };

/** 一次派活的结果摘要（给面板弹提示用）。 */
export type DispatchSummary = { sent: number; failed: { name: string; error: string }[] };

/** 当前用户在本地的身份（P0 用固定值：群主 = 第一个人类成员；后续接账号库）。 */
export const LOCAL_ACTOR_ID = "local-user";

/* ⛔⛔ 11-06 用户（截图）：「我艾特一个，另外一个怎也回复了」——
   原实现会扫描**伙伴回复正文**里的 `@名字` 自动派下一跳；而模型写的是「PPT @星象」这类
   **举例文本**，不是指令 ⇒ 只 @ 了执起，星象也被拉起来跑（真金白银 + 违背「@ 谁谁回复」）。
   ⇒ 自动链式派活整体删除；正文里的 @ 在群视图渲染成**可点提及**，用户点一下才加入本轮 @。
   ⛔ 护栏常量一并删（不留死代码）；要恢复自动链式必须重新设计「显式指令」判据并经用户确认。 */

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
  /** 正在流式输出的伙伴（按群 → threadId）—— 卡片原地刷新，⛔ 不新建消息 */
  const [liveByGroup, setLiveByGroup] = useState<Record<string, Record<string, LiveRun>>>({});
  /** 反向联动（11-07 用户令）：这些会话**已经被删掉**（主进程 `team-thread-gone` 广播）。
   *  群消息记录保留（它是群自己的账本），但「来源」标记要变成不可点的「已删除」，
   *  ⛔ 不能让用户点一个不存在的会话又什么都没发生。 */
  const [goneThreads, setGoneThreads] = useState<Set<string>>(() => new Set());
  /** ⛔ 卸载后不许再 setState（派活可能跑几分钟） */
  const alive = useRef(true);
  /** 伙伴 → 它最近一次的子会话 id（停止运行要用；也从群日志兜底，见 threadOf） */
  const threadRef = useRef<Record<string, string>>({});
  /* ⛔⛔ 11-06 实测：派活还在跑时用户点了「清空聊天记录」，几分钟后旧回复又写回空群，
     用户看到的就是「我只 @ 了一个，怎么另一个也冒出来了」。⇒ 清空 = 一代，
     dispatch 开跑时记住代际，写回前发现代际变了就**不再落盘**（运行照跑完、账照记）。 */
  const clearedEpochRef = useRef<Record<string, number>>({});

  /* ── 卡片原地流式（飞书 §2.4 `cardId` 订阅的等价物）──────────────────────────
     真相源是主进程已经广播的 `delegate-run`（started/delta/finished）——它带 threadId，
     ⇒ 同一次运行的所有增量更新**同一张卡**，⛔ 不新建消息。
     事件是全局的（别的群/主会话的委派也会来）⇒ 只认"本群正在跑的那个名字"。 */
  const groupsRef = useRef<TeamGroup[]>([]);
  groupsRef.current = groups;
  const busyRef = useRef<Record<string, string[]>>({});
  busyRef.current = busyByGroup;
  const liveRef = useRef<Record<string, Record<string, LiveRun>>>({});
  liveRef.current = liveByGroup;
  /* 定时任务在主进程跑（面板可能没开），跑完广播一条事件 ⇒ 这里跟着刷新。
     ⛔ 用 ref 转一手：事件 effect 挂在组件挂载时，而 refresh/loadMessages 是后面才 useCallback 出来的。 */
  const refreshRef = useRef<() => void>(() => undefined);
  const loadMessagesRef = useRef<(groupId: string) => void>(() => undefined);
  /** 追加一条群消息（定义在后面；事件回调要能用到 ⇒ 转一手 ref，⛔ 不靠闭包旧值） */
  const appendMessageRef = useRef<(groupId: string, entry: Record<string, unknown>) => Promise<RowsResult>>(
    async () => ({ ok: false, rows: [] }),
  );

  /**
   * 委派事件里的 record → 本群哪个成员（+ 哪个群）。
   * ⛔⛔ 不能只看 record.name：实测它是**目标显示名**（「软件开发专家团」），
   *   而群成员名是 catalog 里的短名（「承枢」）——按名字比永远不中，流式卡就一直不出现。
   * 匹配顺序：目标 key（宽松包含）→ 名字 → **该群此刻只有一个人在跑**（单忙兜底）。
   */
  const resolveMember = (record: Record<string, unknown>) => {
    const key = String(record?.targetKey ?? "").trim();
    const nm = String(record?.name ?? "").trim();
    const looseKey = (a: string) => {
      const b = key;
      if (!a || !b) return false;
      return a === b || a.includes(b) || b.includes(a);
    };
    for (const g of groupsRef.current) {
      const busyIds = busyRef.current[g.id] ?? [];
      if (!busyIds.length) continue; // 这个群此刻没人跑 ⇒ 不可能属于它
      const bots = g.members.filter((m) => m.kind === "bot");
      const byKey = key ? bots.find((m) => looseKey(m.targetKey)) : undefined;
      const byName = nm ? bots.find((m) => m.name === nm) : undefined;
      const single = busyIds.length === 1 ? bots.find((m) => m.id === busyIds[0]) : undefined;
      const hit = byKey ?? byName ?? single;
      if (hit && busyIds.includes(hit.id)) return { gid: g.id, memberId: hit.id, memberName: hit.name };
    }
    return null;
  };

  /**
   * `team-run` 事件 → 本群哪个「专家团」伙伴在跑。
   * ⛔ 只认 busy 里有它的那一行：主对话 / 别的群也可能同时叫同一个团，
   *    少了这道判据就会把别人的成员产出投进本群。
   * ⛔ 成员是团内部的事（不在 group.members 里），所以只能按 teamId 反查团伙伴。
   */
  const teamDispatchHitOf = (teamId: string) => {
    const id = String(teamId ?? "");
    if (!id) return null;
    for (const g of groupsRef.current) {
      const busyIds = busyRef.current[g.id] ?? [];
      if (!busyIds.length) continue;
      const partner = g.members.find(
        (m) => m.kind === "bot" && m.targetKind === "team" && String(m.targetKey ?? "") === id && busyIds.includes(m.id),
      );
      if (partner) return { gid: g.id, partner };
    }
    return null;
  };

  useEffect(() => {
    const off = window.codex.onHarnessEvent?.((event: Record<string, unknown>) => {
      if (!event) return;
      /* ⛔⛔ 11-07：派活搬到主进程后，「谁在处理中」由主进程广播 ——
         面板不开/被关掉时这条事件仍在发，重开面板就能看到真实状态。
         ⛔ 不再靠 dispatch 的 Promise 生命周期维护 busy（那正是"关弹窗就断"的根因）。 */
      if (event.type === "team-member-run") {
        const gid = String(event.groupId ?? "");
        const mid = String(event.memberId ?? "");
        if (!gid || !mid) return;
        const running = String(event.phase ?? "") === "started";
        const list = busyRef.current[gid] ?? [];
        const next = running ? (list.includes(mid) ? list : [...list, mid]) : list.filter((x) => x !== mid);
        busyRef.current = { ...busyRef.current, [gid]: next };
        setBusyByGroup((prev) => ({ ...prev, [gid]: next }));
        return;
      }
      /* 一轮派活收尾：重读权威行（产出是主进程写的），失败原因贴到提示条。 */
      if (event.type === "team-dispatch-done") {
        const gid = String(event.groupId ?? "");
        const failed = Array.isArray(event.failed) ? (event.failed as unknown[]).map(String).filter(Boolean) : [];
        if (gid) loadMessagesRef.current(gid);
        if (failed.length) setDispatchError(failed.join("；"));
        return;
      }
      /* ⛔⛔ 11-07 用户令「正反向联动做好一点，那边群删除，这边会话跟着删除」——
         反过来的那一半同样要通：**外面**把某条会话删了（侧栏删 / 项目清理 / 另一窗口），
         群里不能还挂着它的流式卡、还能点开一个不存在的会话。
         事件由主进程 boot.ts 的 `thread/deleted` 分支广播（唯一删除入口都汇到那儿）。 */
      if (event.type === "team-thread-gone") {
        const tid = String(event.threadId ?? "");
        if (!tid) return;
        setGoneThreads((prev) => (prev.has(tid) ? prev : new Set(prev).add(tid)));
        /* 流式卡按 threadId 挂 ⇒ 直接摘掉（否则「正在写」永远转下去，finished 不会再来了）。 */
        setLiveByGroup((prev) => {
          let touched = false;
          const next: Record<string, Record<string, LiveRun>> = {};
          for (const [gid, bucket] of Object.entries(prev)) {
            if (!bucket?.[tid]) { next[gid] = bucket; continue; }
            const copy = { ...bucket };
            delete copy[tid];
            next[gid] = copy;
            touched = true;
          }
          return touched ? next : prev;
        });
        return;
      }
      /* 群定时任务跑完：刷新群（nextRunAt/lastError 变了）+ 重读这个群的消息流。 */
      if (event.type === "team-schedule-ran") {
        const gid = String(event.groupId ?? "");
        if (!gid) return;
        refreshRef.current();
        loadMessagesRef.current(gid);
        return;
      }
      /* ⛔⛔ 11-07 用户实测：「专家团会话，总是主代理说话，代替其他成员回复，其他成员会话
         不会直接到群里」。根因：成员产出只是 `team_member_invoke` 的返回值（只有主理人看得到），
         群流里自然只剩主理人一条「以下是原话」。
         ⇒ 把 `team-run` 事件按**成员自己的身份**投进群流：开始/增量走流式卡，完成落一条真消息。
         ⛔ 落盘 id 用 runId（同一次运行重放也只会覆盖同一条，天然幂等）。 */
      if (event.type === "team-run") {
        const runPhase = String(event.phase ?? "");
        const run = (event.run ?? {}) as Record<string, unknown>;
        const teamId = String(run.teamId ?? "");
        const memberKey = String(run.memberId ?? "");
        const memberThread = String(run.memberThreadId ?? event.memberThreadId ?? "");
        if (!teamId || !memberKey || !memberThread) return;

        if (runPhase === "started") {
          const hit = teamDispatchHitOf(teamId);
          if (!hit) return;
          setLiveByGroup((prev) => ({
            ...prev,
            [hit.gid]: {
              ...(prev[hit.gid] ?? {}),
              [memberThread]: {
                threadId: memberThread,
                memberId: teamAuthorIdOf(teamId, memberKey),
                name: String(run.memberName ?? memberKey),
                text: String(run.output ?? ""),
                startedAt: Number(run.startedAt ?? 0) || Date.now(),
                status: "running",
              },
            },
          }));
          return;
        }

        if (runPhase === "delta") {
          const gid = Object.keys(liveRef.current).find((k) => liveRef.current[k]?.[memberThread]);
          if (!gid) return;
          setLiveByGroup((prev) => {
            const cur = prev[gid]?.[memberThread];
            if (!cur) return prev;
            return { ...prev, [gid]: { ...prev[gid], [memberThread]: { ...cur, text: cur.text + String(event.text ?? "") } } };
          });
          return;
        }

        if (runPhase !== "finished") return;
        const hit = teamDispatchHitOf(teamId);
        const liveGid = Object.keys(liveRef.current).find((k) => liveRef.current[k]?.[memberThread]);
        if (liveGid) {
          window.setTimeout(() => {
            if (!alive.current) return;
            setLiveByGroup((prev) => {
              const bucket = { ...(prev[liveGid] ?? {}) };
              delete bucket[memberThread];
              return { ...prev, [liveGid]: bucket };
            });
          }, 300);
        }
        if (!hit || run.status !== "done") return;
        const output = String(run.output ?? "").trim();
        if (!output) return;
        void appendMessageRef.current(hit.gid, {
          id: `team-run:${String(run.runId ?? memberThread)}`,
          authorId: teamAuthorIdOf(teamId, memberKey),
          authorKind: "bot",
          senderKind: "member",
          threadId: memberThread,
          text: output,
          via: { memberId: hit.partner.id, name: hit.partner.name },
        }).then((res) => { if (res?.ok && alive.current) loadMessagesRef.current(hit.gid); });
        return;
      }

      if (event.type !== "delegate-run") return;
      const phase = String(event.phase ?? "");
      const record = (event.record ?? {}) as Record<string, unknown>;
      const threadId = String(event.threadId ?? record.threadId ?? "");
      if (!threadId) return;

      if (phase === "started") {
        const hit = resolveMember(record);
        if (!hit) return; // ⛔ 不是本群的人：不在这里画卡（主会话/别的群的委派不该串进来）
        const { gid, memberId, memberName } = hit;
        setLiveByGroup((prev) => ({
          ...prev,
          [gid]: {
            ...(prev[gid] ?? {}),
            [threadId]: {
              threadId,
              memberId,
              name: memberName,
              text: String(record.output ?? ""),
              startedAt: Number(record.startedAt ?? 0) || Date.now(),
              status: "running",
            },
          },
        }));
        return;
      }

      const gid = Object.keys(liveRef.current).find((k) => liveRef.current[k]?.[threadId]);
      if (!gid) return;

      if (phase === "delta") {
        setLiveByGroup((prev) => {
          const cur = prev[gid]?.[threadId];
          if (!cur) return prev;
          return { ...prev, [gid]: { ...prev[gid], [threadId]: { ...cur, text: cur.text + String(event.text ?? "") } } };
        });
        return;
      }

      if (phase === "finished") {
        setLiveByGroup((prev) => {
          const cur = prev[gid]?.[threadId];
          if (!cur) return prev;
          return {
            ...prev,
            [gid]: {
              ...prev[gid],
              [threadId]: {
                ...cur,
                status: event.status === "failed" ? "failed" : "done",
                error: event.error ? String(event.error) : undefined,
                text: String(event.output ?? cur.text),
              },
            },
          };
        });
        /* 完成态留 500ms 再摘：正式消息落盘有几十毫秒延迟，立刻删会闪一下空白 */
        window.setTimeout(() => {
          if (!alive.current) return;
          setLiveByGroup((prev) => {
            const bucket = { ...(prev[gid] ?? {}) };
            delete bucket[threadId];
            return { ...prev, [gid]: bucket };
          });
        }, 500);
      }
    });
    return () => { try { off?.(); } catch { /* 老版本桥没有这个订阅 */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  refreshRef.current = () => { void refresh(); };
  loadMessagesRef.current = (gid: string) => { void loadMessages(gid); };

  /**
   * 本群此刻正在跑的伙伴（主进程委派登记表 = 真相源）。
   * ⛔ 为什么必须有它：用户「群弹窗一关就看不见了，要等回复完才能看见」——
   *   busy/live 是**这个面板**的临时态，面板一卸载就没了，而主进程一直在跑、一直在累积文本。
   *   面板重开时先拉一次，就能立刻看到「处理中」+ 已输出的那半截。
   * ⛔ 合并而不是替换：本地刚发起、登记表还没写进去的那一瞬间不能被清掉。
   */
  const loadRunning = useCallback(async (groupId: string) => {
    if (!groupId) return;
    try {
      const res = (await window.codex.harnessTeamRunning(groupId)) as {
        ok: boolean;
        runs?: Array<{ memberId: string; name: string; threadId: string; text: string; startedAt: number }>;
      };
      if (!alive.current || !res?.ok) return;
      const runs = Array.isArray(res.runs) ? res.runs : [];
      if (!runs.length) return;
      /* ⛔ 先改 ref 再 setState：delegate-run 的增量到达时靠 ref 判断"这个名字属于哪个群" */
      const merged = [...new Set([...(busyRef.current[groupId] ?? []), ...runs.map((r) => r.memberId)])];
      busyRef.current = { ...busyRef.current, [groupId]: merged };
      setBusyByGroup((prev) => ({ ...prev, [groupId]: merged }));
      setLiveByGroup((prev) => {
        const bucket = { ...(prev[groupId] ?? {}) };
        for (const r of runs) {
          /* 已经在流式里的那张卡不覆盖（它的 text 更新鲜） */
          if (bucket[r.threadId]) continue;
          bucket[r.threadId] = {
            threadId: r.threadId,
            memberId: r.memberId,
            name: r.name,
            text: String(r.text ?? ""),
            startedAt: Number(r.startedAt ?? 0) || Date.now(),
            status: "running",
          };
        }
        return { ...prev, [groupId]: bucket };
      });
    } catch {
      /* 拿不到就当"没人在跑"：⛔ 不要让一个旁路查询挡住读消息 */
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
  appendMessageRef.current = appendMessage;

  /* ⛔ 11-07：`logUsage`（渲染层记账）随派活一起搬进主进程 —— `dispatchGroupText` 自己
     在 finally 里写账本。这里再留一份就是两套记账口径（同一轮记两次 = 账本翻倍）。 */

  /**
   * 派活：把「@ 了谁 + 说了什么」交给**主进程**，这里只拿到"已排队"就返回。
   *
   * ⛔⛔ 11-07 用户令：「流程跑不通、没有结果回传、我关闭一下群弹窗任务就莫名其妙结束了」——
   *    旧实现把落群日志 / 循环派活 / 产出回写 / 互 @ 接力全放在**渲染层**这个 Promise 里，
   *    面板一卸载（关群弹窗、切设置页、换会话）链条就断在半路，用户看到的就是"任务莫名结束、
   *    没结果回来、主代理也不知道成员干了什么"。
   *    ⇒ 现在整条链在 `harness-team:dispatch`（主进程）里跑完：面板关掉照跑、产出照进群、
   *      互 @ 接力照走；这里**不等结果**，只负责发请求 + 把人的那句话读上屏。
   * ⛔ 进度（处理中/失败）由主进程广播 `team-member-run` / `team-dispatch-done` 驱动。
   */
  const dispatch = useCallback(
    async (group: TeamGroup, partnerIds: string[], text: string, params?: TeamRunParams): Promise<{ ok: boolean; error?: string; summary?: DispatchSummary }> => {
      const body = String(text ?? "").trim();
      if (!body) return { ok: false, error: "说点什么再发" };
      setDispatchError("");
      const res = (await window.codex.harnessTeamDispatch(group.id, {
        text: body,
        /* ⛔ 原样把 @ 的 id 交过去：团成员是合成 id `team:<teamId>:<memberId>`，
           主进程按目录解析成 target（⛔ 渲染层不再自己拼 target，避免两套口径）。 */
        memberIds: partnerIds,
        ...(params
          ? {
            params: {
              ...(params.model ? { model: params.model } : {}),
              ...(params.effort ? { effort: params.effort } : {}),
              ...(params.sandbox ? { sandbox: params.sandbox } : {}),
              ...(params.approvalPolicy ? { approvalPolicy: params.approvalPolicy } : {}),
            },
          }
          : {}),
      })) as { ok: boolean; queued?: number; error?: string };
      if (!res?.ok) {
        setDispatchError(res?.error || "派活失败");
        return { ok: false, error: res?.error };
      }
      /* 主进程已经把「人说的那句」落盘 ⇒ 读一次权威行：消息上屏与输入框清空同帧。 */
      void loadMessages(group.id);
      return { ok: true, summary: { sent: Number(res.queued ?? 0), failed: [] } };
    },
    [loadMessages],
  );

  /**
   * 某个伙伴的**候选会话 id**（新→旧，去重）。
   * ⛔ 返回列表而不是单个 id：群里可能有历史消息指向别的会话，渲染层判断不了
   *   "哪个会话正在跑"；主进程拿活动回合表逐个核对，命中才中断。
   */
  const threadsOf = useCallback((groupId: string, memberId: string) => {
    const rows = [...(rowsByGroup[groupId] ?? [])].reverse();
    const fromRows = rows
      .filter((r) => r.authorId === memberId && r.threadId && !r.threadId.startsWith("group:"))
      .map((r) => r.threadId);
    const ref = threadRef.current[memberId];
    return [...new Set([ref, ...fromRows].filter(Boolean))].slice(0, 12);
  }, [rowsByGroup]);

  /**
   * 停止某个伙伴**当前这一回合**（用户：`@成员 /stop`）。
   * ⛔ 不删会话、不影响下一次派活；⛔ 拿不到活动回合就明确说"它没在跑"，不假装成功。
   */
  const stopPartner = useCallback(
    async (group: TeamGroup, memberId: string) => {
      const groupId = group.id;
      const candidates = threadsOf(groupId, memberId);
      /* ⛔ 运行中 `agents:invoke` 还没返回 threadId ⇒ 渲染层的候选可能全是旧的。
         目标身份（targetKey）一定要给：主进程靠它从委派登记表里找"正在跑的那条"。 */
      /* ⛔ 11-07：团成员用的是合成 id（`team:<teamId>:<memberId>`），群成员表里没有它。
         不认它 ⇒ targetKey/memberName 都空，主进程只能靠 threadIds 找（而 threadsOf 也用同一个
         合成 id 查，同样空）⇒ 点「停」什么也停不掉。这里直接翻成调度目录的目标键
         `<teamId>:<memberId>`（记录里的 targetKey 是 `member:<teamId>:<memberId>`，
         主进程按 includes 匹配，能命中）。 */
      const parsedStop = parseTeamAuthorId(memberId);
      const member = group.members.find((m) => m.id === memberId);
      const targetKey = member?.targetKey ?? (parsedStop ? `${parsedStop.teamId}:${parsedStop.memberId}` : "");
      const memberName = member?.name ?? (parsedStop ? parsedStop.memberId : "");
      const res = (await window.codex.harnessTeamStop({ threadIds: candidates, targetKey, memberName })) as { ok: boolean; error?: string; reason?: string };
      if (res?.ok) {
        /* 立刻把运行态摘掉（不等引擎回 turn/interrupted —— 有些情况会晚到或不回） */
        setBusyByGroup((prev) => ({ ...prev, [groupId]: (prev[groupId] ?? []).filter((x) => x !== memberId) }));
        return { ok: true };
      }
      return { ok: false, error: res?.error || "停止失败" };
    },
    [threadsOf],
  );

  const create = useCallback(
    /* ⛔ 建群输入是**整份群结构**（与主进程 createGroup 同字段）：新建群弹窗要一次带
       memory(群简介) / workspace(项目地址) / members(初始伙伴)。只收 name+members 会
       把这三项丢掉 —— 弹窗填了却不生效，正是「选了却不生效」那类装饰。 */
    async (input: { name: string; members?: unknown[]; leadId?: string; memory?: string; workspace?: string }) => {
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

  /** 清空群聊天记录：只清投影日志，⛔ 伙伴的子会话与真实产出一条都不动（与删群同口径） */
  const clearMessages = useCallback(async (groupId: string) => {
    const res = (await window.codex.harnessTeamClearMessages(groupId)) as { ok: boolean; cleared?: number; error?: string };
    if (res?.ok) {
      clearedEpochRef.current[groupId] = (clearedEpochRef.current[groupId] ?? 0) + 1;
      setRowsByGroup((prev) => ({ ...prev, [groupId]: [] }));
    }
    return { ok: Boolean(res?.ok), cleared: res?.cleared, error: res?.error };
  }, []);

  /** 解散群：群 + 群消息日志 + **本群派生出来的那些会话**（11-07 用户令：删群后外面还能看见遗留会话） */
  const removeGroup = useCallback(async (groupId: string) => {
    const res = (await window.codex.harnessTeamDelete(groupId)) as {
      ok: boolean; id?: string; error?: string; removedThreads?: number; totalThreads?: number; failed?: string[];
    };
    if (res?.ok) {
      setGroups((prev) => prev.filter((g) => g.id !== groupId));
      setRowsByGroup((prev) => {
        const next = { ...prev };
        delete next[groupId];
        return next;
      });
      /* 这个群的实时态跟着一起清：群都没了，别让"谁在处理中"留在内存里指着一个不存在的群。 */
      setBusyByGroup((prev) => { const next = { ...prev }; delete next[groupId]; return next; });
      setLiveByGroup((prev) => { const next = { ...prev }; delete next[groupId]; return next; });
    }
    return {
      ok: Boolean(res?.ok),
      error: res?.error,
      removedThreads: Number(res?.removedThreads ?? 0),
      totalThreads: Number(res?.totalThreads ?? 0),
      failed: res?.failed ?? [],
    };
  }, []);

  /** 群记忆（落主进程；返回的 group 直接替换本地那份） */
  const setMemory = useCallback(
    async (groupId: string, text: string) => apply((await window.codex.harnessTeamSetMemory(groupId, text)) as MutationResult),
    [apply],
  );

  /** 项目地址（群的工作目录）：只落路径，派活时作为 cwd */
  const setWorkspace = useCallback(
    async (groupId: string, workspace: string) =>
      apply((await window.codex.harnessTeamSetWorkspace(groupId, workspace)) as MutationResult),
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

  /** 菜单形态（飞书 INPUT_FIRST / FLOAT） */
  const saveMenuPlacement = useCallback(
    async (groupId: string, placement: "input" | "float") =>
      apply((await window.codex.harnessTeamSetMenuPlacement(groupId, placement)) as MutationResult),
    [apply],
  );

  /** 定时任务（整组替换；nextRunAt 由主进程算，渲染层不推算调度时刻） */
  const saveSchedules = useCallback(
    async (groupId: string, list: unknown[]) =>
      apply((await window.codex.harnessTeamSetSchedule(groupId, list)) as MutationResult),
    [apply],
  );

  /** 立刻跑一次（主进程执行派活，产出落群日志；完成后广播事件让这里刷新） */
  const runSchedule = useCallback(
    async (groupId: string, scheduleId: string) => {
      const res = (await window.codex.harnessTeamRunSchedule(groupId, scheduleId)) as { ok: boolean; sent?: number; error?: string };
      if (res?.ok) {
        void loadMessages(groupId);
        void refresh();
      }
      return { ok: Boolean(res?.ok), error: res?.error, sent: res?.sent };
    },
    [loadMessages, refresh],
  );

  const setGuard = useCallback(
    async (groupId: string, guard: Record<string, unknown>) =>
      apply((await window.codex.harnessTeamSetGuard(groupId, guard)) as MutationResult),
    [apply],
  );

  return {
    groups, issues, blockers, limit, loading, error,
    rowsByGroup, busyByGroup, liveByGroup, dispatchError, goneThreads,
    refresh, create, rename, addPartner, removePartner, mute, setGuard, removeGroup,
    setMemory, setWorkspace, addNote, removeNote, saveFiles, saveMenu, saveMenuPlacement, saveSchedules, runSchedule,
    setManagerOf, loadMessages, loadRunning, appendMessage, dispatch, stopPartner, clearMessages,
  };
}
