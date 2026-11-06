/**
 * 11-06 用户：「没有运行状态停止按钮很烦，一直刷那个提醒」「模型也是死的，一点联动性都没有」。
 * 两个纯模块是 app-state ↔ harness-team 之间的桥，行为必须可独立验证（不依赖 Electron / DOM）。
 *
 * ⛔ 11-06 审查修正：总闸判据必须是**粘性身份**，不能查「此刻还在跑」——
 *    主进程超时转后台时先发 delegate-run finished、后转发 429 ⇒ 查 running 必漏拦。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  markDelegateThread, unmarkDelegateThread, isDelegateThread,
  delegateThreadIds, registerRateLimitCancel,
  cancelDelegateRetries, subscribeTeamRuntime, teamRuntimeSnapshot,
} from "../src/lib/team-runtime.mjs";
import { setActiveModel, getActiveModel, subscribeActiveModel } from "../src/lib/active-model.mjs";

/* 每个用例用新 id：known 是粘性集合，⛔ 不跟着 running 清空（这正是被审出来的契约）。 */
let seq = 0;
const uid = (tag = "t") => `${tag}-${++seq}`;
function cleanThreads() {
  for (const id of delegateThreadIds()) unmarkDelegateThread(id);
}

test("登记/摘除：finished 只摘「运行中」，粘性身份仍在（429 晚到也不会漏拦）", () => {
  cleanThreads();
  const a = uid("run"), b = uid("other");
  assert.equal(isDelegateThread(a), false);
  markDelegateThread(a);
  assert.equal(isDelegateThread(a), true);
  assert.equal(isDelegateThread(b), false, "用户自己多开的会话不许被误标成调度会话");
  assert.equal(teamRuntimeSnapshot(), 1);
  unmarkDelegateThread(a);
  assert.equal(teamRuntimeSnapshot(), 0);
  assert.equal(isDelegateThread(a), true, "⛔ finished 之后身份必须还在，否则超时转后台路径总闸被绕过");
});

test("delegateThreadIds 只返回仍在跑的；重复登记不重复通知（启动补种不会刷重渲染）", () => {
  cleanThreads();
  const a = uid("seed"), b = uid("seed");
  let hits = 0;
  const off = subscribeTeamRuntime(() => { hits += 1; });
  markDelegateThread(a);
  markDelegateThread(a);
  markDelegateThread(b);
  assert.equal(hits, 2, "两个新 id 各通知一次，重复登记不通知");
  assert.deepEqual(delegateThreadIds().sort(), [a, b].sort());
  unmarkDelegateThread(a);
  assert.equal(delegateThreadIds().length, 1);
  off();
  cleanThreads();
});

test("停止 = 对仍在跑的会话 silent 清理重试状态（⛔ 不许再弹「已停止限流重试」）", () => {
  cleanThreads();
  const a = uid("stop"), b = uid("stop"), done = uid("stop");
  markDelegateThread(a);
  markDelegateThread(b);
  markDelegateThread(done);
  unmarkDelegateThread(done);
  const calls = [];
  const off = registerRateLimitCancel((threadId, silent) => calls.push([threadId, silent]));
  assert.equal(cancelDelegateRetries(), 2);
  assert.deepEqual(calls.sort(), [[a, true], [b, true]].sort());
  assert.ok(calls.every(([, silent]) => silent === true), "清理必须 silent，否则又是一条提醒");
  assert.ok(!calls.some(([id]) => id === done), "已 finished 的会话不再在清理范围里");
  off();
  assert.equal(cancelDelegateRetries(), 0, "⛔ 注册函数已摘掉时不许虚报「已取消 N 条」");
  assert.doesNotThrow(() => cancelDelegateRetries());
  cleanThreads();
});

test("订阅：登记/摘除/注册都通知，快照是稳定数字", () => {
  cleanThreads();
  let hits = 0;
  const off = subscribeTeamRuntime(() => { hits += 1; });
  const x = uid("sub");
  markDelegateThread(x);
  assert.equal(hits, 1);
  assert.equal(teamRuntimeSnapshot(), 1);
  const off2 = registerRateLimitCancel(() => {});
  assert.equal(hits, 2);
  unmarkDelegateThread(x);
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
