/** 群视图派生口径单测（11-07）：日期分隔（当前唯一已接线的派生） */
import test from "node:test";
import assert from "node:assert/strict";
import { dayKeyOf, dayLabelOf } from "../src/lib/team-view.mjs";

const NOW = new Date(2026, 10, 7, 12, 0, 0).getTime(); // 本地 2026-11-07 12:00
const YESTERDAY = new Date(2026, 10, 6, 9, 30, 0).getTime();
const OLD = new Date(2026, 9, 2, 18, 5, 0).getTime();

test("日期：今天 / 昨天 / 跨月与无效值", () => {
  assert.equal(dayKeyOf(NOW), "2026-11-07");
  assert.equal(dayLabelOf(NOW, NOW), "今天");
  assert.equal(dayLabelOf(YESTERDAY, NOW), "昨天");
  assert.equal(dayLabelOf(OLD, NOW), "2026 年 10 月 2 日");
  assert.equal(dayKeyOf(0), "");
  assert.equal(dayLabelOf(0, NOW), "");
});

test("日期 key 只按本地日历日判等（同一天不同时刻同 key，跨午夜就不同）", () => {
  const morning = new Date(2026, 10, 7, 0, 0, 1).getTime();
  const night = new Date(2026, 10, 7, 23, 59, 59).getTime();
  const prevNight = new Date(2026, 10, 6, 23, 59, 59).getTime();
  assert.equal(dayKeyOf(morning), dayKeyOf(night));
  assert.notEqual(dayKeyOf(prevNight), dayKeyOf(night));
});
