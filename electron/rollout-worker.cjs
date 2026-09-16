/**
 * electron/rollout-worker.cjs —— rollout 磁盘 I/O 的 worker 线程
 *
 * 为什么需要它（2026-09-12 多会话性能「零阻塞宿主」）：
 * 所有会话共用**同一个主进程事件循环**，而 rollout 的扫描/解析是**同步**文件 I/O
 * （readdirSync / readFileSync / statSync + 逐行 JSON.parse）。它一旦出现在
 * `codex:request` 的处理链上，那段时间里**所有会话**的事件转发全部停摆 ——
 * 这正是「多会话一起卡」的形态。把这块整体挪到 worker 线程后，主进程只剩内存操作。
 *
 * 设计：
 *   · worker 内自带缓存（rolloutListCache / parseRollout 的增量游标），跨请求复用；
 *   · 通过 postMessage 收请求、回结果；主进程侧用 Promise 配对（见 rollout-pool.ts）。
 *   · 用 .cjs 独立文件而不是 `new Worker(源码字符串, {eval:true})`：本文件不被打包进
 *     asar（见 package.json 的 asarUnpack / extraResources），路径由主进程传入，
 *     因此不存在「asar 内 worker 读不到文件」的坑。
 *
 * 协议：
 *   请求  { id, op: "list", root }                      → 回 { id, ok, data }
 *   请求  { id, op: "enrich", thread, root }             → 回 { id, ok, data }
 *   出错  回 { id, ok: false, error }
 */

"use strict";

const { readdirSync, readFileSync, statSync, openSync, readSync, closeSync, existsSync } = require("node:fs");
const path = require("node:path");

// ── 缓存（worker 常驻，跨请求复用）──────────────────────────────────────
const rolloutListCache = new Map();   // 路径 -> { mtimeMs, size, entry }
const rolloutPathCache = new Map();   // threadId -> rollout 路径
const rolloutParseCache = new Map();  // 路径 -> 增强解析结果（含增量游标）

/** 剥离 harness 首条消息的任务包装（[SYSTEM TASK …]/=== 用户需求 ===/=== END === 模板），还原用户原文。
 *  ⛔ 09-16 修 Bug 14：与 electron/thread-backup.ts 的 stripSystemTaskWrapper **必须同源**。
 *  旧实现（这里只做 text.startsWith 三个前缀的判断、完全不剥注入块）与 thread-backup.ts
 *  的 extractMeta 漂移了：同一份 rollout，侧栏标题显示「# 交易分析专家团\n你是本专家团的主理人…」
 *  这种**机器编排提示词**，而备份/导出显示的是用户真正输入的那句话（实测 36 条里 4 条不一致）。
 *  两个文件都写着「同口径」，所以注释不能当证据 —— 改一处必须改另一处。 */
function stripSystemTaskWrapper(text) {
  const match = text.match(/\[SYSTEM TASK[^\]]*\]\s*=== 用户需求 ===\s*\n?([\s\S]*?)\s*\n=== END ===/);
  if (match && match[1].trim()) return match[1].trim();
  return text;
}

