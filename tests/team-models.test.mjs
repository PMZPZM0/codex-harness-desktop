import test from "node:test";
import assert from "node:assert/strict";
import {
  GROUP_MAX_PARTNERS,
  addPartner,
  canDelegate,
  createGroup,
  displayNameOf,
  groupIssues,
  guardAllows,
  memberIdsOf,
  partnersOf,
  projectGroupMessages,
  removePartner,
  setPartnerMuted,
} from "../src/lib/team-models.mjs";

const bot = (id, extra = {}) => ({ id, kind: "bot", name: `伙伴${id}`, ...extra });
const human = (id, extra = {}) => ({ id, kind: "human", name: `人${id}`, ...extra });

function baseGroup() {
  return createGroup({
    id: "grp_1",
    name: "智慧厨房",
    leadId: "u1",
    members: [human("u1"), bot("bot_a", { addedBy: "u1", managerId: "u1" }), bot("bot_b", { addedBy: "u2" })],
  });
}

test("建群：去重、补护栏默认值、群主取首个成员", () => {
  const g = createGroup({ id: "g", members: [human("u1"), human("u1"), bot("b1")] });
  assert.equal(g.leadId, "u1");
  assert.equal(g.members.length, 2);
  assert.deepEqual(g.guard, { scope: "project", allowExternal: false, respondToEveryone: false });
});

test("memberIds 只从 members 派生（不额外维护 id 数组）", () => {
  assert.deepEqual(memberIdsOf(baseGroup()), ["u1", "bot_a", "bot_b"]);
  assert.deepEqual(partnersOf(baseGroup()).map((m) => m.id), ["bot_a", "bot_b"]);
});

test("加伙伴：重复加是幂等，不产生第二份", () => {
  const g = baseGroup();
  const r = addPartner(g, bot("bot_a"), "u1");
  assert.equal(r.ok, true);
  assert.equal(r.changed, false);
  assert.equal(r.group.members.filter((m) => m.id === "bot_a").length, 1);
});

test("加伙伴：到上限拒绝，并回带 limit（按钮灰不是准入）", () => {
  let g = createGroup({ id: "g", members: [human("u1")] });
  for (let i = 0; i < GROUP_MAX_PARTNERS; i += 1) {
    const r = addPartner(g, bot(`b${i}`), "u1");
    assert.equal(r.ok, true, `第 ${i + 1} 个应可加入`);
    g = r.group;
  }
  const over = addPartner(g, bot("overflow"), "u1");
  assert.equal(over.ok, false);
  assert.equal(over.reason, "limit");
  assert.equal(over.limit, GROUP_MAX_PARTNERS);
});

test("移除伙伴：群主可移除任何伙伴；添加者可移除自己加的；其他人不行", () => {
  const g = createGroup({
    id: "grp_1",
    name: "智慧厨房",
    leadId: "u1",
    members: [human("u1"), human("u3"), bot("bot_a", { addedBy: "u1" }), bot("bot_b", { addedBy: "u2" })],
  });
  assert.equal(removePartner(g, "bot_a", "u1").ok, true, "群主可移除");
  assert.equal(removePartner(g, "bot_b", "u1").ok, true, "群主也能移除别人加的（飞书文案：仅群主和添加者可移除）");
  assert.equal(removePartner(g, "bot_b", "u2").ok, true, "添加者可移除自己加的");
  assert.equal(removePartner(g, "bot_b", "u3").ok, false, "既非群主又非添加者 ⇒ 拒绝");
  assert.equal(removePartner(g, "bot_b", "u3").reason, "forbidden");
  assert.equal(removePartner(g, "bot_a", "u1").group.members.some((m) => m.id === "bot_a"), false);
  assert.equal(removePartner(g, "u1", "u1").reason, "not_partner", "人类成员不走这条");
  assert.equal(removePartner(g, "bot_a", "bot_a").reason, "forbidden", "伙伴不能自己删自己");
});

test("静音：只影响目标伙伴", () => {
  const g = setPartnerMuted(baseGroup(), "bot_a", true);
  assert.equal(g.members.find((m) => m.id === "bot_a").muted, true);
  assert.equal(g.members.find((m) => m.id === "bot_b").muted, false);
});

