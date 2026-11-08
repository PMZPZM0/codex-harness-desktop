import test from "node:test";
import assert from "node:assert/strict";
import { describeTurnStop } from "../src/lib/turn-stop-reason.mjs";

/** 11-08 用户截图：「任务失败: unexpected status 402 Payment Required: Insufficient Balance
 *  … url: http://127.0.0.1:47121/p/custom906/responses」——原文直接甩给用户。
 *  引擎把这类上游错误归到 other/badRequest ⇒ 这里按原文再分一次类，必须翻成中文 + 处置。 */
test("402 余额不足 → 中文标签 + 处置（codexErrorInfo=other）", () => {
  const stop = describeTurnStop({
    status: "failed",
    error: {
      message: "unexpected status 402 Payment Required: Insufficient Balance (request: id: cdd3870d-c249-4f4d-8e1f-7022d6a396e9), url: http://127.0.0.1:47121/p/custom906/responses",
      codexErrorInfo: "other",
    },
  });
  assert.equal(stop.label, "供应商余额不足");
  assert.match(stop.detail, /充值/);
  assert.match(stop.detail, /重试不会成功/);
  assert.match(stop.detail, /Insufficient Balance/); // 原文仍保留（悬停/详情可查）
});

test("402 余额不足 → 即使引擎分类成 badRequest 也翻中文", () => {
  const stop = describeTurnStop({
    status: "failed",
    error: { message: "Insufficient Balance", codexErrorInfo: "badRequest" },
  });
  assert.equal(stop.label, "供应商余额不足");
});

test("其它分类不被 402 规则抢走（限流 / 上下文超限照旧）", () => {
  const rate = describeTurnStop({ status: "failed", error: { message: "429 Too Many Requests", codexErrorInfo: "rateLimitExceeded" } });
  assert.equal(rate.label, "被限流");
  const ctx = describeTurnStop({ status: "failed", error: { message: "context window exceeded", codexErrorInfo: "contextWindowExceeded" } });
  assert.equal(ctx.label, "上下文超限");
  const plain = describeTurnStop({ status: "failed", error: { message: "something odd", codexErrorInfo: "other" } });
  assert.equal(plain.label, "处理出错");
});
