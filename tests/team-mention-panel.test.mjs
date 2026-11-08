/** @ 提及口径单测（11-07）：触发边界 / 候选排序 / 文本替换 / 分类。 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  MENTION_MAX_QUERY,
  mentionTriggerOf,
  matchMentionCandidates,
  applyMention,
  mentionSectionsOf,
  flattenMentionSections,
  mentionSegments,
} from "../src/lib/team-mention.mjs";

test("触发：行首 / 空白后的 @ 都算，且带出查询词", () => {
  assert.deepEqual(mentionTriggerOf("@洞", 2), { start: 0, caret: 2, query: "洞" });
  assert.deepEqual(mentionTriggerOf("你好 @洞明", 6), { start: 3, caret: 6, query: "洞明" });
  assert.deepEqual(mentionTriggerOf("第一行\n@观澜", 8), { start: 4, caret: 7, query: "观澜" });
});

test("触发：中文标点后算，ASCII 标点后不算（a@b / C:\\x@y / 邮箱）", () => {
  assert.deepEqual(mentionTriggerOf("看这个，@洞明", 7), { start: 4, caret: 7, query: "洞明" });
  assert.equal(mentionTriggerOf("a@b", 3), null);
  assert.equal(mentionTriggerOf("C:\\x@y", 6), null);
  assert.equal(mentionTriggerOf("foo@bar.com", 11), null);
});

test("触发：词里出现空白 / 第二个 @ / 超过 40 字都不算", () => {
  assert.equal(mentionTriggerOf("@a b", 4), null);
  assert.equal(mentionTriggerOf("@@", 2), null);
  const long = `@${"字".repeat(MENTION_MAX_QUERY + 1)}`;
  assert.equal(mentionTriggerOf(long, long.length), null);
  assert.ok(mentionTriggerOf(`@${"字".repeat(MENTION_MAX_QUERY)}`, MENTION_MAX_QUERY + 1));
});

test("触发：caret 越界按末尾处理", () => {
  assert.deepEqual(mentionTriggerOf("@洞明", 999), { start: 0, caret: 3, query: "洞明" });
  assert.equal(mentionTriggerOf("@洞明", -3), null, "caret<0 夹到 0 ⇒ 光标在 @ 之前，不在提及里");
});

test("候选：前缀 > 包含 > 角色命中，同分保持原顺序", () => {
  const items = [
    { name: "洞见 · 逆向工程专家", role: "逆向工程" },
    { name: "洞明", role: "数据核查" },
    { name: "观澜", role: "数据分析总监" },
    { name: "数据分析助手", role: "数据" },
  ];
  assert.deepEqual(matchMentionCandidates(items, "洞").map((x) => x.name), ["洞明", "洞见 · 逆向工程专家"]);
  assert.deepEqual(matchMentionCandidates(items, "数据").map((x) => x.name), ["数据分析助手", "洞明", "观澜"]);
  assert.equal(matchMentionCandidates(items, "").length, 4);
  assert.equal(matchMentionCandidates(items, "", 2).length, 2);
});

test("替换：现算词尾，不吃下一段换行", () => {
  const t = mentionTriggerOf("请 @洞 看一下", 4);
  assert.equal(applyMention("请 @洞 看一下", t, "洞明").text, "请 @洞明 看一下");
  const t2 = mentionTriggerOf("请 @洞", 4);
  assert.deepEqual(applyMention("请 @洞", t2, "洞明"), { text: "请 @洞明 ", caret: 6 });
  const t3 = mentionTriggerOf("@洞", 2);
  assert.equal(applyMention("@洞\n下一段", t3, "洞明").text, "@洞明 \n下一段");
  assert.equal(applyMention("@洞 后面还有字", t3, "洞明").text, "@洞明 后面还有字");
});

test("分类：机器人 / 专家团 / 团成员，团成员归到团那一行", () => {
  const group = {
    members: [
      { id: "me", kind: "human", name: "我" },
      { id: "m1", kind: "bot", name: "执舵", targetKind: "expert", targetKey: "a", targetProfession: "增长总监" },
      { id: "m2", kind: "bot", name: "星篆小队", targetKind: "team", targetKey: "t1" },
      { id: "m3", kind: "bot", name: "没绑定" },
    ],
  };
  const catalog = [
    { kind: "expert", key: "lead1", name: "承枢", profession: "交付总监", teamId: "t1" },
    { kind: "member", key: "k1", name: "甲", profession: "前端", teamId: "t1" },
    { kind: "member", key: "k2", name: "乙", profession: "后端", teamId: "t1" },
    { kind: "member", key: "k2", name: "乙", profession: "后端", teamId: "t1" },
  ];
  const sections = mentionSectionsOf(group, catalog);
  assert.deepEqual(sections.map((s) => s.key), ["bot", "team", "kid"]);
  assert.deepEqual(sections[0].items.map((i) => i.name), ["执舵", "没绑定"]);
  /* ⛔⛔ 11-08 用户令「专家团的主代理人还是显示他名字吧，显示软件开发专家团看着别扭」：
     团这一行显示出面说话的**主理人名**（承枢），团名退到 hint 里交代范围。
     ⛔ 上一轮「正文多一个 @团名」的真根因是正文被注入 @名字（已删），与显示名无关。 */
  assert.equal(sections[1].items[0].name, "承枢", "团这一行出的是主理人名（群里出面说话的人）");
  assert.match(sections[1].items[0].hint, /叫整团（星篆小队）/, "hint 说清点它 = 叫整团，并交代团名");
  assert.equal(sections[1].items[0].selectId, "m2", "selectId 仍指向整团（显示人名不改变派活范围）");
  assert.equal(sections[1].items[0].avatar.targetKind, "expert", "头像种子换成主理人（否则画成团徽）");
  assert.equal(sections[2].items.length, 2, "同名成员按 key 去重");
  assert.equal(sections[2].items[0].selectId, "team:t1:k1",
    "⛔ 点团成员 = 派给这位成员本人（合成 id），不再落到团那一行（用户：「每个成员都可以艾特」）");
  assert.equal(sections[0].items[1].unbound, true);
  assert.equal(flattenMentionSections(sections).length, 5);
});

