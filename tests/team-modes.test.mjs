import test from "node:test";
import assert from "node:assert/strict";
import { addModeStateOf } from "../src/lib/team-models.mjs";

const expert = (id) => ({ id, kind: "bot", name: id, targetKind: "expert", targetKey: `e-${id}` });
const team = (id) => ({ id, kind: "bot", name: id, targetKind: "team", targetKey: `t-${id}` });
const cli = (id) => ({ id, kind: "bot", name: id, targetKind: "cli", targetKey: `c-${id}` });

test("空群：三种模式都允许，专家团可加", () => {
  for (const mode of ["expert", "team", "custom"]) {
    assert.deepEqual(addModeStateOf([], mode), { blocked: false, reason: "" }, mode);
  }
});

test("正向：已有自定义伙伴 ⇒ 专家团被拦，且给出可操作原因", () => {
  const r = addModeStateOf([expert("执舵"), cli("本机")], "team");
  assert.equal(r.blocked, true);
  assert.match(r.reason, /纯新群|先移除|新建/);
});

test("反向：已有专家团 ⇒ 专家模式 / 自定义模式都被拦", () => {
  for (const mode of ["expert", "custom"]) {
    const r = addModeStateOf([team("软件开发专家团")], mode);
    assert.equal(r.blocked, true, mode);
    assert.match(r.reason, /专家团/);
  }
});

test("已有团再加团也拦（纯新群才加团）", () => {
  assert.equal(addModeStateOf([team("A")], "team").blocked, true);
});

test("空群加普通专家后，专家/自定义模式仍可用；移除后专家团自动恢复", () => {
  const partners = [expert("执舵")];
  assert.equal(addModeStateOf(partners, "expert").blocked, false);
  assert.equal(addModeStateOf(partners, "custom").blocked, false);
  assert.equal(addModeStateOf([], "team").blocked, false);
});

test("坏数据不抛：非数组 / 空对象成员一律按空群或忽略处理", () => {
  assert.equal(addModeStateOf(null, "team").blocked, false);
  assert.equal(addModeStateOf([null, {}, 3], "team").blocked, true);
  assert.equal(addModeStateOf(undefined, "custom").blocked, false);
});
