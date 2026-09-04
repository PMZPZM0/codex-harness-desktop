// 状态机纯函数单测（node:test，零新依赖）。
// 用法: node scripts/verify-turn-fold.mjs
// 流程: 用 tsc 把 src/lib/turn-fold.ts 编译成 CJS 到 .test-tmp/，再 require 跑断言。
// 覆盖: 分段合并（命令-思考-命令）、直播思考打断、单个不进组、shouldFold、三类摘要、
//       无正文兜底、多类摘要、历史归一化、topToolGroup。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmpDir = join(root, ".test-tmp");
const outFile = join(tmpDir, "turn-fold.js");
const tscBin = join(root, "node_modules", "typescript", "bin", "tsc");

if (!existsSync(tscBin)) {
  console.error("FATAL: typescript not installed");
  process.exit(1);
}
mkdirSync(tmpDir, { recursive: true });
rmSync(outFile, { force: true });
execFileSync(process.execPath, [
  tscBin,
  join(root, "src", "lib", "turn-fold.ts"),
  "--module", "commonjs",
  "--target", "es2020",
  "--outDir", tmpDir,
  "--skipLibCheck",
  "--esModuleInterop",
], { stdio: "inherit" });
if (!existsSync(outFile)) {
  console.error("FATAL: tsc produced no output");
  process.exit(1);
}

const require = createRequire(import.meta.url);
const fold = require(outFile);

// ── 测试辅助 ──
const item = (id, type, extra = {}) => ({ id, type, ...extra });
const unit = (u) => ({ item: u.item ?? u, kind: u.kind ?? fold.classifyUnit(u.item ?? u) });

// ============ classifyUnit ============
test("classifyUnit 分类映射", () => {
  assert.equal(fold.classifyUnit(item("r", "reasoning")), "thinking");
  assert.equal(fold.classifyUnit(item("a", "agentMessage")), "body");
  assert.equal(fold.classifyUnit(item("p", "plan")), "keepVisible");
  assert.equal(fold.classifyUnit(item("iv", "imageView")), "keepVisible");
  assert.equal(fold.classifyUnit(item("ig", "imageGeneration")), "keepVisible");
  assert.equal(fold.classifyUnit(item("u", "userMessage")), "keepVisible");
  assert.equal(fold.classifyUnit(item("c", "commandExecution")), "foldable");
  assert.equal(fold.classifyUnit(item("f", "fileChange")), "foldable");
  assert.equal(fold.classifyUnit(item("w", "webSearch")), "foldable");
});

// ============ buildSegments: 命令-思考-命令 合并成段（刷屏修复核心） ============
test("已结束思考吸进工具段: [命令,思考(结束),命令] 合并为一个折叠段", () => {
  const units = [
    unit(item("c1", "commandExecution", { status: "completed", durationMs: 100 })),
    unit(item("t", "reasoning", { status: "completed", durationMs: 500 })),
    unit(item("c2", "commandExecution", { status: "completed", durationMs: 200 })),
  ];
  const segs = fold.buildSegments(units, true);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].kind, "foldable");
  assert.equal(segs[0].units.length, 3);
  assert.equal(segs[0].shouldFold, true);
});

test("直播中的思考打断分段、内联常驻: [命令,思考(直播)] 不合并", () => {
  const units = [
    unit(item("c1", "commandExecution", { status: "inProgress" })),
    unit(item("t", "reasoning", { status: "inProgress" })), // 直播思考
  ];
  const segs = fold.buildSegments(units, false);
  // 命令独自 flush 成 normal, 直播思考并入同一 normal 段（内联常驻）
  assert.equal(segs.length, 1);
  assert.equal(segs[0].kind, "normal");
  assert.equal(segs[0].units.length, 2);
  assert.ok(segs[0].units.some((u) => u.item.type === "reasoning"));
});

test("单个命令不进折叠组（normal 段）", () => {
  const segs = fold.buildSegments([unit(item("c", "commandExecution", { status: "completed", durationMs: 100 }))], true);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].kind, "normal");
});

test("连续两个命令进折叠段; 后接正文时 shouldFold=true（流式）", () => {
  const units = [
    unit(item("c1", "commandExecution", { status: "completed", durationMs: 100 })),
    unit(item("c2", "commandExecution", { status: "completed", durationMs: 200 })),
    unit(item("a", "agentMessage", { status: "completed", text: "结论正文" })),
  ];
  const segs = fold.buildSegments(units, false);
  assert.equal(segs[0].kind, "foldable");
  assert.equal(segs[0].shouldFold, true); // 其后出现正文 → 折叠
  assert.equal(segs[1].kind, "normal");
});

test("turnFinished=true 时所有折叠段 shouldFold=true（完成态）", () => {
  const units = [
    unit(item("c1", "commandExecution", { status: "completed", durationMs: 100 })),
    unit(item("c2", "commandExecution", { status: "completed", durationMs: 200 })),
  ];
  const segs = fold.buildSegments(units, true);
  assert.equal(segs[0].kind, "foldable");
  assert.equal(segs[0].shouldFold, true);
});

// ============ buildOrderedToolRuns: 同类工具最多三条展示的顺序基础 ============
test("连续同类命令合成一组，正文与思考保持原位并打断分组", () => {
  const units = [
    unit(item("c1", "commandExecution")),
    unit(item("c2", "commandExecution")),
    unit(item("a1", "agentMessage", { text: "中间正文" })),
    unit(item("c3", "commandExecution")),
    unit(item("r1", "reasoning", { status: "inProgress" })),
    unit(item("c4", "commandExecution")),
    unit(item("c5", "commandExecution")),
  ];
  const runs = fold.buildOrderedToolRuns(units);
  assert.deepEqual(runs.map((run) => [run.kind, run.units.map((entry) => entry.item.id)]), [
    ["toolRun", ["c1", "c2"]],
    ["unit", ["a1"]],
    ["toolRun", ["c3"]],
    ["unit", ["r1"]],
    ["toolRun", ["c4", "c5"]],
  ]);
});

