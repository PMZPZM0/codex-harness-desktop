/**
 * 团队模式 · 运行过程折叠的纯函数单测（11-06）
 * ⛔ 只测"选数据"：不碰 React、不碰引擎请求。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { FOLD_QUOTE_CHARS, buildReplyQuotes, epochMsOf, pickTurnOf, turnBodyOf } from "../src/lib/team-fold.mjs";

const turn = (id, body, extra = {}) => ({
  id,
  status: "completed",
  items: [
    { id: `${id}-cmd`, type: "commandExecution", command: "npm run build" },
    { id: `${id}-msg`, type: "agentMessage", text: body },
  ],
  ...extra,
});

test("turnBodyOf：只认 agentMessage，多段用空行拼（与主进程 turnOutputText 同口径）", () => {
  const t = {
    items: [
      { type: "commandExecution", text: "不该出现" },
      { type: "agentMessage", text: " 第一段 " },
      { type: "reasoning", text: "也不该出现" },
      { type: "agentMessage", text: "第二段" },
    ],
  };
  assert.equal(turnBodyOf(t), "第一段\n\n第二段");
  assert.equal(turnBodyOf(null), "");
  assert.equal(turnBodyOf({ items: "bad" }), "");
});

test("pickTurnOf：正文一致优先（同一个子会话被复用多轮时不会挑错）", () => {
  const older = turn("t1", "上一轮的结论", { completedAt: 1000 });
  const newer = turn("t2", "这一轮的结论", { completedAt: 2000 });
  assert.equal(pickTurnOf([older, newer], 9000, "这一轮的结论").id, "t2");
  assert.equal(pickTurnOf([older, newer], 1000, "上一轮的结论").id, "t1");
});

test("pickTurnOf：正文对不上时按完成时刻就近（10 分钟窗口内）", () => {
  const a = turn("a", "x", { completedAt: 1793948643 });
  const b = turn("b", "y", { completedAt: 1793948663 });
  assert.equal(pickTurnOf([a, b], 1793948663000, "被截断过的正文").id, "b");
  assert.equal(pickTurnOf([a, b], 1793948643000 + 60 * 60 * 1000, "完全对不上").id, "a", "超出窗口 ⇒ 兜底最新一条（data 是 desc）");
});

test("epochMsOf：引擎秒级时间戳 → 毫秒，群消息毫秒保持原值", () => {
  assert.equal(epochMsOf(1793948663), 1793948663000);
  assert.equal(epochMsOf(1793948663000), 1793948663000);
  assert.equal(epochMsOf("1793948663"), 1793948663000);
  assert.equal(epochMsOf(null), 0);
  assert.equal(epochMsOf("坏数据"), 0);
});

test("pickTurnOf：秒级 completedAt 也能按时间命中（实测引擎返回 10 位秒）", () => {
  const a = turn("a", "x", { completedAt: 1793948643 });
  const b = turn("b", "y", { completedAt: 1793948663 });
  assert.equal(pickTurnOf([a, b], 1793948663000, "正文对不上").id, "b");
  assert.equal(pickTurnOf([a, b], 1793948643000, "正文对不上").id, "a");
});

test("pickTurnOf：空/坏数据不抛，返回 null 或首条", () => {
  assert.equal(pickTurnOf([], 0, ""), null);
  assert.equal(pickTurnOf(null, 0, ""), null);
  assert.equal(pickTurnOf([null, turn("t", "x")], 0, "").id, "t");
  assert.equal(pickTurnOf([{ id: "t" }], 0, "").id, "t", "没有 items 时 turnBodyOf 为空，仍走兜底");
});

test("buildReplyQuotes：伙伴消息引用它之前最近一条人类消息（含定时任务）", () => {
  const rows = [
    { key: "h1", authorKind: "human", authorId: "local-user", text: "第一句\n第二句" },
    { key: "b1", authorKind: "bot", authorId: "p1", text: "回复一" },
    { key: "b2", authorKind: "bot", authorId: "p2", text: "回复二" },
    { key: "h2", authorKind: "human", authorId: "automation", text: "定时发的指令" },
    { key: "b3", authorKind: "bot", authorId: "p1", text: "回复三" },
  ];
  const q = buildReplyQuotes(rows);
  assert.deepEqual(q.get("b1"), { authorId: "local-user", text: "第一句 第二句" });
  assert.deepEqual(q.get("b2"), { authorId: "local-user", text: "第一句 第二句" }, "同一提问的两个伙伴回复共用同一引用");
  assert.equal(q.get("b3").authorId, "automation", "定时任务那句也算人类消息");
  assert.equal(q.has("h1"), false, "人类消息自己不进引用表");
});

test("buildReplyQuotes：原文截断、空提问不建引用", () => {
  const long = "字".repeat(FOLD_QUOTE_CHARS + 40);
  const q = buildReplyQuotes([
    { key: "h", authorKind: "human", authorId: "u", text: long },
    { key: "b", authorKind: "bot", authorId: "p", text: "ok" },
  ]);
  assert.equal(q.get("b").text.length, FOLD_QUOTE_CHARS);
  const empty = buildReplyQuotes([
    { key: "h", authorKind: "human", authorId: "u", text: "   " },
    { key: "b", authorKind: "bot", authorId: "p", text: "ok" },
  ]);
  assert.equal(empty.has("b"), false);
});
