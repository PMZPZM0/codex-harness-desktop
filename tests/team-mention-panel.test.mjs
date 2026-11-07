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
  assert.equal(sections[1].items[0].name, "承枢", "团这一行出面上的是主理人");
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
