import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  APP_LOCK_FILE,
  MAX_ATTEMPTS,
  cancelAppLockSetup,
  consumeResetRequest,
  disableAppLock,
  enableAppLockSetup,
  formatPasswordForDisplay,
  generateRandomPassword,
  getAppLockStatus,
  lockFilePath,
  prepareAppLockSetup,
  requestAppDataReset,
  resetMarkerPath,
  verifyAppLockPassword,
} from "../electron/app-lock.ts";

function tempDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `app-lock-${tag}-`));
}

test("随机密码：16 位、无易混字符、展示按 4 位分组", () => {
  const password = generateRandomPassword();
  assert.equal(password.length, 16);
  assert.doesNotMatch(password, /[0O1Il]/);
  assert.match(formatPasswordForDisplay(password, "random"), /^(\w{4} ){3}\w{4}$/);
  assert.equal(formatPasswordForDisplay(password, "random").replace(/\s/g, ""), password);
});

test("开启流程：确认前不落盘，确认后只存哈希且可验证", () => {
  const dir = tempDir("enable");
  const prepared = prepareAppLockSetup(dir, { mode: "custom", password: "my-secret-123" });
  assert.equal(prepared.ok, true);
  assert.equal(fs.existsSync(lockFilePath(dir)), false, "确认前不能落盘");

  const enabled = enableAppLockSetup(dir, prepared.setupId);
  assert.equal(enabled.ok, true);
  const raw = fs.readFileSync(lockFilePath(dir), "utf8");
  assert.ok(raw.includes("hash"));
  assert.ok(!raw.includes("my-secret-123"), "磁盘不能出现明文密码");

  const status = getAppLockStatus(dir);
  assert.equal(status.enabled, true);
  assert.equal(status.remaining, MAX_ATTEMPTS);
  assert.equal(verifyAppLockPassword(dir, "my-secret-123").ok, true);
  assert.equal(verifyAppLockPassword(dir, "wrong").ok, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("自定义密码长度与待确认流程可取消", () => {
  const dir = tempDir("custom");
  const short = prepareAppLockSetup(dir, { mode: "custom", password: "12345" });
  assert.equal(short.ok, false);
  const prepared = prepareAppLockSetup(dir, { mode: "random" });
  assert.equal(prepared.ok, true);
  assert.equal(cancelAppLockSetup(prepared.setupId).ok, true);
  assert.equal(enableAppLockSetup(dir, prepared.setupId).ok, false);
  assert.equal(fs.existsSync(lockFilePath(dir)), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("连续 10 次错误返回 reset，失败次数落盘可跨重启累计", () => {
  const dir = tempDir("attempts");
  const prepared = prepareAppLockSetup(dir, { mode: "custom", password: "correct-password" });
  enableAppLockSetup(dir, prepared.setupId);
  for (let i = 1; i < MAX_ATTEMPTS; i += 1) {
    const result = verifyAppLockPassword(dir, "wrong");
    assert.equal(result.ok, false);
    assert.equal(result.remaining, MAX_ATTEMPTS - i);
    assert.equal(Boolean(result.reset), false);
  }
  assert.equal(getAppLockStatus(dir).remaining, 1);
  const tenth = verifyAppLockPassword(dir, "wrong");
  assert.equal(tenth.reset, true);
  assert.equal(tenth.remaining, 0);
  assert.equal(getAppLockStatus(dir).resetRequired, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("关闭应用锁需要正确密码；密码正确后文件被删除", () => {
  const dir = tempDir("disable");
  const prepared = prepareAppLockSetup(dir, { mode: "custom", password: "disable-me-123" });
  enableAppLockSetup(dir, prepared.setupId);
  assert.equal(disableAppLock(dir, "wrong").ok, false);
  assert.equal(fs.existsSync(lockFilePath(dir)), true);
  assert.equal(disableAppLock(dir, "disable-me-123").ok, true);
  assert.equal(fs.existsSync(lockFilePath(dir)), false);
  assert.equal(getAppLockStatus(dir).enabled, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("重置标记：只认新鲜标记，并同时清掉默认目录与已确认的自定义目录", () => {
  const anchor = tempDir("anchor");
  const custom = tempDir("custom-data");
  fs.writeFileSync(path.join(anchor, "data-dir.json"), JSON.stringify({ dir: custom }), "utf8");
  fs.writeFileSync(path.join(anchor, APP_LOCK_FILE), "{}", "utf8");
  fs.writeFileSync(path.join(custom, "session.json"), "{}", "utf8");

  const marker = requestAppDataReset(anchor, custom);
  assert.equal(marker, resetMarkerPath(anchor));
  assert.equal(fs.existsSync(marker), true);

  const reset = consumeResetRequest(anchor, custom);
  assert.equal(reset, true);
  assert.equal(fs.existsSync(anchor), false);
  assert.equal(fs.existsSync(custom), false);
  assert.equal(fs.existsSync(marker), false);
});

test("重置标记绑定目标 userData：别的 profile 启动时不消费", () => {
  const anchor = tempDir("anchor-bound");
  const target = tempDir("target-profile");
  const other = tempDir("other-profile");
  fs.writeFileSync(path.join(anchor, "keep.txt"), "keep", "utf8");
  fs.writeFileSync(path.join(target, "target.txt"), "target", "utf8");
  fs.writeFileSync(path.join(other, "other.txt"), "other", "utf8");
  requestAppDataReset(anchor, target);
  assert.equal(consumeResetRequest(anchor, other), false, "跨 profile 的标记不能触发重置");
  assert.equal(fs.existsSync(path.join(anchor, "keep.txt")), true);
  assert.equal(fs.existsSync(path.join(target, "target.txt")), true);
  assert.equal(fs.existsSync(path.join(other, "other.txt")), true);
  assert.equal(fs.existsSync(resetMarkerPath(anchor)), true, "标记留给目标 profile 自己处理");
  fs.rmSync(anchor, { recursive: true, force: true });
  fs.rmSync(target, { recursive: true, force: true });
  fs.rmSync(other, { recursive: true, force: true });
});

test("重置标记过期不触发删除", () => {
  const anchor = tempDir("stale");
  const old = { at: Date.now() - 11 * 60 * 1000, version: 1, userData: anchor };
  fs.writeFileSync(resetMarkerPath(anchor), JSON.stringify(old), "utf8");
  fs.writeFileSync(path.join(anchor, "keep.txt"), "keep", "utf8");
  assert.equal(consumeResetRequest(anchor, anchor), false);
  assert.equal(fs.existsSync(path.join(anchor, "keep.txt")), true);
  fs.rmSync(anchor, { recursive: true, force: true });
});

test("未被 data-dir.json 确认的自定义目录不删", () => {
  const anchor = tempDir("anchor2");
  const custom = tempDir("custom-unconfirmed");
  fs.writeFileSync(path.join(custom, "keep.txt"), "keep", "utf8");
  requestAppDataReset(anchor, custom);
  const reset = consumeResetRequest(anchor, custom);
  assert.equal(reset, true);
  assert.equal(fs.existsSync(anchor), false);
  assert.equal(fs.existsSync(path.join(custom, "keep.txt")), true, "不能误删普通文件夹");
  fs.rmSync(custom, { recursive: true, force: true });
});
