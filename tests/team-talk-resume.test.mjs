import test from "node:test";
import assert from "node:assert/strict";
import { classifyTalkResumeFailure } from "../src/lib/team-talk-resume.mjs";

/** 11-08 实测（引擎二进制里的原话）：
 *  成员正在跑时 resume 会报 `cannot resume running thread` —— 旧代码把它当"会话没了"，
 *  于是新建一条 + 覆盖台账 ⇒ 同一位成员两条会话（用户报的重复会话）。 */
test("会话正在运行 ⇒ busy（⛔ 不能新建会话）", () => {
  assert.equal(classifyTalkResumeFailure("cannot resume running thread 01a1b998-fff1"), "busy");
  assert.equal(classifyTalkResumeFailure("Error: thread/resume failed: cannot resume running thread"), "busy");
  assert.equal(classifyTalkResumeFailure("cannot resume a running thread"), "busy");
  assert.equal(classifyTalkResumeFailure("is already running with a different rollout path"), "busy");
});

test("引擎明确说会话不在 ⇒ missing（可重建）", () => {
  assert.equal(classifyTalkResumeFailure("thread not found: 01a1b98d-e73e"), "missing");
  assert.equal(classifyTalkResumeFailure("rollout path missing for thread 01a1"), "missing");
});

test("引擎重启 / 超时 / 未知错误 ⇒ transient（⛔ 也别重建）", () => {
  assert.equal(classifyTalkResumeFailure("Codex app-server restarted"), "transient");
  assert.equal(classifyTalkResumeFailure("failed to load thread history: database is locked"), "transient");
  assert.equal(classifyTalkResumeFailure("CDP Runtime.evaluate 超时"), "transient");
  assert.equal(classifyTalkResumeFailure(""), "transient");
  assert.equal(classifyTalkResumeFailure(undefined), "transient");
});