/** harness 发送管线注入的机器可读块：记忆召回 / 技能引用。剥离后还原用户真实输入。 */
function stripHarnessBlocks(text) {
  let out = stripSystemTaskWrapper(text);
  out = out.replace(/\[Harness 相关记忆，仅供参考\][\s\S]*?\[记忆结束\]/g, "");
  out = out.replace(/\[本轮已引用技能\][\s\S]*?\[请按上述技能工作流执行\]/g, "");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/** 仍然算「注入」的消息前缀（与 thread-backup.ts 的 MD_INJECT_PREFIXES 同源） */
const INJECT_PREFIXES = ["# AGENTS.md", "<INSTRUCTIONS>", "<environment_context>", "<filesystem>", "<danger-zone>", "<approval>"];
function looksInjected(text) {
  const trimmed = String(text).trimStart();
  return INJECT_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/** 解析单个 rollout 文件、取出侧栏需要的元数据。按 mtime+size 缓存。 */
function readRolloutListEntry(full, id, archived) {
  let stat;
  try { stat = statSync(full); } catch { return null; }
  const cached = rolloutListCache.get(full);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.entry;
  let title = "";
  let preview = "";
  let cwd = "";
  let updatedAt = stat.mtimeMs;
  try {
    for (const line of readFileSync(full, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      const payload = row && row.payload ? row.payload : {};
      const meta = payload.internal_chat_message_metadata_passthrough;
      if (row.type === "session_meta" && payload.cwd) cwd = cwd || String(payload.cwd);
      if (row.type === "turn_context" && payload.cwd) cwd = cwd || String(payload.cwd);
      if (payload.type === "message" && payload.role === "user") {
        // 先剥 harness 注入块再判定/取标题（与 thread-backup.ts 的 extractMeta 同口径，见上方说明）
        const cleaned = stripHarnessBlocks((payload.content || [])
          .filter((part) => part && part.type === "input_text")
          .map((part) => String(part.text || ""))
          .join("\n")
          .trim());
        const isUserPrompt = (meta && meta.content_item_kinds && meta.content_item_kinds.includes && meta.content_item_kinds.includes("user.text")) || !(meta && meta.content_item_kinds);
        if (cleaned && isUserPrompt && !looksInjected(cleaned)) {
          if (!title) title = cleaned.slice(0, 80);
          preview = cleaned.slice(0, 160);
        }
        cwd = cwd || String((meta && meta.cwd) || "");
      }
      if (row.type === "event_msg" && payload.type === "task_complete") {
        const text = String(payload.last_agent_message || "").trim();
        if (text) preview = text.slice(0, 160);
      }
      if (row.type === "event_msg" && payload.type === "task_started") {
        const started = Number(payload.started_at);
        if (Number.isFinite(started)) updatedAt = Math.max(updatedAt, started * 1000);
      }
    }
  } catch { return null; }
  const entry = {
    id,
    name: title || preview || "未命名任务",
    preview: preview || title || "",
    cwd,
    updatedAt,
    status: { type: "completed" },
    archived,
  };
  rolloutListCache.set(full, { mtimeMs: stat.mtimeMs, size: stat.size, entry });
  return entry;
}

/** 侧栏会话列表兜底扫描（目录遍历 + 单文件缓存解析）。 */
function listRolloutThreads(root) {
  const roots = [path.join(root, "sessions"), path.join(root, "archived_sessions")];
  const out = [];
  const seen = new Set();
  for (const base of roots) {
    if (!existsSync(base)) continue;
    const archived = base.endsWith("archived_sessions");
    const stack = [base];
    while (stack.length) {
      const current = stack.pop();
      let entries;
      try { entries = readdirSync(current, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) { stack.push(full); continue; }
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const match = entry.name.match(/-([0-9a-f]{8}-[0-9a-f-]{27,})\.jsonl$/i);
        if (!match || seen.has(match[1])) continue;
        const parsed = readRolloutListEntry(full, match[1], archived);
        if (!parsed) continue;
        seen.add(match[1]);
        out.push(parsed);
      }
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

// ── 增强解析（把 rollout 里的工具调用补进 thread）──────────────────────
function findRolloutFile(root, threadId) {
  const cached = rolloutPathCache.get(threadId);
  if (cached && existsSync(cached)) return cached;
  const roots = [path.join(root, "sessions"), path.join(root, "archived_sessions")];
  for (const base of roots) {
    if (!existsSync(base)) continue;
    const stack = [base];
    while (stack.length) {
      const current = stack.pop();
      let entries;
      try { entries = readdirSync(current, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.isFile() && entry.name.endsWith(".jsonl") && entry.name.includes(threadId)) {
          rolloutPathCache.set(threadId, full);
          return full;
        }
      }
    }
  }
  return "";
}

function consumeRolloutLines(text, state) {
  const { turns, outputs, callTurns, turnAliases } = state;
  const push = (turnId, record) => {
    if (!turnId) return;
    const list = turns.get(turnId) || [];
    list.push(record);
    turns.set(turnId, list);
  };
  const lines = text.split("\n");
  const tail = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || row.type !== "response_item") continue;
    const item = row.payload || {};
    const metaTurn = String((item.internal_chat_message_metadata_passthrough && item.internal_chat_message_metadata_passthrough.turn_id) || "");
    if (item.type === "function_call") {
      const callId = String(item.call_id || item.id || "");
      if (!callId || !metaTurn) continue;
      callTurns.set(callId, metaTurn);
      push(metaTurn, { kind: "tool", id: String(item.id || callId), callId, name: String(item.name || "tool"), arguments: String(item.arguments || "") });
    } else if (item.type === "function_call_output") {
      const callId = String(item.call_id || "");
      if (callId) {
        outputs.set(callId, String(item.output || ""));
        const upstreamTurn = callTurns.get(callId);
        if (metaTurn && upstreamTurn && metaTurn !== upstreamTurn) turnAliases.set(metaTurn, upstreamTurn);
      }
    } else if (item.type === "reasoning" && item.id && metaTurn) {
      push(metaTurn, { kind: "item", id: String(item.id), itemType: "reasoning" });
    } else if (item.type === "message" && item.id && metaTurn && item.role === "assistant") {
      push(metaTurn, { kind: "item", id: String(item.id), itemType: "agentMessage" });
    }
  }
  return tail;
}

function parseRollout(filePath) {
  const stat = statSync(filePath);
  const { mtimeMs, size } = stat;
  const cached = rolloutParseCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached;
  // 追加场景：只解析新增部分（会话在跑时 rollout 持续变长）
  if (cached && size > cached.size && cached.bytesConsumed === cached.size) {
    try {
      const fd = openSync(filePath, "r");
      let chunk = "";
      try {
        const buffer = Buffer.alloc(size - cached.bytesConsumed);
        const read = readSync(fd, buffer, 0, buffer.length, cached.bytesConsumed);
        chunk = buffer.subarray(0, read).toString("utf8");
      } finally { closeSync(fd); }
      const state = { turns: cached.turns, outputs: cached.outputs, callTurns: cached.callTurns, turnAliases: cached.turnAliases };
      cached.pendingTail = consumeRolloutLines(cached.pendingTail + chunk, state);
      cached.bytesConsumed = size;
      cached.size = size;
      cached.mtimeMs = mtimeMs;
      return cached;
    } catch { /* 增量失败 → 落到全量 */ }
  }
  const turns = new Map();
  const outputs = new Map();
  const callTurns = new Map();
  const turnAliases = new Map();
  const pendingTail = consumeRolloutLines(readFileSync(filePath, "utf8"), { turns, outputs, callTurns, turnAliases });
  const parsed = { mtimeMs, turns, outputs, turnAliases, callTurns, bytesConsumed: size, size, pendingTail };
  rolloutParseCache.set(filePath, parsed);
  return parsed;
}

function parsedArguments(raw) { try { return JSON.parse(raw); } catch { return raw; } }

function outputMeta(output) {
  const exitCode = Number((/Process exited with code\s+(-?\d+)/i.exec(output) || [])[1] || 0);
  const seconds = Number((/Wall time:\s*([\d.]+)\s*seconds/i.exec(output) || [])[1] || 0);
  return { exitCode: Number.isFinite(exitCode) ? exitCode : 0, durationMs: seconds > 0 ? Math.round(seconds * 1000) : undefined };
}

function syntheticTool(record, output) {
  const args = parsedArguments(record.arguments);
  const meta = outputMeta(output);
  if (record.name === "exec_command" || record.name === "write_stdin") {
    const command = typeof args === "object" ? String(args.cmd || args.command || (record.name === "write_stdin" ? `write_stdin ${args.chars || ""}` : record.arguments)) : record.arguments;
    return { id: record.id, type: "commandExecution", command, aggregatedOutput: output, status: meta.exitCode ? "failed" : "completed", exitCode: meta.exitCode, durationMs: meta.durationMs, callId: record.callId };
  }
  return { id: record.id, type: "dynamicToolCall", tool: record.name, arguments: args, result: output, status: meta.exitCode ? "failed" : "completed", durationMs: meta.durationMs, callId: record.callId };
}

function enrichThreadWithRolloutTools(thread, root) {
  if (!thread || !thread.id || !Array.isArray(thread.turns)) return thread;
  const filePath = findRolloutFile(root, String(thread.id));
  if (!filePath) return thread;
  let parsed;
  try { parsed = parseRollout(filePath); } catch { return thread; }
  let changed = false;
  const assignedRecordGroups = new Set();
  const recordGroups = [...parsed.turns.entries()];
  const turns = thread.turns.map((turn) => {
    const existing = Array.isArray(turn.items) ? turn.items : [];
    const localTurnId = String(turn.id);
    let recordKey = parsed.turns.has(localTurnId) ? localTurnId : (parsed.turnAliases.get(localTurnId) || "");
    let records = recordKey ? parsed.turns.get(recordKey) : undefined;
    if (!records || !records.some((r) => r.kind === "tool") || assignedRecordGroups.has(recordKey)) {
      const existingIds = new Set(existing.map((item) => String((item && item.id) || "")).filter(Boolean));
      let bestScore = 0;
      let bestHasTool = false;
      for (const [candidateKey, candidate] of recordGroups) {
        if (assignedRecordGroups.has(candidateKey)) continue;
        const score = candidate.reduce((count, record) => count + (record.kind === "item" && existingIds.has(record.id) ? 1 : 0), 0);
        const hasTool = candidate.some((record) => record.kind === "tool");
        if (score > bestScore || (score === bestScore && score > 0 && hasTool && !bestHasTool)) {
          bestScore = score;
          bestHasTool = hasTool;
          recordKey = candidateKey;
          records = candidate;
        }
      }
    }
    if (!records || !records.some((r) => r.kind === "tool")) return turn;
    if (recordKey) assignedRecordGroups.add(recordKey);
    const byId = new Map(existing.map((item) => [String(item.id), item]));
    const used = new Set();
    const items = [];
    for (const record of records) {
      if (record.kind === "item") {
        let item = byId.get(record.id);
        let key = item ? String(item.id) : "";
        if (!item) {
          const candidates = existing.filter((candidate) => candidate.type === record.itemType && !used.has(String(candidate.id)));
          item = candidates[0];
          if (item) key = String(item.id);
        }
        if (item && key && !used.has(key)) { items.push(item); used.add(key); }
        continue;
      }
      const existingTool = existing.find((item) => String(item.id) === record.id || String(item.callId || item.call_id || "") === record.callId);
      if (existingTool) {
        const key = String(existingTool.id);
        if (!used.has(key)) { items.push(existingTool); used.add(key); }
      } else {
        items.push(syntheticTool(record, parsed.outputs.get(record.callId) || ""));
        changed = true;
      }
    }
    for (const item of existing) {
      const key = String(item.id);
      if (!used.has(key)) items.push(item);
    }
    return items.length === existing.length && items.every((item, index) => item === existing[index]) ? turn : Object.assign({}, turn, { items });
  });
  return changed || turns.some((turn, index) => turn !== thread.turns[index]) ? Object.assign({}, thread, { turns }) : thread;
}

// ── 消息循环 ─────────────────────────────────────────────────────────
const { parentPort } = require("node:worker_threads");
if (parentPort) {
  parentPort.on("message", (msg) => {
    const id = msg && msg.id;
    try {
      if (msg.op === "list") {
        parentPort.postMessage({ id, ok: true, data: listRolloutThreads(String(msg.root || "")) });
      } else if (msg.op === "enrich") {
        parentPort.postMessage({ id, ok: true, data: enrichThreadWithRolloutTools(msg.thread, String(msg.root || "")) });
      } else {
        parentPort.postMessage({ id, ok: false, error: `unknown op: ${msg.op}` });
      }
    } catch (error) {
      parentPort.postMessage({ id, ok: false, error: String((error && error.message) || error) });
    }
  });
}
