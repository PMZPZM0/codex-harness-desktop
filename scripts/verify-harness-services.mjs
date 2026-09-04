import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { MemoryStore, Scheduler } = require("../dist-electron/harness-services.js");
const root = join(tmpdir(), `codex-harness-services-${process.pid}`);
const memoryFile = join(root, "memory.json");
const taskFile = join(root, "tasks.json");
await fs.mkdir(root, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const memory = new MemoryStore(memoryFile);
  const saved = await memory.upsert({ category: "项目背景", content: "这个项目使用官方 Codex app-server 状态机。" });
  assert.equal((await memory.search("app-server"))[0].id, saved.id);
  assert.equal((await new MemoryStore(memoryFile).list("项目背景")).length, 1);

  const calls = [];
  // 模拟 CodexServer：真实基类是 EventEmitter（Scheduler.run 的 waitForTurnCompletion 会 on/off("event")），
  // 这里用 EventEmitter + request。turn/start 后用 setImmediate（下一轮宏任务，晚于微任务里注册的 on）
  // 发 turn/completed，让 waitForTurnCompletion 正常 resolve 为 completed，lastError 保持 undefined。
  const server = new EventEmitter();
  server.request = async (method, params) => {
    calls.push([method, params]);
    if (method === "thread/start") return { thread: { id: "scheduled-thread" } };
    if (method === "turn/start") {
      setImmediate(() => server.emit("event", { kind: "notification", method: "turn/completed", params: { threadId: params.threadId } }));
    }
    return {};
  };
  const scheduler = new Scheduler(taskFile, server, async () => ({ model: "test-model", provider: "test", name: "Test", baseUrl: "http://127.0.0.1/v1" }), () => undefined);
  const task = await scheduler.save({ name: "自检任务", prompt: "返回 OK", workspace: root, intervalMinutes: 60 });
  await scheduler.runNow(task.id);
  // runNow 是「发射后不管」（UI 立即返回，不阻塞），这里轮询等 run 真正结束（lastRunAt 写入）再断言，消除竞态。
  let finished = false;
  for (let i = 0; i < 500; i++) {
    if (typeof (await scheduler.list())[0]?.lastRunAt === "number") { finished = true; break; }
    await sleep(10);
  }
  assert.ok(finished, "任务应在 5s 内完成");
  assert.deepEqual(calls.map(([method]) => method), ["thread/start", "turn/start"]);
  assert.equal((await scheduler.list())[0].lastError, undefined);
  console.log("harness services verification passed");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
