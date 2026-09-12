import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import path from "node:path";

type ToolCallRecord = { kind: "tool"; id: string; callId: string; name: string; arguments: string };
type ItemRecord = { kind: "item"; id: string; itemType: "reasoning" | "agentMessage" };
type TurnRecord = ToolCallRecord | ItemRecord;
type ParsedRollout = {
  mtimeMs: number;
  turns: Map<string, TurnRecord[]>;
  outputs: Map<string, string>;
  /** app-server 本地 turn id -> 上游 response_item 元数据里的 turn id */
  turnAliases: Map<string, string>;
  /** 增量解析游标（09-12 多会话性能）：已消费的字节数与当时的文件大小。
      会话在跑时 rollout 持续追加，旧实现只看 mtime → 每次都整份重读重解析
      （O(文件大小)），切会话越频繁越慢。现在只解析新增的完整行。 */
  bytesConsumed: number;
  size: number;
  /** 上一行是否写了一半（文件尾无换行）：保留下来与下次新增内容拼起来再解析 */
  pendingTail: string;
  /** function_call 的 call_id -> 上游 turn id，增量解析时也要延续（供 function_call_output 关联） */
  callTurns: Map<string, string>;
};

type RolloutListEntry = {
  id: string;
  name: string;
  preview: string;
  cwd: string;
  updatedAt: number;
  status: { type: string };
  archived: boolean;
};
/** listRolloutThreads 的单文件解析结果缓存。
    意义（09-12 实测 P0）：thread/list 每次调用都会全量遍历 sessions/ 目录树 + 逐文件
    全文 readFileSync + 逐行 JSON.parse，而渲染层**每个回合结束**都打一发 thread/list
    → 调用次数 ∝ 完成回合数、每次仍扫全部历史 = O(N²)，且全是同步 I/O 会堵住主进程
    事件循环（所有会话一起卡）。按「路径 + mtimeMs + size」缓存后，历史文件只解析一次。 */
const rolloutListCache = new Map<string, { mtimeMs: number; size: number; entry: RolloutListEntry | null }>();
/** enrichThreadWithRolloutTools 的短路缓存：同一 thread 对象 + rollout 未变更时
    直接返回原引用（同时也保住了 React 侧的记忆化，不会每次 resume 都产生新对象）。 */
const enrichCache = new WeakMap<object, { fp: string; size: number; mtimeMs: number }>();

const rolloutPathCache = new Map<string, string>();
const rolloutParseCache = new Map<string, ParsedRollout>();

/** 合并 app-server 索引和 rollout 兜底，并严格执行归档筛选。
 * archived=true 只能返回归档项，false 只能返回活动项；旧实现只处理 false，
 * 导致活动会话混入归档管理并被永久删除。 */
export function mergeThreadList(
  indexedInput: any[],
  fallback: any[],
  archived: boolean | null,
  limit = 100,
) {
  const indexed = indexedInput.map((entry) => archived == null ? entry : { ...entry, archived });
  const byId = new Map<string, any>(indexed.map((entry) => [String(entry.id), entry]));
  // 单位归一：引擎索引 updated_at 是秒，rollout 兜底（stat.mtimeMs / started*1000）是毫秒。
  // 混合单位会让侧边栏时间分组把同一批会话拆成两组（毫秒组永远单独成组、标签仍判「今天」）——统一成秒。
  const toSeconds = (value: any): number => {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n > 1e11 ? Math.round(n / 1000) : n;
  };
  for (const raw of fallback) {
    const entry = { ...raw, updatedAt: toSeconds(raw.updatedAt ?? raw.updated_at) };
    const existing = byId.get(String(entry.id));
    if (!existing) {
      byId.set(String(entry.id), entry);
      continue;
    }
    byId.set(String(entry.id), {
      ...entry,
      ...existing,
      name: String(existing.name ?? existing.title ?? "").trim() || entry.name,
      preview: String(existing.preview ?? "").trim() || entry.preview,
      cwd: String(existing.cwd ?? "").trim() || entry.cwd,
      updatedAt: toSeconds(existing.updatedAt ?? existing.updated_at) || entry.updatedAt,
      status: existing.status ?? entry.status,
    });
  }
  return [...byId.values()]
    .filter((entry) => archived == null ? true : Boolean(entry.archived) === archived)
    .sort((a, b) => Number(b.updatedAt ?? b.updated_at ?? 0) - Number(a.updatedAt ?? a.updated_at ?? 0))
    .slice(0, limit);
}

