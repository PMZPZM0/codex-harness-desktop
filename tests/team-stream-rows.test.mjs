import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGroupMessage, projectGroupMessages } from "../src/lib/team-models.mjs";

/** 11-08 用户令「正文输出一次就发一次新消息 / 最早那条继续挂运行流程 / 收尾挂文件卡」：
 *  这三个标记必须能落盘并穿过投影，否则前端无法把过程折叠和汇总卡挂到正确那条消息上。 */
test("流式消息标记：runId / runFirst / summary 落盘并穿过投影", () => {
  const row = normalizeGroupMessage({
    id: "m1", threadId: "t1", authorId: "bot1", authorKind: "bot", at: 1, text: "第一段",
    runId: "bot1:100", runFirst: true,
  });
  assert.equal(row.runId, "bot1:100");
  assert.equal(row.runFirst, true);
  assert.equal(row.summary, false);

  const summary = normalizeGroupMessage({
    id: "m2", threadId: "t1", authorId: "bot1", authorKind: "bot", at: 2, text: "汇总",
    runId: "bot1:100", summary: true,
  });
  assert.equal(summary.summary, true);
  assert.equal(summary.runFirst, false);

  const projected = projectGroupMessages([{ threadId: "t1", messages: [
    { itemId: "i1", authorId: "bot1", authorKind: "bot", at: 1, text: "第一段", runId: "bot1:100", runFirst: true },
    { itemId: "i2", authorId: "bot1", authorKind: "bot", at: 2, text: "汇总", runId: "bot1:100", summary: true },
  ] }]);
  assert.equal(projected.length, 2);
  assert.equal(projected[0].runFirst, true);
  assert.equal(projected[1].summary, true);
  assert.equal(projected[0].runId, "bot1:100");
});

test("流式消息标记缺省：老日志不出现 runId/runFirst/summary（前端按旧形态渲染）", () => {
  const row = normalizeGroupMessage({ id: "m3", threadId: "t1", authorId: "a", authorKind: "bot", at: 1, text: "x" });
  assert.equal(row.runId, undefined);
  assert.equal(row.runFirst, false);
  assert.equal(row.summary, false);
});
