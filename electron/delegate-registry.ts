/**
 * electron/delegate-registry.ts —— 「被调度的临时会话」登记表（持久化）。
 *
 * 记录三类事实，都是闭环必需：
 *   ① 某个线程**是不是**被委派产生的（L3 硬闸据此拒绝「委派会话再委派」）
 *   ② 它由**哪个会话**发起（侧栏分组、任务完成后询问归档的范围）
 *   ③ 它的运行状态与是否已归档（界面上的进行中/已完成标记）
 *
 * 与 `TeamRunStore` 同套路：主进程单点持有 + 合并落盘 + 广播由调用方负责。
 */

import fs from "node:fs/promises";
import type { DispatchKind } from "./dispatch";

export type DelegateStatus = "running" | "done" | "failed";

export type DelegateRecord = {
  /** 被委派产生的会话线程 id */
  threadId: string;
  /** 发起方会话（用户直连的那个） */
  originThreadId: string;
  kind: DispatchKind;
  /** 展示名：`单个专家名` 或 `团队名 · 职业` */
  name: string;
  /** 调用链深度：直连会话发起 = 1 */
  depth: number;
  status: DelegateStatus;
  startedAt: number;
  endedAt?: number;
  /** 用户确认归档后置位（列表里隐藏，但记录保留，防重复询问） */
  archived?: boolean;
  /** 失败原因（status=failed 时） */
  error?: string;
  /** 实时产出（流式累积；跑完是完整产出）。只用于右侧头像弹窗的实时展示与收尾展示。 */
  output?: string;
};

