import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmpDir = join(root, ".test-tmp");
const outFile = join(tmpDir, "session-tools.js");
const tscBin = join(root, "node_modules", "typescript", "bin", "tsc");

mkdirSync(tmpDir, { recursive: true });
rmSync(outFile, { force: true });
execFileSync(process.execPath, [
  tscBin,
  join(root, "electron", "session-tools.ts"),
  "--module", "commonjs",
  "--target", "es2020",
  "--outDir", tmpDir,
  "--skipLibCheck",
  "--esModuleInterop",
], { stdio: "inherit" });
if (!existsSync(outFile)) throw new Error("session-tools compile produced no output");

const require = createRequire(import.meta.url);
const { mergeThreadList } = require(outFile);

const active = { id: "active", name: "活动会话", updatedAt: 20, archived: false };
const archived = { id: "archived", name: "归档会话", updatedAt: 10, archived: true };

test("archived=true 只返回归档会话，绝不混入活动会话", () => {
  const result = mergeThreadList([], [active, archived], true, 100);
  assert.deepEqual(result.map((entry) => entry.id), ["archived"]);
});

test("archived=false 只返回活动会话", () => {
  const result = mergeThreadList([], [active, archived], false, 100);
  assert.deepEqual(result.map((entry) => entry.id), ["active"]);
});

test("app-server 索引缺少 archived 字段时按请求类型补齐", () => {
  const indexed = [{ id: "server", name: "索引记录", updatedAt: 30 }];
  assert.deepEqual(mergeThreadList(indexed, [], true, 100).map((entry) => [entry.id, entry.archived]), [["server", true]]);
  assert.deepEqual(mergeThreadList(indexed, [], false, 100).map((entry) => [entry.id, entry.archived]), [["server", false]]);
});

test("合并元数据后仍按归档状态过滤", () => {
  const indexed = [{ id: "same", name: "服务端标题", updatedAt: 40 }];
  const fallback = [{ id: "same", preview: "本地预览", updatedAt: 20, archived: false }, archived];
  const result = mergeThreadList(indexed, fallback, false, 100);
  assert.deepEqual(result.map((entry) => entry.id), ["same"]);
  assert.equal(result[0].preview, "本地预览");
  assert.equal(result[0].archived, false);
});
