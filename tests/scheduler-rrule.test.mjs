import test from "node:test";
import assert from "node:assert/strict";

/* 说明：node --test 不能直接 import .ts —— 本套用**编译产物**（dist-electron/scheduler/*.js），
 * 与运行时同一份代码，属「行为级冒烟」。⛔ 若 dist 未构建，测试会失败并提示先 build（见下方 skip）。 */
const RRULE = "../dist-electron/scheduler/rrule.js";
const JITTER = "../dist-electron/scheduler/jitter.js";

let rruleMod = null;
let jitterMod = null;
try {
  rruleMod = await import(RRULE);
  jitterMod = await import(JITTER);
} catch {
  // 未构建时跳过（不伪装通过：给出明确 todo 理由）
}

test("RRULE：DAILY / WEEKLY / HOURLY / MONTHLY 解析", { skip: !rruleMod && "dist-electron 未构建" }, () => {
  const { parseRRule } = rruleMod;
  const daily = parseRRule("FREQ=DAILY;INTERVAL=2");
  assert.equal(daily.freq, "DAILY");
  assert.equal(daily.interval, 2);

  const weekly = parseRRule("FREQ=WEEKLY;BYDAY=MO,WE,FR");
  assert.equal(weekly.freq, "WEEKLY");
  assert.deepEqual(weekly.byday, ["MO", "WE", "FR"]);

  const hourly = parseRRule("FREQ=HOURLY;INTERVAL=3");
  assert.equal(hourly.freq, "HOURLY");
  assert.equal(hourly.intervalHours, 3);
});

test("RRULE：非法输入抛错（不静默降级）", { skip: !rruleMod && "dist-electron 未构建" }, () => {
  const { parseRRule } = rruleMod;
  // 实测：非法 FREQ 抛错；**空串是合法默认**（= DAILY 每天），不要当异常
  assert.throws(() => parseRRule("FREQ=NOPE"));
  assert.equal(parseRRule("").freq, "DAILY");
});

test("RRULE：构造后再解析，频率与间隔保持一致（往返）", { skip: !rruleMod && "dist-electron 未构建" }, () => {
  const { buildRRuleFromInput, parseRRule } = rruleMod;
  const built = buildRRuleFromInput("weekly", "09:30", [1, 3, 5]);
  const parsed = parseRRule(built);
  assert.equal(parsed.freq, "WEEKLY");
  assert.deepEqual(parsed.byday, ["MO", "WE", "FR"]);
});

test("jitter：同一 automationId 稳定、不同 id 打散", { skip: !jitterMod && "dist-electron 未构建" }, () => {
  const { applyJitter } = jitterMod;
  const base = Date.UTC(2026, 0, 5, 1, 0, 0); // 北京 09:00（峰时）
  const a1 = applyJitter(base, "task-a", 0);
  const a2 = applyJitter(base, "task-a", 0);
  assert.equal(a1, a2, "同 id 两次结果必须一致");

  const ids = ["a", "b", "c", "d", "e"];
  const outs = new Set(ids.map((id) => applyJitter(base, id, 0)));
  assert.ok(outs.size >= 3, `不同 id 应打散（实际 ${outs.size} 个不同值）`);
});

test("jitter：抖动幅度不超过配置窗口", { skip: !jitterMod && "dist-electron 未构建" }, () => {
  const { applyJitter } = jitterMod;
  const base = Date.UTC(2026, 0, 5, 1, 0, 0);
  for (const id of ["x1", "x2", "x3", "x4"]) {
    const delta = Math.abs(applyJitter(base, id, 0) - base);
    assert.ok(delta <= 600_000, `偏移 ${delta}ms 超出峰时窗口 600s`);
  }
});

test("jitter：removeJitter 对正偏移是恒等（不动基准）", { skip: !jitterMod && "dist-electron 未构建" }, () => {
  const { applyJitter, removeJitter } = jitterMod;
  const base = Date.UTC(2026, 0, 5, 1, 0, 0);
  for (const id of ["p1", "p2", "p3"]) {
    const jittered = applyJitter(base, id, 0);
    const back = removeJitter(jittered, id);
    if (jittered >= base) assert.equal(back, jittered, "正偏移应原样返回");
  }
});

test("常量：FULL_WEEK 与 INDEX_TO_DAY 的起点差异（周日 0 / 周一首）", { skip: !rruleMod && "dist-electron 未构建" }, () => {
  const { FULL_WEEK, INDEX_TO_DAY } = rruleMod;
  assert.equal(FULL_WEEK.length, 7);
  // ⛔ 两者起点不同：INDEX_TO_DAY 以周日 0 起，FULL_WEEK 以周一 MO 起（实测，别假设互逆）
  assert.equal(INDEX_TO_DAY[0], "SU");
  assert.equal(INDEX_TO_DAY[1], "MO");
  assert.equal(FULL_WEEK[0], "MO");
});
