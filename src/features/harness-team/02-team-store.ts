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
import { groupContextBlock, parseMentions } from "../../lib/team-models.mjs";

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

/** 与 `src/lib/team-ledger.mjs` 的 summarizeLedger 返回一致（只声明界面用到的字段） */
type LedgerBucket = { count: number; chars: number; inputTokens: number; outputTokens: number; totalTokens: number; ms: number; failed: number; avgMs: number };
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

/** 互相 @ 的护栏（⛔ 少了这些上限，两个伙伴互 @ 会无限互相触发）。 */
const MAX_MENTION_HOPS = 2;    // 用户 → A → B（更深的 @ 不再触发）
const MAX_MENTION_FANOUT = 2;  // 一条回复最多带 2 个人
const MAX_MENTION_RUNS = 4;    // 一轮派活最多 4 次额外运行

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
  /** 正在流式输出的伙伴（按群 → threadId）—— 卡片原地刷新，⛔ 不新建消息 */
  const [liveByGroup, setLiveByGroup] = useState<Record<string, Record<string, LiveRun>>>({});
  /** ⛔ 卸载后不许再 setState（派活可能跑几分钟） */
  const alive = useRef(true);
  /** 伙伴 → 它最近一次的子会话 id（停止运行要用；也从群日志兜底，见 threadOf） */
  const threadRef = useRef<Record<string, string>>({});

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

  useEffect(() => {
    const off = window.codex.onHarnessEvent?.((event: Record<string, unknown>) => {
      if (!event || event.type !== "delegate-run") return;
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

      const failed: DispatchSummary["failed"] = [];
      /* ⛔⛔ 互相 @ 的护栏（用户要"互相 @ 对话"，但两个伙伴互 @ 会无限触发 —— 真金白银）：
         最多再跳 MAX_MENTION_HOPS 层、每个回复最多带 MAX_MENTION_FANOUT 个人、
         一轮里最多 MAX_MENTION_RUNS 次额外运行；且同一个人一轮只跑一次（防 A→B→A 回环）。 */
      const ranIds = new Set<string>();
      let extraBudget = MAX_MENTION_RUNS;

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

      const runOne = async (
        partner: TeamGroup["members"][number],
        bodyText: string,
        hops: number,
        source: "human" | "partner",
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
          const ctx = groupContextBlock(group, { forMemberId: partner.id });
          const query = ctx ? `${ctx}\n\n---\n\n${bodyText}` : bodyText;
          const res = (await window.codex.invokeAgent({
            kind: partner.targetKind as "expert" | "team" | "member" | "subagent" | "cli",
            name: partner.targetKey,
            query,
            /* ⛔ originThreadId 留空：群聊没有"群主会话"这条线，空 origin 等价于"发起方是本地用户"，
               闸与子会话复用都按这个口径走（互相 @ 触发的那次也一样）。 */
            originThreadId: "",
          })) as InvokeResult;
          if (!res?.ok || !res?.threadId) {
            errMsg = res?.error || "派活失败";
            noteError(partner.name, errMsg);
            return;
          }
          threadId = res.threadId;
          threadRef.current[partner.id] = threadId;
          output = String(res.output ?? "").trim();
          const wrote = await appendMessage(group.id, {
            authorId: partner.id,
            authorKind: "bot",
            threadId: res.threadId,
            text: output || "（没有返回文本内容）",
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

          /* ② 互相 @：回复里点到谁，就让谁接着说话（人能 @ 伙伴，伙伴之间也能）。
             ⛔ 只认群里真实存在、没静音、绑定了可派目标的人；⛔ 跳数/次数有上限。 */
          if (okFlag && hops < MAX_MENTION_HOPS) {
            const hits = parseMentions(output, group, { excludeId: partner.id })
              .filter((m) => m.kind === "bot")
              .filter((m) => !ranIds.has(m.id))
              .slice(0, MAX_MENTION_FANOUT);
            for (const hit of hits) {
              if (extraBudget <= 0) break;
              const next = group.members.find((m) => m.id === hit.id);
              if (!next || next.muted) continue;
              if (!next.targetKind || !next.targetKey) continue;
              if (next.targetKind === "member" || next.targetKind === "team") continue;
              extraBudget -= 1;
              /* ⛔ 不 await：主回复先上屏，被 @ 的人稍后自己进来（否则一个人卡住整条链） */
              void runOne(next, `（${partner.name} 在群里 @ 你）${bodyText}`, hops + 1, "partner");
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

      await Promise.all(targets.map((partner) => runOne(partner, body, 0, "human")));

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
    rowsByGroup, busyByGroup, liveByGroup, dispatchError, ledger,
    refresh, create, rename, addPartner, removePartner, mute, setGuard, removeGroup,
    setMemory, addNote, removeNote, saveFiles, saveMenu, setManagerOf,
    loadMessages, appendMessage, dispatch, loadLedger, stopPartner,
  };
}
