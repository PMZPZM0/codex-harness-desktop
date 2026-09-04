// 会话备份：导出 = 把 codex-home 下引擎原始 rollout 记录（sessions/** / archived_sessions/**）
// 连同会话元信息打包成单文件 .json；导入 = 把 rollout 原样写回 codex-home，
// 让主进程的 rollout 扫描兜底（listRolloutThreads）立即可见，不依赖引擎 thread/list 索引。
// 设计约束：只操作 rollout 文件本身 + 只读扫描，绝不动 state_5 / 索引 DB / config。

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export const BACKUP_FORMAT = "codex-harness-sessions-backup";
export const BACKUP_VERSION = 1;

export type BackupFileRef = { rel: string; mtimeMs: number };
export type SessionMeta = { id: string; name: string; preview: string; cwd: string; archived: boolean; updatedAt: number };
export type BackupThread = { id: string; meta: SessionMeta; files: { rel: string; text: string }[] };
export type SessionsBackup = { format: string; version: number; exportedAt: number; threads: BackupThread[] };

const UUID_RE = /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

/** 递归收集 codex-home 下全部 rollout 文件，按线程 id 聚合（同一线程分叉/迁移可能多文件） */
export function scanSessionFiles(codexHome: string) {
  const roots = [
    { root: path.join(codexHome, "sessions"), archived: false },
    { root: path.join(codexHome, "archived_sessions"), archived: true },
  ];
  const byId = new Map<string, { archived: boolean; files: { rel: string; abs: string; mtimeMs: number }[] }>();
  for (const { root, archived } of roots) {
    if (!existsSync(root)) continue;
    const stack = [root];
    while (stack.length) {
      const current = stack.pop()!;
      let entries: any[];
      try { entries = readdirSync(current, { withFileTypes: true }) as any[]; } catch { continue; }
      for (const entry of entries) {
        const abs = path.join(current, entry.name);
        if (entry.isDirectory()) { stack.push(abs); continue; }
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const match = entry.name.match(UUID_RE);
        if (!match) continue;
        const id = match[1];
        const rel = path.relative(codexHome, abs);
        const bucket = byId.get(id) ?? { archived, files: [] };
        // archived_sessions 在 sessions 之后扫：同一文件不可能同时出现在两处，按根目录决定归档态
        bucket.archived = bucket.archived || archived;
        bucket.files.push({ rel, abs, mtimeMs: statSync(abs).mtimeMs });
        byId.set(id, bucket);
      }
    }
  }
  return byId;
}

/** 从 rollout 文本提取会话标题/预览/cwd（与 listRolloutThreads 同口径：首条非注入用户消息） */
function extractMeta(id: string, files: { rel: string; abs: string; mtimeMs: number }[], archived: boolean): SessionMeta {
  const sorted = [...files].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const meta: SessionMeta = {
    id,
    name: "",
    preview: "",
    cwd: "",
    archived,
    updatedAt: Math.max(...files.map((f) => f.mtimeMs), 0),
  };
  for (const file of sorted) {
    try {
      for (const line of readFileSync(file.abs, "utf8").split(/\r?\n/)) {
        if (!line.trim()) continue;
        let row: any;
        try { row = JSON.parse(line); } catch { continue; }
        const payload = row?.payload ?? {};
        if (row.type === "session_meta" && payload.cwd) meta.cwd = meta.cwd || String(payload.cwd);
        if (row.type === "turn_context" && payload.cwd) meta.cwd = meta.cwd || String(payload.cwd);
        if (payload.type === "message" && payload.role === "user" && !meta.name) {
          const text = (payload.content ?? []).filter((part: any) => part.type === "input_text").map((part: any) => String(part.text ?? "")).join("\n").trim();
          const cleaned = stripHarnessBlocks(text);
          const injected = cleaned.startsWith("# AGENTS.md") || cleaned.startsWith("<environment_context>") || cleaned.startsWith("<filesystem>");
          const kinds = payload.internal_chat_message_metadata_passthrough?.content_item_kinds;
          const isUserPrompt = Array.isArray(kinds) ? kinds.includes("user.text") : true;
          if (cleaned && isUserPrompt && !injected) {
            meta.name = cleaned.slice(0, 80);
            meta.preview = cleaned.slice(0, 160);
          }
        }
        if (meta.name) break;
      }
    } catch { /* 单文件损坏跳过 */ }
    if (meta.name) break;
  }
  return meta;
}