test("委派：canDelegate 白名单优先，空则按 managerId", () => {
  const g = createGroup({
    id: "g",
    members: [
      human("lead"),
      bot("a", { managerId: "lead" }),
      bot("b", { managerId: "a" }),
      bot("c", { managerId: "lead", canDelegate: [] }),
    ],
  });
  assert.equal(canDelegate("lead", "a", g), true, "a 的上级是 lead");
  assert.equal(canDelegate("a", "b", g), true, "b 的上级是 a");
  assert.equal(canDelegate("lead", "b", g), false, "b 的上级不是 lead");
  assert.equal(canDelegate("a", "a", g), false, "不能派给自己");

  const withWhitelist = createGroup({
    id: "g2",
    members: [human("lead"), bot("x", { managerId: "lead", canDelegate: ["z"] }), bot("y", { managerId: "lead" }), bot("z")],
  });
  assert.equal(canDelegate("lead", "x", withWhitelist), true);
  assert.equal(canDelegate("lead", "y", withWhitelist), true);
  assert.equal(canDelegate("x", "z", withWhitelist), true, "白名单命中");
  assert.equal(canDelegate("x", "y", withWhitelist), false, "白名单存在时只认白名单");
});

test("护栏：默认禁外部、不响应 @所有人；开了才放行", () => {
  const g = baseGroup();
  assert.equal(guardAllows(g, { isExternal: true }).reason, "external_blocked");
  assert.equal(guardAllows(g, { mentionsEveryone: true }).reason, "everyone_blocked");
  assert.equal(guardAllows(g, {}).ok, true);

  const open = createGroup({ ...g, guard: { allowExternal: true, respondToEveryone: true } });
  assert.equal(guardAllows(open, { isExternal: true }).ok, true);
  assert.equal(guardAllows(open, { mentionsEveryone: true }).ok, true);
});

test("消息投影：多子会话按时间合并、乱序输入也要升序、重复 itemId 去重", () => {
  const rows = projectGroupMessages([
    {
      threadId: "t_a",
      messages: [
        { itemId: "m3", authorId: "bot_a", at: 300, text: "第三条" },
        { itemId: "m1", authorId: "u1", authorKind: "human", at: 100, text: "第一条" },
      ],
    },
    {
      threadId: "t_b",
      messages: [
        { itemId: "m2", authorId: "bot_b", at: 200, kind: "card", card: { type: "div" } },
        { itemId: "m1", authorId: "u1", at: 100, text: "第一条（重复投影）" },
      ],
    },
  ]);
  /* ⛔ 去重键 = threadId + itemId：跨 thread 的同名 itemId 是**两条不同消息**（同 thread 内才去重） */
  assert.deepEqual(rows.map((r) => r.key), ["t_a:m1", "t_b:m1", "t_b:m2", "t_a:m3"]);
  assert.equal(rows[0].authorKind, "human");
  assert.equal(rows[0].text, "第一条", "同 thread 内先到的那条保留内容");
  assert.equal(rows[2].kind, "card");
  assert.deepEqual(rows.map((r) => r.seq), [1, 2, 3, 4]);
});

test("消息投影：没有真身引用（缺 threadId / itemId）的一条都不留", () => {
  const rows = projectGroupMessages([
    { threadId: "", messages: [{ itemId: "x", at: 1 }] },
    { threadId: "t", messages: [{ itemId: "", at: 2 }, { itemId: "ok", at: 3 }] },
  ]);
  assert.deepEqual(rows.map((r) => r.itemId), ["ok"]);
});

test("显示名：找不到成员时回退 id，不编造", () => {
  const g = baseGroup();
  assert.equal(displayNameOf(g, "bot_a"), "伙伴bot_a");
  assert.equal(displayNameOf(g, "ghost"), "ghost");
});

test("体检：群主不在成员表、没有伙伴、成员重复都要报出来", () => {
  assert.deepEqual(groupIssues(baseGroup()), []);
  const broken = groupIssues({ id: "", leadId: "nobody", members: [{ id: "a", kind: "human" }, { id: "a", kind: "human" }] });
  assert.ok(broken.some((s) => s.includes("缺群 id")));
  assert.ok(broken.some((s) => s.includes("群主不在成员表")));
  assert.ok(broken.some((s) => s.includes("没有伙伴")));
});
