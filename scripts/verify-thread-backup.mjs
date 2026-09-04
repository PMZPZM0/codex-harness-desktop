// 会话备份/导入链路回归验证（node:test，零新依赖）。
// 用法: node scripts/verify-thread-backup.mjs
// 前置: 需先 npm run build:electron（require 编译产物 dist-electron/thread-backup.js）
// 覆盖: rollout 扫描聚合 / 整包导出（含归档态与注入过滤）/ 按线程过滤 /
//       通用 Markdown 导出（合集 + 单会话干净文档）/ 幂等导入（duplicate 跳过、
//       conflict 不覆盖）/ 路径穿越防护 / 外部记录解析 / 真实 codex-home 只读 smoke。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, utimesSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const prod = join(root, "dist-electron", "thread-backup.js");
if (!existsSync(prod)) {
  console.error("FATAL: 缺少 dist-electron/thread-backup.js，请先 npm run build:electron");
  process.exit(1);
}
const require = createRequire(import.meta.url);
const {
  BACKUP_FORMAT, BACKUP_VERSION,
  scanSessionFiles, buildSessionsBackup, buildMarkdownExport,
  parseMarkdownConversation, parseRolloutMessages, applySessionsBackup,
} = require(prod);

// ── 测试辅助 ──
const uuid = () => crypto.randomUUID();
const md5 = (s) => {
  // 仅用于断言文件被覆盖与否的内容指纹（不引入依赖）
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16);
};

let home;      // 源 codex-home（构造数据）
let homeCopy;  // 导入目标副本
let homeEvil;  // 路径穿越注入目标
let uuidA;
let uuidB;
let rollA;     // A 会话 rollout 原文
let rollB;
let fileRelA;

/** 构造一条 rollout JSONL（row.type + payload.type 双结构对齐引擎真实格式） */
const row = (type, payload, ts) => JSON.stringify({ type, timestamp: ts, payload });

before(() => {
  const base = mkdtempSync(join(tmpdir(), "tb-"));
  home = join(base, "home");
  homeCopy = join(base, "copy");
  homeEvil = join(base, "evil");
  for (const h of [home, homeCopy, homeEvil]) {
    mkdirSync(join(h, "sessions"), { recursive: true });
    mkdirSync(join(h, "archived_sessions"), { recursive: true });
  }
  uuidA = uuid();
  uuidB = uuid();
  fileRelA = `sessions/2026-09-01-s-${uuidA}.jsonl`;

  // 线程 A：正常活跃会话（event 版 user 消息 + response_item 双写，测相邻去重）
  rollA = [
    row("session_meta", { cwd: "D:\\proj\\alpha" }, "2026-09-01T01:00:00.000Z"),
    row("event_msg", { type: "user_message", message: "帮我看看这个报错" }, "2026-09-01T01:01:00.000Z"),
    row("response_item", { type: "message", role: "user", content: [{ type: "input_text", text: "帮我看看这个报错" }] }, "2026-09-01T01:01:00.100Z"),
    row("response_item", { type: "message", role: "assistant", content: [{ type: "output_text", text: "报错是缺依赖 X，装一下就好。" }] }, "2026-09-01T01:02:00.000Z"),
    row("event_msg", { type: "user_message", message: "好了，谢谢" }, "2026-09-01T01:03:00.000Z"),
    row("response_item", { type: "message", role: "assistant", content: [{ type: "output_text", text: "不客气！" }] }, "2026-09-01T01:03:30.000Z"),
  ].join("\n") + "\n";
  writeFileSync(join(home, fileRelA), rollA, "utf8");
  // 确定性排序：A 的 mtime 设为 09-01，B 设为 08-30（updatedAt 降序时 A 必在前）
  utimesSync(join(home, fileRelA), new Date("2026-09-01T03:00:00Z"), new Date("2026-09-01T03:00:00Z"));

  // 线程 B：归档会话，首条 user 消息以 # AGENTS.md 开头（系统注入，导出/命名都应跳过）
  const userMsgInject = "# AGENTS.md\n你是助手。\n<environment_context>\n实际用户问题被注入块隔开。";
  rollB = [
    row("turn_context", { cwd: "D:\\proj\\beta" }, "2026-08-30T02:00:00.000Z"),
    row("response_item", { type: "message", role: "user", content: [{ type: "input_text", text: userMsgInject }] }, "2026-08-30T02:00:10.000Z"),
    row("response_item", { type: "message", role: "assistant", content: [{ type: "output_text", text: "（归档会话开场）" }] }, "2026-08-30T02:00:20.000Z"),
    row("response_item", { type: "message", role: "user", content: [{ type: "input_text", text: "真实用户消息" }] }, "2026-08-30T02:01:00.000Z"),
    row("response_item", { type: "message", role: "assistant", content: [{ type: "output_text", text: "归档里也有的内容。" }] }, "2026-08-30T02:01:10.000Z"),
  ].join("\n") + "\n";
  writeFileSync(join(home, "archived_sessions", `2026-08-30-a-${uuidB}.jsonl`), rollB, "utf8");
  utimesSync(join(home, "archived_sessions", `2026-08-30-a-${uuidB}.jsonl`), new Date("2026-08-30T03:00:00Z"), new Date("2026-08-30T03:00:00Z"));
});

