import test from "node:test";
import assert from "node:assert/strict";
import {
  GROUP_MAX_PARTNERS,
  MAX_GROUP_FILES,
  MAX_GROUP_MEMORY_CHARS,
  MAX_GROUP_MESSAGES,
  addPartner,
  appendGroupMessage,
  canDelegate,
  createBlockers,
  createGroup,
  groupContextBlock,
  normalizeGroupFile,
  displayNameOf,
  groupIssues,
  groupThreadId,
  guardAllows,
  memberIdsOf,
  normalizeGroupMessage,
  partnersOf,
  projectGroupLog,
  projectGroupMessages,
  removePartner,
  setManager,
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

/* ── P0b：伙伴绑定调度目标 + 群消息日志 ── */

test("伙伴绑定调度目标：targetKind/targetKey 原样保留，非法 kind 一律清空", () => {
  const g = createGroup({
    id: "grp_1", name: "智慧厨房", leadId: "u1",
    members: [
      human("u1"),
      bot("tgt:member:数据师", { name: "数据师", targetKind: "member", targetKey: "数据师" }),
      bot("tgt:expert:法务", { name: "法务", targetKind: "expert", targetKey: "法务" }),
      bot("bad", { name: "手工加的", targetKind: "乱写" }),
    ],
  });
  const byId = Object.fromEntries(g.members.map((m) => [m.id, m]));
  assert.equal(byId["tgt:member:数据师"].targetKind, "member");
  assert.equal(byId["tgt:member:数据师"].targetKey, "数据师");
  assert.equal(byId["tgt:expert:法务"].targetKind, "expert");
  assert.equal(byId.bad.targetKind, "", "非法 targetKind ⇒ 视为未绑定");
  assert.equal(byId.bad.targetKey, "");
});

test("群消息：没有 id 或 threadId 一律判无效（不造真身）", () => {
  assert.equal(normalizeGroupMessage({ id: "", threadId: "t1" }), null);
  assert.equal(normalizeGroupMessage({ id: "m1", threadId: "" }), null);
  const ok = normalizeGroupMessage({ id: "m1", threadId: "t1", text: "hi", authorKind: "bot" });
  assert.equal(ok.authorKind, "bot");
  assert.equal(ok.kind, "text");
});

test("群消息追加：同 id 覆盖（占位→补正文），并保持时间序由投影负责", () => {
  let list = [];
  list = appendGroupMessage(list, { id: "m1", threadId: "t1", at: 100, text: "占位" });
  list = appendGroupMessage(list, { id: "m1", threadId: "t1", at: 100, text: "正文" });
  assert.equal(list.length, 1, "同 id 不许出现两条");
  assert.equal(list[0].text, "正文");
});

test("群消息上限：超了丢最老的（投影索引而已，真身在子会话）", () => {
  let list = [];
  for (let i = 0; i < MAX_GROUP_MESSAGES + 5; i += 1) {
    list = appendGroupMessage(list, { id: `m${i}`, threadId: "t1", at: i, text: `第 ${i} 条` });
  }
  assert.equal(list.length, MAX_GROUP_MESSAGES);
  assert.equal(list[0].id, "m5", "最老 5 条被截掉");
  assert.equal(list[list.length - 1].id, `m${MAX_GROUP_MESSAGES + 4}`);
});

test("群投影：人的消息（group: 前缀）与两个伙伴的子会话按时间排成一条时间轴", () => {
  const gid = "grp_1";
  const mine = groupThreadId(gid);
  assert.equal(mine, "group:grp_1");
  let list = [];
  list = appendGroupMessage(list, { id: "h1", threadId: mine, authorKind: "human", authorId: "u1", at: 20, text: "本周销量核对一下" });
  list = appendGroupMessage(list, { id: "b1", threadId: "th_data", authorKind: "bot", authorId: "tgt:member:数据师", at: 40, text: "核对完了" });
  list = appendGroupMessage(list, { id: "b2", threadId: "th_promo", authorKind: "bot", authorId: "tgt:member:推广", at: 30, text: "先出方案" });

  const rows = projectGroupLog(list);
  assert.deepEqual(rows.map((r) => r.text), ["本周销量核对一下", "先出方案", "核对完了"], "按时间升序（不是插入序）");
  assert.deepEqual(rows.map((r) => r.seq), [1, 2, 3]);
  assert.deepEqual(rows.map((r) => r.key), ["group:grp_1:h1", "th_promo:b2", "th_data:b1"], "去重键 = threadId:itemId");
  assert.equal(rows[0].authorKind, "human");
  assert.equal(rows[2].authorKind, "bot");
  assert.equal(rows[2].threadId, "th_data", "伙伴消息保留真实子会话 id（点开可回原子会话）");
});

test("群投影：脏数据不炸（null/缺字段/非数组一律跳过）", () => {
  assert.deepEqual(projectGroupLog(null), []);
  assert.deepEqual(projectGroupLog([null, { id: "" }, { id: "x" }, { id: "y", threadId: "t" }]).length, 1);
});

test("建群闸：只有人的新群必须放行（11-06 修「建群从来没成功过」）", () => {
  const fresh = createGroup({ id: "grp_new", name: "验收群", leadId: "u1", members: [human("u1")] });
  assert.deepEqual(createBlockers(fresh), [], "新群没有伙伴是正常的，不能当错误");
  assert.ok(groupIssues(fresh).some((s) => s.includes("还没有伙伴")), "体检仍然提示还没伙伴");
  /* ⛔ 成员去重是 createGroup 的职责 ⇒ 这里只剩「群主不在成员表」这一条结构性错误 */
  assert.deepEqual(createBlockers({ id: "grp_x", leadId: "nobody", members: [human("a"), human("a")] }), ["群主不在成员表里"], "结构性错误照拦");
  assert.deepEqual(createBlockers({ id: "", leadId: "a", members: [human("a")] }), ["缺群 id"]);
});

/* ── 群记忆 / 群文件（11-06 复刻豆包 baseline + 参考资料） ── */

test("群文件：只认路径，名字从路径取，缺 path 一律丢", () => {
  assert.equal(normalizeGroupFile({}), null);
  assert.equal(normalizeGroupFile({ path: "  " }), null);
  const f = normalizeGroupFile({ path: "D:/a/销量.xlsx", note: "  上周  " });
  assert.equal(f.name, "销量.xlsx");
  assert.equal(f.note, "上周", "说明要去空白");
  assert.equal(normalizeGroupFile({ path: "D:/a/b.md", name: "自定义名" }).name, "自定义名");
});

test("群记忆/群文件：建群时保留，超限截断；老数据没有这两项也不炸", () => {
  const g = createGroup({
    id: "g1", name: "n", leadId: "u", members: [human("u")],
    memory: "x".repeat(MAX_GROUP_MEMORY_CHARS + 50),
    files: Array.from({ length: MAX_GROUP_FILES + 3 }, (_, i) => ({ path: `D:/f/${i}.md` })),
  });
  assert.equal(g.memory.length, MAX_GROUP_MEMORY_CHARS, "群记忆按上限截断");
  assert.equal(g.files.length, MAX_GROUP_FILES, "文件按上限截断");
  const legacy = createGroup({ id: "g2", name: "老群", leadId: "u", members: [human("u")] });
  assert.equal(legacy.memory, "");
  assert.deepEqual(legacy.files, []);
});

test("注入块：空群不注入；有记忆/文件时按「标题→记忆→文件」拼，且带路径", () => {
  const bare = createGroup({ id: "g", name: "空群", leadId: "u", members: [human("u")] });
  assert.equal(groupContextBlock(bare), "", "没有任何上下文 ⇒ 空串（⛔ 别注入一个空标题）");

  const onlyMemory = createGroup({ id: "g", name: "智慧厨房", leadId: "u", members: [human("u")], memory: "只做门店周报。" });
  const b1 = groupContextBlock(onlyMemory);
  assert.ok(b1.startsWith("【群聊上下文 · 智慧厨房】"));
  assert.ok(b1.includes("只做门店周报。"));
  assert.ok(!b1.includes("参考文件"));

  const full = createGroup({
    id: "g", name: "智慧厨房", leadId: "u", members: [human("u")],
    memory: "只做门店周报。",
    files: [{ path: "D:/data/销量.xlsx", note: "上周" }, { path: "D:/data/口径.md" }],
  });
  const b2 = groupContextBlock(full);
  assert.ok(b2.includes("参考文件"));
  assert.ok(b2.includes("D:/data/销量.xlsx（上周）"), "带说明");
  assert.ok(b2.includes("D:/data/口径.md"), "没说明也列路径");
  assert.ok(b2.indexOf("只做门店周报。") < b2.indexOf("参考文件"), "记忆在文件之前");
  assert.ok(b2.length < 6000, "注入块要有界（群记忆 4000 + 文件 20 行）");
});

/* ── 上下级（豆包 managerId）+ @ 高亮（飞书 mention） ── */

test("上下级：能设能清，自指/成环/不在群里一律拒", () => {
  const g = createGroup({
    id: "g", name: "n", leadId: "u",
    members: [human("u"), bot("a", { name: "A", targetKind: "expert" }), bot("b", { name: "B", targetKind: "expert" })],
  });
  const r1 = setManager(g, "b", "a");
  assert.equal(r1.ok, true);
  assert.equal(r1.group.members.find((m) => m.id === "b").managerId, "a");
  assert.equal(setManager(r1.group, "a", "a").reason, "self", "不能当自己的上级");
  assert.equal(setManager(r1.group, "a", "b").reason, "cycle", "A→B→A 成环要拒");
  assert.equal(setManager(r1.group, "a", "ghost").reason, "no_manager", "上级必须在群里");
  assert.equal(setManager(r1.group, "b", "").group.members.find((m) => m.id === "b").managerId, "", "能清掉");
});

test("注入块按人不同：上级/下级各写各的，且下级写成 agent_invoke 的参数形", () => {
  const g = createGroup({
    id: "g", name: "智慧厨房", leadId: "u",
    members: [
      human("u"),
      bot("a", { name: "承枢", targetKind: "expert", targetKey: "team:lead", targetProfession: "交付总监" }),
      bot("b", { name: "生图", targetKind: "expert", targetKey: "img" }),
    ],
  });
  const withOrg = setManager(g, "b", "a").group;
  const forA = groupContextBlock(withOrg, { forMemberId: "a" });
  const forB = groupContextBlock(withOrg, { forMemberId: "b" });
  assert.ok(forA.includes("你可以把子任务派给：生图（expert:img）"), forA);
  assert.ok(!forA.includes("你的上级"));
  assert.ok(forB.includes("你的上级：承枢（交付总监）"), forB);
  assert.ok(!forB.includes("你可以把子任务派给"));
  assert.equal(groupContextBlock(g, { forMemberId: "a" }), "", "没配上下级也没记忆/文件 ⇒ 不注入");
});

test("投影带出 mentions（@ 高亮的数据来源）", () => {
  let list = [];
  list = appendGroupMessage(list, { id: "h1", threadId: "group:g", authorKind: "human", at: 1, text: "hi", mentions: ["a", "b"] });
  const rows = projectGroupLog(list);
  assert.deepEqual(rows[0].mentions, ["a", "b"]);
  const bare = projectGroupLog(appendGroupMessage([], { id: "h2", threadId: "group:g", at: 2, text: "x" }));
  assert.deepEqual(bare[0].mentions, [], "没 @ 就是空数组，不是 undefined");
});
