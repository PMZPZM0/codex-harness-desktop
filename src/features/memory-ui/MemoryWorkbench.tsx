/**
 * memory-ui —— **统一外壳**（10-05）。
 *
 * ⛔ 外壳只做三件事，⛔ 不含任何"某类记忆长什么样"的知识：
 *   ① 状态管理（一处 `useMemorySources` 统一取数/错误/重试，各视图不自己 fetch）
 *   ② 类型分发（按 `kind` 走视图 ⇒ 加新类型改 `TABS` 一处）
 *   ③ 主题与密度（靠 CSS 变量，⛔ 不在 JS 里读主题）
 *
 * ⛔ 为什么不用 context：视图间**没有共享状态**（各看各的）⇒ context 只会
 *   带来"谁在提供、谁在消费"的耦合。状态留在外壳 + 显式 props 更清楚。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Layers, RefreshCw } from "lucide-react";
import {
  ActorMemoryView, DispatchedTimelineView, McpBackendView, PyramidView, TeamMemoryView,
} from "./views";
import { MemorySkeleton, MemoryState } from "./primitives";
import {
  LOCAL_MEMORY_CONNECTOR, normalizeDelegates, normalizeEntries, normalizeMcpBackend,
  normalizeMember, normalizePyramid, parseNamespace, statOf, type MemberCard,
} from "./normalize";
import {
  MEMORY_KIND_META, type ActorMemory, type DispatchedSession, type LoadState,
  type McpBackendMemory, type MemoryKind, type PyramidMemory,
} from "./types";

/* ══ 取数：⛔ 统一在这里，视图不碰 IPC ═══════════════════════════════════ */

export type MemorySources = {
  pyramid: PyramidMemory | null;
  mcp: McpBackendMemory | null;
  main: ActorMemory | null;
  subagents: ActorMemory[];
  experts: ActorMemory[];
  teams: ActorMemory[];
  dispatched: DispatchedSession[];
};

const EMPTY: MemorySources = {
  pyramid: null, mcp: null, main: null, subagents: [], experts: [], teams: [], dispatched: [],
};

/** ⛔ 桥接读取：通道缺失/抛错时返回兜底值而**不炸** —— 前端要能降级显示而不是整页白屏。 */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export function useMemorySources(workspace: string, enabled: boolean): {
  data: MemorySources; state: LoadState; error: string; reload: () => void;
} {
  const [data, setData] = useState<MemorySources>(EMPTY);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    /* ⛔ 没工作区就不取：主进程**不猜路径**，前端也不该拿“全部项目”糊过去。 */
    if (!enabled || !workspace) { setData(EMPTY); setState("ready"); return; }
    setState("loading");
    setError("");
    try {
      const bridge = (window as any).codex;
      /* ⛔⛔ hygiene:plan 是**唯一**能拿到 `archive` 的通道（`memory:layers:read` 的
         返回体里没有这个字段 —— 上午那次白屏就是读它读出来的）。
         ⛔ 它是只读的（apply 需 confirm:true），所以取它没有副作用。 */
      const [pyramid, mcp, namespaces, delegates, hygiene] = await Promise.all([
        safe<unknown>(() => bridge.readMemoryLayers(workspace), null),
        safe<unknown>(() => bridge.readMemoryBackend(), null),
        safe<any[]>(() => bridge.listFabricNamespaces(workspace), []),
        safe<unknown>(() => bridge.listDelegates(), null),
        safe<{ archive?: { files?: number; bytes?: number } } | null>(() => bridge.planMemoryHygiene(workspace), null),
      ]);
      const actors = await buildActorViews(bridge, workspace, namespaces ?? [], delegates);
      /* 被调度的 memoryCount 要按 threadId 查 fabric ⇒ 先建“命名空间 → 条数”索引。
         ⛔ 索引取自 listFabricNamespaces 自带的 `entries` 计数（⛔ 不为每个被调度会话
         再发一次 listFabricEntries —— 委托动辄几十个，那是 N+1 次 IPC）。 */
      const nsIndex = new Map<string, number>();
      for (const ns of namespaces ?? []) {
        if (ns?.namespace) nsIndex.set(String(ns.namespace), num(ns.entries));
      }
      setData({
        pyramid: pyramid ? normalizePyramid(pyramid, hygiene?.archive) : null,
        mcp: mcp ? normalizeMcpBackend(mcp) : null,
        main: actors.main,
        subagents: actors.subagents,
        experts: actors.experts,
        teams: actors.teams,
        dispatched: normalizeDelegates(delegates, (threadId) =>
          nsIndex.get("private__" + threadId) ?? 0),
      });
      setState("ready");
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setState("error");
    }
  }, [workspace, enabled]);

  useEffect(() => { void load(); }, [load]);

  return { data, state, error, reload: () => void load() };
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