test("分类：没有可 @ 的伙伴 ⇒ 空数组（面板不画空标题）", () => {
  assert.deepEqual(mentionSectionsOf({ members: [{ id: "me", kind: "human", name: "我" }] }, []), []);
  assert.deepEqual(mentionSectionsOf({}, []), []);
});

test("回归：长中文里艾特不再吃掉整段正文（11-07 真机「输入很多内容再艾特，内容没了」）", () => {
  const long = "这是一段很长的中文内容没有任何空格后面还有很多字";
  const src = `@${long}`;
  const t = mentionTriggerOf(src, 1);
  /* ⛔ 旧实现从 @ 一路吃到空白 ⇒ 整段中文被当成查询词，替换完只剩 "@呈象 " */
  assert.equal(applyMention(src, t, "呈象").text, `@呈象 ${long}`);

  const mid = "请先 @看一下这段方案再给结论";
  const t2 = mentionTriggerOf(mid, 4);
  assert.equal(applyMention(mid, t2, "呈象").text, "请先 @呈象 看一下这段方案再给结论");
});

test("回归：没有 caret 的老调用仍按扫描兜底", () => {
  assert.equal(applyMention("请 @洞 看一下", { start: 2 }, "洞明").text, "请 @洞明 看一下");
});

/* ── 11-08：@ 的唯一真相源改成正文（框上不再有 chip 行） ── */
import { mentionTargetsInText, removeMentionsFromText } from "../src/lib/team-mention.mjs";

test("正文反查 @ 目标：长名优先 / 去重 / 按出现顺序", () => {
  const cands = [
    { selectId: "a", name: "阿团" },
    { selectId: "b", name: "阿团子" },
    { selectId: "c", name: "构梁" },
  ];
  assert.deepEqual(mentionTargetsInText("你好 @构梁 和 @阿团子", cands), ["c", "b"]);
  assert.deepEqual(mentionTargetsInText("@阿团子@构梁", cands), ["b", "c"]);
  assert.deepEqual(mentionTargetsInText("@阿团", cands), ["a"]);
  assert.deepEqual(mentionTargetsInText("没有提及", cands), []);
});

test("摘除提及：不劈更长名字、收掉多余空白", () => {
  assert.equal(removeMentionsFromText("你好 @阿团子 在吗", ["阿团"]), "你好 @阿团子 在吗");
  assert.equal(removeMentionsFromText("你好 @阿团子 在吗", ["阿团子"]), "你好 在吗");
  assert.equal(removeMentionsFromText("@构梁 哈喽", ["构梁"]), "哈喽");
});

test("正文分段：提及段带标记、普通段原样，长名优先不重叠", () => {
  const names = ["阿团", "阿团子", "承枢"];
  const segs = mentionSegments("你好 @阿团子 和 @承枢 在吗", names);
  const joined = segs.map((s) => s.text).join("");
  assert.equal(joined, "你好 @阿团子 和 @承枢 在吗");
  assert.deepEqual(segs.filter((s) => s.mention).map((s) => s.text), ["@阿团子", "@承枢"]);
  assert.deepEqual(mentionSegments("没有提及", names), [{ text: "没有提及" }]);
});

test("专家库：没入群的单专家 / 其他团主理人列出；团已在群、已加过的专家不重复", () => {
  const group = {
    members: [
      { id: "me", kind: "human", name: "我" },
      { id: "m2", kind: "bot", name: "星篆小队", targetKind: "team", targetKey: "t1" },
    ],
  };
  const catalog = [
    { kind: "expert", key: "lead1", name: "承枢", teamId: "t1" },
    { kind: "expert", key: "solo1", name: "呈象", teamId: "solo1" },
    { kind: "expert", key: "lead2", name: "执舵", teamId: "t2" },
    { kind: "member", key: "k1", name: "甲", teamId: "t2" },
  ];
  const lib = mentionSectionsOf(group, catalog).find((s) => s.key === "library");
  assert.deepEqual(lib.items.map((i) => i.name), ["呈象", "执舵"]);
  assert.ok(lib.items.every((i) => i.library === true && i.selectId));
});
