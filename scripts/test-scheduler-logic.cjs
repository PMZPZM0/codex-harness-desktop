// 调度引擎核心逻辑回归测试：验证 harness-services.ts 移植的 WorkBuddy 调度算法
// 运行：先 tsc 编译 electron，再 node scripts/test-scheduler-logic.cjs
const { parseRRule, buildRRuleFromInput, computeNextRunAt, applyJitter, removeJitter } = require("../dist-electron/harness-services.js");

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
function pad(n) { return String(n).padStart(2, "0"); }
function fmt(ms) { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
function mk(over = {}) {
  return { id: "test-1", name: "t", prompt: "p", workspace: "D:/w", intervalMinutes: 60, enabled: true, nextRunAt: null, kind: "interval", effort: "high", createdAt: Date.now(), ...over };
}

console.log("== RRULE 解析 ==");
check("DAILY 默认补 FULL_WEEK", parseRRule("FREQ=DAILY;BYHOUR=9;BYMINUTE=30").freq === "DAILY");
check("WEEKLY 缺 BYDAY 抛错", (() => { try { parseRRule("FREQ=WEEKLY;BYHOUR=9"); return false; } catch { return true; } })());
check("WEEKLY BYDAY 排序", parseRRule("FREQ=WEEKLY;BYDAY=FR,MO;BYHOUR=9").byday.join(",") === "MO,FR");
check("MONTHLY 缺 BYMONTHDAY 抛错", (() => { try { parseRRule("FREQ=MONTHLY;BYHOUR=9"); return false; } catch { return true; } })());
check("YEARLY 解析", parseRRule("FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=25;BYHOUR=8").bymonth[0] === 12);

console.log("== buildRRuleFromInput ==");
check("interval 60→HOURLY 1", buildRRuleFromInput("interval", undefined, undefined, 60) === "FREQ=HOURLY;INTERVAL=1");
check("interval 150→HOURLY 3（向上取整）", buildRRuleFromInput("interval", undefined, undefined, 150) === "FREQ=HOURLY;INTERVAL=3");
check("daily", buildRRuleFromInput("daily", "21:05") === "FREQ=DAILY;BYHOUR=21;BYMINUTE=5");
check("weekly 每两周", buildRRuleFromInput("weekly", "09:00", [1, 3, 5], undefined, undefined, undefined, true) === "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;BYHOUR=9;BYMINUTE=0");
check("monthly", buildRRuleFromInput("monthly", "09:00", undefined, undefined, 15) === "FREQ=MONTHLY;BYMONTHDAY=15;BYHOUR=9;BYMINUTE=0");
check("yearly", buildRRuleFromInput("yearly", "08:00", undefined, undefined, 25, 12) === "FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=25;BYHOUR=8;BYMINUTE=0");

console.log("== computeNextRunAt 各频率（严格 > base） ==");
const base = new Date(2026, 7, 31, 10, 15, 0).getTime(); // 2026-08-31 10:15
// zz-neg-777 的 jitter 为负偏移（signed=-0.56），且 12:15 非高峰 → removeJitter 可精确恢复
const hourly = computeNextRunAt(mk({ rrule: "FREQ=HOURLY;INTERVAL=2", id: "zz-neg-777" }), base);
check("HOURLY INTERVAL=2 严格 > base", hourly !== null && hourly > base, fmt(hourly));
check("HOURLY 相位守恒（负偏移可精确反解，隔 2 小时）", hourly !== null && removeJitter(hourly, "zz-neg-777") - base === 2 * 3600_000);
const daily = computeNextRunAt(mk({ rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=30", id: "test-daily" }), base);
const dailyScheduled = startOfDay(base) + 86400_000 + (9 * 60 + 30) * 60000;
check("DAILY 09:30 在 base 之后", daily !== null && daily > base, fmt(daily));
check("DAILY 为次日 09:30（jitter 幅度 ±10 分钟内）", daily !== null && Math.abs(daily - dailyScheduled) <= 600_000, fmt(daily));
const weekly = computeNextRunAt(mk({ rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=9;BYMINUTE=0" }), base);
check("WEEKLY MO/WE/FR 命中周三", weekly !== null && [1, 3, 5].includes(new Date(weekly).getDay()), fmt(weekly));
const biweekly = computeNextRunAt(mk({ rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;BYHOUR=9;BYMINUTE=0" }), base);
check("WEEKLY INTERVAL=2 相位不漂移（相对锚点差为 14 的倍数天）", biweekly !== null && ((Math.floor((startOfDay(biweekly) - startOfDay(base)) / 86400_000)) % 14 === 0), fmt(biweekly));
const monthly = computeNextRunAt(mk({ rrule: "FREQ=MONTHLY;BYMONTHDAY=15;BYHOUR=9;BYMINUTE=0" }), base);
check("MONTHLY 15 日", monthly !== null && new Date(monthly).getDate() === 15, fmt(monthly));
const yearly = computeNextRunAt(mk({ rrule: "FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=25;BYHOUR=8;BYMINUTE=0" }), base);
check("YEARLY 12-25", yearly !== null && new Date(yearly).getMonth() === 11 && new Date(yearly).getDate() === 25, fmt(yearly));
const once = computeNextRunAt(mk({ scheduleType: "once", scheduledAt: "2026-09-01T09:00:00+08:00" }), base);
check("once 在 base 后返回计划时刻", once === Date.parse("2026-09-01T09:00:00+08:00"), fmt(once));
// WorkBuddy：computeOnceNextRunAt 不查 base，过期判定在 decide 层（once_window_expired）
const oncePast = computeNextRunAt(mk({ scheduleType: "once", scheduledAt: "2026-08-01T09:00:00+08:00" }), base);
check("once 已过 → computeNextRunAt 仍返回计划点（decide 层处理过期）", oncePast === Date.parse("2026-08-01T09:00:00+08:00"));

console.log("== validFrom / validUntil ==");
const inFuture = computeNextRunAt(mk({ rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0", validFrom: "2026-10-01T00:00:00+08:00" }), base);
check("validFrom 未来 → 从 validFrom 之后找", inFuture !== null && new Date(inFuture).getMonth() === 9, fmt(inFuture));
const expired = computeNextRunAt(mk({ rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0", validUntil: "2026-08-01T00:00:00+08:00" }), base);
check("validUntil 已过 → null", expired === null);

console.log("== jitter：确定性 + removeJitter 反解 ==");
const idA = "automation-abc123", idB = "automation-def456";
const sched = new Date(2026, 8, 2, 9, 0).getTime(); // 北京 09:00 早高峰
const jA1 = applyJitter(sched, idA, 86400_000);
const jA2 = applyJitter(sched, idA, 86400_000);
check("jitter 确定性（同 id 同时刻稳定）", jA1 === jA2);
check("jitter 幅度 <= 10 分钟", Math.abs(jA1 - sched) <= 600_000, `Δ=${Math.abs(jA1 - sched) / 1000}s`);
check("removeJitter 反解不误判 missed（负偏移）", removeJitter(jA1, idA) <= sched, `remove=${fmt(removeJitter(jA1, idA))}`);
const nonPeak = new Date(2026, 8, 2, 14, 0).getTime();
const jB = applyJitter(nonPeak, idB, 86400_000);
check("非高峰幅度 <= 5 分钟", Math.abs(jB - nonPeak) <= 300_000);

console.log("== advanceMissedNextRunAt 两阶段（通过 Scheduler 实例验证） ==");
const { Scheduler } = require("../dist-electron/harness-services.js");
const fs = require("fs"); const os = require("os"); const path = require("path");
const tmpFile = path.join(os.tmpdir(), `sched-test-${Date.now()}.json`);
const { EventEmitter } = require("events");
const dummyServer = new EventEmitter();
const scheduler = new Scheduler(tmpFile, dummyServer, async () => ({ model: "m", provider: "p", name: "n", baseUrl: "u" }), () => {});
(async () => {
  // 通过 save() 建任务后，把 nextRunAt 拨回 3 小时前（仍在 24h 窗口内）→ 应判定 missed 补跑
  const task = await scheduler.save({ name: "missed-test", prompt: "p", workspace: "D:/w", kind: "daily", timeOfDay: "09:00", enabled: true });
  const s = scheduler;
  // 用任意接口触碰私有方法做行为验证（白盒）
  const api = s;
  // decide: 未来 → skip
  const future = { ...task, nextRunAt: Date.now() + 3600_000, enabled: true };
  const d1 = api.decide(future, Date.now(), true);
  check("decide 未来 → skip", d1.action === "skip");
  // decide: 3 小时前（窗口内）→ run(missed)
  const missed = { ...task, nextRunAt: Date.now() - 3 * 3600_000, enabled: true, lastRunAt: undefined };
  const d2 = api.decide(missed, Date.now(), true);
  check("decide 3 小时前 → run(missed)", d2.action === "run" && d2.runKind === "missed", JSON.stringify(d2));
  // decide: 2 天前（超窗口）→ skip_missed
  const farMissed = { ...task, nextRunAt: Date.now() - 2 * 86400_000, enabled: true, lastRunAt: undefined };
  const d3 = api.decide(farMissed, Date.now(), true);
  check("decide 2 天前 → skip_missed", d3.action === "skip_missed", JSON.stringify(d3));
  // decide: lastRunAt >= nextRunAt → skip
  const ran = { ...task, nextRunAt: Date.now() - 1000, enabled: true, lastRunAt: Date.now() };
  const d4 = api.decide(ran, Date.now(), true);
  check("decide lastRunAt>=nextRunAt → skip", d4.action === "skip");
  // decide: 引擎未就绪 → wait
  const d5 = api.decide(missed, Date.now(), false);
  check("decide 引擎未就绪 → wait", d5.action === "wait");
  // decide: 熔断 5 次
  const broken = { ...task, nextRunAt: Date.now() - 3600_000, enabled: true, consecutiveInterruptCount: 5 };
  const d6 = api.decide(broken, Date.now(), true);
  check("decide 连续 5 次中断 → skip_missed(熔断)", d6.action === "skip_missed" && d6.reasonCode === "recovery_circuit_broken");
  // advanceMissedNextRunAt: 2 天前（超窗口）→ 跳到窗口内最新鲜的错过点（今天 09:xx），
  // 下一 tick 会把它当 missed 补跑；绝不停留在 24h 窗口外的陈旧点
  const adv = { ...task, id: "test-adv", rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0", nextRunAt: Date.now() - 2 * 86400_000 };
  api.advanceMissedNextRunAt(adv, Date.now());
  check("advanceMissed 2 天前 → 不落在窗口外陈旧点", adv.nextRunAt !== null && adv.nextRunAt >= Date.now() - 1440 * 60 * 1000, fmt(adv.nextRunAt));
  check("advanceMissed 2 天前 → 结果是一个真实计划点（去 jitter 后 09:00）", adv.nextRunAt !== null && new Date(removeJitter(adv.nextRunAt, "test-adv")).getHours() === 9 && new Date(removeJitter(adv.nextRunAt, "test-adv")).getMinutes() === 0, fmt(adv.nextRunAt));
  // decide: once 超窗 → expire(once_window_expired)
  const onceExpired = { ...task, scheduleType: "once", scheduledAt: "2026-08-01T09:00:00+08:00", nextRunAt: Date.now() - 2 * 86400_000, enabled: true };
  const d7 = api.decide(onceExpired, Date.now(), true);
  check("decide once 超 24h 窗口 → expire(once_window_expired)", d7.action === "expire" && d7.reasonCode === "once_window_expired", JSON.stringify(d7));
  // advanceMissedNextRunAt: 3 小时前（窗口内）→ 落到「最新鲜的错过点」（09:00 今天的点已过 → 明天的 09:00）
  const adv2 = { ...task, rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0", nextRunAt: Date.now() - 3 * 3600_000 };
  api.advanceMissedNextRunAt(adv2, Date.now());
  check("advanceMissed 3 小时前 → 未来计划点（窗口内无更近错过点）", adv2.nextRunAt !== null && adv2.nextRunAt > Date.now(), fmt(adv2.nextRunAt));
  // advanceNextRunAt: 完成时刻推进
  const advTask = { ...task, rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0", nextRunAt: Date.now() - 1000, lastRunAt: undefined };
  const finishedAt = Date.now();
  api.advanceNextRunAt(advTask, finishedAt);
  check("advanceNextRunAt(finishedAt) 严格 > finishedAt", advTask.nextRunAt !== null && advTask.nextRunAt > finishedAt, fmt(advTask.nextRunAt));
  // 迁移：旧 kind 字段任务 → rrule
  const legacy = { id: "x", name: "n", prompt: "p", workspace: "D:/w", intervalMinutes: 10080, enabled: true, nextRunAt: 0, kind: "weekly", timeOfDay: "16:00", weekdays: [5] };
  await scheduler.save(legacy);
  const migrated = (await scheduler.list()).find((t) => t.id === "x");
  check("旧 weekly 任务迁移出 rrule", migrated.rrule === "FREQ=WEEKLY;BYDAY=FR;BYHOUR=16;BYMINUTE=0", migrated.rrule);
  fs.rmSync(tmpFile, { force: true });
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

function startOfDay(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
