/**
 * 记忆原子 · 存储层（唯一 IO 实现）
 *
 * 目录（全在 `<workspace>/.codex-harness/memory/atoms/` 下，与既有记忆目录同级、互不覆盖）：
 *   entries/<scope>/<id>.md   一条记忆一个文件
 *   INDEX.md                  生成物（⛔ 不手改，由条目生成）
 *   .usage.json               最近召回时间（打分用，限 200 条）
 *   .changelog.jsonl          append-only 审计
 *
 * ⛔ 写文件一律「tmp + rename」：中途崩掉不会留下半截条目（半截 = 解析失败 = 那条记忆静默消失）。
 * ⛔ 读不到 / 坏文件 → 跳过并计数，**绝不**当成空条目覆盖（这是 11-10 在 CLI 配置上踩过的同一个坑）。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { MEMORY_DIR, MEMORY_SUB } from "./layers-budget";
import {
  ATOM_SCOPES, isExpired, normalizeId, parseAtom, serializeAtom, toMeta,
  type AtomMeta, type AtomScope,
} from "./atoms-format";
import type { AtomDoc } from "./atoms-select";

export const ATOMS_DIR = "atoms";
const ENTRIES_DIR = "entries";
const INDEX_FILE = "INDEX.md";
const USAGE_FILE = ".usage.json";
const CHANGELOG_FILE = ".changelog.jsonl";
const USAGE_CAP = 200;

/** 记忆原子的根目录（`<workspace>/.codex-harness/memory/atoms`，与既有记忆目录同级、互不覆盖）。 */
export function atomsRootOf(workspace: string): string {
  return path.join(workspace, MEMORY_DIR, MEMORY_SUB, ATOMS_DIR);
}
/** 条目目录（其下按 scope 分目录；session 再按群 id 分一层，做到群级隔离）。 */
export function atomsEntriesRoot(workspace: string): string {
  return path.join(atomsRootOf(workspace), ENTRIES_DIR);
}

const ensureDir = (dir: string) => fs.mkdir(dir, { recursive: true });

async function writeFileAtomic(file: string, content: string): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, file);
}

async function appendChangelog(root: string, row: Record<string, unknown>): Promise<void> {
  try {
    await ensureDir(root);
    await fs.appendFile(path.join(root, CHANGELOG_FILE), `${JSON.stringify(row)}\n`, "utf8");
  } catch { /* 审计失败不许挡住写入本身 */ }
}

export type ReadResult = {
  docs: AtomDoc[];
  /** 坏文件（解析失败）—— 调用方应把它报出来，而不是当"没有记忆"。 */
  broken: string[];
};

