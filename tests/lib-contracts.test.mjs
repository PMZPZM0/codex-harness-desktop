import test from "node:test";
import assert from "node:assert/strict";
import { extractVoiceScript, stripVoiceScript, isVoiceFence, VOICE_FENCE_LANG } from "../src/lib/voice-script.mjs";

/* 覆盖点在「契约边界」：围栏识别 / 摘取 / 去围栏 / 上限，都是纯函数。 */

test("voice 围栏：只认 ```voice（含大小写与短围栏）", () => {
  assert.equal(isVoiceFence("```voice"), true);
  assert.equal(isVoiceFence("```VOICE"), true);
  assert.equal(isVoiceFence("```js"), false);
  assert.equal(VOICE_FENCE_LANG, "voice");
});

test("voice 摘取：拿到播报稿，正文原样保留", () => {
  const raw = "正文第一段。\n\n```voice\n这是一句播报。\n```\n";
  const script = extractVoiceScript(raw);
  assert.equal(script.present, true);
  assert.match(script.text, /这是一句播报/);
  const body = stripVoiceScript(raw);
  assert.match(body, /正文第一段/);
  assert.ok(!String(body).includes("```voice"));
});

test("voice：没有围栏时摘取为空、去围栏不改变原文", () => {
  const raw = "只有正文。";
  const none = extractVoiceScript(raw);
  assert.equal(none.present, false);
  assert.equal(none.text, "");
  assert.equal(stripVoiceScript(raw), raw);
});

/* 任务清单展示口径（10-22 用户截图「任务清单重复渲染」）：
   同一条 task_add 被两路写入 ⇒ 同一句话在数组里出现两次；胶囊曾显示「步骤 0/10」而磁盘只有 5 条。 */
import { mergeTaskSteps } from "../src/lib/task-steps.mjs";

test("task-steps：同一句话只出现一次，顺序按首次创建", () => {
  const merged = mergeTaskSteps([
    { id: "b", text: "第1轮 A", status: "todo", createdAt: 2 },
    { id: "a", text: "第1轮 A", status: "todo", createdAt: 1 },
    { id: "c", text: "第2轮 B", status: "todo", createdAt: 3 },
  ]);
  assert.deepEqual(merged.map((s) => s.text), ["第1轮 A", "第2轮 B"]);
  assert.equal(merged[0].id, "a");           // 保留最早那条（createdAt=1）
  assert.equal(merged[0].createdAt, 1);
});

test("task-steps：重复项冲突时保留状态最靠后的（丢进度比重复更糟）", () => {
  const merged = mergeTaskSteps([
    { id: "x", text: "同一步", status: "todo", createdAt: 5 },
    { id: "y", text: "同一步", status: "done", createdAt: 6 },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].state, "done");
  assert.equal(merged[0].createdAt, 5);      // 位置仍按首次创建
});

test("task-steps：脏数据不炸（null / 缺字段 / 未知状态）", () => {
  assert.deepEqual(mergeTaskSteps(null), []);
  const dirty = mergeTaskSteps([null, undefined]);
  assert.equal(dirty.length, 1);             // 两条脏数据文本都为空 ⇒ 归并成一条
  assert.equal(dirty[0].text, "");
  const unknown = mergeTaskSteps([{ text: "t", status: "weird", createdAt: 1 }]);
  assert.equal(unknown[0].state, "weird");
});
