import test from "node:test";
import assert from "node:assert/strict";
import { textsAreNearDuplicate } from "../src/lib/team-models.mjs";

/** 11-08 用户实测（截图「成员消息为啥重复」+ rollout 实锤）：
 *  成员一回合里既调了 group_say（已发进群）、又写了最终回复 ⇒ 两条都落盘。
 *  宿主兜底判据：这一回合已通过工具说过话时，最终回复与工具那句高度重合就不再落盘。 */
test("group_say 与最终回复近乎同一句 ⇒ 判重（用户现场的两条原文）", () => {
  assert.equal(
    textsAreNearDuplicate(
      "问需，在。管数据分析这条线：接口口径、表结构、指标定义。",
      "问需已经报到过了：数据分析这条线，接口口径、表结构、指标定义归我。",
    ),
    true,
  );
  assert.equal(
    textsAreNearDuplicate(
      "问需，在。管数据分析这条线：接口口径、表结构、指标定义。",
      "问需，在。管数据分析这条线：接口口径、表结构、指标定义。",
    ),
    true,
  );
});

test("内容不同的两句不判重（别把正文吞掉）", () => {
  assert.equal(textsAreNearDuplicate("好的，收到", "价格一天 2~4 次、库存同一次请求带出来"), false);
  assert.equal(
    textsAreNearDuplicate("先给结论：价格一天 2~4 次、库存跟着价格同一次请求带出来", "两个表的字段定义已发群里：sku_master 13 个字段"),
    false,
  );
});

test("短句 acknowledging + 长文最终回复 ⇒ 不判重（⛔ 不能吞掉更详细的那条）", () => {
  assert.equal(
    textsAreNearDuplicate(
      "好的，我马上开始处理数据分析这条线。",
      "好的，我马上开始处理数据分析这条线。具体方案：①接口口径先和问需对齐，②表结构用 sku_master 13 个字段，③指标定义按日报粒度落到宽表，今天下班前给第一版。",
    ),
    false,
  );
});

test("空串 / 单字不判重", () => {
  assert.equal(textsAreNearDuplicate("", "abc"), false);
  assert.equal(textsAreNearDuplicate("abc", ""), false);
  assert.equal(textsAreNearDuplicate(undefined, "abc"), false);
});