/** 构建备份包。threadIds 为空 = 全部会话。 */
export function buildSessionsBackup(codexHome: string, threadIds?: string[]): SessionsBackup {
  const byId = scanSessionFiles(codexHome);
  const wanted = threadIds && threadIds.length ? new Set(threadIds.map((id) => String(id).toLowerCase())) : null;
  const threads: BackupThread[] = [];
  for (const [id, bucket] of byId) {
    if (wanted && !wanted.has(id.toLowerCase())) continue;
    const meta = extractMeta(id, bucket.files, bucket.archived);
    threads.push({
      id,
      meta,
      files: bucket.files.map((f) => ({ rel: f.rel, text: readFileSync(f.abs, "utf8") })),
    });
  }
  threads.sort((a, b) => b.meta.updatedAt - a.meta.updatedAt);
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: Date.now(), threads };
}

function safeRel(rel: string): string | null {
  if (typeof rel !== "string" || !rel.trim()) return null;
  const normalized = path.normalize(rel).replace(/\\/g, "/");
  if (normalized.includes("..")) return null;
  if (!normalized.startsWith("sessions/") && !normalized.startsWith("archived_sessions/")) return null;
  if (!normalized.endsWith(".jsonl")) return null;
  return normalized;
}

export type ImportResult = {
  imported: number;
  skipped: number;
  threads: { id: string; name: string; status: "ok" | "duplicate" | "conflict" }[];
};

/** 把备份包写回 codex-home。相同 rel 且内容一致 = duplicate 跳过；内容不一致 = conflict 跳过（不覆盖，保护已有数据）。 */
// ─────────────────────────────────────────────────────────────────────────────
// 通用 Markdown 对话记录（对齐官方 Codex /export 精神）
// 目的：任何主流 AI（ChatGPT / Claude / Gemini / Kimi 等）都能直接读取/带入的
// 干净对话文档；只含真实 User/Assistant 消息，过滤 AGENTS.md / environment_context
// / filesystem 等系统注入块，并还原被任务包装的「用户需求」原文。
// ─────────────────────────────────────────────────────────────────────────────

type MdMessage = { ts: string; role: "user" | "assistant"; text: string };

/** 剥离 harness 首条消息的任务包装（[SYSTEM TASK …]/=== 用户需求 ===/=== END === 模板），还原用户原文 */
export function stripSystemTaskWrapper(text: string): string {
  const match = text.match(/\[SYSTEM TASK[^\]]*\]\s*=== 用户需求 ===\s*\n?([\s\S]*?)\s*\n=== END ===/);
  if (match && match[1].trim()) return match[1].trim();
  return text;
}

