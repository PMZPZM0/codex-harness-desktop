/** 标签文字：字素截断 + 读存档不丢字（11-08 审查回归真值表）。 */
import test from "node:test";
import assert from "node:assert/strict";

/* ⛔ entity-tags 只在函数里碰 localStorage ⇒ 先塞一个内存桩，再动态 import。 */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const LONG = "这是一个很长的存量标签";
store.set("entity-thread-tags-v1", JSON.stringify({ t1: { text: LONG, color: "#3b82f6" } }));

const { clampTagText, MAX_TAG_CHARS, getEntityTagState, setEntityTag } = await import("../src/lib/entity-tags.mjs");

test("按字素簇截断：ZWJ 组合 emoji 不被劈开", () => {
  assert.equal(MAX_TAG_CHARS, 3);
  assert.equal(clampTagText("👨‍👩‍👧‍👦测试"), "👨‍👩‍👧‍👦测试");
  assert.equal(clampTagText("专家团队伍"), "专家团");
  assert.equal(clampTagText("  "), "");
});

test("读存档不按 3 字截断：存量长标签在改别的标签后仍完整", () => {
  const before = getEntityTagState().threads.t1;
  assert.equal(before.text, LONG);
  setEntityTag("thread", "t2", { text: "专家团队伍", color: "#ef4444" });
  const after = getEntityTagState().threads;
  assert.equal(after.t2.text, "专家团", "新保存的标签按 3 字素收口");
  assert.equal(after.t1.text, LONG, "⛔ 改 t2 不能把 t1 的存量长标签截掉（整份读改写的数据丢失）");
});