/** 超过这个时间的已完成记录会被清理（避免文件无限增长）；运行中的永不清理。 */
export const DELEGATE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export class DelegateRegistry {
  private map: Record<string, DelegateRecord> = {};
  private loaded = false;
  private saveTimer: NodeJS.Timeout | null = null;
  /** 运行中的委派线程 → threadId（流式文本累积用；跑完即清） */
  private activeThreads = new Set<string>();

  constructor(private readonly file: string) {}

  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw: unknown = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (raw && typeof raw === "object" && !Array.isArray(raw)) this.map = raw as Record<string, DelegateRecord>;
    } catch { /* 首次运行没有文件：从空表起步 */ }
  }

  /** 写盘做 120ms 合并：一次调度会连写数次状态（开始/进行/结束），不必逐次落盘 */
  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.saveTimer = null; void this.flush(); }, 120);
  }

  async flush() {
    try { await fs.writeFile(this.file, JSON.stringify(this.map, null, 2), "utf8"); } catch { /* 写失败不影响内存态 */ }
  }

  async register(input: Omit<DelegateRecord, "status" | "startedAt" | "endedAt"> & { startedAt?: number }): Promise<DelegateRecord> {
    await this.load();
    const record: DelegateRecord = { ...input, status: "running", startedAt: input.startedAt ?? Date.now(), output: "" };
    this.map[record.threadId] = record;
    this.activeThreads.add(record.threadId);
    this.scheduleSave();
    return record;
  }

  /** 运行中委派会话的流式文本（09-16 用户要求：调度时右侧也要像专家团一样有头像 + 工作内容）。
   *  与 TeamRunStore.handleEngineEvent 同套路 —— 只认「正在跑的委派线程」，其它会话的增量一律不碰。
   *  返回要广播的增量（广播由调用方做，保持与 team-runs 一致的分工）。 */
  handleEngineEvent(event: any): { threadId: string; text: string; chars: number } | null {
    if (!event || event.kind !== "notification" || event.method !== "item/agentMessage/delta") return null;
    const threadId = String(event.params?.threadId ?? "");
    if (!threadId || !this.activeThreads.has(threadId)) return null;
    const text = String(event.params?.delta ?? "");
    if (!text) return null;
    const record = this.map[threadId];
    if (!record) return null;
    record.output = (record.output ?? "") + text;
    return { threadId, text, chars: record.output.length };
  }

  /** 结束/失败时把最终产出写进记录（弹窗关掉前还能看到全文；不额外落盘配置）。 */
  async setOutput(threadId: string, output: string): Promise<void> {
    await this.load();
    const record = this.map[threadId];
    if (record) record.output = output;
  }

  /** 该线程当前是否正在被委派执行（渲染层兜底判定用） */
  isRunningThread(threadId: string): boolean {
    return this.activeThreads.has(String(threadId ?? ""));
  }

  async infoOf(threadId: string): Promise<DelegateRecord | null> {
    await this.load();
    return this.map[String(threadId ?? "")] ?? null;
  }

  /** 某会话调度出来的临时会话（默认隐去已归档的） */
  async listByOrigin(originThreadId: string, options: { includeArchived?: boolean } = {}): Promise<DelegateRecord[]> {
    await this.load();
    const origin = String(originThreadId ?? "");
    return Object.values(this.map)
      .filter((record) => record.originThreadId === origin)
      .filter((record) => (options.includeArchived ? true : !record.archived))
      .sort((a, b) => a.startedAt - b.startedAt);
  }

  async listAll(): Promise<DelegateRecord[]> {
    await this.load();
    return Object.values(this.map).sort((a, b) => b.startedAt - a.startedAt);
  }

  /** 运行中的调度数量（L4 并发闸用） */
  async runningCount(): Promise<number> {
    await this.load();
    return Object.values(this.map).filter((record) => record.status === "running").length;
  }

  /** 启动自愈（09-24，评估报告 §4.3）：重启后不可能还有活着的外部回合，但记录里 status="running"
   *  是**持久化**的 —— 只有 delegation 的成功/失败两条路径会把它改掉，应用被中断（崩溃 / 关窗 /
   *  引擎被杀）就永远留着。后果不是"少一条记录"：runningCount() 只增不减，攒满
   *  MAX_CONCURRENT_DISPATCH（4）之后 **admitDispatch 永久拒绝所有委派**，且跨重启累积
   *  （prune() 只清 finished，救不了这个）。⇒ 启动时把残留 running 一律收成 failed。
   *  幂等：没有残留时返回 0、不写盘。 */
  async reconcileRunning(reason = "应用重启中断，未收到回合结束事件"): Promise<number> {
    await this.load();
    let count = 0;
    for (const [key, record] of Object.entries(this.map)) {
      if (record.status !== "running") continue;
      this.map[key] = { ...record, status: "failed", endedAt: Date.now(), error: reason };
      this.activeThreads.delete(key);
      count += 1;
    }
    if (count) this.scheduleSave();
    return count;
  }

  async markStatus(threadId: string, status: DelegateStatus, extra: { error?: string } = {}): Promise<void> {
    await this.load();
    const key = String(threadId ?? "");
    const current = this.map[key];
    if (!current) return;
    this.map[key] = { ...current, status, endedAt: status === "running" ? undefined : Date.now(), ...(extra.error ? { error: extra.error } : {}) };
    // 跑完就不再接收流式增量（右侧头像也随之消失）
    if (status !== "running") this.activeThreads.delete(key);
    this.scheduleSave();
  }

  async markArchived(threadIds: string[]): Promise<number> {
    await this.load();
    let count = 0;
    for (const id of threadIds) {
      const key = String(id ?? "");
      const current = this.map[key];
      if (!current || current.archived) continue;
      this.map[key] = { ...current, archived: true };
      count += 1;
    }
    if (count) this.scheduleSave();
    return count;
  }

  /** 清理过期的已完成记录（运行中的不动；已归档的保留到同样期限，用于防重复询问） */
  async prune(now: number = Date.now()): Promise<number> {
    await this.load();
    const keep: Record<string, DelegateRecord> = {};
    let dropped = 0;
    for (const [key, record] of Object.entries(this.map)) {
      const finished = record.status !== "running";
      const stamp = record.endedAt ?? record.startedAt ?? 0;
      if (finished && stamp && now - stamp > DELEGATE_RETENTION_MS) { dropped += 1; continue; }
      keep[key] = record;
    }
    if (dropped) { this.map = keep; this.scheduleSave(); }
    return dropped;
  }
}
