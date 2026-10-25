/**
 * 群编排状态机 —— 行为级不变量测试 + 随机压测（跑的是**编译产物**，与运行时同一份代码）
 *
 * ⛔ 为什么要有这套：这套东西的全部价值是「打回真的会换人、超限真的会停、锁住的真的不能派」。
 *    这些规则只要有一条被后来的重构改软了，用户在群里看到的就会是「假闭环」——而 22 号守卫只查
 *    源码里有没有那个字符串，查不出语义。这里用状态迁移把它顶住。
 * ⛔ 判据是**行为**不是实现：只调 state.ts 的公开 reducer，断言可观察结果。
 */
import test from "node:test";
import assert from "node:assert/strict";

const MOD = "../dist-electron/boss-groups/state.js";
let S = null;
try { S = await import(MOD); } catch { /* 未构建：下面全部 skip */ }

const skip = !S && "dist-electron 未构建（先 npm run build:electron）";

/** 造一个干净的群：3 个成员。 */
function freshGroup(policy = {}) {
  const state = S.emptyState();
  const group = S.createGroup(state, {
    name: "压测群",
    workspace: process.cwd(),
    bossThreadId: "boss-1",
    members: [
      { name: "甲", role: "前端" },
      { name: "乙", role: "后端" },
      { name: "丙", role: "测试" },
    ],
    policy,
  });
  return { state, group };
}
const ids = (group) => group.members.filter((m) => m.status !== "removed").map((m) => m.id);
const people = (group) => group.members.filter((m) => m.status !== "removed");

/* ── 单点规则 ─────────────────────────────────────────────────────────────── */
test("建群：成员上限与空名校验", { skip }, () => {
  const state = S.emptyState();
  assert.throws(() => S.createGroup(state, { name: "  ", workspace: "", bossThreadId: "b", members: [{ name: "a", role: "r" }] }), /群名不能为空/);
  assert.throws(() => S.createGroup(state, { name: "g", workspace: "", bossThreadId: "", members: [{ name: "a", role: "r" }] }), /缺少 boss 会话 id/);
  assert.throws(() => S.createGroup(state, { name: "g", workspace: "", bossThreadId: "b", members: [] }), /至少要有 1 个成员/);
  const seven = Array.from({ length: 7 }, (_, i) => ({ name: `m${i}`, role: "r" }));
  assert.throws(() => S.createGroup(state, { name: "g", workspace: "", bossThreadId: "b", members: seven }), /成员最多 6 个/);
});

test("建群：policy 传 undefined 字段不会把默认值冲成 NaN（打回上限不许失效）", { skip }, () => {
  const { group } = freshGroup({ maxRejects: undefined, budgetMinutes: undefined, stallMs: undefined });
  assert.equal(group.policy.maxRejects, 2);
  assert.equal(group.policy.budgetMinutes, 40);
  assert.equal(group.policy.stallMs, 90_000);
});

test("任务：没有验收标准一律拒绝（审查的唯一依据）", { skip }, () => {
  const { state, group } = freshGroup();
  assert.throws(() => S.addTask(state, { groupId: group.id, title: "t", brief: "", criteria: "  " }), /必须给验收标准/);
  assert.throws(() => S.addTask(state, { groupId: group.id, title: " ", brief: "", criteria: "c" }), /标题不能为空/);
});

test("派活 → 开跑 → 交活 → 通过：状态链与成员状态同步", { skip }, () => {
  const { state, group } = freshGroup();
  const [a] = people(group);
  const task = S.addTask(state, { groupId: group.id, title: "落地页", brief: "做个页", criteria: "能打开" });
  S.assignTask(state, task.id, a.id);
  assert.equal(task.status, "assigned");
  S.markRunning(state, task.id, { threadId: "th-1", turnId: "turn-1" });
  assert.equal(task.status, "running");
  assert.equal(group.members.find((m) => m.id === a.id).status, "busy");
  S.submitTask(state, task.id, "成品正文");
  assert.equal(task.status, "reviewing");
  assert.equal(group.members.find((m) => m.id === a.id).status, "reviewing");
  S.recordReview(state, task.id, { by: "boss", verdict: "approved", reasons: [] });
  assert.equal(task.status, "done");
  assert.equal(group.members.find((m) => m.id === a.id).status, "idle");
});

