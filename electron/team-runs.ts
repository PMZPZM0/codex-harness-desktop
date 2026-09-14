/**
 * 专家团运行记录 —— 主进程权威（09-14 用户要求「每个成员都真实干活、能看见成员的工作会话内容、能查历史」）。
 *
 * 三份状态：
 *  ① `<userData>/team-runs/<leadThreadId>.json`：该团队会话的每一次成员委托记录
 *     （谁、子任务、产出全文、起止时间、状态）。历史记录 UI 从这里读。
 *  ② `<userData>/team-threads.json`：threadId → teamId 映射 + (teamId|memberId) → 成员线程 id。
 *     映射必须落盘且在主进程 —— popout 独立窗口里的渲染层没有 teamThreadMapRef，
 *     只能靠这份权威映射才知道自己打开的会话属于哪个团。
 *  ③ 内存里的活跃运行表：成员线程正在跑时，把它的流式文本增量广播给所有窗口
 *     （成员工作弹窗实时显示的就是这个）。**只在内存**，落盘发生在结束时。
 *
 * ⛔ 请求路径禁止同步磁盘 I/O（见项目硬约束）：读用 async fs，写做 120ms 合并。
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export type TeamRunStatus = "running" | "done" | "failed";

export interface TeamMemberRun {
  runId: string;
  /** 发起委托的主理人会话 id —— 历史记录按它归集 */
  leadThreadId: string;
  teamId: string;
  memberId: string;
  memberName: string;
  /** 角色展示名（如「资金流向分析师」） */
  profession: string;
  role: "lead" | "member";
  /** 该次委托实际使用的成员线程 id（同一成员多次委托时复用同一个） */
  memberThreadId: string;
  query: string;
  output: string;
  status: TeamRunStatus;
  startedAt: number;
  endedAt?: number;
  error?: string;
}

export interface TeamRunsDoc {
  leadThreadId: string;
  teamId: string;
  updatedAt: number;
  runs: TeamMemberRun[];
}

export interface TeamThreadsDoc {
  /** threadId → teamId */
  threads: Record<string, string>;
  /** `teamId|memberId`（均小写） → 该成员长期复用的线程 id */
  members: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────
// 纯函数（预检可直接断言，不依赖 Electron）
// ─────────────────────────────────────────────────────────────

/** 复用键：同一 (team, member) 始终指向同一个成员线程 —— 成员因此有跨委托记忆。 */
export function memberThreadKey(teamId: string, memberId: string): string {
  return `${String(teamId ?? "").trim().toLowerCase()}|${String(memberId ?? "").trim().toLowerCase()}`;
}

/** 成员线程标题：`团名·成员名`。
 *  修掉旧行为——不设名字时引擎拿首条用户消息（角色提示词全文）当标题，侧栏显示成一坨。 */
export function memberThreadName(teamDisplayName: string, memberName: string): string {
  const team = String(teamDisplayName ?? "").trim() || "专家团";
  const member = String(memberName ?? "").trim() || "成员";
  return `${team}·${member}`;
}

/** 追加/覆盖一条运行记录。同 runId 覆盖原位，否则插到最前（最新在上）。 */
export function upsertRun(runs: TeamMemberRun[] | null | undefined, run: TeamMemberRun): TeamMemberRun[] {
  const list = Array.isArray(runs) ? runs.slice() : [];
  const index = list.findIndex((entry) => entry?.runId === run.runId);
  if (index >= 0) list[index] = { ...list[index], ...run };
  else list.unshift(run);
  return list;
}

/** 流式累加：把一段增量拼到已有文本后面（纯函数，便于断言「增量不丢不重」）。 */
export function applyMemberDelta(text: string | null | undefined, delta: string | null | undefined): string {
  if (!delta) return String(text ?? "");
  return `${String(text ?? "")}${delta}`;
}

/** 单条记录的展示用时（毫秒）；未结束时按 now 计算。 */
export function runDurationMs(run: Pick<TeamMemberRun, "startedAt" | "endedAt">, now: number = Date.now()): number {
  const start = Number(run?.startedAt) || 0;
  if (!start) return 0;
  const end = Number(run?.endedAt) || now;
  return Math.max(0, end - start);
}

/** 按成员归并运行记录（头像轨上「谁干过几次活、最近一次什么状态」据此得出）。 */
export function groupRunsByMember(runs: TeamMemberRun[] | null | undefined): Record<string, { total: number; last?: TeamMemberRun; running: boolean }> {
  const out: Record<string, { total: number; last?: TeamMemberRun; running: boolean }> = {};
  for (const run of Array.isArray(runs) ? runs : []) {
    if (!run?.memberId) continue;
    const entry = out[run.memberId] ?? { total: 0, running: false };
    entry.total += 1;
    if (!entry.last || (run.startedAt ?? 0) >= (entry.last.startedAt ?? 0)) entry.last = run;
    if (run.status === "running") entry.running = true;
    out[run.memberId] = entry;
  }
  return out;
}

/** 该回合里的成员委托是否可并发判定：同回合内互不依赖的调用数 ≥ 2 即视为并行阶段。 */
export function countParallelRuns(runs: TeamMemberRun[], windowMs = 1500): number {
  const starts = (Array.isArray(runs) ? runs : []).map((run) => Number(run?.startedAt) || 0).filter(Boolean).sort((a, b) => a - b);
  let best = 0;
  for (const start of starts) {
    const n = starts.filter((entry) => entry >= start && entry - start <= windowMs).length;
    if (n > best) best = n;
  }
  return best;
}

// ─────────────────────────────────────────────────────────────
// 存储 + 实时追踪
// ─────────────────────────────────────────────────────────────
export class TeamRunStore {
  private threadsFile: string;
  private runsDir: string;
  private threadsDoc: TeamThreadsDoc = { threads: {}, members: {} };
  private loaded = false;
  private runsCache = new Map<string, TeamRunsDoc>();
  private threadsWriteTimer: NodeJS.Timeout | null = null;
  private runsWriteTimers = new Map<string, NodeJS.Timeout>();
  /** memberThreadId → runId（正在跑的成员线程） */
  private activeByThread = new Map<string, string>();
  private activeRuns = new Map<string, TeamMemberRun>();