type ActorBuckets = { main: ActorMemory | null; subagents: ActorMemory[]; experts: ActorMemory[]; teams: ActorMemory[] };

/**
 * 从 fabric 命名空间反推「谁的记忆」。
 * ⛔⛔ 归属判定**只按命名空间前缀 + 角色登记表**，⛔ 绝不按条目内容/显示名猜 ——
 *   猜错的后果是"张老师的记忆显示在李老师名下"，而界面上完全看不出来。
 */
async function buildActorViews(bridge: any, workspace: string, namespaces: any[], delegatesRaw?: unknown): Promise<ActorBuckets> {
  const empty: ActorBuckets = { main: null, subagents: [], experts: [], teams: [] };
  if (!Array.isArray(namespaces) || !namespaces.length) return empty;

  /* ⛔⛔ delegates 由调用方传入（⛔ 不在这里自己再调一次 —— 那是同一份数据的第二次 IPC，
     委托一多就把刷新拖慢了；⛔ 两处各调一次还会读到不同时刻的快照）。 */
  const [roles, teams] = await Promise.all([
    safe<any[]>(() => bridge.listRoleSessions(), []),
    safe<any[]>(() => bridge.listExpertTeams(), []),
  ]);
  const roleByThread = new Map<string, any>((roles ?? []).map((r: any) => [String(r.threadId), r]));
  const teamById = new Map<string, any>((teams ?? []).map((t: any) => [String(t.teamId ?? t.id), t]));

  /* ⛔ 成员“运行中”标记：⛔ 不能按 team 里有没有 running 会话判（委托真机几秒就跑完 ⇒ 永远假），
     ⛔ 只能按**这个团名下的委托记录**判 —— 登记表是唯一真相源。 */
  const runningNames = new Set<string>();
  for (const d of normalizeDelegates(delegatesRaw)) {
    if (d.status === "running") runningNames.add(d.name);
  }
  const membersOf = (team: any): MemberCard[] => {
    const list = Array.isArray(team?.members) ? team.members : [];
    /* ⛔ 主理人（lead）也是团成员 ⛔ 不加就少一个人（团内共享范围 = 成员名单，名单缺人 = 说谎） */
    return [...(team?.lead ? [team.lead] : []), ...list].map((m: any) =>
      normalizeMember(m, runningNames.has(String(m?.name ?? ""))));
  };

  const out: ActorBuckets = { main: null, subagents: [], experts: [], teams: [] };
  /** 把 project 层（公共层）并进「主会话」区：它不属于任何执行体，但用户需要一个看它的入口 */
  const pushMain = (entries: any[], actorName: string, actorId: string, ns: string) => {
    if (!out.main) {
      out.main = {
        kind: "main", id: ns, actorId, actorName, entries: [],
        createdAt: Date.now(), updatedAt: Date.now(), stats: statOf([]), privateNamespace: ns,
      };
    }
    out.main.entries = [...out.main.entries, ...entries];
    out.main.stats = statOf(out.main.entries);
  };

  for (const ns of namespaces) {
    const name: string = String(ns?.namespace ?? "");
    const entries = normalizeEntries(await safe(
      () => bridge.listFabricEntries({ workspace, namespace: name, includeArchived: true }),
      [] as any[],
    ));
    if (!entries.length) continue;

    const { scope, owner } = parseNamespace(name);

    /* ① 项目公共层：不属于任何执行体 ⇒ 进「主会话」区，标题写明是公共层 */
    if (scope === "project") {
      pushMain(entries, "项目共享层", "project", name);
      continue;
    }

    /* ② 团内层：owner 是团 id ⇒ 归到该团（⛔ 不走下面的 private 分支：
       它的 owner 不是 threadId，`roleByThread` 查不到 ⇒ 会被误判成"孤儿"）。
       探针抓到过这个：团有 2 条却显示 0。 */
    if (scope === "team") {
      const team = teamById.get(owner);
      const found = out.teams.find((t) => t.actorId === owner);
      if (found) {
        found.entries = [...found.entries, ...entries];
        found.stats = statOf(found.entries);
      } else {
        out.teams.push({
          kind: "team", id: name, actorId: owner,
          actorName: String(team?.displayName?.zh ?? owner),
          entries, createdAt: Date.now(), updatedAt: Date.now(), stats: statOf(entries),
          teamNamespace: name, members: membersOf(team),
        });
      }
      continue;
    }

    /* ③ 私有层：owner 是 threadId ⇒ 靠角色登记表认人 */
    const role = roleByThread.get(owner);
    if (!role?.ref) {
      /* ⛔ 孤儿空间（会话已删 / 角色已删）⇒ 如实标成"未归属"，⛔ 不硬塞给某个人 */
      pushMain(entries, "未归属的会话", owner || "unknown", name);
      continue;
    }

    const ref = role.ref;
    const kind: "subagent" | "expert" | "team" =
      ref.kind === "expert" ? "expert" : ref.kind === "subagent" ? "subagent" : "team";
    const teamId = ref.kind === "team-lead" || ref.kind === "team-member" ? String(ref.id) : "";
    const base: ActorMemory = {
      kind, id: name, actorId: ref.id + (ref.memberId ? "/" + ref.memberId : ""),
      actorName: ref.label || ref.id, entries, createdAt: Date.now(), updatedAt: Date.now(),
      stats: statOf(entries), privateNamespace: name,
      teamNamespace: teamId ? "team__" + teamId : undefined,
    };

    if (kind === "subagent") out.subagents.push(base);
    else if (kind === "expert") out.experts.push(base);
    else {
      /* 团：同团合并成一个视图，成员名单来自团队配置（⛔ 团内记忆的可见范围 = 成员名单） */
      const team = teamById.get(teamId);
      const found = out.teams.find((t) => t.actorId === teamId);
      if (found) {
        found.entries = [...found.entries, ...entries];
        found.stats = statOf(found.entries);
      } else {
        out.teams.push({
          ...base, actorId: teamId,
          actorName: String(team?.displayName?.zh ?? ref.label ?? ref.id),
          members: membersOf(team),
        });
      }
    }
  }
  return out;
}