test("打回：必须给理由；给理由后作者被锁，换人才能重做", { skip }, () => {
  const { state, group } = freshGroup();
  const [a, b] = people(group);
  const task = S.addTask(state, { groupId: group.id, title: "接口", brief: "", criteria: "200" });
  S.assignTask(state, task.id, a.id);
  S.markRunning(state, task.id, { threadId: "th-1" });
  S.submitTask(state, task.id, "半成品");
  assert.throws(() => S.recordReview(state, task.id, { by: "boss", verdict: "rejected", reasons: ["  "] }), /打回必须给理由/);

  S.recordReview(state, task.id, { by: "boss", verdict: "rejected", reasons: ["没有错误处理"] });
  assert.equal(task.status, "rejected");
  assert.deepEqual(task.lockedAuthors, [a.id]);
  // ⛔ 作者锁的执法点：原作者再派必须抛错
  assert.throws(() => S.assignTask(state, task.id, a.id), /已被锁在这条任务上/);
  // 换人可以
  S.assignTask(state, task.id, b.id);
  assert.equal(task.status, "assigned");
});

test("打回超限 ⇒ 升级（不再无限重试）", { skip }, () => {
  const { state, group } = freshGroup({ maxRejects: 2 });
  const task = S.addTask(state, { groupId: group.id, title: "活", brief: "", criteria: "c" });
  const [a, b] = people(group);
  // 第一次打回（甲）
  S.assignTask(state, task.id, a.id); S.markRunning(state, task.id, { threadId: "t1" });
  S.submitTask(state, task.id, "v1"); S.recordReview(state, task.id, { by: "boss", verdict: "rejected", reasons: ["r1"] });
  assert.equal(task.status, "rejected");
  // 第二次打回（乙）⇒ 达到上限 2 ⇒ escalated
  S.assignTask(state, task.id, b.id); S.markRunning(state, task.id, { threadId: "t2" });
  S.submitTask(state, task.id, "v2"); S.recordReview(state, task.id, { by: "boss", verdict: "rejected", reasons: ["r2"] });
  assert.equal(task.status, "escalated");
  assert.ok(task.escalation && task.escalation.reasons.length === 1);
  assert.equal(task.rejects, 2);
});

test("全员被锁 ⇒ 无人可派也必须升级（⛔ 不许静默放行）", { skip }, () => {
  const { state, group } = freshGroup();
  const task = S.addTask(state, { groupId: group.id, title: "活", brief: "", criteria: "c" });
  for (const m of people(group)) {
    S.assignTask(state, task.id, m.id);
    S.markRunning(state, task.id, { threadId: `t-${m.id}` });
    S.submitTask(state, task.id, "v");
    S.recordReview(state, task.id, { by: "boss", verdict: "rejected", reasons: ["不行"] });
    if (task.status === "escalated") break;
  }
  assert.equal(task.status, "escalated");
  // 全员要么被这条任务锁过，要么根本没参与过 —— 但不许"还没锁就升级"以外的含糊状态
  assert.ok(task.lockedAuthors.length >= 2, `升级时被锁作者应该有多个，实际 ${task.lockedAuthors.length}`);
});

test("移出成员：不再接新活；正在跑的任务不打断但之后必须换人", { skip }, () => {
  const { state, group } = freshGroup();
  const [a, b] = people(group);
  const task = S.addTask(state, { groupId: group.id, title: "活", brief: "", criteria: "c" });
  S.assignTask(state, task.id, a.id);
  S.markRunning(state, task.id, { threadId: "t1" });
  S.removeMember(state, group.id, a.id);
  assert.equal(group.members.find((m) => m.id === a.id).status, "removed");
  // 移出后新任务不许派给他
  const t2 = S.addTask(state, { groupId: group.id, title: "活2", brief: "", criteria: "c" });
  assert.throws(() => S.assignTask(state, t2.id, a.id), /已移出群/);
  // 正在跑的那条：交活后打回，必须换到乙
  S.submitTask(state, task.id, "v");
  S.recordReview(state, task.id, { by: "boss", verdict: "rejected", reasons: ["不行"] });
  assert.equal(task.status, "rejected");
  const next = S.pickReassignee(state, task);
  assert.equal(next?.id, b.id);
});

test("升级处理：relax 必须带新标准；retry 清锁且计数归零", { skip }, () => {
  const { state, group } = freshGroup({ maxRejects: 1 });
  const task = S.addTask(state, { groupId: group.id, title: "活", brief: "", criteria: "旧标准" });
  const [a] = people(group);
  S.assignTask(state, task.id, a.id); S.markRunning(state, task.id, { threadId: "t" });
  S.submitTask(state, task.id, "v"); S.recordReview(state, task.id, { by: "boss", verdict: "rejected", reasons: ["r"] });
  assert.equal(task.status, "escalated");
  assert.throws(() => S.resolveEscalation(state, task.id, "relax-criteria", "  "), /放宽标准必须给出/);
  S.resolveEscalation(state, task.id, "relax-criteria", "新标准（允许占位）");
  assert.equal(task.criteria, "新标准（允许占位）");
  assert.equal(task.status, "queued");
  assert.equal(task.rejects, 0);
  assert.deepEqual(task.lockedAuthors, []);
  assert.equal(group.members.find((m) => m.id === a.id).status, "idle");
});

