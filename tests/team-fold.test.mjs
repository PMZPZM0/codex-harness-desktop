/**
 * 团队模式 · 运行过程折叠的纯函数单测（11-06）
 * ⛔ 只测"选数据"：不碰 React、不碰引擎请求。
 */
import test from "node:test";
import { mergeConsecutive } from "../src/lib/team-models.mjs";
import assert from "node:assert/strict";
import { FOLD_QUOTE_CHARS, buildReplyQuotes, buildTopicThreads, topicThreadOf, epochMsOf, pickTurnOf, turnBodyOf } from "../src/lib/team-fold.mjs";

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
  assert.equal(
    pickTurnOf([a, b], 1793948643000 + 60 * 60 * 1000, "完全对不上"),
    null,
    "有时间但全对不上 ⇒ 返回 null（⛔ 不许拿最新一条凑数，会把上一轮文件挂到这条消息下）",
  );
});

test("pickTurnOf：整份列表都没有时间字段时仍兜底最新一条（老数据）", () => {
  const a = turn("a", "x");
  const b = turn("b", "y");
  assert.equal(pickTurnOf([a, b], 1793948663000, "正文也对不上").id, "a", "data 是 desc，最新在前");
});

test("pickTurnOf：刚结束的消息可收紧时间窗且禁止最新兜底", () => {
  const old = turn("old", "上一轮", { completedAt: 1793948000 });
  const fresh = turn("fresh", "这一轮", { completedAt: 1793948660 });
  const opts = { maxGapMs: 3 * 60_000, allowNewestFallback: false };
  assert.equal(pickTurnOf([old], 1793948660000, "正文对不上", opts), null, "旧回合超窗 ⇒ 宁可不画");
  assert.equal(pickTurnOf([old, fresh], 1793948660000, "正文对不上", opts).id, "fresh");
  assert.equal(pickTurnOf([old, fresh], 1793948660000, "这一轮", opts).id, "fresh", "正文命中优先");
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

/* ⛔⛔ 11-08 用户实测：「他是回复主代理的，不是回复我的，而且都写了『由 软件开发专家团 叫来』，
   怎么引用了我的消息？」——旧版一律引最近一条人类消息。⇒ 回复谁就引谁。 */
test("buildReplyQuotes：带 via 时引用叫它来的那个人，不是用户", () => {
  const rows = [
    { key: "h1", authorKind: "human", authorId: "local-user", text: "叫构梁说句话，随便一句" },
    { key: "lead", authorKind: "bot", authorId: "team-lead", text: "构梁：潘总点你名了，随便说一句吧" },
    { key: "kid", authorKind: "bot", authorId: "team:kid", text: "在。架构这块我一句话立场……", via: { memberId: "team-lead", name: "软件开发专家团" } },
  ];
  const q = buildReplyQuotes(rows);
  assert.deepEqual(q.get("lead"), { authorId: "local-user", text: "叫构梁说句话，随便一句" }, "主代理直接回用户 ⇒ 引用户");
  assert.deepEqual(q.get("kid"), { authorId: "team-lead", text: "构梁：潘总点你名了，随便说一句吧" }, "构梁被主代理叫来 ⇒ 引主代理那条");
});

test("buildReplyQuotes：via 指向的人还没落盘时回退到最近一条人类消息", () => {
  const q = buildReplyQuotes([
    { key: "h", authorKind: "human", authorId: "u", text: "你好" },
    { key: "b", authorKind: "bot", authorId: "p", text: "在", via: { memberId: "还没出现的人", name: "X" } },
  ]);
  assert.deepEqual(q.get("b"), { authorId: "u", text: "你好" });
});

test("buildReplyQuotes：via 取该人**最近**一条消息（多轮时不引旧的）", () => {
  const q = buildReplyQuotes([
    { key: "h", authorKind: "human", authorId: "u", text: "开场" },
    { key: "a1", authorKind: "bot", authorId: "lead", text: "第一句" },
    { key: "a2", authorKind: "bot", authorId: "lead", text: "第二句（最新）" },
    { key: "b", authorKind: "bot", authorId: "kid", text: "收到", via: { memberId: "lead", name: "lead" } },
  ]);
  assert.equal(q.get("b").text, "第二句（最新）");
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

/* ⛔ 11-08 用户令「加一个话题回复模式」：伙伴回复收进用户气泡，主流只留用户消息。 */
test("buildTopicThreads：伙伴回复归到最近的用户消息，互 @ 的也归同一话题", () => {
  const rows = [
    { key: "u1", authorKind: "human", authorId: "local-user", text: "叫构梁说句话" },
    { key: "b1", authorKind: "bot", authorId: "lead", text: "收到" },
    { key: "b2", authorKind: "bot", authorId: "kid", text: "在", via: { memberId: "lead", name: "lead" } },
    { key: "u2", authorKind: "human", authorId: "local-user", text: "第二个话题" },
    { key: "b3", authorKind: "bot", authorId: "lead", text: "好" },
  ];
  const t = buildTopicThreads(rows);
  assert.deepEqual([...t.keys()], ["u1", "u2"]);
  assert.deepEqual(t.get("u1").replies.map((r) => r.key), ["b1", "b2"], "主代理与构梁都归第一个话题");
  assert.equal(t.get("u1").root.text, "叫构梁说句话");
  assert.deepEqual(t.get("u2").replies.map((r) => r.key), ["b3"]);
});

test("buildTopicThreads：没有回复的用户消息也是空话题（不丢消息）", () => {
  const t = buildTopicThreads([{ key: "u", authorKind: "human", authorId: "u", text: "你好" }]);
  assert.equal(t.size, 1);
  assert.deepEqual(t.get("u").replies, []);
});

/* ⛔ 11-08 Code review 真缺陷：连续用户消息被 mergeConsecutive 合并后，
   第二条的伙伴回复挂在 u2，渲染只查 u1 ⇒ 话题条为空。topicThreadOf 必须把 continued 一并合并。 */
test("topicThreadOf：合并行的 continued 子话题不丢", () => {
  const rows = [
    { key: "u1", authorKind: "human", authorId: "u", at: 1000, kind: "text", text: "连发第一条" },
    { key: "u2", authorKind: "human", authorId: "u", at: 2000, kind: "text", text: "连发第二条" },
    { key: "b2", authorKind: "bot", authorId: "p", at: 2100, kind: "text", text: "回第二条" },
  ];
  const merged = mergeConsecutive(rows);
  const threads = buildTopicThreads(rows);
  assert.equal(merged.length, 2, "两条用户消息合并成一行");
  assert.deepEqual(merged[0].continued.map((r) => r.key), ["u2"]);
  const thread = topicThreadOf(threads, merged[0]);
  assert.deepEqual(thread.replies.map((r) => r.key), ["b2"], "u2 的回复必须出现在主行的话题条里");
  assert.match(thread.root.text, /连发第二条/, "root 文本带上 continued 的内容");
});
