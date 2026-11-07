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
import { groupContextBlock, parseAgentMentions, parseTeamAuthorId, teamAuthorIdOf } from "../../lib/team-models.mjs";
import type { TeamRunParams } from "./10-team-composer";

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

  /**
   * 派活：@ 了谁就把同一句话交给谁，各自落各自的子会话。
   * ⛔ 并发（不是串行）：两个伙伴同时开工，回复按**各自完成时间**进同一条时间轴。
   * ⛔ 未绑定调度目标的伙伴直接拒（老群手工加的），⛔ 不静默降级成"发送成功"。
   */
  const dispatch = useCallback(
    async (group: TeamGroup, partnerIds: string[], text: string, params?: TeamRunParams): Promise<{ ok: boolean; error?: string; summary?: DispatchSummary }> => {
      const body = String(text ?? "").trim();
      if (!body) return { ok: false, error: "说点什么再发" };
      /* ⛔⛔ 11-07 用户令：「团成员拆出来，每个成员都可以艾特」「现在只能艾特主代理会话」。
         @ 里的团成员用的是**合成 id** `team:<teamId>:<memberId>`（不是群成员）。
         主进程调度目录里每位团成员都有 `kind:"member"`、key `<teamId>:<memberId>` 的条目
         ⇒ 直接按成员派活，走他自己的会话；⛔ 不再退化成"叫整团、主理人替他说话"。
         解不出两段的 id 一律忽略（⛔ 不猜，也不当成普通伙伴去匹配）。 */
      const virtuals: TeamGroup["members"] = [];
      for (const id of partnerIds) {
        const parsed = parseTeamAuthorId(id);
        if (!parsed) continue;
        if (virtuals.some((v) => v.id === id)) continue;
        virtuals.push({
          /* 只用这几个字段：id（去重/busy/台账）、name（日志与失败文案）、
             targetKind/targetKey（真正决定派给谁）。⛔ 其余群成员字段用不到，别编值。 */
          id,
          kind: "bot",
          name: parsed.memberId,
          targetKind: "member",
          targetKey: `${parsed.teamId}:${parsed.memberId}`,
        } as TeamGroup["members"][number]);
      }
      const picked = group.members.filter((m) => m.kind === "bot" && partnerIds.includes(m.id));
      if (!picked.length && !virtuals.length) return { ok: false, error: "先 @ 至少一个伙伴" };
      /* 静音 = 不打扰：@ 了也不派（⛔ 但要说清是"被静音"而不是"没选"） */
      const targets = [...picked.filter((m) => !m.muted), ...virtuals];
      if (!targets.length) return { ok: false, error: `「${picked.map((m) => m.name).join("、")}」已静音，先在群设置里取消静音` };
      /* 11-06 用户令：群聊「专家团直接调度」已放开（主进程只对 origin="" 的界面直派
         合并 team 许可），这里不再前置拒绝 team / member 伙伴。 */
      const unbound = targets.filter((m) => !m.targetKind || !m.targetKey);
      if (unbound.length) {
        return { ok: false, error: `「${unbound.map((m) => m.name).join("、")}」还没绑定智能体，去群设置里换成列表里的那一个` };
      }

      setDispatchError("");
      /* 本轮派活的代际：期间若被清空，晚到的旧回复一律不再写回 */
      const epoch = clearedEpochRef.current[group.id] ?? 0;
      /* ⛔ 注入块按**每个伙伴**生成（上下级不同），所以放进循环里；群日志只存用户原话。 */

      /* ① 人的那句话先上屏（真身 = 群日志），这样 @ 谁都能看见自己说了什么。
         ⛔ 存不上就**不发**：否则群里会出现"有回答没有提问"的断头记录。 */
      try {
        const saved = await appendMessage(group.id, {
          authorId: LOCAL_ACTOR_ID,
          authorKind: "human",
          senderKind: "user",
          text: body,
          /* @ 了谁（飞书：mention 是单独一类对象，不是普通文本）—— 群视图据此渲染高亮 chip */
          mentions: targets.map((m) => m.id),
        });
        if (!saved?.ok) return { ok: false, error: saved?.error || "群消息没存上" };
      } catch (err) {
        return { ok: false, error: `群消息没存上：${err instanceof Error ? err.message : String(err)}` };
      }

      const failed: DispatchSummary["failed"] = [];
      /* 一轮里同一个伙伴只跑一次（并发派活时重复 id 去重）。 */
      const ranIds = new Set<string>();

      const noteError = (name: string, msg: string) => {
        failed.push({ name, error: msg });
        /* 递归触发的失败可能在 dispatch 返回**之后**才到 ⇒ 直接更新提示条，别丢 */
        setDispatchError(failed.map((f) => `${f.name}：${f.error}`).join("；"));
      };
      /* ⛔ 必须**先改 ref 再 setState**：`delegate-run started` 可能在这个 state 生效前就到达，
         那时事件处理靠 ref 判断"这个名字属于哪个群"，ref 没更新 ⇒ 这张卡不出现（静默无流式）。 */
      const busyAdd = (id: string) => {
        const list = busyRef.current[group.id] ?? [];
        if (!list.includes(id)) busyRef.current = { ...busyRef.current, [group.id]: [...list, id] };
        setBusyByGroup((prev) => {
          const cur = prev[group.id] ?? [];
          return cur.includes(id) ? prev : { ...prev, [group.id]: [...cur, id] };
        });
      };
      const busyRemove = (id: string) => {
        busyRef.current = { ...busyRef.current, [group.id]: (busyRef.current[group.id] ?? []).filter((x) => x !== id) };
        setBusyByGroup((prev) => ({ ...prev, [group.id]: (prev[group.id] ?? []).filter((x) => x !== id) }));
      };

      /* 伙伴之间互相 @ 的预算（11-06 用户令：「他们就可以在群里 @ 沟通，不用限制啥」）。
         ⛔ 只留两条**必须**的护栏，不是"限制沟通"：
            · 只走**一跳**（A@B 触发 B；B 再 @ 谁不再触发）—— 否则两个伙伴互 @ 会无限对烧；
            · 一轮总量上限（4）—— 同上。
         其余（谁是能派活的伙伴、静音、代码围栏、自己 @ 自己）都由纯函数判。 */
      let chainBudget = 4;
      const runOne = async (
        partner: TeamGroup["members"][number],
        bodyText: string,
        source: "human" | "partner",
        hop = 0,
        /* 被谁叫来的（只有 source==="partner" 才有）—— 写进群日志的 `via`，界面上标出来 */
        caller?: { id: string; name: string },
      ): Promise<void> => {
        if (ranIds.has(partner.id)) return;
        ranIds.add(partner.id);
        busyAdd(partner.id);
        const startedAt = Date.now();
        let chars = 0;
        let threadId = "";
        let okFlag = false;
        let errMsg = "";
        let output = "";
        /* 真实 token（引擎 last 桶）：拿不到就 0，⛔ 不编造 */
        let tokens: { input: number; output: number; total: number } | null = null;
        try {
          /* ⛔⛔ 11-07 用户令：「专家团会话总是主代理说话，代其他成员回复，其他成员的会话不会直接到群里」
             ⇒ 团的成员产出由 `team-run` 事件**以成员自己的署名**直投群流（见本文件 team-run 分支），
                同时在这里告诉主理人「别转述，只出统筹结论」。⛔ 只对团生效：单个伙伴没有"成员产出"。 */
          const ctx = groupContextBlock(group, { forMemberId: partner.id, forTeam: partner.targetKind === "team" });
          const query = ctx ? `${ctx}\n\n---\n\n${bodyText}` : bodyText;
          const res = (await window.codex.invokeAgent({
            kind: partner.targetKind as "expert" | "team" | "member" | "subagent" | "cli",
            name: partner.targetKey,
            query,
            /* 群的项目地址 = 子会话的工作目录（空 ⇒ 应用默认目录）。⛔ 不传就是另一回事了：
               伙伴会在默认目录里找相对路径，然后如实告诉你"没这个文件"。 */
            cwd: group.workspace || undefined,
            /* ⛔ originThreadId 留空：群聊没有"群主会话"这条线，闸与子会话复用都按这个口径走。 */
            originThreadId: "",
            /* ⛔⛔ 11-07 用户令：「调度功能在被调度场景中正确识别上级消息」——
               origin 为空**不再**等价于「用户发的」：伙伴互 @ 触发的这一跳，真实发送者是
               上一个伙伴（上级/同事），必须结构化传下去，别再默认按用户消息处理。 */
            sender: source === "partner"
              ? { kind: "member", name: caller?.name ?? partner.name }
              : { kind: "user" },
            /* 输入框选的模型/档位/沙箱/审批在这里**真下发**：agents:invoke 原样透传给
               runDelegatedTask（turn/start.model|effort、thread/start.sandbox|approvalPolicy）。
               ⛔ 不传这些字段 = 选项沦为装饰，回落到全局默认值。 */
            ...(params?.model ? { model: params.model } : {}),
            ...(params?.effort ? { effort: params.effort } : {}),
            ...(params?.sandbox ? { sandbox: params.sandbox } : {}),
            ...(params?.approvalPolicy ? { approvalPolicy: params.approvalPolicy } : {}),
          })) as InvokeResult;
          if (!res?.ok || !res?.threadId) {
            errMsg = res?.error || "派活失败";
            noteError(partner.name, errMsg);
            return;
          }
          threadId = res.threadId;
          threadRef.current[partner.id] = threadId;
          output = String(res.output ?? "").trim();
          /* ⛔ 用户在这期间清空过记录 ⇒ 这条是上一代的产出，⛔ 不许再往空群里冒。
             同时撤掉它的流式卡：finished 事件的延迟删除是唯一兜底，面板若已重开就收不到了。 */
          if ((clearedEpochRef.current[group.id] ?? 0) !== epoch) {
            setLiveByGroup((prev) => {
              const bucket = { ...(prev[group.id] ?? {}) };
              delete bucket[threadId];
              return { ...prev, [group.id]: bucket };
            });
            return;
          }
          const wrote = await appendMessage(group.id, {
            authorId: partner.id,
            authorKind: "bot",
            senderKind: "member",
            threadId: res.threadId,
            text: output || "（没有返回文本内容）",
            /* 被别的伙伴叫来的 ⇒ 记下"谁叫的"，群视图标出来（⛔ 不是人多点了一下） */
            via: source === "partner" && caller ? { memberId: caller.id, name: caller.name } : null,
          });
          /* ⛔ 落盘失败也要说出来（典型场景：跑的过程中群被解散了），⛔ 不许当成功 */
          if (!wrote?.ok) {
            errMsg = wrote?.error || "产出没能写进群聊记录";
            noteError(partner.name, errMsg);
          } else {
            okFlag = true;
          }
          /* 取本次运行的**真实 token**（主进程登记表里存着引擎推的 last 桶）。
             ⛔ 引擎是异步推的，可能还没到 ⇒ 拿不到就先记 0（账本里显示「—」而不是假数字）。 */
          try {
            const usage = await window.codex.harnessTeamThreadUsage(res.threadId);
            if (usage?.ok && usage.tokens) {
              tokens = { input: usage.tokens.input, output: usage.tokens.output, total: usage.tokens.total };
            }
          } catch { /* 取不到不影响派活 */ }

          /* 正式消息已落盘 ⇒ 这张流式卡可以撤了（不留 500ms 的重复） */
          setLiveByGroup((prev) => {
            const bucket = { ...(prev[group.id] ?? {}) };
            delete bucket[threadId];
            return { ...prev, [group.id]: bucket };
          });
          /* 用量口径：输入（注入块 + 原话）+ 输出 的**字符数**，⛔ 不是 token（引擎没回 usage） */
          chars = query.length + output.length;

          /* ② 伙伴在回复里**行首点名** ⇒ 叫那个伙伴接手（11-06 用户令：「可以 @ 沟通」）。
             ⛔ 判据只在 parseAgentMentions 一处（行首 `@名字：要做的事`）；句子中间的 @ 不触发
                —— 上次的 bug 正是把「PPT @星象」这种举例当成了指令。
             ⛔ 只走一跳：hop === 0 才派下一轮，避免两个伙伴互 @ 无限对烧。 */
          if (hop === 0 && chainBudget > 0 && okFlag && output) {
            const asks = parseAgentMentions(output, group, {
              excludeId: partner.id,
              alreadyRan: [...ranIds],
              max: chainBudget,
            });
            for (const ask of asks) {
              const next = group.members.find((m) => m.id === ask.memberId);
              if (!next || ranIds.has(next.id)) continue;
              chainBudget -= 1;
              /* ⛔ 不 await：主回复先上屏，被叫的人稍后自己进来（否则一个人卡住整条链） */
              void runOne(next, `（${partner.name} 在群里叫你）${ask.ask}`, "partner", 1, {
                id: partner.id,
                name: partner.name,
              });
            }
          }
        } catch (err) {
          errMsg = err instanceof Error ? err.message : String(err);
          noteError(partner.name, errMsg);
        } finally {
          void logUsage({
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
          if (alive.current) busyRemove(partner.id);
        }
      };

      await Promise.all(targets.map((partner) => runOne(partner, body, "human")));

      /* ③ 收尾再读一次权威行：并发写回的中间态可能少一条，这里兜平 */
      await loadMessages(group.id);
      if (failed.length) setDispatchError(failed.map((f) => `${f.name}：${f.error}`).join("；"));
      return { ok: true, summary: { sent: targets.length - failed.length, failed } };
    },
    [appendMessage, loadMessages],
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
      const member = group.members.find((m) => m.id === memberId);
      const targetKey = member?.targetKey ?? "";
      const memberName = member?.name ?? "";
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
    rowsByGroup, busyByGroup, liveByGroup, dispatchError,
    refresh, create, rename, addPartner, removePartner, mute, setGuard, removeGroup,
    setMemory, setWorkspace, addNote, removeNote, saveFiles, saveMenu, saveMenuPlacement, saveSchedules, runSchedule,
    setManagerOf, loadMessages, loadRunning, appendMessage, dispatch, stopPartner, clearMessages,
  };
}
