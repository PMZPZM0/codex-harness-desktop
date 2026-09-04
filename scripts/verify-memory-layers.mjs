// 记忆分层 MemoryLayers 纯 fs 回归验证（node:test，零新依赖）。
// 用法: node scripts/verify-memory-layers.mjs
// 前置: 需先 npm run build:electron（require 编译产物 dist-electron/memory-layers.js）
// 覆盖: L0 用户档案 / L1 项目长期记忆 / L2 每日日志 读写与写入门禁（无工作区拒写）、
//       context 注入拼装与预算裁剪、pickDistill 只挑满 30 天的日志、
//       distill 提炼落 L1 + 原文移入 archive/ + 6 小时节流、autoDistill 异常兜底。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const prod = join(root, "dist-electron", "memory-layers.js");
if (!existsSync(prod)) {
  console.error("FATAL: 缺少 dist-electron/memory-layers.js，请先 npm run build:electron");
  process.exit(1);
}
const require = createRequire(import.meta.url);
const { MemoryLayers, MEMORY_BUDGET } = require(prod);

// ── 测试辅助 ──
const fmt = (d) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const today = () => fmt(new Date());
const dayAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return fmt(d); };

let userDataDir;
let workspace;
let workspaceB;
let layers;
let makeOldLog;
let makeLogIn;

