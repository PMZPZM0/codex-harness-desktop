import test from "node:test";
import assert from "node:assert/strict";
import { renameMember } from "../src/lib/team-models.mjs";

/** 11-09 用户令：「群里的成员都加上支持改名字，联动会话改名 / 成员识别同步」。 */

const group = {
  id: "g1",
  name: "cli 群",
  leadId: "local-user",
  members: [
    { id: "local-user", kind: "human", name: "我" },
    { id: "tgt:cli:a", kind: "bot", name: "Claude Code", targetKind: "cli", targetKey: "a" },
    { id: "tgt:expert:b", kind: "bot", name: "生图专家", targetKind: "expert", targetKey: "b" },
  ],
};

test("改名只动目标成员，其它成员与身份字段保持不变", () => {
  const r = renameMember(group, "tgt:cli:a", " 小柯 ");
  assert.equal(r.ok, true);
  assert.equal(r.changed, true);
  const hit = r.group.members.find((m) => m.id === "tgt:cli:a");
  assert.equal(hit.name, "小柯");
  assert.equal(hit.targetKind, "cli");
  assert.equal(hit.targetKey, "a");
  assert.equal(r.group.members.find((m) => m.id === "tgt:expert:b").name, "生图专家");
});

test("空名拒绝（不写脏盘）", () => {
  const r = renameMember(group, "tgt:cli:a", "   ");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "empty");
  assert.equal(r.group.members.find((m) => m.id === "tgt:cli:a").name, "Claude Code");
});

test("重名拒绝（避免 @名字 解析歧义）", () => {
  const r = renameMember(group, "tgt:cli:a", "生图专家");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "duplicate");
  assert.equal(r.group.members.find((m) => m.id === "tgt:cli:a").name, "Claude Code");
});

test("改成同名 = 成功但 unchanged（不触发会话改名/广播）", () => {
  const r = renameMember(group, "tgt:cli:a", "Claude Code");
  assert.equal(r.ok, true);
  assert.equal(r.changed, false);
});

test("不存在的成员拒绝", () => {
  const r = renameMember(group, "tgt:cli:missing", "新名");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not_member");
});
