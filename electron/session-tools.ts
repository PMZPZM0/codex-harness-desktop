import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
};

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

function parseRollout(filePath: string): ParsedRollout {
  const mtimeMs = statSync(filePath).mtimeMs;
  const cached = rolloutParseCache.get(filePath);
  if (cached?.mtimeMs === mtimeMs) return cached;
  const turns = new Map<string, TurnRecord[]>();
  const outputs = new Map<string, string>();
  const callTurns = new Map<string, string>();
  const turnAliases = new Map<string, string>();
  const push = (turnId: string, record: TurnRecord) => {
    if (!turnId) return;
    const list = turns.get(turnId) ?? [];
    list.push(record);
    turns.set(turnId, list);
  };
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
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
  const parsed = { mtimeMs, turns, outputs, turnAliases };
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

export function enrichThreadWithRolloutTools(thread: any, codexHome: string) {
  if (!thread?.id || !Array.isArray(thread.turns)) return thread;
  const filePath = findRolloutFile(codexHome, String(thread.id));
  if (!filePath) return thread;
  let parsed: ParsedRollout;
  try { parsed = parseRollout(filePath); } catch { return thread; }
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
  return changed || turns.some((turn: any, index: number) => turn !== thread.turns[index]) ? { ...thread, turns } : thread;
}

/** 当 app-server 的 thread/list 索引尚未完成迁移时，从 rollout 文件恢复左侧会话列表。 */
export function listRolloutThreads(codexHome: string) {
  const roots = [path.join(codexHome, "sessions"), path.join(codexHome, "archived_sessions")];
  const out: any[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    if (!existsSync(root)) continue;
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
        let title = "";
        let preview = "";
        let cwd = "";
        let updatedAt = 0;
        try {
          const stat = statSync(full);
          updatedAt = stat.mtimeMs;
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
        } catch { continue; }
        seen.add(id);
        out.push({ id, name: title || preview || "未命名任务", preview: preview || title || "", cwd, updatedAt, status: { type: "completed" }, archived: root.endsWith("archived_sessions") });
      }
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}