function findRolloutFile(codexHome: string, threadId: string) {
  const cached = rolloutPathCache.get(threadId);
  if (cached && existsSync(cached)) return cached;
  const roots = [path.join(codexHome, "sessions"), path.join(codexHome, "archived_sessions")];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const stack = [root];
    while (stack.length) {
      const current = stack.pop()!;
      let entries: ReturnType<typeof readdirSync>;
      try { entries = readdirSync(current, { withFileTypes: true }) as any; } catch { continue; }
      for (const entry of entries as any[]) {
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

/** 把一批「新行 + 上一轮残留的半行」喂进解析状态。抽出来是为了让增量与全量共用同一套
    解析逻辑（避免两套规则漂移），返回值是尚未成行的尾巴。 */
function consumeRolloutLines(
  text: string,
  state: { turns: Map<string, TurnRecord[]>; outputs: Map<string, string>; callTurns: Map<string, string>; turnAliases: Map<string, string> },
) {
  const { turns, outputs, callTurns, turnAliases } = state;
  const push = (turnId: string, record: TurnRecord) => {
    if (!turnId) return;
    const list = turns.get(turnId) ?? [];
    list.push(record);
    turns.set(turnId, list);
  };
  const lines = text.split("\n");
  const tail = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    let row: any;
    try { row = JSON.parse(line); } catch { continue; }
    if (row?.type !== "response_item") continue;
    const item = row.payload ?? {};
    const metaTurn = String(item.internal_chat_message_metadata_passthrough?.turn_id ?? "");
    if (item.type === "function_call") {
      const callId = String(item.call_id ?? item.id ?? "");
      if (!callId || !metaTurn) continue;
      callTurns.set(callId, metaTurn);
      push(metaTurn, { kind: "tool", id: String(item.id ?? callId), callId, name: String(item.name ?? "tool"), arguments: String(item.arguments ?? "") });
    } else if (item.type === "function_call_output") {
      const callId = String(item.call_id ?? "");
      if (callId) {
        outputs.set(callId, String(item.output ?? ""));
        // 一些上游会给 function_call/message/reasoning 写自己的 turn id，而
        // function_call_output 中才携带 app-server 真正用于 thread/resume 的本地 turn id。
        // 通过 call_id 把两套 id 关联起来，旧会话才能找到完整的工具事件序列。
        const upstreamTurn = callTurns.get(callId);
        if (metaTurn && upstreamTurn && metaTurn !== upstreamTurn) turnAliases.set(metaTurn, upstreamTurn);
      }
    } else if (item.type === "reasoning" && item.id && metaTurn) {
      push(metaTurn, { kind: "item", id: String(item.id), itemType: "reasoning" });
    } else if (item.type === "message" && item.id && metaTurn && item.role === "assistant") {
      // developer/user 注入消息不属于回合里的 assistant 过程，不能参与顺序匹配；
      // 只记录真正展示给用户的 assistant 正文。
      push(metaTurn, { kind: "item", id: String(item.id), itemType: "agentMessage" });
    }
  }
  return tail;
}

function parseRollout(filePath: string): ParsedRollout {
  const stat = statSync(filePath);
  const { mtimeMs, size } = stat;
  const cached = rolloutParseCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached;
  // 追加场景（会话正在跑）：文件只变长 → 只解析新增部分，历史不再重解析。
  // size 变小 = 被截断/迁移重写，退回全量。mtime 变化但长度不变同样退回全量。
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
    } catch {
      // 增量失败（文件被替换/权限等）→ 落到下面的全量路径，绝不返回半截数据
    }
  }
  const turns = new Map<string, TurnRecord[]>();
  const outputs = new Map<string, string>();
  const callTurns = new Map<string, string>();
  const turnAliases = new Map<string, string>();
  const pendingTail = consumeRolloutLines(readFileSync(filePath, "utf8"), { turns, outputs, callTurns, turnAliases });
  const parsed: ParsedRollout = { mtimeMs, turns, outputs, turnAliases, callTurns, bytesConsumed: size, size, pendingTail };
  rolloutParseCache.set(filePath, parsed);
  return parsed;
}

function parsedArguments(raw: string) {
  try { return JSON.parse(raw); } catch { return raw; }
}

