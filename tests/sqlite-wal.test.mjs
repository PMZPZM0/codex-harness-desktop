import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/* 说明（P1-4）：node --test 不能直接 import .ts —— 与服务进程同一份代码用**编译产物**。
 * ⛔ 未构建时显式 skip（不伪装通过）；CI 用 `npm run test:ci`（先 build:electron）。 */
const MOD = "../dist-electron/sqlite-wal.js";
let mod = null;
try { mod = await import(MOD); } catch { /* 未构建 */ }

const makeWalDb = (dir, name) => {
  const file = join(dir, name);
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE t (a INTEGER)");
  const insert = db.prepare("INSERT INTO t (a) VALUES (?)");
  for (let i = 0; i < 400; i++) insert.run(i);
  // ⛔ 不关闭：SQLite 在关最后一个连接时会自动 checkpoint，WAL 会提前归零（测试前置就失效）。
  //    真实形态就是引擎进程一直持有连接。
  return { file, db };
};
const walSize = (file) => { try { return statSync(`${file}-wal`).size; } catch { return 0; } };

test("checkpointWal：TRUNCATE 把 WAL 截到 0，且数据完好", { skip: !mod && "dist-electron 未构建" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "wal-test-"));
  const { file, db: keep } = makeWalDb(dir, "state.sqlite");
  try {
    assert.ok(walSize(file) > 0, "前置：写入后 WAL 应有内容");
    const result = mod.checkpointWal(file);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(walSize(file), 0, "TRUNCATE 后 WAL 应为 0 字节");
    assert.equal(result.after, 0);
    assert.equal(keep.prepare("SELECT COUNT(*) n FROM t").get().n, 400, "数据不能丢");
  } finally {
    keep.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checkpointWal：库不存在 → ok:false，且**不会凭空创建**该文件", { skip: !mod && "dist-electron 未构建" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "wal-test-"));
  try {
    const file = join(dir, "missing.sqlite");
    const result = mod.checkpointWal(file);
    assert.equal(result.ok, false);
    assert.match(result.error, /不存在/);
    assert.equal(existsSync(file), false, "⛔ 不许创建文件");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("checkpointEngineWals：混合列表单个失败不影响其余", { skip: !mod && "dist-electron 未构建" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "wal-test-"));
  const { file: good, db: keep } = makeWalDb(dir, "a.sqlite");
  try {
    const results = mod.checkpointEngineWals([good, join(dir, "nope.sqlite")]);
    assert.equal(results.length, 2);
    assert.equal(results[0].ok, true);
    assert.equal(results[1].ok, false);
  } finally {
    keep.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("startWalCheckpointWatch：启动即跑一次，返回可停止函数", { skip: !mod && "dist-electron 未构建" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "wal-test-"));
  const { file, db: keep } = makeWalDb(dir, "b.sqlite");
  try {
    assert.ok(walSize(file) > 0);
    const stop = mod.startWalCheckpointWatch([file], 60_000);
    assert.equal(typeof stop, "function");
    assert.equal(walSize(file), 0, "启动时应立即 checkpoint 一次");
    stop();
  } finally {
    keep.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ── P2-8：引擎日志库归档（默认保留 14 天） ─────────────────────────────── */
const makeLogsDb = (dir, name, { old = 0, recent = 0 } = {}) => {
  const file = join(dir, name);
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE logs (id INTEGER PRIMARY KEY, ts INTEGER, body TEXT)");
  const insert = db.prepare("INSERT INTO logs (ts, body) VALUES (?, ?)");
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < old; i++) insert.run(now - 30 * 24 * 60 * 60, "old-" + i);
  for (let i = 0; i < recent; i++) insert.run(now - 60, "recent-" + i);
  db.close();
  return file;
};

test("trimEngineLogs：删 14 天前的行、保留新行、回收空间", { skip: !mod && "dist-electron 未构建" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "wal-test-"));
  try {
    const file = makeLogsDb(dir, "logs_2.sqlite", { old: 300, recent: 5 });
    const result = mod.trimEngineLogs(file, 14);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.deleted, 300);
    const db = new DatabaseSync(file);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM logs").get().n, 5, "新行必须保留");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM logs WHERE body LIKE 'old-%'").get().n, 0, "旧行必须删净");
    db.close();
    assert.ok((result.after ?? 0) <= (result.before ?? 0), "VACUUM 后不应变大");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("trimEngineLogs：库不存在 → ok:false（不创建文件）", { skip: !mod && "dist-electron 未构建" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "wal-test-"));
  try {
    const file = join(dir, "none.sqlite");
    const result = mod.trimEngineLogs(file);
    assert.equal(result.ok, false);
    assert.equal(existsSync(file), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