/** 读全部条目。目录不存在 = 还没启用 atoms（调用方走旧逻辑）。 */
export async function readAtoms(workspace: string): Promise<ReadResult> {
  const root = atomsEntriesRoot(workspace);
  const docs: AtomDoc[] = [];
  const broken: string[] = [];
  let scopes: string[] = [];
  try {
    scopes = (await fs.readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return { docs, broken };
  }
  /* ⛔ 11-10 用户令「记忆按群和会话每个独立一套」：
     `entries/session/<groupId>/xxx.md` = 只属于这个群的记忆；
     `entries/<scope>/xxx.md`（直接放 md）= 工作区级（跨群共享）。
     ⇒ 这里必须认**两级**目录，否则所有群会读到彼此的记忆。 */
  const readOne = async (dir: string, rel: string, group: string, scope: AtomScope) => {
    try {
      const text = await fs.readFile(path.join(dir, rel), "utf8");
      const parsed = parseAtom(text, { id: rel.replace(/\.md$/i, ""), scope });
      if (!parsed) { broken.push(`${scope}/${group ? `${group}/` : ""}${rel}`); return; }
      /* frontmatter 没写 group 时用目录名兜底 —— 目录本身就是归属。 */
      docs.push({ meta: { ...parsed.meta, group: parsed.meta.group || group }, body: parsed.body });
    } catch {
      broken.push(`${scope}/${group ? `${group}/` : ""}${rel}`);
    }
  };

  for (const scope of scopes) {
    const scopeDir = path.join(root, scope);
    const scopeKind: AtomScope = ATOM_SCOPES.includes(scope as AtomScope) ? (scope as AtomScope) : "project";
    let entries: Array<{ name: string; isDir: boolean }> = [];
    try {
      entries = (await fs.readdir(scopeDir, { withFileTypes: true })).map((d) => ({ name: d.name, isDir: d.isDirectory() }));
    } catch { continue; }
    for (const entry of entries) {
      if (entry.isDir) {
        let files: string[] = [];
        try { files = (await fs.readdir(path.join(scopeDir, entry.name))).filter((f) => f.endsWith(".md")); } catch { continue; }
        for (const file of files) await readOne(path.join(scopeDir, entry.name), file, entry.name, scopeKind);
      } else if (entry.name.endsWith(".md")) {
        await readOne(scopeDir, entry.name, "", scopeKind);
      }
    }
  }
  return { docs, broken };
}

export type WriteOutcome = "written" | "same" | "skipped";

/** 写一条记忆（新建 / 覆盖正文）。⛔ 内容相同返回 same（算成功，不制造"假失败"）。 */
export async function writeAtom(
  workspace: string,
  meta: AtomMeta,
  body: string,
  by: "capture" | "distill" | "manual" = "manual",
): Promise<WriteOutcome> {
  const id = normalizeId(meta.id);
  if (!id) return "skipped";
  const scope = ATOM_SCOPES.includes(meta.scope) ? meta.scope : "project";
  /* ⛔⛔ 11-11 自审发现：读侧 readAtoms 认 entries/session/<群id>/ 两级目录，
     写侧原来只写 entries/session/<id>.md ⇒ 同一 id 在不同群互相覆盖，群隔离形同虚设。
     ⇒ session 域带 group 必须落到自己的群目录；工作区级 / 老数据保持一级目录不变。 */
  const group = meta.scope === "session" ? String(meta.group ?? "").trim() : "";
  const file = path.join(atomsEntriesRoot(workspace), scope, ...(group ? [group] : []), `${id}.md`);
  const next = serializeAtom({ ...meta, id, scope }, body);
  const current = await fs.readFile(file, "utf8").catch(() => null);
  if (current === next) return "same";
  await writeFileAtomic(file, next);
  await appendChangelog(atomsRootOf(workspace), {
    at: new Date().toISOString(), op: current === null ? "add" : "update", id, scope, by, summary: meta.summary,
  });
  return "written";
}

/** 生成 INDEX.md。返回条数与 active 数，供注入侧与界面显示。 */
export async function regenerateIndex(workspace: string, now = Date.now()): Promise<{ total: number; active: number; broken: string[] }> {
  const { docs, broken } = await readAtoms(workspace);
  const root = atomsRootOf(workspace);
  const active = docs.filter((d) => d.meta.status === "active" && !isExpired(d.meta, now));
  const pending = active.filter((d) => d.meta.confidence === "tentative").length;
  const retired = docs.length - active.length;
  const GROUPS: Array<[string, string]> = [
    ["rule", "规则（必须遵守）"], ["decision", "决定"], ["runbook", "流程"], ["fact", "事实"], ["preference", "偏好"],
  ];
  const lines: string[] = [
    "# INDEX.md — 项目记忆索引（自动生成，勿手改）",
    `> 共 ${docs.length} 条 · 在用 ${active.length} · 待验证 ${pending} · 已停用 ${retired}${broken.length ? ` · ⚠ 坏文件 ${broken.length} 个` : ""}`,
    "",
  ];
  for (const [type, title] of GROUPS) {
    const rows = active.filter((d) => d.meta.type === type).sort((a, b) => String(b.meta.updated).localeCompare(String(a.meta.updated)));
    if (!rows.length) continue;
    lines.push(`## ${title}`);
    for (const row of rows) {
      const flag = row.meta.confidence === "tentative" ? " · 待验证" : "";
      const groupHint = row.meta.group ? ` · 群 ${row.meta.group}` : "";
      lines.push(`- [[${row.meta.id}]] — ${row.meta.summary}${flag}${groupHint} · ${String(row.meta.updated).slice(5)}`);
    }
    lines.push("");
  }
  if (broken.length) {
    lines.push("## ⚠ 坏文件（解析失败，不会被注入）");
    for (const b of broken) lines.push(`- ${b}`);
    lines.push("");
  }
  await writeFileAtomic(path.join(root, INDEX_FILE), `${lines.join("\n").trimEnd()}\n`);
  return { total: docs.length, active: active.length, broken };
}

/** 把旧条目标成被新条目取代（索引里不再出，但文件保留可查）。 */
export async function supersedeAtom(workspace: string, oldId: string, newId: string): Promise<boolean> {
  const target = normalizeId(oldId);
  if (!target) return false;
  const { docs } = await readAtoms(workspace);
  const hit = docs.find((d) => d.meta.id === target);
  if (!hit) return false;
  hit.meta.status = "superseded";
  hit.meta.updated = new Date().toISOString().slice(0, 10);
  const outcome = await writeAtom(workspace, hit.meta, `${hit.body}\n\n> 已被 [[${normalizeId(newId)}]] 取代。`, "manual");
  await appendChangelog(atomsRootOf(workspace), {
    at: new Date().toISOString(), op: "supersede", id: target, by: normalizeId(newId) ? "manual" : "manual", summary: hit.meta.summary,
  });
  await regenerateIndex(workspace);
  return outcome !== "skipped";
}

/** 到期/超期 → expired（启动 gc 调用；⛔ 不阻塞注入路径）。 */
export async function expireStale(workspace: string, now = Date.now()): Promise<number> {
  const { docs } = await readAtoms(workspace);
  let changed = 0;
  for (const doc of docs) {
    if (doc.meta.status !== "active" || !isExpired(doc.meta, now)) continue;
    doc.meta.status = "expired";
    doc.meta.updated = new Date().toISOString().slice(0, 10);
    await writeAtom(workspace, doc.meta, doc.body, "distill");
    await appendChangelog(atomsRootOf(workspace), {
      at: new Date().toISOString(), op: "expire", id: doc.meta.id, by: "distill", summary: doc.meta.summary,
    });
    changed += 1;
  }
  if (changed) await regenerateIndex(workspace, now);
  return changed;
}

/** 记录本轮召回到了谁（下次打分略加权）。限 200 条，防无限增长。 */
export async function markUsed(workspace: string, ids: string[], now = Date.now()): Promise<void> {
  if (!ids.length) return;
  const file = path.join(atomsRootOf(workspace), USAGE_FILE);
  let map: Record<string, number> = {};
  try { map = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, number>; } catch { /* 新文件 */ }
  for (const id of ids) map[normalizeId(id)] = now;
  const rows = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, USAGE_CAP);
  try { await writeFileAtomic(file, `${JSON.stringify(Object.fromEntries(rows), null, 2)}\n`); } catch { /* 旁路 */ }
}

