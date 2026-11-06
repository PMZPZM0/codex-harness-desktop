import test from "node:test";
import assert from "node:assert/strict";
import { createGroup, groupContextBlock, resolveManagerId } from "../src/lib/team-models.mjs";

/* 群主 = local-user「我」；两个伙伴（专家），一个显式设了上级。 */
function makeGroup(extra = {}) {
  return createGroup({
    id: "g1",
    name: "测试群",
    leadId: "me",
    memory: "共享背景",
    members: [
      { id: "me", kind: "human", name: "我" },
      { id: "tgt:expert:a", kind: "bot", name: "执舵", targetKind: "expert", targetKey: "a", targetProfession: "首席策略官" },
      { id: "tgt:expert:b", kind: "bot", name: "洞明", targetKind: "expert", targetKey: "b", targetProfession: "代码审查专家" },
    ],
    ...extra,
  });
}

test("没设过上级的伙伴，默认上级就是群主（主会话那个）", () => {
  const g = makeGroup();
  assert.equal(resolveManagerId(g, "tgt:expert:a"), "me");
  assert.equal(resolveManagerId(g, "tgt:expert:b"), "me");
});

test("显式设过的上级优先（不会被默认值覆盖）", () => {
  const g = createGroup({
    ...makeGroup(),
    members: [
      { id: "me", kind: "human", name: "我" },
      { id: "tgt:expert:a", kind: "bot", name: "执舵", targetKind: "expert", targetKey: "a" },
      { id: "tgt:expert:b", kind: "bot", name: "洞明", targetKind: "expert", targetKey: "b", managerId: "tgt:expert:a" },
    ],
  });
  assert.equal(resolveManagerId(g, "tgt:expert:b"), "tgt:expert:a");
  assert.equal(resolveManagerId(g, "tgt:expert:a"), "me", "没改的继续默认群主");
});

test("群主自己没有上级；不存在的成员 / 没有群主时返回空串", () => {
  const g = makeGroup();
  assert.equal(resolveManagerId(g, "me"), "", "⛔ 群主不能当自己的上级");
  assert.equal(resolveManagerId(g, "tgt:expert:不存在"), "");
  assert.equal(resolveManagerId(null, "x"), "");
  const noLead = createGroup({ name: "无主群", members: [{ id: "b1", kind: "bot", name: "B", targetKind: "expert", targetKey: "b1" }] });
  assert.equal(resolveManagerId(noLead, "b1"), "", "群主缺失 ⇒ 不编一个上级出来");
});

test("坏数据不抛：非数组成员 / 空群", () => {
  assert.doesNotThrow(() => resolveManagerId({ members: null }, "x"));
  assert.equal(resolveManagerId({ members: [] }, "x"), "");
});

test("注入块带「你的上级」：默认标默认，显式标人名", () => {
  const g = makeGroup();
  /* 默认态：a 没设过上级 ⇒ 群主「我」，并标注「默认 · 群主」 */
  const block = groupContextBlock(g, { forMemberId: "tgt:expert:a" });
  assert.match(block, /你的上级：我（默认 · 群主）/);

  const g2 = createGroup({
    ...g,
    members: g.members.map((m) => (m.id === "tgt:expert:b" ? { ...m, managerId: "tgt:expert:a" } : m)),
  });
  const block2 = groupContextBlock(g2, { forMemberId: "tgt:expert:b" });
  assert.match(block2, /你的上级：执舵/);
  assert.doesNotMatch(block2, /默认 · 群主/, "显式设过就不该再写「默认」");
});

test("群主视角的注入块不给自己写上级", () => {
  const g = makeGroup();
  const block = groupContextBlock(g, { forMemberId: "me" });
  assert.doesNotMatch(block, /你的上级/);
});
