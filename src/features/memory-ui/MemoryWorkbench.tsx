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
import { RefreshCw } from "lucide-react";
import {
  ActorMemoryView, DispatchedTimelineView, McpBackendView, PyramidView, TeamMemoryView,
} from "./views";
import { MemorySkeleton, MemoryState } from "./primitives";
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
    /* ⛔ 没工作区就不取：主进程**不猜路径**，前端也不该拿"全部项目"糊过去。 */
    if (!enabled || !workspace) { setData(EMPTY); setState("ready"); return; }
    setState("loading");
    setError("");
    try {
      const bridge = (window as any).codex;
      const [pyramid, mcp, namespaces, dispatched] = await Promise.all([
        safe(() => bridge.readMemoryLayers(workspace), null),
        safe(() => bridge.readMemoryBackend(), null),
        safe(() => bridge.listFabricNamespaces(workspace), [] as any[]),
        safe(() => bridge.listDelegates(), [] as any[]),
      ]);
      const actors = await buildActorViews(bridge, workspace, namespaces ?? []);
      setData({
        pyramid: pyramid as PyramidMemory | null,
        mcp: mcp as McpBackendMemory | null,
        main: actors.main,
        subagents: actors.subagents,
        experts: actors.experts,
        teams: actors.teams,
        dispatched: (dispatched ?? []) as DispatchedSession[],
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

type ActorBuckets = { main: ActorMemory | null; subagents: ActorMemory[]; experts: ActorMemory[]; teams: ActorMemory[] };

/**
 * 从 fabric 命名空间反推「谁的记忆」。
 * ⛔⛔ 归属判定**只按命名空间前缀 + 角色登记表**，⛔ 绝不按条目内容/显示名猜 ——
 *   猜错的后果是"张老师的记忆显示在李老师名下"，而界面上完全看不出来。
 */
async function buildActorViews(bridge: any, workspace: string, namespaces: any[]): Promise<ActorBuckets> {
  const empty: ActorBuckets = { main: null, subagents: [], experts: [], teams: [] };
  if (!Array.isArray(namespaces) || !namespaces.length) return empty;

  const [roles, teams] = await Promise.all([
    safe(() => bridge.listRoleSessions(), [] as any[]),
    safe(() => bridge.listExpertTeams(), [] as any[]),
  ]);
  const roleByThread = new Map<string, any>((roles ?? []).map((r: any) => [String(r.threadId), r]));
  const teamById = new Map<string, any>((teams ?? []).map((t: any) => [String(t.teamId ?? t.id), t]));

  const statOf = (entries: any[]) => ({
    total: entries.length,
    pinned: entries.filter((e) => e?.pinned).length,
    archived: entries.filter((e) => e?.archivedAt != null).length,
    chars: entries.reduce((sum, e) => sum + String(e?.content ?? "").length, 0),
  });

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
    const name: string = ns?.namespace ?? "";
    const entries = await safe(
      () => bridge.listFabricEntries({ workspace, namespace: name, includeArchived: true }),
      [] as any[],
    );
    if (!Array.isArray(entries) || !entries.length) continue;

    /* ① 项目公共层：不属于任何执行体 ⇒ 进「主会话」区，标题写明是公共层 */
    if (name.startsWith("project__")) {
      pushMain(entries, "项目共享层", "project", name);
      continue;
    }

    /* ② 团内层：owner 是团 id ⇒ 归到该团（⛔ 不走下面的 private 分支：
       它的 owner 不是 threadId，`roleByThread` 查不到 ⇒ 会被误判成"孤儿"）。
       探针抓到过这个：团有 2 条却显示 0。 */
    if (name.startsWith("team__")) {
      const teamId = name.replace(/^team__/, "");
      const team = teamById.get(teamId);
      const found = out.teams.find((t) => t.actorId === teamId);
      const members = (team?.members ?? []).map((m: any) => ({ id: m.id, name: m.name, profession: m.profession?.zh }));
      if (found) {
        found.entries = [...found.entries, ...entries];
        found.stats = statOf(found.entries);
      } else {
        out.teams.push({
          kind: "team", id: name, actorId: teamId,
          actorName: String(team?.displayName?.zh ?? teamId),
          entries, createdAt: Date.now(), updatedAt: Date.now(), stats: statOf(entries),
          teamNamespace: name, members,
        });
      }
      continue;
    }

    /* ③ 私有层：owner 是 threadId ⇒ 靠角色登记表认人 */
    const ownerThread = name.replace(/^private__/, "");
    const role = roleByThread.get(ownerThread);
    if (!role?.ref) {
      /* ⛔ 孤儿空间（会话已删 / 角色已删）⇒ 如实标成"未归属"，⛔ 不硬塞给某个人 */
      pushMain(entries, "未归属的会话", ownerThread || "unknown", name);
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
          members: (team?.members ?? []).map((m: any) => ({ id: m.id, name: m.name, profession: m.profession?.zh })),
        });
      }
    }
  }
  return out;
}

/* ══ 外壳 ═════════════════════════════════════════════════════════════ */

const TABS: { kind: MemoryKind; label: string }[] = [
  { kind: "main", label: MEMORY_KIND_META.main.label },
  { kind: "subagent", label: MEMORY_KIND_META.subagent.label },
  { kind: "expert", label: MEMORY_KIND_META.expert.label },
  { kind: "team", label: MEMORY_KIND_META.team.label },
  { kind: "dispatched", label: MEMORY_KIND_META.dispatched.label },
  { kind: "pyramid", label: MEMORY_KIND_META.pyramid.label },
  { kind: "mcp-backend", label: MEMORY_KIND_META["mcp-backend"].label },
];

export function MemoryWorkbench({ workspace, onOpenThread }: {
  workspace: string;
  onOpenThread?: (id: string) => void;
}) {
  const { data, state, error, reload } = useMemorySources(workspace, true);
  const [tab, setTab] = useState<MemoryKind>("main");

  const counts = useMemo(() => ({
    main: data.main?.stats.total ?? 0,
    subagent: data.subagents.reduce((s, a) => s + a.stats.total, 0),
    expert: data.experts.reduce((s, a) => s + a.stats.total, 0),
    team: data.teams.reduce((s, a) => s + a.stats.total, 0),
    dispatched: data.dispatched.length,
    pyramid: data.pyramid?.layers.length ?? 0,
    "mcp-backend": data.mcp ? 1 : 0,
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
      {tab === "pyramid" && <PyramidView data={data.pyramid ?? emptyPyramid()} />}
      {tab === "mcp-backend" && (
        <McpBackendView data={data.mcp ?? emptyMcp()} state={state} error={error} onRetry={reload} />
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
  return {
    kind: "pyramid", id: "empty", createdAt: Date.now(), updatedAt: Date.now(),
    layers: [], archive: { files: 0, bytes: 0 },
  };
}

function emptyMcp(): McpBackendMemory {
  return {
    kind: "mcp-backend", id: "empty", createdAt: Date.now(), updatedAt: Date.now(),
    active: "builtin", connector: "local-memory", ready: false, sinkLabel: "内置金字塔",
  };
}
