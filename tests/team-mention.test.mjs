import test from "node:test";
import assert from "node:assert/strict";
import { createGroup, parseAgentMentions } from "../src/lib/team-models.mjs";

function makeGroup() {
  return createGroup({
    id: "g1",
    name: "测试群",
    leadId: "me",
    members: [
      { id: "me", kind: "human", name: "我" },
      { id: "tgt:expert:a", kind: "bot", name: "执舵", targetKind: "expert", targetKey: "a" },
      { id: "tgt:expert:b", kind: "bot", name: "洞明", targetKind: "expert", targetKey: "b" },
      { id: "tgt:expert:c", kind: "bot", name: "洞见 · 逆向工程专家", targetKind: "expert", targetKey: "c" },
      { id: "tgt:expert:m", kind: "bot", name: "静音的人", targetKind: "expert", targetKey: "m", muted: true },
      { id: "tgt:expert:u", kind: "bot", name: "未绑定" },
    ],
  });
}

test("行首 @名字：冒号 / 空格两种写法都算「叫它接手」", () => {
  const g = makeGroup();
  const colon = parseAgentMentions("@洞明：复核这段 diff", g, { excludeId: "tgt:expert:a" });
  assert.equal(colon.length, 1);
  assert.equal(colon[0].memberId, "tgt:expert:b");
  assert.equal(colon[0].ask, "复核这段 diff");

  const space = parseAgentMentions("@洞明 复核这段 diff", g, { excludeId: "tgt:expert:a" });
  assert.equal(space[0].memberId, "tgt:expert:b");
});

test("句子中间 / 举例里的 @ 不触发（11-06 误触发的那类文本）", () => {
  const g = makeGroup();
  const text = [
    "输出形态（Markdown / 表格 / PPT @星象）",
    "这一轮我先列口径，@洞明 后面再复核。",
    "见上：@执舵 的结论",
  ].join("\n");
  assert.deepEqual(parseAgentMentions(text, g, { excludeId: "tgt:expert:a" }), []);
});

test("代码围栏里的不算（示例代码里常有 @）", () => {
  const g = makeGroup();
  const text = ["```", "@洞明：这是示例，不要执行", "```", "已经处理完了。"].join("\n");
  assert.deepEqual(parseAgentMentions(text, g, { excludeId: "tgt:expert:a" }), []);
});

test("静音的 / 没绑定目标的 / 自己 / 人类，都不算能叫的对象", () => {
  const g = makeGroup();
  assert.deepEqual(parseAgentMentions("@静音的人：帮个忙", g, { excludeId: "tgt:expert:a" }), []);
  assert.deepEqual(parseAgentMentions("@未绑定：帮个忙", g, { excludeId: "tgt:expert:a" }), []);
  assert.deepEqual(parseAgentMentions("@执舵：帮个忙", g, { excludeId: "tgt:expert:a" }), [], "自己 @ 自己不算");
  assert.deepEqual(parseAgentMentions("@我：帮个忙", g, { excludeId: "tgt:expert:a" }), [], "人是用户，不是伙伴");
});

test("名字里有空格 / 间隔号也能匹配", () => {
  const g = makeGroup();
  const hit = parseAgentMentions("@洞见·逆向工程专家：看下这个二进制", g, { excludeId: "tgt:expert:a" });
  assert.equal(hit.length, 1);
  assert.equal(hit[0].memberId, "tgt:expert:c");
});

test("alreadyRan 跳过（防回环）；max 限流；同一条里同一人只算一次", () => {
  const g = makeGroup();
  const text = ["@洞明：一", "@执舵：二", "@洞明：三"].join("\n");
  assert.equal(parseAgentMentions(text, g, { excludeId: "tgt:expert:c" }).length, 2, "同一人只算一次");
  assert.equal(parseAgentMentions(text, g, { excludeId: "tgt:expert:c", max: 1 }).length, 1);
  const skipped = parseAgentMentions(text, g, { excludeId: "tgt:expert:c", alreadyRan: ["tgt:expert:b"] });
  assert.deepEqual(skipped.map((x) => x.memberId), ["tgt:expert:a"]);
});

test("坏数据不抛：null / 非字符串 / 空群", () => {
  assert.doesNotThrow(() => parseAgentMentions(null, null));
  assert.deepEqual(parseAgentMentions(null, null), []);
  assert.deepEqual(parseAgentMentions("@洞明：x", { members: null }), []);
});
