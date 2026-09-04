// 用户消息引用解析纯函数单测（node:test，零新依赖）。
// 用法: node scripts/verify-user-refs.mjs
// 流程: 用 tsc 把 src/lib/user-refs.ts 编译成 CJS 到 .test-tmp/，再 require 跑断言。
// 覆盖: 团队/成员会话 SYSTEM TASK 段、附件/技能/上下文剥离、userDisplayText、
//       firstUserTextInTurn、无 SYSTEM TASK 老消息、正文含协议关键字的边界。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmpDir = join(root, ".test-tmp");
const outFile = join(tmpDir, "user-refs.js");
const tscBin = join(root, "node_modules", "typescript", "bin", "tsc");

if (!existsSync(tscBin)) {
  console.error("FATAL: typescript not installed");
  process.exit(1);
}
mkdirSync(tmpDir, { recursive: true });
rmSync(outFile, { force: true });
execFileSync(process.execPath, [
  tscBin,
  join(root, "src", "lib", "user-refs.ts"),
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
const refs = require(outFile);

// ── 测试辅助 ──
const userMsg = (text) => ({ id: "u", type: "userMessage", content: [{ type: "text", text }] });
const turn = (items) => ({ id: "t", status: "completed", items });

// main.ts 里 teams:start-session 注入的真实模板形态
const teamTemplate = (task) => `[SYSTEM TASK · 团队会话]\n=== 用户需求 ===\n${task}\n=== END ===\n\n请按 SOP 编排团队完成任务，把结果直接交给用户，不要再请用户复述。`;
const memberTemplate = (task) => `[SYSTEM TASK · 成员会话]\n=== 用户需求 ===\n${task}\n=== END ===\n\n请直接完成任务，无需复述需求。`;

// ============ SYSTEM TASK 段（团队/成员会话首条） ============
test("团队会话: kind=team、requirement 提取、cleanText 为空", () => {
  const raw = teamTemplate("帮我做一个项目管理的看板");
  const parsed = refs.parseUserRefs(raw);
  assert.equal(parsed.teamTask?.kind, "team");
  assert.equal(parsed.teamTask?.requirement, "帮我做一个项目管理的看板");
  assert.equal(parsed.cleanText, ""); // 编排指令整段被折叠
  assert.deepEqual(parsed.files, []);
  assert.deepEqual(parsed.skills, []);
  assert.deepEqual(parsed.contexts, []);
});

test("成员会话: kind=member", () => {
  const parsed = refs.parseUserRefs(memberTemplate("帮我修一下登录页的 bug"));
  assert.equal(parsed.teamTask?.kind, "member");
  assert.equal(parsed.teamTask?.requirement, "帮我修一下登录页的 bug");
});

test("超长多行需求 + 特殊字符原样保留", () => {
  const task = "第一行需求：接入微信支付\n第二行：\u201c引号\u201d 和 \\反斜杠/ 和 emoji 🚀\n\n第三行空行后\n结尾";
  const parsed = refs.parseUserRefs(teamTemplate(task));
  assert.equal(parsed.teamTask?.requirement, task);
  assert.equal(refs.userDisplayText(teamTemplate(task)), task);
});

test("需求正文里再次出现 === 用户需求 === 不误伤（捕获到 END 才停）", () => {
  const task = "需求一：改标题\n=== 用户需求 ===\n需求二：改文案";
  const parsed = refs.parseUserRefs(teamTemplate(task));
  assert.equal(parsed.teamTask?.requirement, task);
});

test("userDisplayText 对 SYSTEM TASK 消息返回用户原文，不泄漏角色提示/SOP", () => {
  const raw = teamTemplate("写一个周报生成器") + "这是角色提示和 SOP 指令，绝不能出现在对外文本里";
  assert.equal(refs.userDisplayText(raw), "写一个周报生成器");
});

// ============ 导入会话记录段（外部 md 记录随首条消息附上） ============
const importTemplate = (userText) => `[导入的会话记录]
来源文件：chat-history.md ｜ 原会话：帮我修 bug ｜ 4 条消息 ｜ 导入于 2026-09-03 07:20
=== 记录内容 ===
# 帮我修 bug

## User
登录页报错

## Assistant
看一下控制台

（记录正文里恰好出现 [附件文件] 等伪引用字样也不能被误剥）
=== 记录结束 ===

${userText}`;

test("导入记录: imported 提取、cleanText=用户正文、记录内伪引用字样不误伤", () => {
  const raw = importTemplate("接着上面的问题继续，帮我给出修复方案");
  const parsed = refs.parseUserRefs(raw);
  assert.ok(parsed.imported, "应解析出 imported");
  assert.match(parsed.imported.note, /来源文件：chat-history\.md/);
  assert.match(parsed.imported.content, /# 帮我修 bug/);
  assert.match(parsed.imported.content, /\[附件文件\]/); // 记录全文原样保留
  assert.equal(parsed.cleanText, "接着上面的问题继续，帮我给出修复方案");
  assert.equal(refs.userDisplayText(raw), "接着上面的问题继续，帮我给出修复方案");
  assert.equal(parsed.teamTask, undefined);
  assert.deepEqual(parsed.files, []);
});

test("导入记录在用户正文为空时 cleanText 为空、不炸", () => {
  const parsed = refs.parseUserRefs(importTemplate(""));
  assert.ok(parsed.imported);
  assert.equal(parsed.cleanText, "");
});

// ============ 通过会话 ID 引用本机会话记录 ============
const threadRefTemplate = (id, title, content) => `[引用的会话记录]
会话 ID：${id}
会话名称：${title} ｜ 4 条消息
=== 记录内容 ===
${content}
=== 记录结束 ===`;

test("会话引用: 记录折叠提取，气泡只保留用户问题", () => {
  const id = "019c1234-5678-7abc-9def-0123456789ab";
  const raw = `帮我继续处理这个问题\n\n${threadRefTemplate(id, "修复登录问题", "## User\n登录报错\n\n## Assistant\n正在检查\n[附件文件]")}`;
  const parsed = refs.parseUserRefs(raw);
  assert.equal(parsed.cleanText, "帮我继续处理这个问题");
  assert.equal(parsed.threadReferences.length, 1);
  assert.equal(parsed.threadReferences[0].id, id);
  assert.match(parsed.threadReferences[0].note, /修复登录问题/);
  assert.match(parsed.threadReferences[0].content, /\[附件文件\]/);
  assert.deepEqual(parsed.files, []);
});

test("会话引用: 一条消息可以引用多个会话", () => {
  const first = threadRefTemplate("019c1111-1111-7111-8111-111111111111", "会话一", "## User\n一");
  const second = threadRefTemplate("019c2222-2222-7222-8222-222222222222", "会话二", "## Assistant\n二");
  const parsed = refs.parseUserRefs(`${first}\n\n${second}\n\n综合比较`);
  assert.equal(parsed.threadReferences.length, 2);
  assert.equal(parsed.cleanText, "综合比较");
  assert.equal(refs.userDisplayText(`${first}\n\n${second}\n\n综合比较`), "综合比较");
});

// ============ 附件/技能/上下文段剥离 ============
test("cleanText 剥离附件/技能/上下文三件套，保留用户正文", () => {
  const raw = `帮我总结这份代码

[附件文件]
- C:\\foo\\bar.ts
- src/App.tsx
[附件结束]

[本轮已引用技能]
- 代码审查：检查潜在 bug
[请按上述技能工作流执行]

[用户指定的对话上下文]
(1) 用户：这是需求背景

(2) 系统：这是约束

[上下文结束]`;
  const parsed = refs.parseUserRefs(raw);
  assert.deepEqual(parsed.files, ["C:\\foo\\bar.ts", "src/App.tsx"]);
  assert.deepEqual(parsed.skills, [{ name: "代码审查", description: "检查潜在 bug" }]);
  assert.deepEqual(parsed.contexts, [
    { role: "用户", text: "这是需求背景" },
    { role: "系统", text: "这是约束" },
  ]);
  assert.equal(parsed.cleanText, "帮我总结这份代码");
  assert.equal(parsed.teamTask, undefined);
  assert.equal(refs.userDisplayText(raw), "帮我总结这份代码");
});

test("无任何引用段的老消息原样返回 cleanText", () => {
  const raw = "你好，帮我看看这个报错：\n\nTypeError: x is not a function";
  const parsed = refs.parseUserRefs(raw);
  assert.equal(parsed.teamTask, undefined);
  assert.equal(parsed.cleanText, raw.trim());
  assert.equal(refs.userDisplayText(raw), raw.trim());
});

test("空文本/undefined 不炸", () => {
  assert.equal(refs.parseUserRefs("").cleanText, "");
  assert.equal(refs.parseUserRefs(undefined).cleanText, "");
  assert.equal(refs.userDisplayText(""), "");
});

test("乐观消息确认: 本地含隐藏记忆段、服务端只返回可见正文仍匹配", () => {
  const input = [{ type: "text", text: "哈喽\n\n[Harness 相关记忆，仅供参考]\n项目背景\n[记忆结束]" }];
  const server = { content: [{ type: "text", text: "哈喽" }] };
  assert.equal(refs.userMessageMatchesInput(server, input), true);
});

test("乐观消息确认: 纯图片消息按路径与顺序匹配", () => {
  const input = [{ type: "localImage", path: "D:\\image-a.png" }, { type: "localImage", path: "D:\\image-b.png" }];
  assert.equal(refs.userMessageMatchesInput({ content: [...input] }, input), true);
  assert.equal(refs.userMessageMatchesInput({ content: [input[1], input[0]] }, input), false);
});

// ============ firstUserTextInTurn ============
test("取回合首个 userMessage 的对外文本（跳过前置 reasoning）", () => {
  const t = turn([
    { id: "r", type: "reasoning", text: "思考中" },
    userMsg("帮我写个脚本"),
    { id: "a", type: "agentMessage", text: "好的" },
  ]);
  assert.equal(refs.firstUserTextInTurn(t), "帮我写个脚本");
});

test("团队会话首条消息的标题取用户需求原文", () => {
  const t = turn([userMsg(teamTemplate("做一个数据看板"))]);
  assert.equal(refs.firstUserTextInTurn(t), "做一个数据看板");
});

test("无 userMessage / 空 items 返回空串", () => {
  assert.equal(refs.firstUserTextInTurn({ items: [] }), "");
  assert.equal(refs.firstUserTextInTurn({}), "");
  assert.equal(refs.firstUserTextInTurn(turn([{ id: "a", type: "agentMessage", text: "hi" }])), "");
});

// ============ cleanThreadDisplayTitle ============
test("清洗: 含 harness 注入块的脏命名只保留首句原文", () => {
  const raw = "哈喽 [Harness 相关记忆，仅供参考] [项目背景] 哈喽，潛潛！有什么想让我帮忙的？";
  assert.equal(refs.cleanThreadDisplayTitle(raw), "哈喽");
});

test("清洗: 系统任务包装的命名透传 requirement", () => {
  const raw = teamTemplate("扫描最近的 CI 任务运行，列出失败任务");
  assert.equal(refs.cleanThreadDisplayTitle(raw), "扫描最近的 CI 任务运行，列出失败任务");
});

test("清洗: 导入记录块外层 raw 时先剥 imported 再取原文", () => {
  const raw = importTemplate("继续修 bug");
  // 外层 raw 含 imported 块 + 用户正文，但用户正文"继续修 bug"才是真正的标题
  assert.equal(refs.cleanThreadDisplayTitle(raw), "继续修 bug");
});

test("清洗: 短/数字命名原样保留（用户真有给纯数字命名）", () => {
  assert.equal(refs.cleanThreadDisplayTitle("1"), "1");
  assert.equal(refs.cleanThreadDisplayTitle("11"), "11");
  assert.equal(refs.cleanThreadDisplayTitle("1e1"), "1e1");
});

test("清洗: 超长标题按 maxLength 截断并补省略号", () => {
  const raw = "扫描最近的 CI 任务运行，列出失败任务与可能原因，并按影响范围给出修复建议；扫描最近的 CI 任务运行，列出失败任务与可能原因，并按影响范围给出修复建议；";
  // 默认 maxLength=60 → 应被截断
  const cleaned = refs.cleanThreadDisplayTitle(raw);
  assert.ok(cleaned.length <= 61, `长度应<=61 实际 ${cleaned.length}`);
  assert.match(cleaned, /…$/);
  // 显式 maxLength=10 也应被截断
  const short = refs.cleanThreadDisplayTitle("扫描最近的 CI 任务运行", { maxLength: 10 });
  assert.ok(short.length <= 11);
  assert.match(short, /…$/);
});

test("清洗: 首行有内容时只取首行（多行贴入）", () => {
  const raw = "扫描最近的 CI 运行\n列出失败与不稳定测试及其可能原因。";
  assert.equal(refs.cleanThreadDisplayTitle(raw), "扫描最近的 CI 运行");
});

test("清洗: raw 为空/null 时回退到 preview", () => {
  assert.equal(refs.cleanThreadDisplayTitle("", { preview: "执行 CI 周报" }), "执行 CI 周报");
  assert.equal(refs.cleanThreadDisplayTitle(null, { preview: "执行 CI 周报" }), "执行 CI 周报");
  assert.equal(refs.cleanThreadDisplayTitle(undefined, { preview: "执行 CI 周报" }), "执行 CI 周报");
});

test("清洗: raw 与 preview 都为空时回退到 fallback", () => {
  assert.equal(refs.cleanThreadDisplayTitle("", { preview: "", fallback: "未命名会话" }), "未命名会话");
  assert.equal(refs.cleanThreadDisplayTitle(null), "未命名会话");
  assert.equal(refs.cleanThreadDisplayTitle(undefined), "未命名会话");
  assert.equal(refs.cleanThreadDisplayTitle("   \n  \t"), "未命名会话");
});

test("清洗: 同时含 harness 块与 SYSTEM TASK 时只取用户原文", () => {
  const raw = `[Harness 相关记忆，仅供参考]\n[项目背景]\n某项目\n[记忆结束]\n${teamTemplate("开始扫描")}`;
  assert.equal(refs.cleanThreadDisplayTitle(raw), "开始扫描");
});

// ============ 引用会话记录：生成 ↔ 解析 对称性（协议两侧同文件守护） ============

test("对称: build → format → parse 往返无损（id/note/content 一致）", () => {
  const payload = refs.buildThreadReferencePayload("aabbccdd-1122-3344-5566-778899aabbcc", "帮我修登录 bug", [
    { role: "user", text: "登录页 500" },
    { role: "assistant", text: "已定位：token 过期未刷新" },
  ]);
  assert.ok(payload);
  const block = refs.formatThreadReferenceBlock(payload);
  const parsed = refs.parseUserRefs(`帮我参考这个会话\n\n${block}`);
  assert.equal(parsed.threadReferences.length, 1);
  assert.equal(parsed.threadReferences[0].id, payload.id);
  assert.equal(parsed.threadReferences[0].note, payload.note);
  assert.equal(parsed.threadReferences[0].content, payload.content);
  assert.equal(parsed.cleanText, "帮我参考这个会话"); // 协议块不进正文
});

test("防御: 会话名含换行时 note 仍单行、解析不失配", () => {
  const payload = refs.buildThreadReferencePayload("aabbccdd-1122-3344-5566-778899aabbcc", "第一行名字\n第二行名字", [
    { role: "user", text: "你好" },
    { role: "assistant", text: "在的" },
  ]);
  assert.ok(payload);
  assert.ok(!payload.note.includes("\n"), "note 必须单行");
  const parsed = refs.parseUserRefs(refs.formatThreadReferenceBlock(payload));
  assert.equal(parsed.threadReferences.length, 1, "多行名生成的块必须仍可解析");
  assert.equal(parsed.threadReferences[0].id, payload.id);
});

test("载荷: 空消息全部被过滤返回 null；超长内容截取尾部", () => {
  assert.equal(refs.buildThreadReferencePayload("aabbccdd-1122-3344-5566-778899aabbcc", "空会话", [
    { role: "user", text: "  \n  " },
  ]), null);
  const big = refs.buildThreadReferencePayload("aabbccdd-1122-3344-5566-778899aabbcc", "长会话", [
    { role: "user", text: "HEAD_MARKER" + "x".repeat(200_000) },
  ]);
  assert.ok(big);
  assert.ok(big.note.includes("已截取最近内容"));
  assert.ok(big.content.includes("HEAD_MARKER") === false, "截断后应丢弃较早内容");
  assert.ok(big.content.length <= 160_000 + 100);
});

test("提取: 标记形式 / 裸 UUID / 上限 3 个 / 去重", () => {
  const id1 = "11111111-2222-3333-4444-555555555555";
  const id2 = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const id3 = "99999999-8888-7777-6666-555555555555";
  const id4 = "dddddddd-cccc-bbbb-aaaa-999999999999";
  assert.deepEqual(refs.extractThreadReferenceIds(`会话 ID：${id1}`), [id1]);
  assert.deepEqual(refs.extractThreadReferenceIds(`任务ID:${id1}`), [id1]); // 半角冒号 + 无空格
  assert.deepEqual(refs.extractThreadReferenceIds(id1), [id1]); // 整条消息就是裸 UUID
  assert.deepEqual(refs.extractThreadReferenceIds(`${id1}\n\n会话 ID：${id1.toUpperCase()}`), [id1]); // 去重不区分大小写
  assert.deepEqual(refs.extractThreadReferenceIds(`会话 ID：${id1}\n会话 ID：${id2}\n会话 ID：${id3}\n会话 ID：${id4}`), [id1, id2, id3]); // 上限 3
  assert.deepEqual(refs.extractThreadReferenceIds("没有 ID 的普通消息"), []);
});

test("剥离: 标记移除、裸 UUID 清空、多空行压缩", () => {
  const id1 = "11111111-2222-3333-4444-555555555555";
  assert.equal(refs.stripThreadReferenceIds(`看看这个 会话 ID：${id1}\n\n后续问题`), "看看这个 \n\n后续问题".replace(/\n{3,}/g, "\n\n").trim());
  assert.equal(refs.stripThreadReferenceIds(id1), ""); // 只粘了个 ID → 正文为空但引用仍发送
  assert.equal(refs.stripThreadReferenceIds("普通消息保持不变"), "普通消息保持不变");
});

console.log(`\n${tmpDir} 产物可删: user-refs.js（node scripts/verify-user-refs.mjs 每次重建）`);
