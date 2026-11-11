/**
 * 记忆原子 · 召回层（纯函数，无 IO、不看时钟）
 *
 * 用户令（11-10）：「按豆包那套改造，但要比他的更好」。
 * 豆包只把**索引**给模型（模型自己决定开不开哪个文件）；我们多一步：
 * 按「本轮任务 + 工作区 + 来源」打一次分，把最相关的几条**正文**直接召回到眼前。
 *
 * ⛔ 所有输入都由调用方传入（now / query / 工作区），本模块不读盘、不取时间 —— 这样才能被守卫真跑。
 * ⛔ 中文必须 bigram 切分：按空格切分对中文是零召回（本项目知识库检索踩过同一个坑）。
 */

import { isInjectable, type AtomMeta } from "./atoms-format";

export type AtomDoc = { meta: AtomMeta; body: string };

export type RecallContext = {
  /** 本轮任务的文本（首条用户消息 / 待办标题）。空则只出索引。 */
  query?: string;
  /** 当前工作区绝对路径（用于 source.ref 同源加成）。 */
  workspace?: string;
  /** 当前会话/群标识（同上）。 */
  sessionRef?: string;
  /** 注入时刻（毫秒）。 */
  now?: number;
  /** 已注入过的 id → 最近使用时间（命中过的下次略加权）。 */
  lastUsedAt?: Record<string, number>;
};

export type SelectOptions = {
  /** 索引用多少字符（默认 1200）。 */
  indexMaxChars?: number;
  /** 召回的正文条数（默认 3，0 = 只出索引）。 */
  recallLimit?: number;
  /** 单条正文最多多少字符（默认 600）。 */
  bodyMaxChars?: number;
};

export type SelectResult = {
  /** 索引段（markdown，未加标题）。 */
  indexText: string;
  /** 被截掉的条目数（>0 时索引里要写明"还有 N 条未列出"）。 */
  indexDropped: number;
  /** 召回选中（含截断后的正文）。 */
  recalled: Array<{ meta: AtomMeta; body: string }>;
  /** 互相矛盾、需要人裁决的条目对（只报 active）。 */
  conflicts: Array<[string, string]>;
};

const STOP = new Set(["的", "了", "是", "在", "和", "与", "就", "都", "也", "很", "把", "被", "这", "那", "一个", "我们", "你们", "他们", "the", "and", "for", "with", "that", "this"]);

/** 中文 bigram + 英文词；去停用词、去纯数字噪音。 */
export function tokenize(text: unknown): string[] {
  const src = String(text ?? "")
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (!src) return [];
  const out = new Set<string>();
  for (const chunk of src.split(/\s+/)) {
    if (!chunk) continue;
    /* 英文/数字：整词（≥ 3 字符） */
    if (/^[a-z0-9]+$/.test(chunk)) {
      if (chunk.length >= 3 && !STOP.has(chunk)) out.add(chunk);
      continue;
    }
    /* 中文：单字没区分度，按 2 字滑窗 */
    const chars = [...chunk];
    if (chars.length === 1) { out.add(chunk); continue; }
    for (let i = 0; i + 1 < chars.length; i += 1) {
      const bi = chars[i] + chars[i + 1];
      if (!STOP.has(bi)) out.add(bi);
    }
  }
  return [...out];
}

const DAY = 86_400_000;

/** 一条记忆的相关度。⛔ 权重写在这里，别散落到调用方（口径一散就不可比）。 */
export function scoreAtom(doc: AtomDoc, ctx: RecallContext): number {
  const { meta } = doc;
  if (!isInjectable(meta, ctx.now)) return 0;
  const q = tokenize(ctx.query);
  if (!q.length) return 0;
  const hay = new Set(tokenize([meta.summary, meta.tags.join(" "), doc.body.slice(0, 1500)].join(" ")));
  let hit = 0;
  for (const t of q) if (hay.has(t)) hit += 1;
  const relevance = hit / q.length;

  /* 同源加成：这条记忆就来自当前工作区 / 当前会话。 */
  const ref = meta.source.ref || "";
  let affinity = 0;
  if (ctx.sessionRef && ref.includes(ctx.sessionRef)) affinity = 1;
  else if (ctx.workspace && ref.replace(/\\/g, "/").includes(ctx.workspace.replace(/\\/g, "/"))) affinity = 1;

  /* 新近度：90 天线性衰减到 0。 */
  const updated = Date.parse(meta.updated);
  const now = ctx.now ?? Date.now();
  const ageDays = Number.isFinite(updated) ? Math.max(0, (now - updated) / DAY) : 999;
  const recency = Math.max(0, 1 - ageDays / 90);

  /* 使用频次：最近 30 天被召回过就给一点加权。 */
  const lastUsed = ctx.lastUsedAt?.[meta.id] ?? 0;
  const usage = lastUsed && now - lastUsed < 30 * DAY ? 1 : 0;

  const base = 0.55 * relevance + 0.2 * affinity + 0.15 * recency + 0.1 * usage;
  const conf = meta.confidence === "confirmed" ? 1 : 0.6;
  /* 规则类不因置信打折：规则是人定的，不是"待验证的事实"。 */
  return base * (meta.type === "rule" ? 1 : conf);
}

