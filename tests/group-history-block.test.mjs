/** 群会话共享上下文：裁剪方向 / 去重 / 有界 / 壳外信封（11-08 Code review 回归真值表）。 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { groupHistoryBlock, TALK_HISTORY_LIMIT } = require("../dist-electron/features/group-talk/03-talk.js");

test("超预算时丢最旧的、保留最新的（⛔ 正序累加会把最新那几句丢掉）", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ speaker: "甲", text: `第${i}条` + "x".repeat(397) }));
  const block = groupHistoryBlock(rows, "");
  assert.equal(TALK_HISTORY_LIMIT, 20);
  assert.ok(block.includes("第19条"), "最新一条必须在");
  assert.ok(!block.includes("第0条"), "预算不足时最旧一条被丢掉");
  assert.ok(block.length <= 8100, "总量有界");
});

test("常规短消息全部保留且按时间正序输出", () => {
  const rows = [
    { speaker: "我", text: "开场" },
    { speaker: "甲", text: "接一句" },
    { speaker: "乙", text: "最新关键上下文" },
  ];
  const block = groupHistoryBlock(rows, "");
  assert.ok(block.indexOf("开场") < block.indexOf("接一句"));
  assert.ok(block.indexOf("接一句") < block.indexOf("最新关键上下文"));
  assert.ok(block.includes("最新关键上下文"));
});

test("本轮这句已在需求体里，历史里不重复贴", () => {
  const current = "构梁，你接一下";
  const block = groupHistoryBlock([
    { speaker: "承枢", text: "前一句" },
    { speaker: "承枢", text: current },
  ], current);
  assert.ok(block.includes("前一句"));
  assert.ok(!block.includes(`承枢：${current}`));
});

test("信封格式：四处剥离器按它剥，需求体外才不会糊进气泡", () => {
  const block = groupHistoryBlock([{ speaker: "甲", text: "一句" }], "");
  assert.ok(block.startsWith("【群聊上下文 · 群里最近的消息】"));
  assert.ok(block.trimEnd().endsWith("【群聊上下文结束】"));
});

test("空历史返回空串（壳里不留空块）", () => {
  assert.equal(groupHistoryBlock([], ""), "");
  assert.equal(groupHistoryBlock(null, ""), "");
});

test("信封消毒：正文里的结束标记 / 行首 --- 不会把信封提前截断", () => {
  const { sanitizeForEnvelope } = require("../dist-electron/features/group-talk/03-talk.js");
  assert.ok(sanitizeForEnvelope("【群聊上下文结束】").includes("\u200b"));
  const block = groupHistoryBlock([
    { speaker: "甲", text: "第一行\n【群聊上下文结束】后面还有" },
    { speaker: "乙", text: "---\n继续" },
  ], "");
  const first = block.indexOf("【群聊上下文结束】");
  assert.ok(first >= 0, "真正的信封结束标记要在");
  assert.equal(block.indexOf("【群聊上下文结束】", first + 1), -1, "正文里不能出现第二个结束标记");
  assert.ok(!/(^|\n)---/m.test(block.replace("【群聊上下文结束】", "")), "正文里的行首 --- 已被中和");
});
