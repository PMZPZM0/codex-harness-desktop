/**
 * 11-06 用户：「没有运行状态停止按钮很烦，一直刷那个提醒」「模型也是死的，一点联动性都没有」。
 * 两个纯模块是 app-state ↔ harness-team 之间的桥，行为必须可独立验证（不依赖 Electron / DOM）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  markDelegateThread, unmarkDelegateThread, isDelegateThread,
  delegateThreadIds, delegateRunningCount, registerRateLimitCancel,
  cancelDelegateRetries, subscribeTeamRuntime, teamRuntimeSnapshot,
} from "../src/lib/team-runtime.mjs";
import { setActiveModel, getActiveModel, subscribeActiveModel } from "../src/lib/active-model.mjs";

/* 每个用例前把共享集合清空（模块是单例，测试之间会互相看见） */
function cleanThreads() {
  for (const id of delegateThreadIds()) unmarkDelegateThread(id);
}

test("调度会话登记：started 命中、finished 摘除，不影响别的 threadId", () => {
  cleanThreads();
  assert.equal(isDelegateThread("t-1"), false);
  markDelegateThread("t-1", "g-1");
  assert.equal(isDelegateThread("t-1"), true);
  assert.equal(isDelegateThread("t-2"), false);
  assert.equal(delegateRunningCount(), 1);
  unmarkDelegateThread("t-1");
  assert.equal(isDelegateThread("t-1"), false);
  assert.equal(delegateRunningCount(), 0);
});

test("按群取会话 id：只返回本群，空 groupId = 全部", () => {
  cleanThreads();
  markDelegateThread("a", "g-1");
  markDelegateThread("b", "g-2");
  markDelegateThread("c", "g-1");
  assert.deepEqual(delegateThreadIds("g-1").sort(), ["a", "c"]);
  assert.equal(delegateThreadIds().length, 3);
  cleanThreads();
});

test("停止 = 对每个登记会话 silent 取消重试链（⛔ 不许再弹「已停止限流重试」）", () => {
  cleanThreads();
  markDelegateThread("a", "g-1");
  markDelegateThread("b", "g-2");
  const calls = [];
  const off = registerRateLimitCancel((threadId, silent) => calls.push([threadId, silent]));
  assert.equal(cancelDelegateRetries("g-1"), 1);
  assert.deepEqual(calls, [["a", true]]);
  assert.equal(cancelDelegateRetries(), 2);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(([, silent]) => silent === true), "清理必须 silent，否则又是一条提醒");
  off();
  assert.doesNotThrow(() => cancelDelegateRetries());
  cleanThreads();
});

test("订阅：登记/摘除/注册都通知，快照是稳定数字", () => {
  cleanThreads();
  let hits = 0;
  const off = subscribeTeamRuntime(() => { hits += 1; });
  markDelegateThread("x");
  assert.equal(hits, 1);
  assert.equal(teamRuntimeSnapshot(), 1);
  const off2 = registerRateLimitCancel(() => {});
  assert.equal(hits, 2);
  unmarkDelegateThread("x");
  assert.equal(hits, 3);
  assert.equal(teamRuntimeSnapshot(), 0);
  off(); off2();
  cleanThreads();
});

test("当前生效模型：值不变不通知，变化才通知；复合串剥离成裸模型名", () => {
  let hits = 0;
  const off = subscribeActiveModel(() => { hits += 1; });
  setActiveModel("custom:pp:deepseek-v4.1-flash", "deepseek-v4.1-flash");
  assert.equal(hits, 1);
  const before = getActiveModel();
  setActiveModel("custom:pp:deepseek-v4.1-flash", "deepseek-v4.1-flash");
  assert.equal(hits, 1, "同值不得触发无谓重渲染");
  assert.equal(getActiveModel(), before, "快照引用必须稳定，useSyncExternalStore 才不会死循环");
  setActiveModel("custom:pp:gpt-5.1", "gpt-5.1");
  assert.equal(hits, 2);
  assert.equal(getActiveModel().name, "gpt-5.1");
  assert.equal(getActiveModel().id, "custom:pp:gpt-5.1");
  off();
});

test("空模型名：跟随全局取不到裸名时不得把空串当具体模型下发", () => {
  setActiveModel("", "");
  assert.equal(Boolean(getActiveModel().name), false);
});