test("预算：过 100% ⇒ 全群暂停，且此后再派活直接拒绝", { skip }, () => {
  const { state, group } = freshGroup({ budgetMinutes: 1 });
  const later = group.createdAt + 61_000;
  const b = S.checkBudget(state, group.id, later);
  assert.equal(b.warn, "100");
  assert.equal(group.paused, true);
  const task = S.addTask(state, { groupId: group.id, title: "活", brief: "", criteria: "c" });
  assert.throws(() => S.assignTask(state, task.id, ids(group)[0]), /已暂停/);
});

test("评审解析：非 JSON 一律打回，绝不默认通过", { skip }, () => {
  assert.deepEqual(S.parseVerdict("我觉得还行"), { verdict: "rejected", reasons: ["评审输出不是可解析的 JSON 结论，无法判定通过"] });
  assert.deepEqual(S.parseVerdict('前面废话 {"pass": true} 后面废话'), { verdict: "approved", reasons: [] });
  const rejected = S.parseVerdict('{"pass": false, "reasons": ["缺错误处理", " "] }');
  assert.equal(rejected.verdict, "rejected");
  assert.deepEqual(rejected.reasons, ["缺错误处理"]);
  const empty = S.parseVerdict('{"pass": false}');
  assert.equal(empty.verdict, "rejected");
  assert.ok(empty.reasons.length > 0);
});

test("事件流：超过上限只保留最近 MAX_EVENTS 条", { skip }, () => {
  const { state, group } = freshGroup();
  for (let i = 0; i < 700; i++) S.pushEvent(state, { groupId: group.id, kind: "note", text: `n${i}` });
  assert.equal(state.events.length, 600);
  assert.equal(state.events.at(-1).text, "n699");
});

test("CLI 成员：缺命令模板必须当场拒绝（不许建一个跑不起来的成员）", { skip }, () => {
  const { state, group } = freshGroup();
  assert.throws(() => S.addMember(state, group.id, { name: "cli", role: "r", source: "cli", cliCommand: "  " }), /必须有命令模板/);
  const ok = S.addMember(state, group.id, { name: "cli2", role: "r", source: "cli", cliCommand: 'node -e "1"' });
  assert.equal(ok.source, "cli");
  assert.equal(ok.cliCommand, 'node -e "1"');
});

/* ── ⛔ 期望的不变量（发现的缺陷会在这里现形）────────────────────────────── */
test("[不变量] 同一成员不许同时「在跑」两条任务（并发唯一性）", { skip }, () => {
  const { state, group } = freshGroup();
  const [a] = people(group);
  const t1 = S.addTask(state, { groupId: group.id, title: "活1", brief: "", criteria: "c" });
  const t2 = S.addTask(state, { groupId: group.id, title: "活2", brief: "", criteria: "c" });
  S.assignTask(state, t1.id, a.id);
  S.markRunning(state, t1.id, { threadId: "th-1" });
  // 同一个成员再派第二条：必须拒绝（他的常驻线程只有一条，两条提示词会互相污染）
  assert.throws(() => S.assignTask(state, t2.id, a.id), /一次只能派一条活/);
  assert.equal([t1, t2].filter((t) => t.status === "running").length, 1);
  // 他这条做完（交活 → 通过）之后必须能再接活
  S.submitTask(state, t1.id, "成品");
  S.recordReview(state, t1.id, { by: "boss", verdict: "approved", reasons: [] });
  S.assignTask(state, t2.id, a.id);
  assert.equal(t2.assignee, a.id);
});

test("[不变量] 迟到回调不许把任务从终态拉回 running（markRunning 状态闸）", { skip }, () => {
  const { state, group } = freshGroup({ maxRejects: 1 });
  const [a] = people(group);
  const t = S.addTask(state, { groupId: group.id, title: "活", brief: "", criteria: "c" });
  S.assignTask(state, t.id, a.id);
  S.markRunning(state, t.id, { threadId: "th" });
  S.submitTask(state, t.id, "v");
  S.recordReview(state, t.id, { by: "boss", verdict: "rejected", reasons: ["理由"] });  // maxRejects=1 ⇒ escalated
  assert.equal(t.status, "escalated");
  // 打回/升级之后来一个迟到的"开跑"回调：不许复活，更不许复用被锁作者的旧 attempt
  assert.throws(() => S.markRunning(state, t.id, { threadId: "late" }), /不能标 running/);
  assert.equal(t.status, "escalated");
  assert.ok(t.lockedAuthors.includes(a.id));
});

