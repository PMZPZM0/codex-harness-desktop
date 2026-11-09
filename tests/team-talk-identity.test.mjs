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
