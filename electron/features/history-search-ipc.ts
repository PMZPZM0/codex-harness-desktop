/**
 * 历史会话搜索的 IPC 面（09-24）。
 *
 * 需求：顶栏 🔍 图标 → 搜全部历史会话的**对话内容**（不是只搜标题），点结果跳进那个会话。
 * 数据源 = 引擎 rollout 原档（codex-home/sessions/** + archived_sessions/**）——
 * 它是历史的唯一真相源（thread/list 不含无回合会话、渲染层 threads 只持有已加载回合），
 * 复用 thread-backup.ts 的 scanSessionFiles / parseRolloutMessages（与导出/预览同口径）。
 *
 * ⛔ 性能护栏：rollout 单文件可达很大 ⇒ ① 先对原文做一次 indexOf 快速否决（不含关键词不解析）
 * ② 超大文件直接跳过并计数返回 ③ 文件按 mtime 倒序扫、命中够了且后续文件更旧就提前收工。
 */

import { readFile, statSync } from "node:fs";
import { promisify } from "node:util";
import { ipcMain } from "electron";
import { codexHome } from "../runtime-refs";
import { parseRolloutMessages, scanSessionFiles } from "../thread-backup";
// ⛔ 09-24 修（用户反馈「搜出来的历史记录点进去报错」）：搜索结果**必须排除已删除会话**。
//    数据源是 rollout 原档，而 rollout 在删除时并不立即销毁（见 thread-deletion 的血缘/墓碑逻辑），
//    ⇒ 已删会话照样能被搜到、显示出来，但**点进去必然打不开**（引擎与侧栏都没有它）。
import { deletedThreadIds, loadDeletedThreads } from "./thread-deletion";

const readFileAsync = promisify(readFile);

/** 单文件读取上限：超过直接跳过（防大文件把主进程内存拖爆），跳过数照实返回 */
const MAX_FILE_BYTES = 32 * 1024 * 1024;
/** 默认返回的会话条数上限 */
const DEFAULT_LIMIT = 30;
/** 每个会话最多带几条摘要 */
const MATCHES_PER_THREAD = 4;

export type HistorySearchMatch = { role: "user" | "assistant"; ts: string; snippet: string };
export type HistorySearchThread = {
  threadId: string;
  title: string;
  archived: boolean;
  updatedAt: number;
  matchCount: number;
  matches: HistorySearchMatch[];
};
export type HistorySearchResult = {
  threads: HistorySearchThread[];
  scannedFiles: number;
  skippedLarge: number;
  elapsedMs: number;
};

/** 摘要：命中词前后各留一段上下文，压平空白 */
function snippetOf(text: string, needle: string): string {
  const idx = text.toLowerCase().indexOf(needle);
  if (idx < 0) return text.slice(0, 160);
  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + needle.length + 120);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + body + (end < text.length ? "…" : "");
}

/** 会话标题 = 第一条「非注入」用户消息（与 extractMeta 同判据的简化版：注入文本都以 # 或 < 开头） */
function titleOf(messages: ReturnType<typeof parseRolloutMessages>): string {
  for (const m of messages) {
    if (m.role !== "user") continue;
    const t = m.text.trim();
    if (!t || t.startsWith("#") || t.startsWith("<")) continue;
    return t.slice(0, 80);
  }
  return "";
}

ipcMain.handle("history:search", async (_event, input?: { query?: string; limit?: number }): Promise<HistorySearchResult> => {
  const started = Date.now();
  const query = String(input?.query ?? "").trim();
  const limit = Math.max(1, Math.min(80, Number(input?.limit) || DEFAULT_LIMIT));
  const empty: HistorySearchResult = { threads: [], scannedFiles: 0, skippedLarge: 0, elapsedMs: Date.now() - started };
  if (!query) return empty;
  const needle = query.toLowerCase();

  // scanSessionFiles 是同步目录遍历（成本可忽略）；文件级搜索走异步读，不卡主进程
  const byId = scanSessionFiles(codexHome);
  // ⛔ 先确保墓碑集已加载（loadDeletedThreads 自带 in-flight 幂等），据此排除已删除会话
  await loadDeletedThreads().catch(() => undefined);
  const files: { threadId: string; archived: boolean; abs: string; mtimeMs: number }[] = [];
  for (const [threadId, bucket] of byId) {
    if (deletedThreadIds.has(threadId)) continue; // 已删除 ⇒ 搜到了也打不开，直接不呈现
    for (const f of bucket.files) files.push({ threadId, archived: bucket.archived, abs: f.abs, mtimeMs: f.mtimeMs });
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const found = new Map<string, HistorySearchThread>();
  let scannedFiles = 0;
  let skippedLarge = 0;

  for (const file of files) {
    // 提前收工：已凑够 limit 个会话，且当前文件比其中最旧的命中还旧 ⇒ 后面只会更旧
    if (found.size >= limit) {
      const worst = Math.min(...[...found.values()].map((t) => t.updatedAt));
      if (file.mtimeMs < worst) break;
    }
    try {
      if (statSync(file.abs).size > MAX_FILE_BYTES) { skippedLarge++; continue; }
      const text = await readFileAsync(file.abs, "utf8");
      scannedFiles++;
      if (!text.toLowerCase().includes(needle)) continue;
      const messages = parseRolloutMessages(text);
      const matches: HistorySearchMatch[] = [];
      let matchCount = 0;
      for (const m of messages) {
        if (!m.text.toLowerCase().includes(needle)) continue;
        matchCount++;
        if (matches.length < MATCHES_PER_THREAD) matches.push({ role: m.role, ts: m.ts, snippet: snippetOf(m.text, needle) });
      }
      if (!matchCount) continue;
      const bucket = found.get(file.threadId);
      if (bucket) {
        bucket.matchCount += matchCount;
        bucket.updatedAt = Math.max(bucket.updatedAt, file.mtimeMs);
        for (const m of matches) if (bucket.matches.length < MATCHES_PER_THREAD) bucket.matches.push(m);
      } else {
        found.set(file.threadId, {
          threadId: file.threadId,
          title: titleOf(messages),
          archived: file.archived,
          updatedAt: file.mtimeMs,
          matchCount,
          matches,
        });
      }
    } catch { /* 单文件损坏/读失败跳过 */ }
  }

  const threads = [...found.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  return { threads, scannedFiles, skippedLarge, elapsedMs: Date.now() - started };
});
