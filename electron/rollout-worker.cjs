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
 *   请求  { id, op: "purge", root, ids }                 → 回 { id, ok, data:{ removed, failed, kept } }
 *   请求  { id, op: "healLineage", root }                → 回 { id, ok, data:{ healed, failed } }
 *   出错  回 { id, ok: false, error }
 */

"use strict";

const { readdirSync, readFileSync, writeFileSync, renameSync, statSync, openSync, readSync, closeSync, existsSync, unlinkSync } = require("node:fs");
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

/** ⛔ 永久删除线程时清理磁盘残留（09-18 用户实测：「我删除了，重启又恢复了」）。
 *
 *  为什么必须由 harness 自己删：引擎的 `thread/delete` 只把线程从**索引**里摘掉，
 *  磁盘上的 rollout 文件原样留着；而 `thread/list` 带 rollout 兜底扫描（见
 *  electron/main.ts 的 thread/list 分支），它把「索引里没有、磁盘上有」的会话当
 *  权威源合回侧栏 ⇒ 删掉的会话重启后又冒出来（用户机上实测 12 条幽灵会话，
 *  侧栏分组名与它们的 cwd 一一对应）。
 *
 *  匹配方式：文件名尾部 uuid（`rollout-<时间戳>-<uuid>.jsonl`），**不要用 includes**
 *  ——短 id 会误伤别的 rollout。唯一例外是历史遗留的非标准命名（时间戳位置带了短 id），
 *  那种靠 `endsWith` 兜不住，但它同样只在「索引里已无该线程」时才可能残留。
 */
// ── 血缘（rollout 首行的 session_meta）──────────────────────────────────
// ⛔⛔ 09-19 用户实测：归档/删除一条会话后，**另一个会话**报
//   `invalid paginated history lineage for <源 id>: missing source rollout`，那个会话彻底打不开。
//   根因：分支/接力/专家团派生出来的会话，其 rollout 首行记着 `forked_from_id` 指向**源会话**，
//   引擎打开子会话时要沿血缘去读源 rollout；而我们的删除收尾（purge）把源文件直接删了 ⇒ 血缘断链。
//   所以：**删任何 rollout 之前，必须先确认没有别的活着的会话依赖它**。
//   ⛔ 09-19 实测教训：真正的血缘载体是 **`history_base`**（`{thread_id, end_ordinal_exclusive,
//   end_byte_offset}`），引擎报错 `invalid paginated history lineage for <history_base.thread_id>:
//   missing source rollout` 就是它。只摘 `forked_from_id` 那一组**不够**——文件层面看着"血缘已摘"，
//   引擎照样报错（为这个漏项白跑两轮真机验证）。改血缘字段表时务必连 history_base 一起。
const LINEAGE_KEYS = ["forked_from_id", "forked_from_ordinal_exclusive", "parent_thread_id", "history_base"];

/** 遍历 sessions/ 与 archived_sessions/ 下的全部 rollout 文件 */
function walkRolloutFiles(root) {
  const out = [];
  for (const base of [path.join(root, "sessions"), path.join(root, "archived_sessions")]) {
    if (!existsSync(base)) continue;
    const stack = [base];
    while (stack.length) {
      const current = stack.pop();
      let entries;
      try { entries = readdirSync(current, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(full);
      }
    }
  }
  return out;
}

/** 只读文件第一行（session_meta 所在行）。首行超长（含 dynamic_tools）时退化为整文件读。 */
function readFirstLine(file, maxBytes = 512 * 1024) {
  let fd;
  try {
    fd = openSync(file, "r");
    const buf = Buffer.alloc(maxBytes);
    const read = readSync(fd, buf, 0, maxBytes, 0);
    const text = buf.subarray(0, read).toString("utf8");
    const nl = text.indexOf("\n");
    if (nl >= 0) return text.slice(0, nl);
    return readFileSync(file, "utf8").split("\n")[0];
  } catch {
    return "";
  } finally {
    try { if (fd !== undefined) closeSync(fd); } catch { /* 忽略 */ }
  }
}

/** 解析一个 rollout 的 session_meta（拿不到返回 null） */
function readSessionMeta(file) {
  const first = readFirstLine(file);
  if (!first) return null;
  try {
    const meta = JSON.parse(first)?.payload;
    if (!meta || typeof meta !== "object") return null;
    return {
      id: String(meta.session_id || meta.id || "").toLowerCase(),
      // ⛔ 与 hasLineage 必须**同步**：history_base 可能是对象（`{thread_id,…}`）也可能是字符串
      //   （形状变化时不兜底 ⇒ hasLineage=true 但 parentId 为空 ⇒ 自愈直接 continue，
      //   症状是"这条会话永远修不好、也永远不报修"这种静默漏修）。
      parentId: String(
        meta.forked_from_id
        || meta.parent_thread_id
        || (typeof meta.history_base === "string" ? meta.history_base : meta.history_base?.thread_id)
        || "",
      ).toLowerCase(),
      hasLineage: LINEAGE_KEYS.some((key) => meta[key] !== undefined && meta[key] !== null),
    };
  } catch {
    return null;
  }
}

/** 血缘依赖图：Map<源会话 id(小写), [{ childId, file }]>（只统计**仍在磁盘上**的 rollout） */
function collectLineage(root) {
  const deps = new Map();
  for (const file of walkRolloutFiles(root)) {
    const meta = readSessionMeta(file);
    if (!meta?.id || !meta.parentId) continue;
    const list = deps.get(meta.parentId) || [];
    list.push({ childId: meta.id, file });
    deps.set(meta.parentId, list);
  }
  return deps;
}

function purgeRolloutFiles(root, idsInput) {
  const ids = new Set(
    (Array.isArray(idsInput) ? idsInput : [])
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean),
  );
  const removed = [];
  const failed = [];
  const kept = [];
  if (!ids.size) return { removed, failed, kept };
  // ⛔ 血缘守卫（09-19）：源 rollout 被别的会话依赖时**不删**，否则子会话直接打不开
  //   （`invalid paginated history lineage: missing source rollout`）。
  //   源会话早已不在索引里、侧栏也不会显示它（有墓碑兜底），磁盘上留这一个文件是**必要**的。
  const deps = collectLineage(root);
  for (const base of [path.join(root, "sessions"), path.join(root, "archived_sessions")]) {
    if (!existsSync(base)) continue;
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
        if (!match || !ids.has(match[1].toLowerCase())) continue;
        // 本次一并删除的子会话不算依赖（整批一起删掉，不存在"子活着源没了"）
        const dependents = (deps.get(match[1].toLowerCase()) || []).filter((item) => !ids.has(item.childId));
        if (dependents.length) {
          kept.push({ path: full, id: match[1].toLowerCase(), dependents: dependents.map((item) => item.childId) });
          continue;
        }
        try {
          unlinkSync(full);
          removed.push(full);
          rolloutListCache.delete(full);
          rolloutParseCache.delete(full);
          for (const [key, value] of rolloutPathCache) if (value === full) rolloutPathCache.delete(key);
        } catch (error) {
          // 文件被占用（正在跑的会话）等：交给调用方记「墓碑」，下次列表合并时仍排除它
          failed.push({ path: full, error: String((error && error.message) || error) });
        }
      }
    }
  }
  return { removed, failed, kept };
}