/* ══ 外壳 ═════════════════════════════════════════════════════════════ */

/** tab 用的 kind 子集 = **作用域维度**（⛔ 不是 MemoryKind 全集：pyramid / mcp-backend
 *  仍是独立数据源，但它们不做 tab —— 见下面 TABS 的注释）。类型收窄还有个好处：
 *  counts 与 TABS 的键对不上时**编译期就报错**（这次修正就是它先把问题顶出来的）。 */
type ScopeTabKind = "main" | "subagent" | "expert" | "team" | "dispatched";

const TABS: { kind: ScopeTabKind; label: string }[] = [
  { kind: "main", label: MEMORY_KIND_META.main.label },
  { kind: "subagent", label: MEMORY_KIND_META.subagent.label },
  { kind: "expert", label: MEMORY_KIND_META.expert.label },
  { kind: "team", label: MEMORY_KIND_META.team.label },
  { kind: "dispatched", label: MEMORY_KIND_META.dispatched.label },
  /* ⛔⛔ 这里**只放作用域维度**（「这是谁的记忆」）。← 10-10 用户反馈修正：
     原来把 `pyramid` 与 `mcp-backend` 也并列成 tab，是**把两个正交维度混在一起**了 ——
     金字塔（L0–L7）是**横切分层机制**、MCP 是**存储位置**，它们跟"谁的记忆"不是一回事。
     更糟的是计数口径：其它 tab 显示**条目数**，而 pyramid 显示的是**层数**（L0–L7 恒为 8）、
     mcp-backend 是**布尔转 1** ⇒ 用户看到"金字塔 8、其它全 0"，读出来的结论是
     「记忆全被归到了金字塔这一类」（用户原话）。
     ⇒ 两者改为**常驻概览条**（见 MemoryOverview）：切到任一作用域都看得到层水位与后端，
       而不再是并列分类。⛔ MemoryKind 类型层的七类数据源**不变**（它们仍是独立数据源）。 */
];