  constructor(private userDataDir: string, private broadcast: (payload: unknown) => void) {
    this.threadsFile = path.join(userDataDir, "team-threads.json");
    this.runsDir = path.join(userDataDir, "team-runs");
  }

  private ensureThreadsLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.threadsFile, "utf8"));
      this.threadsDoc = {
        threads: parsed?.threads && typeof parsed.threads === "object" ? parsed.threads : {},
        members: parsed?.members && typeof parsed.members === "object" ? parsed.members : {},
      };
    } catch {
      this.threadsDoc = { threads: {}, members: {} };
    }
  }

  private scheduleThreadsWrite() {
    if (this.threadsWriteTimer) return;
    this.threadsWriteTimer = setTimeout(() => {
      this.threadsWriteTimer = null;
      try {
        fs.mkdirSync(this.userDataDir, { recursive: true });
        fs.writeFileSync(this.threadsFile, JSON.stringify(this.threadsDoc), "utf8");
      } catch { /* 落盘失败不影响运行 */ }
    }, 120);
  }

  private runsFile(leadThreadId: string) {
    return path.join(this.runsDir, `${String(leadThreadId).replace(/[^\w.-]/g, "_")}.json`);
  }

  private scheduleRunsWrite(leadThreadId: string) {
    if (this.runsWriteTimers.has(leadThreadId)) return;
    const timer = setTimeout(() => {
      this.runsWriteTimers.delete(leadThreadId);
      const doc = this.runsCache.get(leadThreadId);
      if (!doc) return;
      try {
        fs.mkdirSync(this.runsDir, { recursive: true });
        fs.writeFileSync(this.runsFile(leadThreadId), JSON.stringify(doc), "utf8");
      } catch { /* ignore */ }
    }, 120);
    this.runsWriteTimers.set(leadThreadId, timer);
  }

  /** 记录 threadId 属于哪个专家团（团队会话与成员直达会话都要记）。 */
  setThreadTeam(threadId: string, teamId: string) {
    if (!threadId || !teamId) return;
    this.ensureThreadsLoaded();
    this.threadsDoc.threads[threadId] = teamId;
    this.scheduleThreadsWrite();
  }

  teamOfThread(threadId: string): string {
    this.ensureThreadsLoaded();
    return this.threadsDoc.threads[threadId] ?? "";
  }

  rememberMemberThread(teamId: string, memberId: string, memberThreadId: string) {
    if (!teamId || !memberId || !memberThreadId) return;
    this.ensureThreadsLoaded();
    this.threadsDoc.members[memberThreadKey(teamId, memberId)] = memberThreadId;
    this.scheduleThreadsWrite();
  }

  /** 该成员长期复用的线程 id（没有则空串 → 走新建）。 */
  memberThreadOf(teamId: string, memberId: string): string {
    this.ensureThreadsLoaded();
    return this.threadsDoc.members[memberThreadKey(teamId, memberId)] ?? "";
  }

  listThreads(): TeamThreadsDoc {
    this.ensureThreadsLoaded();
    return { threads: { ...this.threadsDoc.threads }, members: { ...this.threadsDoc.members } };
  }

  /** 开始一次委托：注册活跃运行（成员线程的流式事件据此路由），并广播 started。 */
  beginRun(input: Omit<TeamMemberRun, "runId" | "status" | "output" | "startedAt"> & Partial<Pick<TeamMemberRun, "runId" | "startedAt">>): TeamMemberRun {
    const run: TeamMemberRun = {
      runId: input.runId ?? `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      leadThreadId: input.leadThreadId,
      teamId: input.teamId,
      memberId: input.memberId,
      memberName: input.memberName,
      profession: input.profession,
      role: input.role,
      memberThreadId: input.memberThreadId,
      query: input.query,
      output: "",
      status: "running",
      startedAt: input.startedAt ?? Date.now(),
    };
    this.activeRuns.set(run.runId, run);
    if (run.memberThreadId) this.activeByThread.set(run.memberThreadId, run.runId);
    this.broadcast({ type: "team-run", phase: "started", run });
    return run;
  }

  /** 成员线程的流式文本增量 → 广播给所有窗口（成员工作弹窗实时渲染）。 */
  handleEngineEvent(event: any) {
    if (!event || event.kind !== "notification") return;
    if (event.method !== "item/agentMessage/delta") return;
    const params = event.params ?? {};
    const threadId = String(params.threadId ?? "");
    if (!threadId) return;
    const runId = this.activeByThread.get(threadId);
    if (!runId) return;
    const run = this.activeRuns.get(runId);
    if (!run) return;
    const delta = String(params.delta ?? "");
    if (!delta) return;
    run.output = applyMemberDelta(run.output, delta);
    this.broadcast({ type: "team-run", phase: "delta", runId, memberId: run.memberId, memberThreadId: threadId, text: delta, chars: run.output.length });
  }

  /** 结束一次委托：写进落盘文档、广播 finished、清掉活跃表。 */
  finishRun(runId: string, patch: { status: TeamRunStatus; output?: string; error?: string }) {
    const run = this.activeRuns.get(runId);
    if (!run) return null;
    const finished: TeamMemberRun = {
      ...run,
      output: (patch.output ?? run.output ?? "").trim(),
      status: patch.status,
      error: patch.error,
      endedAt: Date.now(),
    };
    this.activeRuns.delete(runId);
    if (finished.memberThreadId) this.activeByThread.delete(finished.memberThreadId);
    const key = finished.leadThreadId;
    const existing = this.runsCache.get(key);
    const runs = upsertRun(existing?.runs, finished);
    this.runsCache.set(key, { leadThreadId: key, teamId: finished.teamId, updatedAt: Date.now(), runs });
    this.scheduleRunsWrite(key);
    this.broadcast({ type: "team-run", phase: "finished", run: finished });
    return finished;
  }

  activeRunList(): TeamMemberRun[] {
    return [...this.activeRuns.values()];
  }

  /** 读该团队会话的历史委托记录（成员历史工作记录面板用）。
   *  ⛔ 09-14 用户实测 bug：活跃中的委托只进内存（activeRuns），落盘发生在结束时——
   *  用户在成员运行中关掉工作弹窗再点开历史，listRuns 只读落盘文档 → 显示「还没有
   *  历史工作记录」，跑完才出现。这里把同会话的活跃 run（含实时 output）一并合并返回。 */
  async listRuns(leadThreadId: string): Promise<TeamMemberRun[]> {
    if (!leadThreadId) return [];
    const activeHere = [...this.activeRuns.values()].filter((run) => run.leadThreadId === leadThreadId);
    const cached = this.runsCache.get(leadThreadId);
    if (cached) {
      // 活跃 run 覆盖同 id 的已落盘条目（运行中又 finishing 的时序缝隙），其余照旧
      const byId = new Map(cached.runs.map((run) => [run.runId, run]));
      for (const run of activeHere) byId.set(run.runId, run);
      return [...byId.values()].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    }
    try {
      const parsed = JSON.parse(await fsp.readFile(this.runsFile(leadThreadId), "utf8"));
      const runs: TeamMemberRun[] = Array.isArray(parsed?.runs) ? parsed.runs : [];
      this.runsCache.set(leadThreadId, { leadThreadId, teamId: parsed?.teamId ?? "", updatedAt: parsed?.updatedAt ?? 0, runs });
      const byId = new Map(runs.map((run) => [run.runId, run]));
      for (const run of activeHere) byId.set(run.runId, run);
      return [...byId.values()].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    } catch {
      this.runsCache.set(leadThreadId, { leadThreadId, teamId: "", updatedAt: 0, runs: [] });
      return [...activeHere].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    }
  }
}