before(() => {
  userDataDir = mkdtempSync(join(tmpdir(), "ml-user-"));
  workspace = mkdtempSync(join(tmpdir(), "ml-ws-"));
  workspaceB = mkdtempSync(join(tmpdir(), "ml-ws-b-"));
  layers = new MemoryLayers(userDataDir);
  makeLogIn = (ws, daysAgo, content) => {
    const dir = join(ws, ".codex-harness", "memory");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${dayAgo(daysAgo)}.md`), content, "utf8");
  };
  makeOldLog = (daysAgo, content) => makeLogIn(workspace, daysAgo, content);
});

after(() => {
  rmSync(userDataDir, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
  rmSync(workspaceB, { recursive: true, force: true });
});

// ============ L0 用户档案 ============
test("L0: writeUser/readUser 往返，写入自动补结尾换行", async () => {
  await layers.writeUser("  我叫老王，偏好直接给结论  ");
  assert.equal(await layers.readUser(), "我叫老王，偏好直接给结论\n");
});

test("L0: 空内容清空文件不残留", async () => {
  await layers.writeUser("   ");
  assert.equal(await layers.readUser(), "");
  await layers.writeUser("再写一次");
  assert.match(await layers.readUser(), /再写一次/);
});

// ============ L1 项目长期记忆 ============
test("L1: writeProject/readProject 落在 {workspace}/.codex-harness/memory/MEMORY.md", async () => {
  await layers.writeProject(workspace, "铁律：改完源码必须 npm run build");
  assert.equal(await layers.readProject(workspace), "铁律：改完源码必须 npm run build\n");
  const file = join(workspace, ".codex-harness", "memory", "MEMORY.md");
  assert.equal(existsSync(file), true);
  assert.match(readFileSync(file, "utf8"), /npm run build/);
});

test("L1: 无工作区时写入被门禁拒绝，读取静默返回空", async () => {
  await assert.rejects(() => layers.writeProject("", "不允许写"), /尚未选择工作区/);
  await assert.rejects(() => layers.writeProject(undefined, "不允许写"), /尚未选择工作区/);
  assert.equal(await layers.readProject(), "");
  assert.equal(await layers.readProject(undefined), "");
});

// ============ L2 每日日志 ============
test("L2: appendLog 只写当天文件且为追加模式", async () => {
  await layers.appendLog(workspace, "- 需求：做记忆分层");
  await layers.appendLog(workspace, "- 结果：四层架构落盘");
  const file = join(workspace, ".codex-harness", "memory", `${today()}.md`);
  assert.equal(existsSync(file), true);
  const text = readFileSync(file, "utf8");
  assert.match(text, /^# \d{4}-\d{2}-\d{2}\n/);
  assert.match(text, /需求：做记忆分层/);
  assert.match(text, /结果：四层架构落盘/);
  assert.equal((text.match(/^## \d{2}:\d{2}$/gm) ?? []).length, 2, "两次追加应生成两个时间戳小节");
});

test("L2: appendLog 空工作区/空内容直接忽略不炸", async () => {
  await layers.appendLog("", "不该写");
  await layers.appendLog(workspace, "   ");
});

// ============ context 注入拼装与预算 ============
test("context: 空状态返回空注入块", async () => {
  const fresh = new MemoryLayers(mkdtempSync(join(tmpdir(), "ml-empty-")));
  const { text, stats } = await fresh.context(undefined);
  assert.equal(text, "");
  assert.equal(stats.chars, 0);
  assert.equal(stats.over, false);
});

test("context: L0+L1+L2 按块拼装，无超预算", async () => {
  const { text, stats } = await layers.context(workspace);
  assert.match(text, /\[Harness 常驻记忆/);
  assert.match(text, /## 用户档案/);
  assert.match(text, /## 项目记忆/);
  assert.match(text, /## 近期工作日志/);
  assert.match(text, /铁律：改完源码必须 npm run build/);
  assert.match(text, /需求：做记忆分层/);
  assert.equal(stats.over, false);
  assert.ok(stats.chars > 0);
});

test("context: L0 超预算标记 over 并给出蒸馏提示而非静默丢内容", async () => {
  await layers.writeUser("长".repeat(MEMORY_BUDGET.user + 50));
  const { text, stats } = await layers.context(workspace);
  assert.equal(stats.over, true);
  assert.match(text, /已超出 \d+ 字预算/);
  await layers.writeUser("我叫老王，偏好直接给结论"); // 还原
});

// ============ 蒸馏 ============
test("pickDistill: 只挑满 30 天的日志，当天/近期不进候选", async () => {
  makeOldLog(45, "第 45 天前：".repeat(40)); // 约 400 字
  makeOldLog(40, "第 40 天前：".repeat(30)); // 约 300 字
  const pick = await layers.pickDistill(workspace);
  assert.ok(pick, "应有待蒸馏日志");
  assert.ok(pick.dates.includes(dayAgo(45)), "45 天前应入选");
  assert.ok(pick.dates.includes(dayAgo(40)), "40 天前应入选");
  assert.equal(pick.dates.includes(today()), false, "当天日志不应入选");
  assert.ok(pick.chars >= 200, "低于 200 字不配调模型");
});

test("distill: 提炼追加进 L1、原文移入 archive/、写入节流状态", async () => {
  const summarize = async (_prompt, _body) => "## 环境与部署\n- 下载通道走 dl 子域名直连比 CF 快 26 倍";
  const result = await layers.distill(workspace, summarize, true);
  assert.equal(result.ok, true);
  assert.ok(result.dates.length >= 2);
  assert.ok(result.added > 0);

  const l1 = await layers.readProject(workspace);
  assert.match(l1, /铁律：改完源码必须 npm run build/, "既有 L1 内容必须保留");
  assert.match(l1, /## 蒸馏 \d{4}-\d{2}-\d{2}/, "蒸馏结果应追加为独立小节");
  assert.match(l1, /下载通道走 dl 子域名/);

  for (const date of result.dates) {
    assert.equal(existsSync(join(workspace, ".codex-harness", "memory", `${date}.md`)), false, `${date} 原文应移走`);
    assert.equal(existsSync(join(workspace, ".codex-harness", "memory", "archive", `${date}.md`)), true, `${date} 应归档到 archive/`);
  }
  const state = JSON.parse(readFileSync(join(workspace, ".codex-harness", "memory", ".distill-state.json"), "utf8"));
  assert.ok(state.lastDistillAt > 0);
});

test("distill: 6 小时内重跑被节流拒绝（force=false）", async () => {
  // 独立工作区：先跑一次蒸馏种下 lastDistillAt 状态，再造一条新满月日志当候选
  makeLogIn(workspaceB, 35, "旧日志 ".repeat(60));
  const seed = await layers.distill(workspaceB, async () => "种子提炼", true);
  assert.equal(seed.ok, true);
  makeLogIn(workspaceB, 32, "新满月日志 ".repeat(60));
  const result = await layers.distill(workspaceB, async () => "不该被调用");
  assert.equal(result.ok, false);
  assert.match(result.reason, /不足 6 小时/);
});

test("distill: 无工作区直接拒绝", async () => {
  const result = await layers.distill("", async () => "x");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "尚未选择工作区");
});

test("autoDistill: 无工作区返回 null，模型抛错全兜底不炸", async () => {
  assert.equal(await layers.autoDistill(undefined, async () => "x"), null);
  assert.equal(await layers.autoDistill("", async () => "x"), null);
  // 异常路径：清掉节流状态 + 造满月候选 → summarize 抛错 → autoDistill 吞掉返回 null，
  // 且日志原文不得被误归档、L1 不得被写入
  rmSync(join(workspaceB, ".codex-harness", "memory", ".distill-state.json"), { force: true });
  const pendingDate = dayAgo(32);
  const l1Before = await layers.readProject(workspaceB);
  const result = await layers.autoDistill(workspaceB, async () => { throw new Error("模型挂了"); });
  assert.equal(result, null);
  assert.equal(existsSync(join(workspaceB, ".codex-harness", "memory", `${pendingDate}.md`)), true, "失败时原文必须保留");
  assert.equal(await layers.readProject(workspaceB), l1Before, "失败时 L1 不得被改动");
});

// ============ 设置页快照 ============
test("snapshot: 字段齐全，paths 指向分层落盘位置", async () => {
  const snap = await layers.snapshot(workspace);
  assert.equal(snap.hasWorkspace, true);
  assert.match(snap.user, /老王/);
  assert.match(snap.project, /蒸馏 \d{4}-\d{2}-\d{2}/);
  assert.equal(snap.paths.user, join(userDataDir, "memory", "USER.md"));
  assert.equal(snap.paths.projectDir, join(workspace, ".codex-harness", "memory"));
  assert.equal(snap.paths.project, join(workspace, ".codex-harness", "memory", "MEMORY.md"));
  assert.ok(Array.isArray(snap.logs));
  assert.equal(snap.pendingDistill.dates.length, 0, "全部满月日志已被蒸馏，不应再有待处理");
  assert.ok(snap.lastDistillAt > 0);
});

test("snapshot: 无工作区时 project 相关字段为空且不炸", async () => {
  const snap = await layers.snapshot(undefined);
  assert.equal(snap.hasWorkspace, false);
  assert.equal(snap.project, "");
  assert.equal(snap.paths.projectDir, "");
  assert.deepEqual(snap.logs, []);
  assert.equal(snap.pendingDistill.dates.length, 0);
});

console.log(`\n临时目录: ${userDataDir} / ${workspace}（after 已清理）`);
