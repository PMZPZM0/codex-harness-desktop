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
  mergeConsecutive,
  parseCommand,
  parseMentions,
  groupContextBlock,
  teamKidsOf,
  parseAgentMentions,
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

test("群消息来源：定时任务 / 伙伴 / 用户各有身份，老日志按作者推导（⛔ 不是一律当用户）", () => {
  /* 11-07 用户令：「准确区分每条消息是上级发送还是用户发送」。
     定时任务的 authorKind 仍是 human（它还管着过程折叠 / 动作条，⛔ 不改语义），
     真实来源走独立的 senderKind —— 渲染层据此标「定时任务」而不是当成"我"说的话。 */
  const auto = normalizeGroupMessage({ id: "a1", threadId: "t1", text: "到点巡检", authorKind: "human", authorId: "automation" });
  assert.equal(auto.senderKind, "automation");
  const user = normalizeGroupMessage({ id: "u1", threadId: "t1", text: "我打的", authorKind: "human", authorId: "local-user" });
  assert.equal(user.senderKind, "user");
  const bot = normalizeGroupMessage({ id: "b1", threadId: "t1", text: "伙伴回复", authorKind: "bot", authorId: "p1" });
  assert.equal(bot.senderKind, "member", "伙伴消息（老日志无字段）按 authorKind 推导");
  const explicit = normalizeGroupMessage({ id: "s1", threadId: "t1", text: "系统提示", authorKind: "human", senderKind: "system" });
  assert.equal(explicit.senderKind, "system", "显式落库的身份优先（不被 authorKind 覆盖）");
  const rows = projectGroupLog([auto, user, bot]);
  /* ⛔ 按 id 取而不是按顺序比：投影按 at 排序（三条 at 都是 0，同刻顺序不属于本用例的判据）。 */
  const kindById = Object.fromEntries(rows.map((r) => [r.itemId ?? r.key, r.senderKind]));
  assert.deepEqual(Object.values(kindById).sort(), ["automation", "member", "user"], "投影行也要带（群视图读的是投影）");
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
  /* 11-07：必须带结束标记 —— 显示侧靠它整段剥掉（老会话没有标记只能靠 `---` 兜底）。 */
  assert.ok(b1.trimEnd().endsWith("【群聊上下文结束】"), "群上下文块要自带结束标记");

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
  /* 11-06 用户令「他们可以在群里 @ 沟通」：下级不再是"只作说明"，而是可以叫 ——
     判据口径写在 parseAgentMentions（行首 @名字）。 */
  assert.ok(forA.includes("你可以叫这些伙伴接手") && forA.includes("生图"), forA);
  assert.ok(forA.includes("另起一行写") && forA.includes("@名字：要他做什么"), "叫人的格式必须写进提示词，否则模型不知道怎么触发");
  /* 11-06 需求变更（用户令「默认上级就是主会话那个」）：没显式设过 ⇒ 上级是群主，
     所以这里**一定**有「你的上级」，且带「默认 · 群主」标记。 */
  assert.ok(forA.includes("你的上级"), forA);
  assert.ok(forA.includes("默认 · 群主"), forA);
  assert.ok(forB.includes("你的上级：承枢（交付总监）"), forB);
  assert.ok(!forB.includes("你可以叫这些伙伴接手"));
  /* 11-06：成员名录现在**总是**注入（伙伴互相 @ 要靠它认人），所以不再断言"空串"；
     上下级的可观测差异改为"有没有组织关系段"。 */
  const plain = groupContextBlock(g, { forMemberId: "a" });
  assert.ok(plain.includes("群里的人（"), "名录总是注入（互相 @ 的前提）");
  /* 11-06 起：默认上级（群主）也让组织关系段常在 —— 这一段现在是「你向谁汇报」，
     不再是「有没有配过上下级」。 */
  assert.ok(plain.includes("组织关系"), "默认上级 ⇒ 组织关系段总在");
  assert.ok(!plain.includes("你可以叫这些伙伴接手"), "没配下级就不写下级段");
});

test("投影带出 mentions（@ 高亮的数据来源）", () => {
  let list = [];
  list = appendGroupMessage(list, { id: "h1", threadId: "group:g", authorKind: "human", at: 1, text: "hi", mentions: ["a", "b"] });
  const rows = projectGroupLog(list);
  assert.deepEqual(rows[0].mentions, ["a", "b"]);
  const bare = projectGroupLog(appendGroupMessage([], { id: "h2", threadId: "group:g", at: 2, text: "x" }));
  assert.deepEqual(bare[0].mentions, [], "没 @ 就是空数组，不是 undefined");
});

/* ── 互相 @ / 合并 / 命令（11-06 用户要求） ── */