/**
 * 血缘自愈（09-19）：把「源已丢失」的子会话修成**独立会话**。
 *
 * 场景：旧版本删源会话时没有血缘守卫，已经把源 rollout 删掉了 ⇒ 子会话每次打开都报
 *   `invalid paginated history lineage for <源>: missing source rollout`，用户连侧栏点击都不行。
 * 修法：把该子会话 rollout 首行里的血缘字段**摘掉**（forked_from_id /
 *   forked_from_ordinal_exclusive / parent_thread_id），引擎便会把它当普通会话加载。
 *   ⛔ 代价必须说清：子会话**继承自源会话的那段历史**找不回来了（自己的回合一个不少，
 *     因为都在它自己的 rollout 里）；但"完全打不开"显然更糟。
 *   ⛔ 改前把原首行存成 `<文件>.lineage.bak`，可人工回滚。
 */
function healBrokenLineage(root) {
  const healed = [];
  const failed = [];
  const metas = walkRolloutFiles(root).map((file) => ({ file, meta: readSessionMeta(file) })).filter((item) => item.meta?.id);
  const known = new Set(metas.map((item) => item.meta.id));
  for (const { file, meta } of metas) {
    if (!meta.parentId || known.has(meta.parentId) || !meta.hasLineage) continue;
    try {
      const text = readFileSync(file, "utf8");
      const nl = text.indexOf("\n");
      const first = nl >= 0 ? text.slice(0, nl) : text;
      const rest = nl >= 0 ? text.slice(nl) : "";
      const parsed = JSON.parse(first);
      const meta2 = parsed?.payload ?? {};
      const backupFirst = first;
      for (const key of LINEAGE_KEYS) delete meta2[key];
      parsed.payload = meta2;
      writeFileSync(`${file}.lineage.bak`, backupFirst, "utf8");
      // ⛔ 必须**原子替换**（写临时文件 → rename）：直接覆盖写时若磁盘满/被杀，会留下
      //   半截 JSONL ⇒ 整个会话历史损坏（比"打不开"更糟，用户内容真丢了）。
      //   rename 在同一目录内是原子的，最坏情况是保留原文件（下次启动再试）。
      const tmpFile = `${file}.heal.tmp`;
      writeFileSync(tmpFile, JSON.stringify(parsed) + rest, "utf8");
      renameSync(tmpFile, file);
      rolloutListCache.delete(file);
      rolloutParseCache.delete(file);
      healed.push({ path: file, id: meta.id, lostFrom: meta.parentId });
    } catch (error) {
      failed.push({ path: file, error: String((error && error.message) || error) });
    }
  }
  return { healed, failed };
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
      } else if (msg.op === "purge") {
        parentPort.postMessage({ id, ok: true, data: purgeRolloutFiles(String(msg.root || ""), msg.ids) });
      } else if (msg.op === "healLineage") {
        parentPort.postMessage({ id, ok: true, data: healBrokenLineage(String(msg.root || "")) });
      } else {
        parentPort.postMessage({ id, ok: false, error: `unknown op: ${msg.op}` });
      }
    } catch (error) {
      parentPort.postMessage({ id, ok: false, error: String((error && error.message) || error) });
    }
  });
}