/** harness 发送管线注入的机器可读块：记忆召回 / 技能引用。剥离后还原用户真实输入；附件与对话上下文保留（对 AI 有上下文价值）。 */
export function stripHarnessBlocks(text: string): string {
  let out = stripSystemTaskWrapper(text);
  out = out.replace(/\[Harness 相关记忆，仅供参考\][\s\S]*?\[记忆结束\]/g, "");
  out = out.replace(/\[本轮已引用技能\][\s\S]*?\[请按上述技能工作流执行\]/g, "");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/** 导出前清洗用户消息：剥离 harness 注入块 + 系统注入，返回空串表示应跳过 */
function cleanUserText(raw: string): string {
  const cleaned = stripHarnessBlocks(raw);
  return looksInjected(cleaned) ? "" : cleaned;
}

const MD_INJECT_PREFIXES = ["# AGENTS.md", "<INSTRUCTIONS>", "<environment_context>", "<filesystem>", "<danger-zone>", "<approval>"];

function looksInjected(text: string): boolean {
  const t = text.trimStart();
  return MD_INJECT_PREFIXES.some((prefix) => t.startsWith(prefix));
}

/** 从 rollout JSONL 提取有序 user/assistant 消息（口径与 scripts/export-threads.py 一致：过滤注入、相邻去重） */
export function parseRolloutMessages(rolloutText: string): MdMessage[] {
  const msgs: { ts: string; role: "user" | "assistant"; text: string }[] = [];
  for (const line of rolloutText.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row: any;
    try { row = JSON.parse(line); } catch { continue; }
    const payload = row?.payload ?? {};
    const ts = typeof row?.timestamp === "string" ? row.timestamp : "";
    const push = (role: "user" | "assistant", raw: string) => {
      const text = role === "user" ? cleanUserText(raw) : raw.trim();
      if (!text) return;
      msgs.push({ ts, role, text });
    };
        if (row.type === "event_msg" && payload.type === "user_message") {
          let text = String(payload.message ?? "");
          if (!text && Array.isArray(payload.text_elements)) {
            text = payload.text_elements.map((el: any) => (el && typeof el === "object" ? String(el.text ?? "") : "")).join("");
          }
          if (text.trim()) push("user", text);
        } else if (row.type === "response_item" && payload.type === "message") {
          const role = String(payload.role ?? "");
          if (role !== "user" && role !== "assistant") continue;
          const parts = (payload.content ?? []).filter((c: any) => c && typeof c === "object" && (c.type === "output_text" || c.type === "input_text"))
            .map((c: any) => String(c.text ?? ""));
          const joined = parts.join("\n").trim();
          if (joined) push(role, joined);
        }
  }
  // 同文件内按行序即时间序；相邻同 role 去重（同一用户消息常有 event 版 + response_item 版，保留较长者）
  const dedup: { ts: string; role: "user" | "assistant"; text: string }[] = [];
  for (const m of msgs) {
    const last = dedup[dedup.length - 1];
    if (last && last.role === m.role) {
      if (last.text === m.text || (m.role === "user" && (last.text.includes(m.text) || m.text.includes(last.text)))) {
        if (m.text.length > last.text.length) dedup[dedup.length - 1] = m;
        continue;
      }
    }
    dedup.push(m);
  }
  return dedup;
}

function fmtLocal(ms: number): string {
  try { return new Date(ms).toLocaleString("zh-CN", { hour12: false }); } catch { return String(ms); }
}

/** 渲染单个会话为 Markdown 文档。files 须已按时间升序传入（buildMarkdownExport 已按 mtime 排好），保证合并时间线正确 */
export function renderThreadMarkdown(thread: BackupThread): string {
  const meta = thread.meta;
  const parts: string[] = [];
  parts.push(`# ${meta.name || meta.preview || "未命名会话"}`);
  parts.push("");
  parts.push(`> 会话 ID：\`${thread.id}\` ｜ 更新：${fmtLocal(meta.updatedAt)} ｜ 工作目录：\`${meta.cwd || "—"}\`${meta.archived ? " ｜ 已归档" : ""}`);
  parts.push("");
  for (const file of thread.files) {
    for (const m of parseRolloutMessages(file.text)) {
      parts.push(`## ${m.role === "user" ? "User" : "Assistant"}`, "", m.text, "");
    }
  }
  return parts.join("\n").trimEnd() + "\n";
}

export type MarkdownExportResult = { markdown: string; count: number; totalMessages: number };

/** 构建通用 Markdown 导出。threadIds 为空 = 全部会话；单会话时输出干净的单会话文档，多会话时输出带总览的合集。 */
export function buildMarkdownExport(codexHome: string, threadIds?: string[]): MarkdownExportResult {
  const byId = scanSessionFiles(codexHome);
  const wanted = threadIds && threadIds.length ? new Set(threadIds.map((id) => String(id).toLowerCase())) : null;
  const threads: BackupThread[] = [];
  for (const [id, bucket] of byId) {
    if (wanted && !wanted.has(id.toLowerCase())) continue;
    const files = [...bucket.files].sort((a, b) => a.mtimeMs - b.mtimeMs || (a.rel < b.rel ? -1 : 1));
    threads.push({
      id,
      meta: extractMeta(id, bucket.files, bucket.archived),
      files: files.map((f) => ({ rel: f.rel, text: readFileSync(f.abs, "utf8") })),
    });
  }
  threads.sort((a, b) => b.meta.updatedAt - a.meta.updatedAt);
  if (!threads.length) return { markdown: "", count: 0, totalMessages: 0 };

  let markdown: string;
  let totalMessages = 0;
  for (const t of threads) {
    for (const f of t.files) totalMessages += parseRolloutMessages(f.text).length;
  }
  if (threads.length === 1) {
    markdown = renderThreadMarkdown(threads[0]);
  } else {
    const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");
    const head = [
      "# Codex 会话记录",
      "",
      `> 由 Codex Harness Desktop 导出 · ${stamp} · 共 ${threads.length} 个会话 · ${totalMessages} 条消息`,
      "> 每条消息以 `## User`（用户）与 `## Assistant`（Codex/助手）分隔，时间从早到晚；可作为完整上下文直接带入其他 AI。",
      "",
      "## 目录",
      "",
      ...threads.map((t, index) => `${index + 1}. ${t.meta.name || t.meta.preview || t.id.slice(0, 8)}`),
      "",
      "---",
      "",
    ];
    markdown = head.join("\n") + threads.map((t) => renderThreadMarkdown(t)).join("\n---\n\n");
  }
  return { markdown, count: threads.length, totalMessages };
}

export type ThreadPreviewMessage = { role: "user" | "assistant"; text: string };
export type ThreadPreview = {
  id: string;
  name: string;
  updatedAt: number;
  cwd: string;
  archived: boolean;
  messages: ThreadPreviewMessage[];
  truncated: number;
  truncatedMessages: number;
};

/**
 * 单会话只读全文预览（全局搜索的「会话」命中点开用）：从 rollout 原档抽取清洗后的
 * user/assistant 消息序列。只读扫描，不动引擎焦点/索引；超长截断防 IPC 负载过大。
 */
export function buildThreadPreview(codexHome: string, threadId: string): ThreadPreview | null {
  const id = String(threadId ?? "").trim();
  if (!id) return null;
  const byId = scanSessionFiles(codexHome);
  const bucket = byId.get(id.toLowerCase()) ?? byId.get(id);
  if (!bucket) return null;
  const meta = extractMeta(id, bucket.files, bucket.archived);
  const MAX_MESSAGES = 500;
  const MAX_MESSAGE_CHARS = 20000;
  const files = [...bucket.files].sort((a, b) => a.mtimeMs - b.mtimeMs || (a.rel < b.rel ? -1 : 1));
  const messages: ThreadPreviewMessage[] = [];
  let truncatedMessages = 0;
  let truncatedChars = 0;
  for (const file of files) {
    if (messages.length >= MAX_MESSAGES) break;
    for (const m of parseRolloutMessages(readFileSync(file.abs, "utf8"))) {
      if (messages.length >= MAX_MESSAGES) { truncatedMessages += 1; continue; }
      let text = m.text;
      if (text.length > MAX_MESSAGE_CHARS) { text = text.slice(0, MAX_MESSAGE_CHARS); truncatedChars += 1; }
      messages.push({ role: m.role, text });
    }
  }
  return {
    id,
    name: meta.name || meta.preview || "未命名会话",
    updatedAt: meta.updatedAt,
    cwd: meta.cwd,
    archived: meta.archived,
    messages,
    truncated: truncatedChars,
    truncatedMessages,
  };
}

/** 外部对话记录解析结果（主流 AI / 官方 Codex /export 导出的 .md 或 .txt 文本）。
 *  text 保留文件原文（trim 后）——发送时原样附上，AI 读到的是完整上下文；title/turns 只用于命名与备注展示。 */
export type MarkdownConversation = {
  title: string;
  turns: number;
  text: string;
};

/** 宽松解析外部 Markdown 对话记录：
 *  - title：第一个 `# ` 单级标题（无则取文件名去扩展名，由调用方传入 fileName）
 *  - turns：对话轮次估算（## User / ## Assistant / ## 用户 / ## Codex 等常见轮次标题计数，仅用于备注展示，不参与内容）
 *  - text：原文逐字节保留（trim 首尾空白），不做任何重排/裁剪
 */
export function parseMarkdownConversation(raw: string, fileName: string): MarkdownConversation {
  const text = String(raw ?? "").trim();
  const titleMatch = text.match(/^#\s+(.+)$/m);
  const fallback = (fileName || "对话记录").replace(/\.(md|markdown|txt)$/i, "").trim() || "对话记录";
  const title = (titleMatch?.[1] ?? fallback).trim().slice(0, 120);
  // 轮次标题：二级及以上标题，且内容是常见说话人标记（大小写/中英变体都收）
  const TURN_HEADING = /^#{2,6}\s+(user|assistant|human|me|you|用户|助手|助理|我|你|codex|ai|assistant codex|chatgpt|claude)\b[：:　\s]?.*$/im;
  const turnLines = text.split(/\r?\n/).filter((line) => TURN_HEADING.test(line.trim()));
  const turns = Math.max(0, Math.ceil(turnLines.length / 2));
  return { title, turns, text };
}

/** 幂等导入整包备份：同 rel 同内容=duplicate 跳过；同 rel 异内容=conflict 跳过（绝不覆盖）；返回统计。 */
export function applySessionsBackup(codexHome: string, payload: any): ImportResult {
  if (!payload || payload.format !== BACKUP_FORMAT || !Array.isArray(payload.threads)) {
    throw new Error("不是有效的 Codex 会话备份文件（缺少 format 标记）");
  }
  const result: ImportResult = { imported: 0, skipped: 0, threads: [] };
  for (const thread of payload.threads) {
    const id = String(thread?.id ?? "").trim();
    if (!id || !Array.isArray(thread.files)) continue;
    const name = String(thread?.meta?.name ?? "").trim() || id.slice(0, 8);
    let threadOk = false;
    let sawConflict = false;
    for (const file of thread.files) {
      const rel = safeRel(file?.rel);
      if (!rel || typeof file.text !== "string") continue;
      const target = path.join(codexHome, ...rel.split("/"));
      let status: "ok" | "duplicate" | "conflict";
      if (existsSync(target)) {
        let same = false;
        try { same = readFileSync(target, "utf8") === file.text; } catch { /* 读失败按不同处理 */ }
        status = same ? "duplicate" : "conflict";
      } else {
        try {
          mkdirSync(path.dirname(target), { recursive: true });
          writeFileSync(target, file.text, "utf8");
          status = "ok";
        } catch (error: any) {
          throw new Error(`写入会话 ${id} 失败：${error.message}`);
        }
      }
      if (status === "ok") threadOk = true;
      if (status === "conflict") sawConflict = true;
    }
    if (threadOk) {
      result.imported += 1;
      result.threads.push({ id, name, status: "ok" });
    } else if (sawConflict) {
      // 有文件目标已存在且内容不一致：宁可跳过也不覆盖；冲突优先于重复如实上报
      result.skipped += 1;
      result.threads.push({ id, name, status: "conflict" });
    } else {
      result.skipped += 1;
      result.threads.push({ id, name, status: "duplicate" });
    }
  }
  return result;
}