export function MemoryWorkbench({ workspace, onOpenThread }: {
  workspace: string;
  onOpenThread?: (id: string) => void;
}) {
  const { data, state, error, reload } = useMemorySources(workspace, true);
  const [tab, setTab] = useState<MemoryKind>("main");

  /* ⛔ 计数**只统计条目数**（口径统一）。10-10 修正：原来 pyramid 填的是 `layers.length`
     （层数，恒 8）、mcp-backend 填的是 `data.mcp ? 1 : 0`（布尔转数字）—— 量与意义都不同，
     摆在同一排 tab 上就是在骗人。两者已移出 tab（见 MemoryOverview）。 */
  const counts = useMemo(() => ({
    main: data.main?.stats.total ?? 0,
    subagent: data.subagents.reduce((s, a) => s + a.stats.total, 0),
    expert: data.experts.reduce((s, a) => s + a.stats.total, 0),
    team: data.teams.reduce((s, a) => s + a.stats.total, 0),
    dispatched: data.dispatched.length,
  }), [data]);

  if (!workspace) {
    return (
      <div className="mui-root">
        <MemoryState state="ready" empty="先在上方选一个项目" emptyHint="记忆按项目存放 —— 选好后这里会列出七类记忆。" />
      </div>
    );
  }

  const open = (id: string) => onOpenThread?.(id);

  return (
    <div className="mui-root">
      <nav className="mui-tabs" role="tablist" aria-label="记忆类型">
        {TABS.map((t) => {
          const n = counts[t.kind];
          return (
            <button key={t.kind} type="button" role="tab" aria-selected={tab === t.kind}
              className={"mui-tab" + (tab === t.kind ? " is-on" : "")}
              onClick={() => setTab(t.kind)}>
              <span>{t.label}</span>
              {/* ⛔ 计数为 0 也显示（压暗）—— 让用户知道"这类存在但还没内容" */}
              <span className={"mui-tab-count" + (n ? "" : " is-zero")}>{n}</span>
            </button>
          );
        })}
        <span className="mui-tabs-spacer" />
        <button type="button" className="mui-refresh" onClick={reload} title="重新读取" aria-label="重新读取">
          <RefreshCw size={13} className={state === "loading" ? "mui-spin" : ""} />
        </button>
      </nav>

      <p className="mui-blurb">{MEMORY_KIND_META[tab].blurb}</p>

      {/* 机制概览（**常驻**）：金字塔层水位 + 存储后端。
          ⛔ 它不是 tab —— 金字塔与后端跟"谁的记忆"是两个正交维度（见 TABS 上的注释）；
            放在这里 ⇒ 切到任一作用域都看得到"金字塔现在什么水位、记忆存在哪"。 */}
      <MemoryOverview
        pyramid={data.pyramid ?? emptyPyramid()}
        mcp={data.mcp ?? emptyMcp()}
        state={state} error={error} onRetry={reload}
      />

      {state === "loading" && !hasAnyData(data) && <MemorySkeleton rows={4} />}
      {state === "error" && <MemoryState state="error" error={error} empty="读取失败" onRetry={reload} />}

      {tab === "main" && (
        <ActorMemoryView kind="main" data={data.main ?? emptyActor("还没有记忆", "main")}
          state={state} error={error} onRetry={reload} onOpenThread={open} />
      )}
      {tab === "subagent" && (data.subagents.length
        ? data.subagents.map((a) => (
            <ActorMemoryView key={a.actorId} kind="subagent" data={a} state="ready" onOpenThread={open} />
          ))
        : <ActorMemoryView kind="subagent" data={emptyActor("还没有子智能体", "-")} state="ready" />)}
      {tab === "expert" && (data.experts.length
        ? data.experts.map((a) => (
            <ActorMemoryView key={a.actorId} kind="expert" data={a} state="ready" onOpenThread={open} />
          ))
        : <ActorMemoryView kind="expert" data={emptyActor("还没有专家", "-")} state="ready" />)}
      {tab === "team" && (data.teams.length
        ? data.teams.map((a) => <TeamMemoryView key={a.actorId} data={a} state="ready" onOpenThread={open} />)
        : <TeamMemoryView data={emptyActor("还没有专家团", "-")} state="ready" />)}
      {tab === "dispatched" && (
        <DispatchedTimelineView items={data.dispatched} state={state} error={error} onRetry={reload} onOpenThread={open} />
      )}
    </div>
  );
}

