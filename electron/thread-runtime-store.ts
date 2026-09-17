import fs from "node:fs/promises";

/** 调度配置（与渲染层 `emptyDispatch()` 同形）：当前会话允许 Codex 调度哪些对象干活 */
export type DispatchConfig = { enabled: boolean; expert: boolean; team: boolean; subagent: boolean };

/** 会话运行时配置记录（与渲染层 `src/lib/thread-runtime.mjs` 同形，多一个 updatedAt） */
export type ThreadRuntimeRecord = {
  model: string;
  effort: string;
  sandbox: string;
  approval: string;
  /** 调度开关（09-15 新增；与模型/权限同源同存放处，会话级） */
  dispatch: DispatchConfig;
  /** 版本号：只在**真的变了**时 +1，用作并发冲突判据（等价 ZCode 的 revision） */
  rev: number;
  updatedAt: number;
};

const FIELDS = ["model", "effort", "sandbox", "approval"] as const;
export type ThreadRuntimeField = (typeof FIELDS)[number];

const emptyDispatchConfig = (): DispatchConfig => ({ enabled: false, expert: true, team: true, subagent: true });

/** 归一化调度配置（坏值/缺字段一律回落默认：总开关关、三类勾选开） */
export function normalizeDispatchConfig(input: unknown): DispatchConfig {
  const src = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    enabled: src.enabled === true,
    expert: bool(src.expert, true),
    team: bool(src.team, true),
    subagent: bool(src.subagent, true),
  };
}

/** 调度配置签名（与渲染层 `dispatchSignature()` 同算法，多窗口回声判定要用同一套） */
export function dispatchSignatureOf(input: unknown): string {
  const d = normalizeDispatchConfig(input);
  return [d.enabled, d.expert, d.team, d.subagent].map((v) => (v ? "1" : "0")).join("");
}

const emptyRecord = (): ThreadRuntimeRecord => ({ model: "", effort: "", sandbox: "", approval: "", dispatch: emptyDispatchConfig(), rev: 0, updatedAt: 0 });

const str = (value: unknown) => (typeof value === "string" ? value : value === undefined || value === null ? "" : String(value));

function sanitizeFields(input: unknown): Partial<Record<ThreadRuntimeField, string>> {
  const src = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const out: Partial<Record<ThreadRuntimeField, string>> = {};
  for (const key of FIELDS) {
    const value = str(src[key]);
    if (value) out[key] = value;
  }
  return out;
}

/** 从 patch/记录里取调度配置；不是对象就返回 null（表示「这次不动调度」） */
function pickDispatch(input: unknown): DispatchConfig | null {
  const src = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const value = src.dispatch;
  return value && typeof value === "object" ? normalizeDispatchConfig(value) : null;
}

/**
 * 会话运行时配置（模型 / 思考档位 / 权限）的**主进程权威存放处**——多窗口并发保护（09-14）。
 *
 * 为什么放主进程：popout 独立窗口与主窗口是两个渲染进程，它们共享同一份 localStorage（同 origin），
 * 因此**存储**是一致的，但各自的 React 状态是旧的、且写入是「读-改-写」三步 —— 两个窗口同时改
 * 同一会话会互相看不见、丢更新（两边都读到 rev=N，各自写回 rev=N+1，后写的把前者的字段抹掉）。
 * 主进程是单点：写入天然串行、改完还能广播给所有窗口。渲染层保留 localStorage 镜像只作**同步读
 * 缓存**（渲染层大量同步读，不能全改成异步 IPC），权威值以主进程为准。
 *
 * 冲突策略：**字段级合并 + 以传入的 baseRev 判冲突**。冲突时不丢用户这次动作自身的字段
 * （用户动作该赢），但对方的其它字段不受影响；冲突只作为信息回报给渲染层（用于刷新界面）。
 * 这比「整对象覆盖」和「直接拒绝写入」都更贴合真实场景：两个窗口改的通常不是同一个字段。
 */
