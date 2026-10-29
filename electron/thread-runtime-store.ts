import fs from "node:fs/promises";

/** 调度许可（与渲染层 `emptyDispatch()` 同形）：本会话允许 Codex 调度哪些类别的对象。
 *
 *  ⛔ 10-29 用户令：「子智能体调用和专家调度改为默认可直接调用，仅专家团需要显式开启」+
 *     「不再做数量或使用上的限制，每个会话都可以调度它们」⇒
 *       · 删掉了 `enabled`（调度总开关）—— 它同时充当「全局独占锁」（同一时间只允许一个会话调度），
 *         与新语义直接冲突（每个会话都该能派）。锁、接管（takeover）、孤儿锁自愈一并删除。
 *       · `expert` / `subagent` 默认 **true**；`team` 默认 **false**（唯一需要显式开启的一类）。
 *  ⛔ 老记录迁移：旧结构有 `enabled`，且旧默认 `team: true`。规则 = `team && enabled` ——
 *     旧日「开过调度」= 当时显式开过，保留专家团；旧日没开过 ⇒ 专家团仍是关的（不能凭空开团）。
 *     专家 / 子智能体沿用旧值（旧默认也是 true）。 */
export type DispatchConfig = { expert: boolean; team: boolean; subagent: boolean };

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

/** 出厂默认：专家 / 子智能体可用，专家团关闭（需显式开启）。 */
const emptyDispatchConfig = (): DispatchConfig => ({ expert: true, team: false, subagent: true });

/** 归一化调度许可（坏值/缺字段一律回落默认；兼容旧结构里的 `enabled`）。
 *
 *  ⛔ 10-29 定稿：面板只剩「专家团」一个开关 ⇒ `expert` / `subagent` 恒为 true。
 *    旧记录里若有 `false`（当年逐类勾选时关过），在这里**直接读成 true**：界面上已经没有
 *    关闭它们的入口，留着 false 只会让模型收到一个用户无法从 UI 纠正的"本会话禁用专家"，
 *    并在回复里让用户去点一个不存在的开关（10-29 实测现象）。 */
export function normalizeDispatchConfig(input: unknown): DispatchConfig {
  const src = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const legacy = typeof src.enabled === "boolean" ? src.enabled : null;
  return {
    expert: true,
    // 旧记录：team 旧默认 true，但那只是"没关过"，不等于用户开过调度 ⇒ 必须叠加 enabled
    team: legacy === null ? src.team === true : src.team === true && legacy,
    subagent: true,
  };
}

/** 调度许可签名（与渲染层 `dispatchSignature()` 同算法，多窗口回声判定要用同一套） */
export function dispatchSignatureOf(input: unknown): string {
  const d = normalizeDispatchConfig(input);
  return [d.expert, d.team, d.subagent].map((v) => (v ? "1" : "0")).join("");
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
   * @param opts.takeover 保留入参形态但**已无意义**（10-29 删除了全局调度独占锁）——
   *        老渲染层仍可能带 `takeover: true`，这里忽略即可，不做任何「把上家关掉」的写入。
   *
   * ⛔ 10-29 用户令「每个会话都可以调度它们，不再做数量或使用上的限制」⇒ 原来那套
   *    「全局唯一调度权 / 接管 / 孤儿锁自愈」整体删除（锁是 09-16 的需求，与"默认可用 +
   *    无数量限制"直接冲突）。现在写调度许可就是纯粹的本会话配置写入，不碰任何别的线程。
   */
  async patch(
    threadId: string,
    patch: unknown,
    baseRev?: number,
    _opts?: { takeover?: boolean },
  ): Promise<{ runtime: ThreadRuntimeRecord; conflict: boolean; changed: boolean }> {
    await this.load();
    const current = this.map[threadId] ?? emptyRecord();
    const conflict = typeof baseRev === "number" && Number.isFinite(baseRev) && baseRev !== current.rev;
    const fields = sanitizeFields(patch);
    const dispatch = pickDispatch(patch);
    const changed = FIELDS.some((key) => fields[key] !== undefined && fields[key] !== current[key])
      || (dispatch !== null && dispatchSignatureOf(dispatch) !== dispatchSignatureOf(current.dispatch));
    if (!changed) return { runtime: current, conflict, changed: false };
    const next: ThreadRuntimeRecord = { ...current, ...fields, ...(dispatch ? { dispatch } : {}), rev: current.rev + 1, updatedAt: Date.now() };
    this.map[threadId] = next;
    this.scheduleSave();
    return { runtime: next, conflict, changed: true };
  }

  /** 彻底删除该会话的运行时记录（会话被**删除**时用；归档保留记录，恢复后配置不丢）。 */
  async remove(threadId: string): Promise<boolean> {
    await this.load();
    if (!this.map[threadId]) return false;
    delete this.map[threadId];
    this.scheduleSave();
    return true;
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
