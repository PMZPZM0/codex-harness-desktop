/**
 * 团队模式 · 菜单形态 + 群定时任务单测（11-06）
 * ⛔ 纯函数测试：不碰 IPC、不碰 React、⛔ 不调引擎（`nextRunAt` 由主进程的 scheduler 算，
 *    这里只验证"我们交给它的口径"和"我们显示给人看的口径"）。
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  MENU_PLACEMENTS,
  normalizeMenu,
  normalizeMenuPlacement,
} from "../src/lib/team-menu.mjs";
import { createGroup } from "../src/lib/team-models.mjs";
import {
  MAX_GROUP_SCHEDULES,
  MAX_SCHEDULE_PROMPT_CHARS,
  MAX_SCHEDULE_TARGETS,
  describeSchedule,
  formatNextRun,
  normalizeScheduleEntry,
  normalizeSchedules,
  removeSchedule,
  scheduleBlockers,
  toggleSchedule,
  upsertSchedule,
} from "../src/lib/team-schedule.mjs";

/* ── 菜单形态（飞书 INPUT_FIRST / FLOAT）─────────────────────────────────── */

test("菜单形态：只认 input/float，其他一律回 input", () => {
  assert.deepEqual([...MENU_PLACEMENTS], ["input", "float"]);
  assert.equal(normalizeMenuPlacement("float"), "float");
  assert.equal(normalizeMenuPlacement("input"), "input");
  assert.equal(normalizeMenuPlacement("FLOAT"), "input", "大小写不宽容：⛔ 别猜用户意思");
  assert.equal(normalizeMenuPlacement(""), "input");
  assert.equal(normalizeMenuPlacement(undefined), "input");
  assert.equal(normalizeMenuPlacement("悬浮"), "input");
});

test("建群：老数据缺 menuPlacement/schedules 时补默认值（⛔ 不能是 undefined）", () => {
  const g = createGroup({ id: "grp_1", name: "x", members: [{ id: "u", kind: "human", name: "我" }] });
  assert.equal(g.menuPlacement, "input");
  assert.deepEqual(g.schedules, []);
  const g2 = createGroup({ id: "grp_2", name: "y", members: [{ id: "u", kind: "human", name: "我" }], menuPlacement: "float" });
  assert.equal(g2.menuPlacement, "float");
  assert.ok(normalizeMenu(g.menu).length > 0, "菜单默认那套仍在（别被这次改动带走了）");
});

/* ── 定时任务归一化 ─────────────────────────────────────────────────────── */

test("定时任务：缺 id 或指令判无效；指令里的开发标记被清掉", () => {
  assert.equal(normalizeScheduleEntry({ prompt: "跑一下" }), null);
  assert.equal(normalizeScheduleEntry({ id: "s1" }), null);
  const e = normalizeScheduleEntry({ id: "s1", prompt: "⛔ 别编数\n汇总今天的销量" });
  assert.equal(e.prompt, "别编数\n汇总今天的销量");
  assert.equal(e.kind, "daily", "缺省每天（最不容易误伤的一种）");
  assert.equal(e.timeOfDay, "09:00");
  assert.equal(e.enabled, true);
  assert.equal(e.nextRunAt, null, "⛔ 不猜下次时刻：等主进程算");
});

test("定时任务：频率/时间/星期/一次性时刻的归一化与上限", () => {
  const weekly = normalizeScheduleEntry({ id: "s", prompt: "p", kind: "weekly", weekdays: [3, 1, 3, 9, -1], timeOfDay: "7:5" });
  assert.deepEqual(weekly.weekdays, [1, 3], "去重 + 排序 + 丢掉越界（⛔ 别把 9 当星期几）");
  assert.equal(weekly.timeOfDay, "07:05", "补零成 HH:mm");
  assert.equal(weekly.scheduleType, "recurring");

  const daily = normalizeScheduleEntry({ id: "d", prompt: "p", kind: "daily", weekdays: [2] });
  assert.deepEqual(daily.weekdays, [], "非 weekly 不保留星期（否则界面上会出现「每天·周二」这种矛盾）");

  const once = normalizeScheduleEntry({ id: "o", prompt: "p", kind: "once", scheduledAt: "2026-11-08T09:30" });
  assert.equal(once.scheduleType, "once");
  assert.equal(once.scheduledAt, "2026-11-08T09:30");

  const many = normalizeScheduleEntry({ id: "m", prompt: "p", memberIds: ["a", "b", "c", "d", "e", "a"] });
  assert.deepEqual(many.memberIds, ["a", "b", "c", "d"], `最多 ${MAX_SCHEDULE_TARGETS} 个目标`);

  const long = normalizeScheduleEntry({ id: "l", prompt: "字".repeat(MAX_SCHEDULE_PROMPT_CHARS + 50) });
  assert.equal(long.prompt.length, MAX_SCHEDULE_PROMPT_CHARS);
});

