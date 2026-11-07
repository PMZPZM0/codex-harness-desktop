/** 群内搜索纯函数单测（11-07）：AND 匹配 / 大小写 / 卡片剔除 / 排序 / 片段。 */
import test from "node:test";
import assert from "node:assert/strict";
import { searchGroupRows } from "../src/lib/team-search.mjs";

const rows = [
  { key: "k1", itemId: "i1", at: 1000, authorId: "a", kind: "text", text: "周报口径：单店营收按含税算" },
  { key: "k2", itemId: "i2", at: 3000, authorId: "b", kind: "text", text: "毛利趋势要按周看，别按月" },
  { key: "k3", itemId: "i3", at: 2000, authorId: "a", kind: "card", text: '{"type":"card","title":"周报"}' },
  { key: "k4", itemId: "i4", at: 4000, authorId: "b", kind: "text", text: "Store Revenue 的口径要统一" },
  { key: "k5", itemId: "i5", at: 5000, authorId: "a", kind: "text", text: "毛利口径和营收口径不是一回事" },
];

test("搜索：空查询返回空数组（不是全量）", () => {
  assert.deepEqual(searchGroupRows(rows, ""), []);
  assert.deepEqual(searchGroupRows(rows, "   "), []);
  assert.deepEqual(searchGroupRows(null, "周报"), []);
});

test("搜索：多个词是 AND（全部命中才算）", () => {
  assert.deepEqual(searchGroupRows(rows, "毛利 口径").map((r) => r.key), ["k5"]);
  assert.deepEqual(searchGroupRows(rows, "毛利 营收").map((r) => r.key), ["k5"]);
  assert.deepEqual(searchGroupRows(rows, "毛利 不存在"), []);
});

test("搜索：英文忽略大小写，结果按时间倒序", () => {
  assert.deepEqual(searchGroupRows(rows, "store revenue").map((r) => r.key), ["k4"]);
  assert.deepEqual(searchGroupRows(rows, "口径").map((r) => r.key), ["k5", "k4", "k1"]);
});

test("搜索：卡片消息不参与（正文是 JSON，搜它只会命中字段名）", () => {
  assert.deepEqual(searchGroupRows(rows, "card"), []);
  assert.deepEqual(searchGroupRows(rows, "周报").map((r) => r.key), ["k1"]);
});

test("搜索：结果带 itemId（跳转锚点）与命中片段", () => {
  const hit = searchGroupRows(rows, "毛利").find((r) => r.key === "k5");
  assert.equal(hit.itemId, "i5");
  assert.match(hit.snippet, /毛利/);
  assert.equal(hit.text, "毛利口径和营收口径不是一回事", "返回原文，不被截断");
});

test("搜索：限制条数", () => {
  assert.equal(searchGroupRows(rows, "口径", { limit: 2 }).length, 2);
});