test("[不变量] 同一 attempt 不许重复交活（重复回调会重复进群、重复触发评审）", { skip }, () => {
  const { state, group } = freshGroup();
  const [a] = people(group);
  const t = S.addTask(state, { groupId: group.id, title: "活", brief: "", criteria: "c" });
  S.assignTask(state, t.id, a.id);
  S.markRunning(state, t.id, { threadId: "th" });
  S.submitTask(state, t.id, "v1");
  assert.throws(() => S.submitTask(state, t.id, "v2"), /不在可交活阶段/, "reviewing 状态还能被第二次交活覆盖 ⇒ 群里会出现两份成品");
});

test("[不变量] 建群时同名成员 id 不许撞车", { skip }, () => {
  const state = S.emptyState();
  const group = S.createGroup(state, {
    name: "g", workspace: "", bossThreadId: "b",
    members: [{ name: "张三", role: "a" }, { name: "张三", role: "b" }],
  });
  const unique = new Set(group.members.map((m) => m.id));
  assert.equal(unique.size, 2, `同名成员的 id 撞了：${group.members.map((m) => m.id).join(" / ")} ⇒ memberOf 永远只能找到第一个`);
});

/* ── 随机压测：随机合法/非法操作，跑完对全局状态做体检 ─────────────────────── */
test("[压测] 2000 次随机操作后状态仍然自洽", { skip }, () => {
  const { state, group } = freshGroup({ maxRejects: 2, budgetMinutes: 10_000 });
  const memberIds = group.members.map((m) => m.id);
  const rnd = (n) => Math.floor(Math.random() * n);
  const pick = (arr) => arr[rnd(arr.length)];
  const tasks = [];
  const errors = [];
  const t0 = Date.now();

  for (let i = 0; i < 2000; i++) {
    const roll = rnd(100);
    try {
      if (roll < 22 || !tasks.length) {
        tasks.push(S.addTask(state, { groupId: group.id, title: `t${i}`, brief: "", criteria: `c${i}` }));
      } else {
        const task = pick(tasks);
        if (roll < 45) S.assignTask(state, task.id, pick(memberIds));
        else if (roll < 62) S.markRunning(state, task.id, { threadId: `th${i}` });
        else if (roll < 78) S.submitTask(state, task.id, `out-${i}`);
        else if (roll < 92) S.recordReview(state, task.id, { by: "boss", verdict: rnd(2) ? "rejected" : "approved", reasons: ["r"] });
        else if (roll < 97) S.resolveEscalation(state, task.id, pick(["retry-with-other-model", "relax-criteria", "user-takeover"]), "note");
        else S.removeMember(state, group.id, pick(memberIds));
      }
    } catch (error) {
      errors.push(String(error?.message ?? error));
    }
  }
  const cost = Date.now() - t0;

  /* 体检：状态自洽性（不看"该不该"，只看"有没有自相矛盾"） */
  for (const task of Object.values(state.tasks)) {
    // 1) 状态必须在枚举里
    assert.ok(["queued", "assigned", "running", "submitted", "reviewing", "approved", "rejected", "escalated", "done", "failed"].includes(task.status), `非法状态 ${task.status}`);
    // 2) 锁名单里的人必须真实存在
    for (const id of task.lockedAuthors) assert.ok(memberIds.includes(id), `锁名单里有不存在的成员 ${id}`);
    // 3) attempt 序号必须从 1 连续递增
    task.attempts.forEach((a, idx) => assert.equal(a.n, idx + 1, `attempt 序号断裂：${JSON.stringify(task.attempts.map((x) => x.n))}`));
    // 4) escalated 必须带 escalation 记录
    if (task.status === "escalated") assert.ok(task.escalation, "escalated 却没有 escalation 记录 ⇒ 用户看不到选项");
    // 5) done 必须有结束时间
    if (task.status === "done") assert.ok(task.endedAt, "done 却没有 endedAt");
    // 6) running 的 assignee 不许在锁名单里
    if (task.status === "running") assert.ok(!task.lockedAuthors.includes(task.assignee), "running 的任务派给了被锁作者");
  }
  // 7) 事件上限
  assert.ok(state.events.length <= 600, "事件流没按上限裁剪");
  // 8) 同一成员并发的 running 任务数（记录，不 fail，已由专项用例盯）
  const runningPerMember = new Map();
  for (const task of Object.values(state.tasks)) {
    if (task.status !== "running") continue;
    runningPerMember.set(task.assignee, (runningPerMember.get(task.assignee) ?? 0) + 1);
  }
  const maxParallel = Math.max(0, ...runningPerMember.values());
  console.log(`[压测] 2000 次操作 / ${Object.keys(state.tasks).length} 条任务 / ${errors.length} 次被规则拒绝 / ${cost}ms / 单成员最大并发 running=${maxParallel}`);
  assert.ok(maxParallel <= 1, `压测里出现单成员并发 running=${maxParallel}（>1 说明缺并发闸）`);
});