test("互相 @：只认群里真实成员名，长名优先，排除自己", () => {
  const g = createGroup({
    id: "g", name: "n", leadId: "u",
    members: [human("u"), bot("a", { name: "承枢", targetKind: "expert" }), bot("b", { name: "承枢二", targetKind: "expert" })],
  });
  const hits = parseMentions("@承枢二 你先看，再让 @承枢 复核；@外人 不认", g);
  assert.deepEqual(hits.map((x) => x.name), ["承枢二", "承枢"], "两个都在，且长名不被短名吃掉");
  assert.deepEqual(parseMentions("@承枢 自己", g, { excludeId: "a" }).map((x) => x.name), [], "排除自己");
  assert.deepEqual(parseMentions("@所有人 开会", g), [], "没有 @所有人 这个动作");
});

test("合并：同作者短间隔并成一条，作者变了/间隔久了/卡片消息都断开", () => {
  const rows = [
    { key: "1", authorId: "a", kind: "text", at: 1000, text: "第一句" },
    { key: "2", authorId: "a", kind: "text", at: 2000, text: "第二句" },
    { key: "3", authorId: "b", kind: "text", at: 3000, text: "换人" },
    { key: "4", authorId: "b", kind: "text", at: 3000 + 10 * 60_000, text: "十分钟后" },
    { key: "5", authorId: "b", kind: "card", at: 3000 + 10 * 60_000 + 1, card: {} },
  ];
  const merged = mergeConsecutive(rows, 90_000);
  assert.equal(merged.length, 4, "前两条并成 1 条 + 换人 1 条 + 超时 1 条 + 卡片 1 条");
  assert.equal(merged[0].continued.length, 1);
  assert.equal(merged[0].continued[0].key, "2");
  assert.equal(merged[3].kind, "card", "卡片消息自成一框（不并入上一条）");
  assert.deepEqual(mergeConsecutive(null), []);
});

test("命令：只有开头就是 / 才算；/stop 带不带 @ 都认得出来", () => {
  assert.deepEqual(parseCommand("/stop"), { name: "stop", rest: "" });
  assert.deepEqual(parseCommand("  /stop @承枢 "), { name: "stop", rest: "@承枢" });
  assert.equal(parseCommand("今天的/会议"), null, "句中出现斜杠不是命令");
  assert.equal(parseCommand("你好"), null);
});

test("团成员进名录与互 @ 候选（11-07：成员之间要能互相艾特）", () => {
  const group = createGroup({
    id: "g_team", name: "测试", leadId: "u1",
    members: [
      human("u1"),
      { id: "tgt:team:software-dev-team", kind: "bot", name: "软件开发专家团", targetKind: "team", targetKey: "software-dev-team" },
    ],
  });
  const catalog = [
    { kind: "team", key: "software-dev-team", name: "软件开发专家团", teamId: "software-dev-team" },
    { kind: "member", key: "software-dev-team:product-manager", name: "问需", profession: "产品经理", teamId: "software-dev-team", memberId: "product-manager" },
    { kind: "member", key: "software-dev-team:architect", name: "构梁", teamId: "software-dev-team", memberId: "architect" },
  ];
  const kids = teamKidsOf(group, catalog);
  assert.equal(kids.length, 2, "团里两位成员都展开成可派活的虚拟伙伴");
  assert.equal(kids[0].id, "team:software-dev-team:product-manager");
  assert.equal(kids[0].targetKind, "member");
  assert.equal(kids[0].targetKey, "software-dev-team:product-manager");
  const ctx = groupContextBlock(group, { forMemberId: "tgt:team:software-dev-team", catalog });
  assert.ok(ctx.includes("问需") && ctx.includes("构梁"), "名录里要列出团成员，成员才知道能 @ 谁");
  assert.ok(ctx.includes("另起一行写") && ctx.includes("@名字：要他做什么"));
  const asks = parseAgentMentions("先给结论。\n@问需：出来说句话", group, { catalog });
  assert.equal(asks.length, 1);
  assert.equal(asks[0].name, "问需");
  assert.equal(asks[0].target?.targetKey, "software-dev-team:product-manager", "互 @ 要带可派活的虚拟伙伴");
  assert.deepEqual(parseAgentMentions("@问需：出来说句话", group, { catalog, excludeId: kids[0].id }), [], "不能叫自己");
  /* 团成员自己被派活时 forMemberId 是合成 id ⇒ self 在 g.members 里查不到（null），
     但有 kids 时名录段仍会执行 —— 这里以前会解引用 self.targetKind 直接崩。 */
  const kidCtx = groupContextBlock(group, { forMemberId: kids[0].id, catalog });
  assert.ok(kidCtx.includes("问需") && kidCtx.includes("另起一行写"), "团成员拿到群上下文不能崩");
});
