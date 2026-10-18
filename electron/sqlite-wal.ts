/**
 * 引擎 SQLite 的 WAL 定期 checkpoint（10-19 复检报告 P1-4）。
 *
 * 背景：`codex-home/state_5.sqlite` 的 `-wal` 曾长到主库的 5.7 倍（4.3MB vs 753KB），
 * 且清完一段时间又长回来 —— 说明**没有任何 checkpoint 机制**，全靠人手动清。
 * 引擎用 WAL 模式写这些库，WAL 只增不减时磁盘和打开成本都会慢慢变差。
 *
 * 做法：应用启动时跑一次 + 每 6 小时跑一次 `PRAGMA wal_checkpoint(TRUNCATE)`。
 *   · ⛔ 只处理**已存在**的库（`new DatabaseSync` 默认会创建文件 —— 不先判存在就会凭空造库）；
 *   · ⛔ 失败（被引擎占用 / 权限）只记日志，**绝不影响启动**；
 *   · `TRUNCATE` 会把 WAL 文件截到 0 字节（`PASSIVE` 不会）。
 *
 * ⛔ 跨进程：引擎同时持有这些库的连接。SQLite 的 checkpoint 是并发安全的（拿锁失败就 busy），
 *   这里给 2s busy_timeout，失败就跳过这一轮，下一轮再来。
 */
import fs from "node:fs";

type SqliteDb = { exec(sql: string): void; prepare(sql: string): { get(): unknown }; close(): void };
const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (file: string) => SqliteDb };

/** 默认周期：6 小时（WAL 肿胀是缓慢过程，没必要更频繁）。 */
export const WAL_CHECKPOINT_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type WalCheckpointResult = {
  file: string;
  ok: boolean;
  /** 1 = 有别的连接正在用，本轮没拿到锁 */
  busy?: number;
  /** checkpoint 前后 `-wal` 的字节数 */
  before?: number;
  after?: number;
  error?: string;
};

function walSizeOf(file: string): number {
  try { return fs.statSync(`${file}-wal`).size; } catch { return 0; }
}

/** 对单个库做 TRUNCATE checkpoint；库不存在 / 打不开 / 被占用都返回 ok:false（不 throw）。 */
export function checkpointWal(file: string, busyTimeoutMs = 2000): WalCheckpointResult {
  if (!fs.existsSync(file)) return { file, ok: false, error: "数据库不存在" };
  const before = walSizeOf(file);
  let db: SqliteDb | null = null;
  try {
    db = new DatabaseSync(file);
    db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(busyTimeoutMs))}`);
    const row = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() as { busy?: number } | undefined;
    return { file, ok: true, busy: Number(row?.busy ?? 0), before, after: walSizeOf(file) };
  } catch (error) {
    return { file, ok: false, error: String((error as Error)?.message ?? error).slice(0, 200), before };
  } finally {
    try { db?.close(); } catch { /* 已关闭 / 打不开 */ }
  }
}

/** 依次 checkpoint 一批库（单个失败不影响其余）。 */
export function checkpointEngineWals(files: string[]): WalCheckpointResult[] {
  return files.map((file) => checkpointWal(file));
}

/**
 * 启动即跑一次 + 定时跑；返回停止函数（退出时清定时器）。
 * `intervalMs` 下限 60s（测试/调试可传小值，但别让生产配成 0 变成忙轮询）。
 */
export function startWalCheckpointWatch(files: string[], intervalMs = WAL_CHECKPOINT_INTERVAL_MS): () => void {
  const run = () => {
    for (const result of checkpointEngineWals(files)) {
      if (!result.ok) console.warn(`[wal] checkpoint 跳过 ${result.file}：${result.error}`);
      else if (result.busy) console.warn(`[wal] checkpoint 被占用（busy=1），下一轮再试：${result.file}`);
    }
  };
  run();
  const timer = setInterval(run, Math.max(60_000, Number(intervalMs) || WAL_CHECKPOINT_INTERVAL_MS));
  timer.unref?.();
  return () => clearInterval(timer);
}

/* ══ 引擎日志库归档（P2-8）：`logs_2.sqlite` 已 44.5MB 且只增不减 ══════════════════════ */

/** 默认保留天数：14 天（引擎的 stderr 另有 engine-debug.log，项目结论另有 logs/ 档案）。 */
export const LOG_RETAIN_DAYS = 14;

export type TrimLogsResult = { file: string; ok: boolean; deleted?: number; before?: number; after?: number; error?: string };

function sizeOf(file: string): number {
  try { return fs.statSync(file).size; } catch { return 0; }
}

/**
 * 删除 `logs` 表里超过保留期的行，并回收空间（VACUUM）。
 * ⛔ 只在**引擎未启动时**调用（boot 里 server.start 之前）：VACUUM 需要独占，引擎连着时会失败。
 * ⛔ 任何一步失败都返回 ok:false，由调用方吞掉 —— 日志归档失败绝不能影响启动。
 */
export function trimEngineLogs(file: string, retainDays = LOG_RETAIN_DAYS, nowMs = Date.now()): TrimLogsResult {
  if (!fs.existsSync(file)) return { file, ok: false, error: "数据库不存在" };
  const days = Math.max(1, Math.floor(Number(retainDays) || LOG_RETAIN_DAYS));
  const cutoff = Math.floor(nowMs / 1000) - days * 24 * 60 * 60;
  const before = sizeOf(file);
  let db: SqliteDb | null = null;
  try {
    db = new DatabaseSync(file);
    db.exec("PRAGMA busy_timeout = 2000");
    db.exec(`DELETE FROM logs WHERE ts < ${cutoff}`);
    const deleted = Number((db.prepare("SELECT changes() AS n").get() as { n?: number } | undefined)?.n ?? 0);
    db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    if (deleted > 0) {
      try { db.exec("VACUUM"); } catch { /* 回收失败不影响“已删除”这一事实 */ }
    }
    return { file, ok: true, deleted, before, after: sizeOf(file) };
  } catch (error) {
    return { file, ok: false, error: String((error as Error)?.message ?? error).slice(0, 200), before };
  } finally {
    try { db?.close(); } catch { /* 已关闭 */ }
  }
}