function outputMeta(output: string) {
  const exitCode = Number(/Process exited with code\s+(-?\d+)/i.exec(output)?.[1] ?? 0);
  const seconds = Number(/Wall time:\s*([\d.]+)\s*seconds/i.exec(output)?.[1] ?? 0);
  return { exitCode: Number.isFinite(exitCode) ? exitCode : 0, durationMs: seconds > 0 ? Math.round(seconds * 1000) : undefined };
}

function syntheticTool(record: ToolCallRecord, output: string) {
  const args: any = parsedArguments(record.arguments);
  const meta = outputMeta(output);
  if (record.name === "exec_command" || record.name === "write_stdin") {
    const command = typeof args === "object" ? String(args.cmd ?? args.command ?? (record.name === "write_stdin" ? `write_stdin ${args.chars ?? ""}` : record.arguments)) : record.arguments;
    return { id: record.id, type: "commandExecution", command, aggregatedOutput: output, status: meta.exitCode ? "failed" : "completed", exitCode: meta.exitCode, durationMs: meta.durationMs, callId: record.callId };
  }
  return { id: record.id, type: "dynamicToolCall", tool: record.name, arguments: args, result: output, status: meta.exitCode ? "failed" : "completed", durationMs: meta.durationMs, callId: record.callId };
}

/** thread.turns 的轻量指纹：用来判断「同一 thread 对象是否已经按这份 rollout 富化过」。
    只取 回合数 + 每回合的 item id/数量，不做深比较（这里只为短路，不需要精确分辨）。 */
function turnsFingerprint(thread: any): string {
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  let out = `${turns.length}`;
  for (const turn of turns) {
    const items = Array.isArray(turn?.items) ? turn.items : [];
    out += `|${items.length}`;
    for (const item of items) out += `,${String(item?.id ?? "")}`;
  }
  return out.length > 4096 ? out.slice(0, 4096) : out;
}