/** 两条 active 可能矛盾的粗判：类型相同、标签重合 ≥ 2、且正文都出现了数字但没有任何一句共同结论。 */
export function findConflicts(docs: AtomDoc[]): Array<[string, string]> {
  const active = docs.filter((d) => d.meta.status === "active");
  const out: Array<[string, string]> = [];
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i].meta;
      const b = active[j].meta;
      if (a.type !== b.type) continue;
      const shared = a.tags.filter((t) => b.tags.includes(t));
      if (shared.length < 2) continue;
      /* ⛔ 只报"同一主题、数字不同"这一种 —— 判得太宽会把整份索引刷成警告。 */
      const nums = (s: string) => (s.match(/\d+(?:\.\d+)?/g) || []).slice(0, 20).join(",");
      const na = nums(active[i].body);
      const nb = nums(active[j].body);
      if (na && nb && na !== nb) out.push([a.id, b.id]);
    }
  }
  return out;
}

const TYPE_TITLE: Record<string, string> = {
  rule: "规则（必须遵守）",
  decision: "决定",
  fact: "事实",
  runbook: "流程",
  preference: "偏好",
};
const TYPE_ORDER = ["rule", "decision", "runbook", "fact", "preference"];

/** 生成索引 + 选召回。**唯一实现**：调用方（注入链）不许自己再排一遍。 */
export function selectAtoms(docs: AtomDoc[], ctx: RecallContext = {}, options: SelectOptions = {}): SelectResult {
  const indexMaxChars = Math.max(200, options.indexMaxChars ?? 1200);
  const recallLimit = Math.max(0, options.recallLimit ?? 3);
  const bodyMaxChars = Math.max(120, options.bodyMaxChars ?? 600);
  const now = ctx.now ?? Date.now();

  const live = docs.filter((d) => isInjectable(d.meta, now));
  const conflicts = findConflicts(live);

  /* 索引：按类型分组，组内 updated 降序（规则组在前）。 */
  const byType = new Map<string, AtomDoc[]>();
  for (const d of live) {
    const list = byType.get(d.meta.type) ?? [];
    list.push(d);
    byType.set(d.meta.type, list);
  }
  const lines: string[] = [];
  let used = 0;
  let dropped = 0;
  let emitted = 0;
  for (const type of TYPE_ORDER) {
    const rows = (byType.get(type) ?? []).sort((a, b) => String(b.meta.updated).localeCompare(String(a.meta.updated)));
    if (!rows.length) continue;
    const header = `### ${TYPE_TITLE[type] ?? type}`;
    let headerDone = false;
    for (const row of rows) {
      const stamp = String(row.meta.updated).slice(5);
      const flag = row.meta.confidence === "tentative" ? " · 待验证" : "";
      const line = `- [[${row.meta.id}]] — ${row.meta.summary}${flag} · ${type} · ${stamp}`;
      const cost = line.length + (headerDone ? 0 : header.length + 1);
      if (used + cost > indexMaxChars) { dropped += 1; continue; }
      if (!headerDone) { lines.push(header); used += header.length + 1; headerDone = true; }
      lines.push(line);
      used += line.length + 1;
      emitted += 1;
    }
  }
  /* ⛔ 索引一条都没放下时也要留个证明：不能静默变成"没有记忆"。 */
  if (!emitted && live.length) lines.push(`（索引超预算，${live.length} 条全部未列出 —— 先蒸馏或调大预算）`);

  /* 召回：按分排序取 Top-K；同分按 updated 新的优先（避免顺序随机）。 */
  const scored = live
    .map((d) => ({ d, s: scoreAtom(d, ctx) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => (b.s - a.s) || String(b.d.meta.updated).localeCompare(String(a.d.meta.updated)));
  const recalled = scored.slice(0, recallLimit).map(({ d }) => ({
    meta: d.meta,
    body: d.body.length > bodyMaxChars ? `${d.body.slice(0, bodyMaxChars).trimEnd()}\n…（本条已截断，需要全文读 entries/${d.meta.scope}/${d.meta.id}.md）` : d.body,
  }));

  return { indexText: lines.join("\n"), indexDropped: dropped, recalled, conflicts };
}

/** 渲染成注入块（信封由调用方套；这里只管内容）。 */
export function renderAtomsBlock(result: SelectResult, total: number): string {
  const parts: string[] = [];
  const head = `## 项目记忆 · 索引（${total} 条在用${result.indexDropped ? `，另有 ${result.indexDropped} 条超预算未列出` : ""}）`;
  parts.push(`${head}\n${result.indexText}`);
  if (result.recalled.length) {
    const rows = result.recalled.map((r) => {
      const tags = r.meta.tags.length ? ` · ${r.meta.tags.slice(0, 3).join("/")}` : "";
      const warn = r.meta.confidence === "tentative" ? " · ⚠ 待验证，不当事实用" : "";
      return `### ${r.meta.id}（${r.meta.type}${tags}${warn}）\n${r.body}`;
    });
    parts.push(`## 项目记忆 · 本轮相关（${rows.length} 条，按当前任务召回）\n${rows.join("\n\n")}`);
  }
  if (result.conflicts.length) {
    const pairs = result.conflicts.map(([a, b]) => `- [[${a}]] ↔ [[${b}]]`).join("\n");
    parts.push(`## ⚠ 待裁决的记忆冲突\n下面几条说法互相矛盾，**先确认再采信**，不要随手挑一条用：\n${pairs}`);
  }
  return parts.join("\n\n");
}
