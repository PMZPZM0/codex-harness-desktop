/**
 * `splitMentionSegments` 真值表（11-07 用户令：艾特要真、按顺序、不重复）。
 *
 * ⛔ 这张表钉的是「用户的肉眼判据」，不是实现细节：
 *   · 多个 @ 必须按正文出现顺序逐个产出（不能一次全给、也不能倒序）；
 *   · 名字后面直接跟汉字不算提及（「@问需求澄清」不能把成员「问需」吃掉）；
 *   · 长名优先（「张三丰」不能被「张三」截断）；
 *   · 代码块里的 @ 不解析；
 *   · 自己 @ 自己（excludeId）不算。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { splitMentionSegments } from "../src/lib/team-mention-render.mjs";

const cands = [
  { id: "local-user", name: "Administrator" },
  { id: "t1", name: "承枢" },
  { id: "t2", name: "问需" },
  { id: "t3", name: "构梁" },
  { id: "t4", name: "张三" },
  { id: "t5", name: "张三丰" },
];

const mentionsOf = (segs) => segs.filter((s) => s.type === "mention").map((s) => s.name);
const textsOf = (segs) => segs.filter((s) => s.type === "text").map((s) => s.text);

test("多个艾特按正文出现顺序逐个产出", () => {
  const segs = splitMentionSegments("@问需：说两句。@构梁：你也说。@承枢 收尾。", cands);
  assert.deepEqual(mentionsOf(segs), ["问需", "构梁", "承枢"]);
  /* 段序也必须与正文一致：mention 与 text 交替出现 */
  assert.deepEqual(segs.map((s) => s.type), ["mention", "text", "mention", "text", "mention", "text"]);
});

test("同一条消息里重复 @ 同一个人：按位置各出一枚（不合并、不丢）", () => {
  const segs = splitMentionSegments("@承枢 @承枢 喊你的成员出来唠唠嗑", cands);
  assert.deepEqual(mentionsOf(segs), ["承枢", "承枢"]);
  assert.equal(segs.filter((s) => s.type === "mention").length, 2);
});

test("名字后面直接跟汉字不算提及（@问需求澄清 不吃掉「问需」）", () => {
  const segs = splitMentionSegments("@问需求澄清一下", cands);
  assert.deepEqual(mentionsOf(segs), []);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].text, "@问需求澄清一下");
});

test("长名优先：@张三丰 不被「张三」截断", () => {
  const segs = splitMentionSegments("@张三丰 来讲讲", cands);
  assert.deepEqual(mentionsOf(segs), ["张三丰"]);
});

test("代码块里的 @ 不解析", () => {
  const segs = splitMentionSegments("看这段：\n```\n@问需 echo hi\n```\n完了 @构梁", cands);
  assert.deepEqual(mentionsOf(segs), ["构梁"]);
  assert.ok(segs.some((s) => s.type === "text" && s.text.includes("@问需 echo hi")));
});

test("excludeId：自己 @ 自己不算提及", () => {
  const segs = splitMentionSegments("@承枢 自己", cands, { excludeId: "t1" });
  assert.deepEqual(mentionsOf(segs), []);
});

test("未知名字不解析（保留原文，不编造目标）", () => {
  const segs = splitMentionSegments("@路人甲 你好 @问需", cands);
  assert.deepEqual(mentionsOf(segs), ["问需"]);
  assert.ok(textsOf(segs).join("").includes("@路人甲"));
});

test("文本段合并不产生空段 / 相邻 text 段已并成一段", () => {
  const segs = splitMentionSegments("开头 @问需 中间 @构梁 结尾", cands);
  assert.deepEqual(segs.map((s) => s.type), ["text", "mention", "text", "mention", "text"]);
  assert.deepEqual(textsOf(segs), ["开头 ", " 中间 ", " 结尾"]);
});

test("空文本 / 无候选", () => {
  assert.deepEqual(splitMentionSegments("", cands), []);
  const segs = splitMentionSegments("@问需 你好", []);
  assert.deepEqual(mentionsOf(segs), []);
});

/* ── linkifyMentions：正文 → Markdown 链接（渲染层据此画真提及） ────────────── */
import { linkifyMentions, mentionIdOfHref } from "../src/lib/team-mention-render.mjs";

test("linkify：多个艾特按顺序变成带 id 的链接，正文其余原样", () => {
  const out = linkifyMentions("@问需：做需求。@构梁：出方案。", cands);
  assert.equal(out, "[@问需](#tm-t2)：做需求。[@构梁](#tm-t3)：出方案。");
});

test("linkify：合成 id（含冒号）能原样取回", () => {
  const out = linkifyMentions("@问需 你看", [{ id: "team:t1:问需", name: "问需" }]);
  assert.ok(out.includes("(#tm-team%3At1%3A%E9%97%AE%E9%9C%80)"));
  assert.equal(mentionIdOfHref("#tm-team%3At1%3A%E9%97%AE%E9%9C%80"), "team:t1:问需");
});

test("linkify：名字里的方括号被转义（不破坏链接语法）", () => {
  const out = linkifyMentions("@A[1] 说话", [{ id: "x1", name: "A[1]" }]);
  assert.equal(out, "[@A\\[1\\]](#tm-x1) 说话");
});

test("mentionIdOfHref：普通链接 / 空值不算提及", () => {
  assert.equal(mentionIdOfHref("https://example.com"), "");
  assert.equal(mentionIdOfHref(""), "");
  assert.equal(mentionIdOfHref("#tm-abc"), "abc");
});