after(() => {
  for (const h of [home, homeCopy, homeEvil]) rmSync(h, { recursive: true, force: true });
});

// ── 用例 ──

test("scan: 递归聚合 sessions + archived_sessions，按线程 id 归组", () => {
  const byId = scanSessionFiles(home);
  assert.equal(byId.size, 2);
  assert.ok(byId.has(uuidA.toLowerCase()));
  assert.ok(byId.has(uuidB.toLowerCase()));
  const b = byId.get(uuidB.toLowerCase());
  assert.equal(b.archived, true, "归档目录里的会话应标 archived");
  const a = byId.get(uuidA.toLowerCase());
  assert.equal(a.archived, false);
  assert.equal(a.files.length, 1);
  assert.equal(a.files[0].rel.replace(/\\/g, "/"), fileRelA, "rel 与源相对路径一致（平台分隔符归一后）");
});

test("buildSessionsBackup: 全量导出含 2 线程、format/version 标记、文件原文完整", () => {
  const backup = buildSessionsBackup(home);
  assert.equal(backup.format, BACKUP_FORMAT);
  assert.equal(backup.version, BACKUP_VERSION);
  assert.equal(backup.threads.length, 2);
  // updatedAt 降序：A（09-01）在前，B（08-30）在后
  assert.equal(backup.threads[0].id.toLowerCase(), uuidA.toLowerCase());
  assert.equal(backup.threads[1].id.toLowerCase(), uuidB.toLowerCase());
  const a = backup.threads.find((t) => t.id.toLowerCase() === uuidA.toLowerCase());
  assert.equal(a.files.length, 1);
  assert.equal(a.files[0].text, rollA, "文件文本必须逐字节保留");
  // extractMeta：名字来自首条非注入 user 消息，cwd 来自 session_meta
  assert.equal(a.meta.name, "帮我看看这个报错");
  assert.equal(a.meta.preview.length > 0, true);
  assert.equal(a.meta.cwd, "D:\\proj\\alpha");
  assert.equal(a.meta.archived, false);
  const b = backup.threads.find((t) => t.id.toLowerCase() === uuidB.toLowerCase());
  assert.equal(b.meta.archived, true);
  assert.equal(b.meta.name, "真实用户消息", "AGENTS.md 注入的首条 user 消息不应成为会话名");
  assert.equal(b.meta.cwd, "D:\\proj\\beta");
});

test("buildSessionsBackup: threadIds 过滤只导出指定会话", () => {
  const one = buildSessionsBackup(home, [uuidB]);
  assert.equal(one.threads.length, 1);
  assert.equal(one.threads[0].id.toLowerCase(), uuidB.toLowerCase());
});

test("buildMarkdownExport: 多会话合集带总览目录，消息按 User/Assistant 交替且无系统注入", () => {
  const out = buildMarkdownExport(home);
  assert.equal(out.count, 2);
  assert.equal(out.totalMessages >= 4, true);
  assert.ok(out.markdown.startsWith("# Codex 会话记录"));
  assert.ok(out.markdown.includes("## 目录"));
  assert.ok(out.markdown.includes("## User"));
  assert.ok(out.markdown.includes("## Assistant"));
  assert.ok(out.markdown.includes("帮我看看这个报错"));
  assert.ok(out.markdown.includes("报错是缺依赖 X，装一下就好。"));
  assert.ok(!out.markdown.includes("# AGENTS.md"), "Markdown 导出必须剔除系统注入块");
  assert.ok(!out.markdown.includes("实际用户问题被注入块隔开"), "注入文本不应泄漏进导出");
});

test("buildMarkdownExport: 单会话导出干净文档（无合集目录）", () => {
  const one = buildMarkdownExport(home, [uuidA]);
  assert.equal(one.count, 1);
  assert.ok(one.markdown.startsWith("# 帮我看看这个报错"));
  assert.ok(!one.markdown.includes("## 目录"));
});

test("applySessionsBackup: 幂等写回副本 imported=2，重放 duplicate 跳过", () => {
  const backup = buildSessionsBackup(home);
  const first = applySessionsBackup(homeCopy, backup);
  assert.equal(first.imported, 2);
  assert.equal(first.skipped, 0);
  assert.equal(first.threads.length, 2);
  assert.ok(first.threads.every((t) => t.status === "ok"));
  // 写回后立即可被扫描到（不依赖引擎索引）
  const byId = scanSessionFiles(homeCopy);
  assert.equal(byId.size, 2);
  // 幂等：同内容重放 → duplicate
  const second = applySessionsBackup(homeCopy, backup);
  assert.equal(second.imported, 0);
  assert.equal(second.skipped, 2);
  assert.ok(second.threads.every((t) => t.status === "duplicate"));
  // 副本文件内容与源一致
  assert.equal(readFileSync(join(homeCopy, fileRelA), "utf8"), rollA);
});