export class ThreadRuntimeStore {
  private map: Record<string, ThreadRuntimeRecord> = {};
  private loaded = false;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly file: string) {}

  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw: unknown = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        // 老文件里的记录没有 dispatch 字段（09-15 才加的）—— 读进来就补齐默认值：
        // 否则下游到处要判 undefined，`patch` 的 changed 判定也会把「补默认」误认成一次修改。
        const table: Record<string, ThreadRuntimeRecord> = {};
        for (const [key, value] of Object.entries(raw as Record<string, ThreadRuntimeRecord>)) {
          table[key] = { ...emptyRecord(), ...(value ?? {}), dispatch: normalizeDispatchConfig((value as any)?.dispatch) };
        }
        this.map = table;
      }
    } catch { /* 首次运行没有文件：按空表起步 */ }
  }

  /** 写盘做 120ms 合并：一次用户动作可能连带写两三个字段，不必逐次落盘 */
  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.saveTimer = null; void this.flush(); }, 120);
  }

  async flush() {
    try { await fs.writeFile(this.file, JSON.stringify(this.map, null, 2), "utf8"); } catch { /* 写失败不影响内存态 */ }
  }

  async get(threadId: string): Promise<ThreadRuntimeRecord | null> {
    await this.load();
    return this.map[threadId] ?? null;
  }

  async list(): Promise<Record<string, ThreadRuntimeRecord>> {
    await this.load();
    return { ...this.map };
  }

  /**
   * 打补丁（字段级合并）。
   * @param baseRev 渲染层读到的 rev；传了就做冲突检测（不等即 conflict=true），不传则不检测。
   * @param opts.takeover 独占冲突时是否原子接管（见下）。
   *
   * ⛔ 调度独占（09-16 用户要求「同一时间只能一个会话开，其他灰掉，避免同时调用」）：
   * 开关是**会话级**的，但「谁有权调度」是**全局唯一**的。持有者不单独存字段，
   * 而是从记录里**派生**（第一个 dispatch.enabled 的线程）—— 但「记录会被清掉」这件事必须真的发生：
   * 09-17 修（用户实测「都关掉了，怎么还提示被锁住了」）：归档 → `releaseDispatch`、删除 → `remove`，
   * 调用点在 main.ts 对 `thread/archived` / `thread/deleted` 的事件清理 + 渲染层自愈。
   * ⛔ 旧版只有这句设想、**没有任何调用点**（本类连 remove 都没有）⇒ 会话被归档/删除后记录仍在，
   * 孤儿记录永久占着全局唯一的调度权，而它在侧栏已找不到、用户无法关闭 —— 永久死锁。
   * 冲突时默认**不改动任何东西**（changed:false + blockedBy），由 UI 决定是否接管；
   * takeover=true 才在同一笔写入里把原持有者的开关关掉（原子，两个窗口同时操作也不会
   * 出现「两个都开着」的中间态）。
   */
  async patch(
    threadId: string,
    patch: unknown,
    baseRev?: number,
    opts?: { takeover?: boolean },
  ): Promise<{ runtime: ThreadRuntimeRecord; conflict: boolean; changed: boolean; blockedBy?: string; tookOverFrom?: string }> {
    await this.load();
    const current = this.map[threadId] ?? emptyRecord();
    const conflict = typeof baseRev === "number" && Number.isFinite(baseRev) && baseRev !== current.rev;
    const fields = sanitizeFields(patch);
    const dispatch = pickDispatch(patch);
    // ── 独占检查：本笔要把 enabled 置真、而锁在别人手里 ──
    let tookOverFrom: string | undefined;
    if (dispatch?.enabled === true) {
      const owner = this.dispatchOwnerFromMap(threadId);
      if (owner) {
        if (!opts?.takeover) return { runtime: current, conflict, changed: false, blockedBy: owner };
        tookOverFrom = owner;
        const held = this.map[owner];
        if (held) {
          this.map[owner] = { ...held, dispatch: { ...held.dispatch, enabled: false }, rev: held.rev + 1, updatedAt: Date.now() };
        }
      }
    }
    const changed = FIELDS.some((key) => fields[key] !== undefined && fields[key] !== current[key])
      || (dispatch !== null && dispatchSignatureOf(dispatch) !== dispatchSignatureOf(current.dispatch));
    if (!changed) {
      // 接管动作本身没有改变本线程配置（本来就是开的）时，也要把锁从上家摘下来
      if (tookOverFrom) { this.scheduleSave(); return { runtime: current, conflict, changed: false, tookOverFrom }; }
      return { runtime: current, conflict, changed: false };
    }
    const next: ThreadRuntimeRecord = { ...current, ...fields, ...(dispatch ? { dispatch } : {}), rev: current.rev + 1, updatedAt: Date.now() };
    this.map[threadId] = next;
    this.scheduleSave();
    return { runtime: next, conflict, changed: true, ...(tookOverFrom ? { tookOverFrom } : {}) };
  }

  /**
   * 释放该会话的调度独占锁：**只**把 `dispatch.enabled` 置假，其它字段（模型 / 思考档位 / 权限 /
   * 专家·专家团·子智能体开关）原样保留 —— 归档的会话被恢复后配置不丢。
   *
   * ⛔ 为什么必须显式释放（09-17 用户实测：「都关掉了，怎么还提示被锁住了」）：
   *   持有者是**从记录派生**的（第一个 `dispatch.enabled` 的线程），而**归档 / 删除会话时
   *   没有任何地方清这条记录** —— `patch()` 里那句注释「删除/归档线程、记录被清掉时锁会自动
   *   释放」当年只是设想，实现里既没有 `remove` 也没有任何调用点。
   *   ⇒ 孤儿记录永久占着全局唯一的调度权，而那个会话在侧栏上已经找不到，
   *     用户**没有任何入口**能关掉它。实测证据：用户 `thread-runtime.json` 里有 1 条 enabled，
   *     其 threadId 在引擎 `state_5.sqlite` 的 threads 表里已不存在。
   */
  async releaseDispatch(threadId: string): Promise<boolean> {
    await this.load();
    const current = this.map[threadId];
    if (!current || current.dispatch?.enabled !== true) return false;
    this.map[threadId] = {
      ...current,
      dispatch: { ...current.dispatch, enabled: false },
      rev: current.rev + 1,
      updatedAt: Date.now(),
    };
    this.scheduleSave();
    return true;
  }

  /** 彻底删除该会话的运行时记录（会话被**删除**时用；归档请用 `releaseDispatch` 保留配置）。 */
  async remove(threadId: string): Promise<boolean> {
    await this.load();
    if (!this.map[threadId]) return false;
    delete this.map[threadId];
    this.scheduleSave();
    return true;
  }

  /** 当前调度持有者（全局唯一）。exclude 用来看「除了我以外还有谁开着」。 */
  async dispatchOwner(excludeThreadId?: string): Promise<string | null> {
    await this.load();
    return this.dispatchOwnerFromMap(excludeThreadId);
  }

  private dispatchOwnerFromMap(excludeThreadId?: string): string | null {
    for (const [id, record] of Object.entries(this.map)) {
      if (excludeThreadId && id === excludeThreadId) continue;
      if (record?.dispatch?.enabled) return id;
    }
    return null;
  }

  /** 迁移：渲染层 localStorage 里已有值、而主进程这份还是空的时候灌进来；已有记录一律不覆盖 */
  async seed(threadId: string, runtime: unknown): Promise<ThreadRuntimeRecord> {
    await this.load();
    const existing = this.map[threadId];
    if (existing && existing.rev > 0) return existing;
    const fields = sanitizeFields(runtime);
    const dispatch = pickDispatch(runtime);
    const next: ThreadRuntimeRecord = { ...emptyRecord(), ...fields, ...(dispatch ? { dispatch } : {}), rev: Object.keys(fields).length || dispatch ? 1 : 0, updatedAt: Date.now() };
    if (next.rev > 0) { this.map[threadId] = next; this.scheduleSave(); }
    return next;
  }
}