/**
 * 「机制概览」—— 金字塔（L0–L7 分层）与存储后端**常驻**在每个作用域视图上方。
 *
 * ⛔⛔ 为什么不做成并列 tab（10-10 用户反馈修正）：金字塔是**横切分层机制**、后端是
 * **存储位置**，两者与「这是谁的记忆」（作用域维度）正交。并列成 tab 时的实际后果是
 * 计数口径串了味 —— pyramid 那格填的是**层数**（L0–L7 恒 8）、mcp 那格是**布尔**，
 * 而作用域那几格是**条目数** ⇒ 用户看到「金字塔 8、其它全 0」，读出来就是
 * 「记忆全归到了金字塔这一类」。⇒ 改成概览条：默认一行摘要（有内容的层 + 需蒸馏 + 后端），
 * 点开才是完整的七层水位与后端详情（能力一点没少）。
 */
function MemoryOverview({ pyramid, mcp, state, error, onRetry }: {
  pyramid: PyramidMemory; mcp: McpBackendMemory;
  state: LoadState; error: string; onRetry: () => void;
}) {
  const [open, setOpen] = useState(false);
  const layers = Array.isArray(pyramid?.layers) ? pyramid.layers : [];
  const withContent = layers.filter((l) => (l.used ?? 0) > 0);
  const needDistill = layers.filter((l) => l.needDistill).length;
  const summary = withContent.length
    ? withContent.map((l) => `${l.id} ${Math.round((l.ratio ?? 0) * 100)}%`).join(" · ")
    : "七层还没有内容";
  return (
    <div className="mui-overview" data-layers={layers.length}>
      <button type="button" className="mui-overview-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Layers size={13} />
        <strong>金字塔记忆</strong>
        <span className="mui-overview-summary">{summary}</span>
        {needDistill ? <span className="mui-overview-warn">{needDistill} 层需蒸馏</span> : null}
        <span className="mui-overview-backend">存储：{mcp?.active ? "本地 MCP" : "内置分层"}</span>
        <ChevronDown size={14} className={"mui-overview-chevron" + (open ? " is-open" : "")} />
      </button>
      {open && (
        <div className="mui-overview-body">
          <PyramidView data={pyramid} />
          <McpBackendView data={mcp} state={state} error={error} onRetry={onRetry} />
        </div>
      )}
    </div>
  );
}

function hasAnyData(d: MemorySources): boolean {
  return Boolean(
    d.pyramid || d.mcp || d.main || d.subagents.length || d.experts.length || d.teams.length || d.dispatched.length,
  );
}

function emptyActor(actorName: string, actorId: string): ActorMemory {
  return {
    kind: "main", id: "empty-" + actorId, actorId, actorName, entries: [],
    createdAt: Date.now(), updatedAt: Date.now(),
    stats: { total: 0, pinned: 0, archived: 0, chars: 0 },
  };
}

function emptyPyramid(): PyramidMemory {
  return normalizePyramid(null, null);
}

function emptyMcp(): McpBackendMemory {
  return {
    kind: "mcp-backend", id: "empty", createdAt: 0, updatedAt: 0,
    active: "builtin", connector: LOCAL_MEMORY_CONNECTOR, ready: false, sinkLabel: "内置记忆金字塔",
    fallbackReason: null, installCommand: "",
  };
}