test("applySessionsBackup: 同 rel 异内容 conflict 跳过且绝不覆盖", () => {
  const backup = buildSessionsBackup(home);
  // 篡改备份里 A 的内容后再导入
  const tampered = JSON.parse(JSON.stringify(backup));
  const a = tampered.threads.find((t) => t.id.toLowerCase() === uuidA.toLowerCase());
  a.files[0].text = rollA.replace("报错是缺依赖 X", "报错是缺依赖 Y（被篡改）");
  const result = applySessionsBackup(homeCopy, tampered);
  assert.equal(result.imported, 0, "冲突内容不应导入");
  const aStatus = result.threads.find((t) => t.id.toLowerCase() === uuidA.toLowerCase());
  const bStatus = result.threads.find((t) => t.id.toLowerCase() === uuidB.toLowerCase());
  assert.equal(aStatus.status, "conflict");
  assert.equal(bStatus.status, "duplicate");
  // 原文件未被覆盖
  assert.equal(readFileSync(join(homeCopy, fileRelA), "utf8"), rollA, "conflict 时禁止覆盖已有数据");
});

test("applySessionsBackup: 非法 payload 抛错；路径穿越 rel 被拒", () => {
  assert.throws(() => applySessionsBackup(homeCopy, { format: "other", threads: [] }), /不是有效的/);
  assert.throws(() => applySessionsBackup(homeCopy, null), /不是有效的/);
  // rel 带 .. 或不在 sessions 下 → safeRel 拒绝，不写任何文件
  const evil = {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: Date.now(),
    threads: [{ id: uuid(), meta: { name: "evil" }, files: [{ rel: "../escape.jsonl", text: "x" }] }],
  };
  const res = applySessionsBackup(homeEvil, evil);
  assert.equal(res.imported, 0);
  assert.equal(readdirSync(homeEvil).filter((n) => n !== "sessions" && n !== "archived_sessions").length, 0, "穿越文件不得写出");
});

test("parseMarkdownConversation: 标题/轮次/原文保留", () => {
  const raw = [
    "# 报错排查记录",
    "",
    "## User",
    "为什么报错？",
    "",
    "## Assistant",
    "因为 X。",
    "",
    "## User",
    "怎么修？",
  ].join("\n");
  const parsed = parseMarkdownConversation(raw, "whatever.md");
  assert.equal(parsed.title, "报错排查记录");
  assert.equal(parsed.turns, 2);
  assert.equal(parsed.text, raw.trim());
  // 无标题时回退文件名
  const fallback = parseMarkdownConversation("只有正文没有标题", "我的对话.md");
  assert.equal(fallback.title, "我的对话");
});

test("parseRolloutMessages: 注入块剔除 + 相邻同角色去重", () => {
  const msgs = parseRolloutMessages(rollA + rollB);
  // A：user 去重后 1 条 + assistant 2 条；B：注入 user 剔除 + 真实 user 1 条 + assistant 2 条
  const aTexts = msgs.filter((m) => m.text.includes("报错") || m.text === "好了，谢谢" || m.text.includes("依赖 X") || m.text === "不客气！");
  assert.equal(aTexts.length, 4);
  const allUsers = msgs.filter((m) => m.role === "user").map((m) => m.text);
  assert.equal(allUsers.includes("帮我看看这个报错"), true);
  assert.equal(allUsers.includes("# AGENTS.md\n你是助手。"), false, "注入消息应被剔除");
});

test("真实 codex-home smoke（只读，无会话则跳过）", () => {
  const realHome = join(homedir(), "AppData", "Roaming", "Codex Harness Desktop", "codex-home");
  if (!existsSync(join(realHome, "sessions"))) {
    console.log("  ↳ 真实 codex-home 无会话目录，跳过（仅测试构造数据路径）");
    return;
  }
  const byId = scanSessionFiles(realHome);
  if (!byId.size) {
    console.log("  ↳ 真实 codex-home 无 rollout 会话，跳过");
    return;
  }
  const ids = [...byId.keys()].slice(0, 2);
  const backup = buildSessionsBackup(realHome, ids);
  assert.equal(backup.threads.length, Math.min(2, byId.size));
  for (const t of backup.threads) {
    assert.ok(t.meta.name || t.meta.preview || t.id, "会话应有名字/预览/id");
    assert.ok(t.files.length > 0, "会话应有 rollout 文件");
    assert.ok(t.files.every((f) => f.text.length > 0), "rollout 文件内容非空");
  }
  const md = buildMarkdownExport(realHome, ids);
  assert.equal(md.count, backup.threads.length);
  assert.ok(md.markdown.length > 0);
  // 输出只读统计，不回显任何会话内容
  console.log(`  ↳ 真实会话 smoke OK：${backup.threads.length} 线程，${md.totalMessages} 条消息（仅统计）`);
});

console.log("\n临时目录已由 after 钩子清理");
