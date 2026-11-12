import test from "node:test";
import assert from "node:assert/strict";
import { talkPartnerIdentity } from "../src/lib/team-models.mjs";

/** 11-09 用户令（截图：「历史会话，不刷新一下，名字和头像同步群聊里面吗」）：
 *  外面那条伙伴会话要显示**群聊里那个人**的名字/头像，且随群成员表现走（不存快照）。 */

const group = {
  id: "g1",
  name: "cli 群",
  members: [
    { id: "tgt:cli:builtin-claude-code", kind: "bot", name: "Claude Code", targetKind: "cli", targetKey: "builtin-claude-code", avatar: "preset:avatar-07" },
    { id: "tgt:expert:x", kind: "bot", name: "新名字", targetKind: "expert", targetKey: "x", avatar: "" },
  ],
  avatars: { "team:t1:k1": "preset:avatar-03" },
};

test("成员改名后按群成员当前名字显示（⛔ 不用台账里的旧快照）", () => {
  const row = { memberId: "tgt:cli:builtin-claude-code", name: "旧名字" };
  const out = talkPartnerIdentity(row, group);
  assert.equal(out.name, "Claude Code");
  assert.equal(out.avatar, "preset:avatar-07");
  assert.equal(out.targetKind, "cli");
  assert.equal(out.targetKey, "builtin-claude-code");
  assert.equal(out.kind, "bot");
});

test("团成员（合成 id）不在 members 里 ⇒ 名字回落台账、头像取群级覆盖表", () => {
  const row = { memberId: "team:t1:k1", name: "团成员甲" };
  const out = talkPartnerIdentity(row, group);
  assert.equal(out.name, "团成员甲");
  assert.equal(out.avatar, "preset:avatar-03");
  assert.equal(out.targetKind, "member");
  assert.equal(out.targetKey, "k1");
});

test("群已删 / 读不到群档案 ⇒ 退回台账名字（不显示空名）", () => {
  const row = { memberId: "tgt:cli:builtin-claude-code", name: "Claude Code" };
  const out = talkPartnerIdentity(row, null);
  assert.equal(out.name, "Claude Code");
  assert.equal(out.avatar, "");
  assert.equal(out.kind, "bot");
});

test("成员头像为空串 ⇒ 交给 MemberAvatar 走默认图集（⛔ 不编造 preset）", () => {
  const row = { memberId: "tgt:expert:x", name: "旧" };
  const out = talkPartnerIdentity(row, group);
  assert.equal(out.name, "新名字");
  assert.equal(out.avatar, "");
});

/* ⛔⛔ 11-12 用户：「私聊界面的头像也没有同步」。主理人的合成 id 与团成员同形，
   只有调度目录能区分；私聊 seed 必须与群聊视图的 lead.key 完全一致。 */
const catalog = [
  { kind: "expert", key: "t1:lead1", memberId: "lead1", name: "文枢", teamId: "t1" },
  { kind: "member", key: "t1:m1", memberId: "m1", name: "衡纸", teamId: "t1" },
];
const teamGroup = {
  id: "g2",
  name: "内容生产组",
  members: [{ id: "slot", kind: "bot", name: "内容创作专家团", targetKind: "team", targetKey: "t1", avatar: "" }],
  avatars: {},
};

test("主理人私聊身份用目录 lead.key（不是合成 id 拆出来的裸 memberId）", () => {
  const out = talkPartnerIdentity({ memberId: "team:t1:lead1", name: "台账旧名" }, teamGroup, catalog);
  assert.equal(out.targetKind, "expert");
  assert.equal(out.targetKey, "t1:lead1");
  assert.equal(out.name, "文枢");
  assert.equal(out.avatar, "");
});

test("团成员不被误判成主理人（仍是裸 memberId）", () => {
  const out = talkPartnerIdentity({ memberId: "team:t1:m1", name: "衡纸" }, teamGroup, catalog);
  assert.equal(out.targetKind, "member");
  assert.equal(out.targetKey, "m1");
});

test("私聊认成员栏给主理人换过的脸（整团槽成员行）", () => {
  const changed = { ...teamGroup, members: [{ ...teamGroup.members[0], avatar: "preset:avatar-07" }] };
  const out = talkPartnerIdentity({ memberId: "team:t1:lead1", name: "x" }, changed, catalog);
  assert.equal(out.avatar, "preset:avatar-07");
});

test("私下换脸写进群级覆盖表（团槽 avatar 为空串）⇒ 私聊也要跟着变", () => {
  const changed = { ...teamGroup, avatars: { "team:t1:lead1": "preset:avatar-03" } };
  const out = talkPartnerIdentity({ memberId: "team:t1:lead1", name: "x" }, changed, catalog);
  assert.equal(out.avatar, "preset:avatar-03");
});

test("目录读不到时降级为旧口径（⛔ 不把团成员画成主理人）", () => {
  const out = talkPartnerIdentity({ memberId: "team:t1:lead1", name: "文枢" }, teamGroup);
  assert.equal(out.targetKind, "member");
  assert.equal(out.targetKey, "lead1");
});
