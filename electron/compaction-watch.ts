/**
 * compaction-watch.ts —— 「引擎真压缩」的宿主侦测与落盘（2026-10-07 立）。
 *
 * ── 为什么需要它（10-07 实测取证）────────────────────────────────────────────
 *  09-26 的压缩线 UI 全部挂在引擎事件上（`item/started|completed` 的 ContextCompaction、
 *  `thread/compacted`）。而当前引擎（0.153/0.157 系）对压缩**不发这些事件**：实测整个压缩
 *  过程只收到 `thread/status/changed` + 一条 `turn/started` + `turn/completed`，压缩 item
 *  只落 rollout 文件 ⇒ 渲染层三条信号全断，压缩线永不出现（重启后更没有）。
 *
 * ── 判据（10-07 二次修正后只剩一条，见下）────────────────────────────────────
 *  ① **rollout 对账 + 记录本体归因**：turn/completed 时增量扫该线程 rollout 的新增段，找
 *     `item_completed` 且 `item.type === "ContextCompaction"` 的记录，**按记录自己的
 *     `turn_id` 归因** —— 等于刚完成回合 id 才认。
 *     ⛔ 首版判据「回合不是渲染层发起的」是**错的**（10-07 大会话实测）：自动压缩是
 *     **内联**完成的 —— 没有独立压缩回合，压缩 item 直接记在**用户回合**名下
 *     （rollout 实证：turn_id == 用户 turn/start 回执的 id）。按"非渲染层回合"过滤会把
 *     真实的自动压缩全部丢掉（存储一直是空）。改成记录归因后无需排除任何回合：
 *       · 内联压缩（自动压缩的真实形态）→ 记录 turn_id == 用户回合 id ✓ 命中；
 *       · 独立压缩回合（手动 thread/compact/start）→ 记录 turn_id == 压缩回合 id ✓ 命中；
 *       · 普通回合 → tail 里最多有**旧**压缩记录（turn_id ≠ 本回合）⇒ 不误判。
 *  ② 去重（重放/重连可能重复到达）。
 *  命中 ⇒ 落盘 `<userData>/compaction-records/<threadId>.json`（每线程 30 条防呆）+
 *  广播 `thread-compacted-host`（渲染层据此画压缩线；resume 时由 codex-ipc 重播存量）。
 *
 * ⛔ 与 09-26 的旧信号**并存**：旧引擎发 item 事件时照旧走原路；本模块只是补上当前引擎
 *   缺失的那条链。⛔ 侦测失败最多"线不出现"，绝不允许影响回合本身（全程 catch 兜底）。
 */
import fs from "node:fs";
import path from "node:path";
import { broadcastHarnessEvent } from "./features/window-bus";
import { checkCompactionAsync } from "./rollout-pool";

export type CompactionRecord = { turnId: string; at: number };

/** 落盘目录（boot 在 app-ready 后注入；模块顶层不许求值 app.getPath —— 见 turn-file-watch 同款注释） */
let storeDir: string | null = null;
/** 引擎侧 codex home（rollout 所在根；同样由 boot 注入） */
let codexHomeDir = "";

/** 内存镜像：threadId → 记录（新到旧，供 resume 重播与查询） */
const recordsByThread = new Map<string, CompactionRecord[]>();

const MAX_RECORDS_PER_THREAD = 30;

export function setCompactionWatchDirs(dir: string, home: string): void {
  storeDir = dir ? String(dir) : null;
  codexHomeDir = home ? String(home) : "";
}

function storeFileFor(threadId: string): string | null {
  if (!storeDir) return null;
  return path.join(storeDir, threadId.replace(/[^A-Za-z0-9_-]/g, "_") + ".json");
}

function persistThread(threadId: string): void {
  const file = storeFileFor(threadId);
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ records: recordsByThread.get(threadId) ?? [] }), "utf8");
    fs.renameSync(tmp, file);
  } catch { /* 落盘失败只影响重启后的重播，不影响本次会话 */ }
}

/** boot 启动时读一次存量（供 resume 重播）。失败按空处理。 */
export function loadCompactionStore(): void {
  if (!storeDir) return;
  try {
    for (const name of fs.readdirSync(storeDir)) {
      if (!name.endsWith(".json")) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(storeDir, name), "utf8"));
        const records = Array.isArray(parsed?.records)
          ? parsed.records.filter((r: any) => r && typeof r.turnId === "string" && r.turnId).map((r: any) => ({ turnId: String(r.turnId), at: Number(r.at) || 0 })).slice(-MAX_RECORDS_PER_THREAD)
          : [];
        if (records.length) recordsByThread.set(name.replace(/\.json$/, ""), records);
      } catch { /* 单文件坏掉跳过 */ }
    }
  } catch { /* 目录不存在等：视为无存量 */ }
}

/** 回合结束钩子（boot 的 turn/completed 分支调用）——判据 = rollout 记录按 turn_id 归因。 */
export async function watchTurnCompleted(threadId: string, turnId: string): Promise<void> {
  try {
    const tid = String(threadId ?? "");
    const id = String(turnId ?? "");
    if (!tid || !id) return;
    if (!codexHomeDir) return;
    const scanned = await checkCompactionAsync(codexHomeDir, tid).catch(() => null);
    const hit = (scanned?.records ?? []).some((record) => record.turnId === id);
    if (!hit) return;
    const list = recordsByThread.get(tid) ?? [];
    if (list.some((r) => r.turnId === id)) return;   // 去重（重放/重连可能重复到达）
    const record: CompactionRecord = { turnId: id, at: Date.now() };
    list.push(record);
    while (list.length > MAX_RECORDS_PER_THREAD) list.shift();
    recordsByThread.set(tid, list);
    persistThread(tid);
    broadcastHarnessEvent({ type: "thread-compacted-host", threadId: tid, turnId: id, at: record.at } as any);
  } catch { /* 侦测失败最多线不出现，绝不打断回合收尾 */ }
}

/** resume 重播用：该线程的全部存量记录（新到旧不敏感，渲染层只取最新）。 */
export function storedCompactionsForThread(threadId: string): CompactionRecord[] {
  return recordsByThread.get(String(threadId ?? "")) ?? [];
}

/** 会话永久删除时清落盘（与 turn-file-watch 同口径）。 */
export function dropStoredCompactions(threadId: string): void {
  const tid = String(threadId ?? "");
  if (!tid) return;
  recordsByThread.delete(tid);
  const file = storeFileFor(tid);
  if (file) void fs.promises.rm(file, { force: true }).catch(() => undefined);
}