test("定时任务：列表去重 + 上限；增删改都返回新数组（⛔ 不就地改）", () => {
  const list = normalizeSchedules([
    { id: "a", prompt: "一" },
    { id: "a", prompt: "二" },
    { id: "b", prompt: "三" },
  ]);
  assert.deepEqual(list.map((x) => x.id), ["a", "b"], "同 id 只留第一条");

  const tooMany = normalizeSchedules(
    Array.from({ length: MAX_GROUP_SCHEDULES + 4 }, (_, i) => ({ id: `s${i}`, prompt: "p" })),
  );
  assert.equal(tooMany.length, MAX_GROUP_SCHEDULES);

  const base = [{ id: "a", prompt: "一", kind: "daily" }];
  const added = upsertSchedule(base, { id: "b", prompt: "二" }, 1000);
  assert.equal(added.length, 2);
  assert.equal(added[1].createdAt, 1000, "新条目用调用方给的 now");
  assert.equal(base.length, 1, "⛔ 不许就地改入参");

  const off = toggleSchedule(added, "b", false);
  assert.equal(off[1].enabled, false);
  assert.equal(removeSchedule(off, "b").length, 1);
});

test("改个名字不该把这一轮推掉（调度口径没变 ⇒ 沿用旧 nextRunAt）", () => {
  const old = normalizeScheduleEntry({ id: "a", prompt: "p", kind: "daily", timeOfDay: "09:00", nextRunAt: 123456, lastRunAt: 1000 });
  const renamed = upsertSchedule([old], { ...old, name: "改名了" }, 9999);
  assert.equal(renamed[0].nextRunAt, 123456, "⛔ 保存一次就把用户今天这一轮推掉 = 静默丢一次执行");
  assert.equal(renamed[0].lastRunAt, 1000, "上次跑过这件事不能失忆");
  const changed = upsertSchedule([old], { ...old, timeOfDay: "10:00" }, 9999);
  assert.equal(changed[0].nextRunAt, null, "口径变了 ⇒ 等主进程重算");
});

/* ── 派不出去的原因（与手动派活同一把闸）────────────────────────────────── */

const groupWith = (members) => createGroup({ id: "grp", name: "群", members, leadId: "u" });

test("定时任务：没选人 / 静音 / 未绑定 各给一句人话；专家团已可直接调度不再阻断", () => {
  const group = groupWith([
    { id: "u", kind: "human", name: "我" },
    { id: "p1", kind: "bot", name: "承枢", targetKind: "expert", targetKey: "e1" },
    { id: "p2", kind: "bot", name: "静音王", targetKind: "expert", targetKey: "e2", muted: true },
    { id: "p3", kind: "bot", name: "没绑定" },
    { id: "p4", kind: "bot", name: "团成员", targetKind: "member", targetKey: "m1" },
  ]);
  assert.deepEqual(scheduleBlockers(group, { memberIds: [] }), ["还没选派给谁"]);

  const muted = scheduleBlockers(group, { memberIds: ["p2"] });
  assert.match(muted.join(), /静音/);
  assert.match(scheduleBlockers(group, { memberIds: ["p3"] }).join(), /没绑定/);
  /* 11-06 用户令「专家团直接调度」：群聊界面直派已在执行端合并许可，
     定时任务体检不再把 team / member 当阻断项（改了会把可用的伙伴误判成派不出去）。 */
  assert.deepEqual(scheduleBlockers(group, { memberIds: ["p4"] }), [], "专家团成员现在可直接调度");
  assert.match(scheduleBlockers(group, { memberIds: ["p3", "p4"] }).join(), /没绑定/);

  assert.deepEqual(scheduleBlockers(group, { memberIds: ["p1"] }), [], "能派的就别报问题");
  assert.match(scheduleBlockers(group, { kind: "once", memberIds: ["p1"] }).join(), /时间/);
});

/* ── 人话描述 ──────────────────────────────────────────────────────────── */

test("描述频率：四种口径都说人话", () => {
  assert.equal(describeSchedule({ kind: "interval" }), "每小时");
  assert.equal(describeSchedule({ kind: "daily", timeOfDay: "09:00" }), "每天 09:00");
  assert.equal(describeSchedule({ kind: "weekly", weekdays: [1, 3], timeOfDay: "08:30" }), "每周一、周三 08:30");
  assert.equal(describeSchedule({ kind: "weekly", weekdays: [] }), "每周一 09:00", "空星期回落到周一（⛔ 不能是「每周」这种半句话）");
  assert.equal(describeSchedule({ kind: "once", scheduledAt: "2026-11-08T09:30" }), "一次性 · 11-08 09:30");
  assert.equal(describeSchedule({ kind: "once", scheduledAt: "" }), "一次性 · 时间未设");
});

test("下次运行：今天/明天/昨天/具体日期；没有时刻就是破折号（⛔ 不显示 NaN）", () => {
  const now = new Date(2026, 10, 6, 13, 0, 0).getTime();
  const at = (d, h, m) => new Date(2026, 10, d, h, m, 0).getTime();
  assert.equal(formatNextRun(at(6, 18, 5), now), "今天 18:05");
  assert.equal(formatNextRun(at(7, 9, 0), now), "明天 09:00");
  assert.equal(formatNextRun(at(5, 9, 0), now), "昨天 09:00");
  assert.equal(formatNextRun(at(20, 9, 0), now), "11-20 09:00");
  assert.equal(formatNextRun(null, now), "—");
  assert.equal(formatNextRun(0, now), "—");
  assert.equal(formatNextRun("乱写", now), "—");
});
