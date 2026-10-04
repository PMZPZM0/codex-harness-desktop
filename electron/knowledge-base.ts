// 本地知识库（10-01 立项，独立板块 knowledge-base）：**项目级**知识库。
// 落点：<项目>/.codex-harness/knowledge/<docId>/——文档原文(source.md) + meta.json，全部跟项目走。
// 检索有两档（全局搜索时**自动合并**，任何一档不可用都不影响另一档）：
//   · 全文评分（零依赖、永远可用）
//   · 语义向量（可选）：复用用户已配置供应商的 /embeddings 接口生成向量，纯 JS 余弦检索——
//     ⛔ 刻意不引入 LanceDB 这类原生包：30MB+ 原生模块要进安装包或做 ABI 匹配的大下载，
//     违背「不把安装包拉大」；本地后端将来要做也走「开发工具」页按需下载项，不进包。
// ⛔ 本模块是叶子：不 import 业务模块；workspace/cwd 由 IPC 层传入。
import fs from "node:fs";
import path from "node:path";

export type KbDocMeta = { id: string; title: string; source: string; chunks: number; addedAt: string; bytes: number };
export type KbHit = { docId: string; title: string; chunkIndex: number; score: number; snippet: string };

const KB_DIR = path.join(".codex-harness", "knowledge");
const CHUNK_SIZE = 700;      // 每块约 700 字符（按段落切，块间不重叠）
const MAX_DOCS = 500;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export function kbRoot(workspace: string): string {
  return path.join(String(workspace ?? "").trim(), KB_DIR);
}

function docsDir(workspace: string): string {
  return path.join(kbRoot(workspace), "docs");
}

function safeId(title: string): string {
  const base = String(title ?? "").trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return (base || "doc") + "-" + Date.now().toString(36);
}

function readMeta(workspace: string, docId: string): KbDocMeta | null {
  try { return JSON.parse(fs.readFileSync(path.join(docsDir(workspace), docId, "meta.json"), "utf8")) as KbDocMeta; } catch { return null; }
}

export function listDocs(workspace: string): KbDocMeta[] {
  const dir = docsDir(workspace);
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { return []; }
  const out: KbDocMeta[] = [];
  for (const entry of entries) {
    const meta = readMeta(workspace, entry.name);
    if (meta) out.push(meta);
  }
  return out.sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1));
}

/** 切块：按空行分段，段过长再按句号切，保证块 ≤ CHUNK_SIZE */
export function chunkText(text: string): string[] {
  const paragraphs = String(text ?? "").replace(/\r\n?/g, "\n").split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = "";
  const push = () => { if (current.trim()) chunks.push(current.trim()); current = ""; };
  for (const para of paragraphs) {
    if (para.length <= CHUNK_SIZE) {
      if ((current + "\n\n" + para).length > CHUNK_SIZE) push();
      current = current ? current + "\n\n" + para : para;
      continue;
    }
    push();
    for (const sentence of para.split(/(?<=[。！？.!?])\s*/)) {
      if ((current + sentence).length > CHUNK_SIZE) push();
      current = current ? current + sentence : sentence;
    }
    push();
  }
  push();
  return chunks;
}

