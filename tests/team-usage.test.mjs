import test from "node:test";
import assert from "node:assert/strict";
import { pickUsagePatchIndex, usageFromTokenEvent, usageUsableFor } from "../src/lib/team-usage.mjs";

const evt = (bucket, threadId = "t1") => ({
  kind: "notification",
  method: "thread/tokenUsage/updated",
  params: { threadId, tokenUsage: bucket },
});

test("用量事件解析：四种 last 桶字段名都认（引擎版本差异）", () => {
  const expect = { inputTokens: 10, outputTokens: 20, cachedTokens: 3, totalTokens: 33 };
  for (const wrap of [
    { last: { inputTokens: 10, outputTokens: 20, cachedInputTokens: 3, totalTokens: 33 } },
    { lastTokenUsage: { input_tokens: 10, output_tokens: 20, cached_input_tokens: 3, total_tokens: 33 } },
    { last_token_usage: { input: 10, output: 20, cached: 3, total: 33 } },
    { info: { last_token_usage: { input_tokens: 10, output_tokens: 20, cached_input_tokens: 3, total_tokens: 33 } } },
  ]) {
    assert.deepEqual(usageFromTokenEvent(evt(wrap))?.usage, expect);
  }
});

test("非用量事件 / 缺 threadId / 缺 last 桶 ⇒ null", () => {
  assert.equal(usageFromTokenEvent({ kind: "notification", method: "turn/completed", params: {} }), null);
  assert.equal(usageFromTokenEvent(evt({ last: { inputTokens: 1 } }, "")), null);
  assert.equal(usageFromTokenEvent(evt({})), null);
  assert.equal(usageFromTokenEvent(null), null);
});

test("补写目标：最新一条同会话、未带用量、未超时", () => {
  const now = 1_000_000;
  const rows = [
    { id: "a", threadId: "t1", at: now - 1000 },
    { id: "b", threadId: "t2", at: now - 500 },
    { id: "c", threadId: "t1", at: now - 100 },
  ];
  assert.equal(pickUsagePatchIndex(rows, "t1", now), 2);
  assert.equal(pickUsagePatchIndex(rows, "t2", now), 1);
  assert.equal(pickUsagePatchIndex(rows, "nope", now), -1);
});

test("最新那条已有用量 ⇒ 不再补（⛔ 别覆盖 / 别重复显示）", () => {
  const now = 1_000_000;
  const rows = [
    { id: "a", threadId: "t1", at: now - 100 },
    { id: "b", threadId: "t1", at: now - 50, usage: { inputTokens: 1 } },
  ];
  assert.equal(pickUsagePatchIndex(rows, "t1", now), -1);
});

test("超时（10 分钟）⇒ 不补历史消息", () => {
  const now = 1_000_000;
  const fresh = [{ id: "a", threadId: "t1", at: now - 60_000 }];
  const stale = [{ id: "b", threadId: "t1", at: now - 11 * 60_000 }];
  assert.equal(pickUsagePatchIndex(fresh, "t1", now), 0);
  assert.equal(pickUsagePatchIndex(stale, "t1", now), -1);
});

test("缓存只能在**本轮开始之后**使用（⛔ 别把上一轮用量挂到新消息上）", () => {
  const usage = { inputTokens: 1, outputTokens: 2, cachedTokens: 0, totalTokens: 3 };
  assert.equal(usageUsableFor({ usage, at: 1000 }, 1000), usage);
  assert.equal(usageUsableFor({ usage, at: 1000 }, 1001), null);
  assert.equal(usageUsableFor(null, 0), null);
});