test("不同工具类型不混组，相同动态工具连续调用可合组", () => {
  const units = [
    unit(item("c1", "commandExecution")),
    unit(item("d1", "dynamicToolCall", { tool: "memory_recall" })),
    unit(item("d2", "dynamicToolCall", { tool: "memory_recall" })),
    unit(item("d3", "dynamicToolCall", { tool: "task_add" })),
  ];
  const runs = fold.buildOrderedToolRuns(units);
  assert.deepEqual(runs.map((run) => [run.kind === "toolRun" ? run.toolKey : run.key, run.units.length]), [
    ["command", 1],
    ["dynamic:memory_recall", 2],
    ["dynamic:task_add", 1],
  ]);
});

// ============ computeFoldSummary 摘要文案 ============
test("运行中摘要: 正在运行 + 命令", () => {
  const units = [unit(item("c", "commandExecution", { status: "inProgress", command: "npm test" }))];
  assert.equal(fold.computeFoldSummary(units, true), "正在运行 npm test");
});

test("等待确认摘要: 等待确认 + 命令", () => {
  const units = [unit(item("c", "commandExecution", { status: "inProgress", command: "rm -rf" }))];
  assert.equal(fold.computeFoldSummary(units, true, true), "等待确认：运行 rm -rf");
});

test("完成摘要: 无前缀", () => {
  const units = [unit(item("c", "commandExecution", { status: "completed", durationMs: 100, command: "npm test" }))];
  assert.equal(fold.computeFoldSummary(units, false), "运行 npm test");
});

test("修改文件摘要: 取文件名", () => {
  const units = [unit(item("f", "fileChange", { status: "completed", durationMs: 100, changes: [{ path: "src/App.tsx" }] }))];
  // modify.topic = "修改{t}"（无空格），与运行命令的 "运行 {t}" 不同
  assert.equal(fold.computeFoldSummary(units, false), "修改App.tsx");
});

test("无正文锚点兜底: 处理任务过程", () => {
  const units = [unit(item("x", "unknownType", { status: "completed", durationMs: 100 }))];
  assert.equal(fold.computeFoldSummary(units, false), "处理任务过程");
});

test("多类工具: 运行命令、修改文件：主题", () => {
  const units = [
    unit(item("c", "commandExecution", { status: "completed", durationMs: 100, command: "npm test" })),
    unit(item("f", "fileChange", { status: "completed", durationMs: 100, changes: [{ path: "src/App.tsx" }] })),
  ];
  const summary = fold.computeFoldSummary(units, false);
  assert.match(summary, /^运行命令、修改文件：/);
  assert.ok(summary.includes("App.tsx"));
});

test("纯思考组: 深度思考", () => {
  const units = [unit(item("t", "reasoning", { status: "completed", durationMs: 500 }))];
  assert.equal(fold.computeFoldSummary(units, false), "深度思考");
});

// ============ normalizeLoadedThread 历史归一化 ============
test("运行中会话原样保留（引擎级仍在跑）", () => {
  const input = { id: "t", status: "inProgress", turns: [{ id: "u", status: "inProgress", items: [] }] };
  assert.equal(fold.normalizeLoadedThread(input), input);
});

test("残留 inProgress 的回合落成 completed（含 item）", () => {
  const input = {
    id: "t",
    status: "completed",
    turns: [
      { id: "u", status: "inProgress", items: [{ id: "i", type: "commandExecution", status: "inProgress" }] },
      { id: "v", status: "completed", items: [{ id: "j", type: "agentMessage", status: "completed" }] },
    ],
  };
  const out = fold.normalizeLoadedThread(input);
  assert.equal(out.turns[0].status, "completed");
  assert.equal(out.turns[0].items[0].status, "completed");
  assert.equal(out.turns[1].status, "completed"); // 已完成回合不动
  assert.equal(out.turns[1].items[0].status, "completed");
});

test("已完成的会话原样返回（无 changed）", () => {
  const input = { id: "t", status: "completed", turns: [{ id: "u", status: "completed", items: [] }] };
  assert.equal(fold.normalizeLoadedThread(input), input);
});

// ============ topToolGroup 引导图标 ============
test("纯思考段引导 reasoning; 混合段取出现最多的分组", () => {
  const think = [unit(item("t", "reasoning", { status: "completed", durationMs: 100 }))];
  assert.equal(fold.topToolGroup(think), "reasoning");
  const mixed = [
    unit(item("c1", "commandExecution", { status: "completed", durationMs: 100 })),
    unit(item("c2", "commandExecution", { status: "completed", durationMs: 100 })),
    unit(item("w", "webSearch", { status: "completed", durationMs: 100 })),
  ];
  assert.equal(fold.topToolGroup(mixed), "command");
});

// ============ 词表可扩展（P1 词表配置化验收） ============
test("customText 可覆盖摘要文案", () => {
  const units = [unit(item("c", "commandExecution", { status: "completed", durationMs: 100, command: "git push" }))];
  assert.equal(fold.computeFoldSummary(units, false, undefined, { command: { topic: "执行命令 {t}", noTopic: "执行命令", verb: "执行命令" } }), "执行命令 git push");
});

console.log(`\n${tmpDir} 产物可删: turn-fold.js（node scripts/verify-turn-fold.mjs 每次重建）`);