/** 导入一个文档：title + 全文文本（渲染层负责读文件/粘贴），落盘 source.md + meta.json */
export function addDocument(workspace: string, input: { title: string; text: string; source?: string }): KbDocMeta {
  const dir = docsDir(workspace);
  if (listDocs(workspace).length >= MAX_DOCS) throw new Error(`知识库文档已达上限（${MAX_DOCS} 个）——先删一些再导入`);
  const text = String(input?.text ?? "");
  if (!text.trim()) throw new Error("文档内容为空");
  if (Buffer.byteLength(text, "utf8") > MAX_FILE_BYTES) throw new Error("单文档超过 20MB，不支持");
  const title = String(input?.title ?? "").trim() || "未命名文档";
  const id = safeId(title);
  const docDir = path.join(dir, id);
  fs.mkdirSync(docDir, { recursive: true });
  fs.writeFileSync(path.join(docDir, "source.md"), text.replace(/\r\n?/g, "\n"), "utf8");
  const meta: KbDocMeta = { id, title, source: String(input?.source ?? ""), chunks: chunkText(text).length, addedAt: new Date().toISOString(), bytes: Buffer.byteLength(text, "utf8") };
  fs.writeFileSync(path.join(docDir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
  return meta;
}

export function removeDocument(workspace: string, docId: string): void {
  const id = String(docId ?? "").trim();
  if (!id || /[\\/]/.test(id)) throw new Error("非法文档 ID");
  const docDir = path.join(docsDir(workspace), id);
  if (!fs.existsSync(docDir)) throw new Error("文档不存在，可能已被删除");
  fs.rmSync(docDir, { recursive: true, force: true });
}

/** v1 检索：分块全文评分（命中词覆盖 + 词频密度），返回带高亮片段的命中列表。零依赖。 */
export function searchDocs(workspace: string, query: string, limit = 8): KbHit[] {
  const q = String(query ?? "").trim();
  if (!q) return [];
  const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  const hits: KbHit[] = [];
  for (const meta of listDocs(workspace)) {
    const file = path.join(docsDir(workspace), meta.id, "source.md");
    let text = "";
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    const chunks = chunkText(text);
    chunks.forEach((chunk, chunkIndex) => {
      const lower = chunk.toLowerCase();
      let score = 0;
      for (const term of terms) {
        let count = 0;
        let at = lower.indexOf(term);
        while (at >= 0) { count += 1; at = lower.indexOf(term, at + term.length); }
        if (count > 0) score += 1 + Math.min(count, 8) * 0.25 + Math.min(term.length, 12) * 0.1;
      }
      if (score > 0) {
        const first = terms.map((term) => lower.indexOf(term)).filter((at) => at >= 0).sort((a, b) => a - b)[0] ?? 0;
        const from = Math.max(0, first - 60);
        const snippet = (from > 0 ? "…" : "") + chunk.slice(from, from + 260).replace(/\s+/g, " ") + (chunk.length > from + 260 ? "…" : "");
        hits.push({ docId: meta.id, title: meta.title, chunkIndex, score, snippet });
      }
    });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(20, limit)));
}

/** 读一个文档全文（前端预览 / 引擎引用原文用） */
export function readDocument(workspace: string, docId: string): { meta: KbDocMeta; text: string } | null {
  const meta = readMeta(workspace, String(docId ?? "").trim());
  if (!meta) return null;
  try { return { meta, text: fs.readFileSync(path.join(docsDir(workspace), meta.id, "source.md"), "utf8") }; } catch { return null; }
}

/* ── 语义向量检索（10-01 第三步）─────────────────────────────────────────────
   向量来源 = 用户已配置供应商的 /embeddings 接口（与润色同一条 chat 供应商配置）。
   向量落盘 = <docDir>/embeddings.json（每块一条，Float 数组），失败/未装时全部静默跳过；
   ⛔ 永不阻塞写入：embed 失败只影响语义档，全文检索照常。 */
export type KbEmbedFn = (texts: string[]) => Promise<number[][]>;

function embeddingsFile(workspace: string, docId: string): string {
  return path.join(docsDir(workspace), docId, "embeddings.json");
}

/** 给一个文档的全部块生成向量并落盘（幂等：已有且块数一致则跳过）。返回是否可用。 */
export async function embedDocument(workspace: string, docId: string, embed: KbEmbedFn): Promise<boolean> {
  const doc = readDocument(workspace, docId);
  if (!doc) return false;
  const chunks = chunkText(doc.text);
  const file = embeddingsFile(workspace, docId);
  try {
    const cached = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(cached?.vectors) && cached.vectors.length === chunks.length) return true;
  } catch { /* 首次或损坏：重建 */ }
  try {
    const vectors = await embed(chunks);
    if (!vectors.length || vectors.length !== chunks.length) return false;
    fs.writeFileSync(file, JSON.stringify({ version: 1, at: new Date().toISOString(), vectors }), "utf8");
    return true;
  } catch { return false; }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0; let na = 0; let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 语义档检索：对已有向量的文档算余弦相似度。embed 失败返回 null（调用方回落全文档）。 */
export async function searchDocsSemantic(workspace: string, query: string, limit: number, embed: KbEmbedFn): Promise<KbHit[] | null> {
  const q = String(query ?? "").trim();
  if (!q) return [];
  let queryVector: number[];
  try { queryVector = (await embed([q]))[0]; } catch { return null; }
  if (!queryVector?.length) return null;
  const hits: KbHit[] = [];
  for (const meta of listDocs(workspace)) {
    let vectors: number[][] = [];
    try { vectors = JSON.parse(fs.readFileSync(embeddingsFile(workspace, meta.id), "utf8")).vectors ?? []; } catch { continue; }
    if (!vectors.length) continue;
    let text = "";
    try { text = fs.readFileSync(path.join(docsDir(workspace), meta.id, "source.md"), "utf8"); } catch { continue; }
    const chunks = chunkText(text);
    vectors.forEach((vector, chunkIndex) => {
      const score = cosine(queryVector, vector);
      if (score < 0.25) return; // 低相似度不凑数（余弦对短文本噪声大）
      const chunk = chunks[chunkIndex] ?? "";
      hits.push({ docId: meta.id, title: meta.title, chunkIndex, score: score * 10, snippet: chunk.slice(0, 260).replace(/\s+/g, " ") });
    });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(20, limit)));
}

/** 全档检索：语义 + 全文合并（同块去重取高分；语义不可用时自动只有全文档）。 */
export async function searchDocsSmart(workspace: string, query: string, limit: number, embed?: KbEmbedFn): Promise<{ hits: KbHit[]; semantic: boolean }> {
  const textHits = searchDocs(workspace, query, limit);
  if (!embed) return { hits: textHits, semantic: false };
  const semanticHits = await searchDocsSemantic(workspace, query, limit, embed);
  if (!semanticHits) return { hits: textHits, semantic: false };
  const merged = new Map<string, KbHit>();
  for (const hit of [...semanticHits, ...textHits]) {
    const key = `${hit.docId}:${hit.chunkIndex}`;
    const prev = merged.get(key);
    if (!prev || hit.score > prev.score) merged.set(key, hit);
  }
  return { hits: [...merged.values()].sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(20, limit))), semantic: true };
}
