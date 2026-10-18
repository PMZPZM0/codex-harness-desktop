import test from "node:test";
import assert from "node:assert/strict";
import { compactionStateOf, COMPACTION_STATE, compactionStateLabel } from "../src/lib/compaction-state.mjs";
import { isCompactionItem } from "../src/lib/compaction-item.mjs";

const turn = (id, items) => ({ id, items });
/* ⛔ 完成态夹具**故意不带 status**：引擎落盘的压缩项就是 {"type":"ContextCompaction"} 形状，
   状态机按「非运行/非失败即完成」判定 —— 这条用例同时钉住该语义。 */
const DONE = { type: "ContextCompaction", id: "c1" };
const RUNNING = { type: "toolCall", name: "contextCompaction", id: "live", status: "inProgress" };
const FAILED = { type: "contextCompaction", id: "bad", status: "error", failure: { message: "boom" } };

test("isCompactionItem: 大小写不敏感（PascalCase / camelCase）", () => {
  assert.equal(isCompactionItem({ type: "ContextCompaction" }), true);
  assert.equal(isCompactionItem({ type: "contextCompaction" }), true);
});

test("isCompactionItem: 进行中项按 name 兜底，普通工具不误伤", () => {
  assert.equal(isCompactionItem(RUNNING), true);
  assert.equal(isCompactionItem({ type: "toolCall", name: "shell" }), false);
});

test("四态：idle / compacting / done / failed", () => {
  assert.equal(compactionStateOf([turn("t1", [{ type: "userMessage" }])], null).state, COMPACTION_STATE.idle);
  assert.equal(compactionStateOf([turn("t1", [RUNNING])], null).state, COMPACTION_STATE.compacting);
  assert.equal(compactionStateOf([turn("t1", [DONE])], null).state, COMPACTION_STATE.done);
  assert.equal(compactionStateOf([turn("t1", [FAILED])], null).state, COMPACTION_STATE.failed);
});

test("四态：运行中优先于已完成；done 取最后一条；toast 兜底", () => {
  const r = compactionStateOf([turn("t1", [DONE]), turn("t2", [RUNNING])], null);
  assert.equal(r.state, COMPACTION_STATE.compacting);
  assert.equal(r.turnId, "t2");

  const d = compactionStateOf([turn("t1", [DONE]), turn("t2", [{ type: "ContextCompaction", id: "newer" }])], null);
  assert.equal(d.item.id, "newer");

  assert.equal(compactionStateOf([turn("t1", [])], "running").state, COMPACTION_STATE.compacting);
  assert.equal(compactionStateOf([turn("t1", [])], "success").state, COMPACTION_STATE.done);
  assert.equal(compactionStateOf([turn("t1", [])], "cancelled").state, COMPACTION_STATE.idle);
});

test("四态：标签齐全（界面与日志同源）", () => {
  for (const s of ["idle", "compacting", "done", "failed"]) {
    assert.ok(compactionStateLabel(s));
    assert.notEqual(compactionStateLabel(s), s);
  }
});