export function enrichThreadWithRolloutTools(thread: any, codexHome: string) {
  if (!thread?.id || !Array.isArray(thread.turns)) return thread;
  const filePath = findRolloutFile(codexHome, String(thread.id));
  if (!filePath) return thread;
  let parsed: ParsedRollout;
  try { parsed = parseRollout(filePath); } catch { return thread; }
  // 短路（09-12 多会话性能）：同一个 thread 对象 + 同一份 rollout（size/mtime 未变）
  // 已经富化过一次 → 直接返回原对象。既省掉 O(T×R×C) 的匹配，又保住引用相等，
  // 不会每次 thread/resume 都造新对象去打穿渲染层的记忆化。
  const fp = turnsFingerprint(thread);
  const memo = enrichCache.get(thread);
  if (memo && memo.fp === fp && memo.size === parsed.size && memo.mtimeMs === parsed.mtimeMs) return thread;
  let changed = false;
  const assignedRecordGroups = new Set<string>();
  const recordGroups = [...parsed.turns.entries()];
  const turns = thread.turns.map((turn: any) => {
    const existing = Array.isArray(turn.items) ? turn.items : [];
    const localTurnId = String(turn.id);
    let recordKey = parsed.turns.has(localTurnId) ? localTurnId : parsed.turnAliases.get(localTurnId) ?? "";
    let records = recordKey ? parsed.turns.get(recordKey) : undefined;
    // 分叉/迁移后的 rollout 可能同时包含父会话与当前会话，并出现第三套 turn id。
    // 此时用 resume 已恢复出的 message/reasoning id 反查所属记录组，比时间或顺序猜测可靠。
    if (!records?.some((record) => record.kind === "tool") || assignedRecordGroups.has(recordKey)) {
      const existingIds = new Set(existing.map((item: any) => String(item.id ?? "")).filter(Boolean));
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
    if (!records?.some((record) => record.kind === "tool")) return turn;
    if (recordKey) assignedRecordGroups.add(recordKey);
    const byId = new Map<string, any>(existing.map((item: any) => [String(item.id), item] as [string, any]));
    const used = new Set<string>();
    const items: any[] = [];
    for (const record of records) {
      if (record.kind === "item") {
        let item = byId.get(record.id);
        let key = item ? String(item.id) : "";
        // 上游/本地恢复可能重写 message/reasoning id。按同类型的原始顺序
        // 兜底匹配，确保工具仍插在对应正文/思考之间，而不是全部挪到顶部。
        if (!item) {
          const candidates = existing.filter((candidate: any) => candidate.type === record.itemType && !used.has(String(candidate.id)));
          item = candidates[0];
          if (item) key = String(item.id);
        }
        if (item && key && !used.has(key)) { items.push(item); used.add(key); }
        continue;
      }
      const existingTool = existing.find((item: any) => String(item.id) === record.id || String(item.callId ?? item.call_id ?? "") === record.callId);
      if (existingTool) {
        const key = String(existingTool.id);
        if (!used.has(key)) { items.push(existingTool); used.add(key); }
      } else {
        items.push(syntheticTool(record, parsed.outputs.get(record.callId) ?? ""));
        changed = true;
      }
    }
    for (const item of existing) {
      const key = String(item.id);
      if (!used.has(key)) items.push(item);
    }
    return items.length === existing.length && items.every((item, index) => item === existing[index]) ? turn : { ...turn, items };
  });
  const result = changed || turns.some((turn: any, index: number) => turn !== thread.turns[index]) ? { ...thread, turns } : thread;
  // 记下这次富化对应的 rollout 状态与结果指纹，供下次同对象调用短路。
  // WeakMap：thread 对象被 GC 时缓存自动消失，无需自己清理；指纹自带长度上限。
  const stamp = { size: parsed.size, mtimeMs: parsed.mtimeMs };
  enrichCache.set(thread, { fp, ...stamp });
  if (result !== thread) enrichCache.set(result, { fp: turnsFingerprint(result), ...stamp });
  return result;
}

/** 解析单个 rollout 文件、取出侧栏需要的元数据（标题/预览/cwd/更新时间）。
    带 mtime+size 缓存：同一个文件只在内容变化时重读，历史会话永远只解析一次。 */
function readRolloutListEntry(full: string, id: string, archived: boolean): RolloutListEntry | null {
  let stat: ReturnType<typeof statSync>;
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
      let row: any;
      try { row = JSON.parse(line); } catch { continue; }
      const payload = row?.payload ?? {};
      const meta = payload.internal_chat_message_metadata_passthrough;
      if (row.type === "session_meta" && payload.cwd) cwd = cwd || String(payload.cwd);
      if (row.type === "turn_context" && payload.cwd) cwd = cwd || String(payload.cwd);
      if (payload.type === "message" && payload.role === "user") {
        const text = (payload.content ?? []).filter((part: any) => part.type === "input_text").map((part: any) => String(part.text ?? "")).join("\n").trim();
        const injected = text.startsWith("# AGENTS.md") || text.startsWith("<environment_context>") || text.startsWith("<filesystem>");
        const isUserPrompt = meta?.content_item_kinds?.includes?.("user.text") || !meta?.content_item_kinds;
        if (text && isUserPrompt && !injected) {
          if (!title) title = text.slice(0, 80);
          preview = text.slice(0, 160);
        }
        cwd = cwd || String(meta?.cwd ?? "");
      }
      if (row.type === "event_msg" && payload.type === "task_complete") {
        const text = String(payload.last_agent_message ?? "").trim();
        if (text) preview = text.slice(0, 160);
      }
      if (row.type === "event_msg" && payload.type === "task_started") {
        const started = Number(payload.started_at);
        if (Number.isFinite(started)) updatedAt = Math.max(updatedAt, started * 1000);
      }
    }
  } catch { return null; }
  const entry: RolloutListEntry = {
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

/** 当 app-server 的 thread/list 索引尚未完成迁移时，从 rollout 文件恢复左侧会话列表。
 *  性能（09-12 P0）：目录遍历仍是同步的，但每个文件的**内容解析**按 mtime+size 缓存，
 *  历史文件不再重复 readFileSync + 逐行 JSON.parse；调用方还应只在引擎索引为空时兜底。 */
export function listRolloutThreads(codexHome: string) {
  const roots = [path.join(codexHome, "sessions"), path.join(codexHome, "archived_sessions")];
  const out: RolloutListEntry[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const archived = root.endsWith("archived_sessions");
    const stack = [root];
    while (stack.length) {
      const current = stack.pop()!;
      let entries: any[];
      try { entries = readdirSync(current, { withFileTypes: true }) as any[]; } catch { continue; }
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) { stack.push(full); continue; }
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const match = entry.name.match(/-([0-9a-f]{8}-[0-9a-f-]{27,})\.jsonl$/i);
        if (!match || seen.has(match[1])) continue;
        const id = match[1];
        const parsedEntry = readRolloutListEntry(full, id, archived);
        if (!parsedEntry) continue;
        seen.add(id);
        out.push(parsedEntry);
      }
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}
