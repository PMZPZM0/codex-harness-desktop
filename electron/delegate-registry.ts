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
};

/** 超过这个时间的已完成记录会被清理（避免文件无限增长）；运行中的永不清理。 */
export const DELEGATE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export class DelegateRegistry {
  private map: Record<string, DelegateRecord> = {};
  private loaded = false;
  private saveTimer: NodeJS.Timeout | null = null;

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
    const record: DelegateRecord = { ...input, status: "running", startedAt: input.startedAt ?? Date.now() };
    this.map[record.threadId] = record;
    this.scheduleSave();
    return record;
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

  async markStatus(threadId: string, status: DelegateStatus, extra: { error?: string } = {}): Promise<void> {
    await this.load();
    const key = String(threadId ?? "");
    const current = this.map[key];
    if (!current) return;
    this.map[key] = { ...current, status, endedAt: status === "running" ? undefined : Date.now(), ...(extra.error ? { error: extra.error } : {}) };
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