/** 读「最近被召回」的时间表（打分的新近度用）；文件不存在或坏了就当空表，⛔ 不抛。 */
export async function readUsage(workspace: string): Promise<Record<string, number>> {
  try { return JSON.parse(await fs.readFile(path.join(atomsRootOf(workspace), USAGE_FILE), "utf8")) as Record<string, number>; }
  catch { return {}; }
}

/** 从一段自由文本里抽一条 meta 的便捷入口（capture / 迁移脚本共用）。 */
export function metaFromText(input: {
  title: string; summary?: string; body?: string; scope?: AtomScope;
  type?: AtomMeta["type"]; source?: { kind: AtomMeta["source"]["kind"]; ref: string; quote?: string };
  tags?: string[]; confidence?: AtomMeta["confidence"];
}, id?: string): AtomMeta | null {
  return toMeta({
    id: id ?? input.title,
    summary: input.summary ?? input.title,
    type: input.type ?? "fact",
    scope: input.scope ?? "project",
    confidence: input.confidence ?? "confirmed",
    created: new Date().toISOString().slice(0, 10),
    updated: new Date().toISOString().slice(0, 10),
    source: input.source ?? { kind: "workspace", ref: "未记录" },
    tags: input.tags ?? [],
    supersedes: [],
    expiresAt: "",
    evidence: [],
  });
}

