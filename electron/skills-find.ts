/**
 * 本地技能检索（11-19 用户令：「find-skills 能找到新安装的技能」「这样节省 token」）。
 *
 * 为什么单独一个模块：技能清单是**引擎注入**的索引（每个技能一行 60 字），模型命中不了的技能
 * 就等于不存在。这里提供**按需检索**——实时扫盘，所以**刚装的技能立刻可被找到**（不依赖清单刷新）。
 *
 * 检索口径（可解释、不做花哨排序）：
 *   · 名称命中 = 3 分，description 命中 = 2 分，正文命中 = 1 分；多个关键词相加；
 *   · 中文不分词，按**子串**匹配（项目实测：中文按空格分词召回为 0）；
 *   · 大小写不敏感；只扫 `SKILL.md` 与 `SKILL.md.disabled`（停用的也返回，但标 enabled=false）。
 *
 * ⛔ 只读：不修改任何技能文件；扫盘上限防止超大目录拖慢（默认 400 个技能、每个正文只读前 16KB）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";

export type SkillHit = {
  name: string;
  /** SKILL.md 的绝对路径（模型可直接 read_file） */
  path: string;
  desc: string;
  scope: "user" | "repo";
  enabled: boolean;
  score: number;
};

const MAX_SKILLS = 400;
const MAX_BODY = 16 * 1024;

/** 从 frontmatter 取 description（缺省返回空串）。 */
function descOf(raw: string): string {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const head = m ? m[1] : "";
  const d = head.match(/^description:\s*([\s\S]*?)(?=\n[a-zA-Z_-]+:\s|$)/m);
  return String(d?.[1] ?? "").replace(/\s+/g, " ").trim();
}

function score(haystacks: { name: string; desc: string; body: string }, terms: string[]): number {
  let total = 0;
  for (const term of terms) {
    if (!term) continue;
    if (haystacks.name.includes(term)) total += 3;
    if (haystacks.desc.includes(term)) total += 2;
    if (haystacks.body.includes(term)) total += 1;
  }
  return total;
}

/**
 * 检索本地技能。
 * @param dirs 要扫的技能根目录（全局 + 项目级），按顺序给 scope
 */
export async function findLocalSkills(
  dirs: Array<{ dir: string; scope: "user" | "repo" }>,
  query: string,
  limit = 5,
): Promise<SkillHit[]> {
  const terms = String(query ?? "").toLowerCase().split(/[\s,，、;；]+/).filter(Boolean);
  if (!terms.length) return [];
  const hits: SkillHit[] = [];
  let scanned = 0;

  for (const { dir, scope } of dirs) {
    if (!existsSync(dir)) continue;
    let entries: Array<{ name: string; isDirectory(): boolean }> = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (scanned >= MAX_SKILLS) break;
      const base = path.join(dir, entry.name);
      const active = path.join(base, "SKILL.md");
      const disabled = path.join(base, "SKILL.md.disabled");
      const file = existsSync(active) ? active : existsSync(disabled) ? disabled : null;
      if (!file) continue;
      scanned += 1;
      let raw = "";
      try {
        const buf = await fs.readFile(file);
        raw = buf.subarray(0, MAX_BODY).toString("utf8");
      } catch { continue; }
      const name = entry.name;
      const desc = descOf(raw);
      const body = raw.toLowerCase();
      const s = score({ name: name.toLowerCase(), desc: desc.toLowerCase(), body }, terms);
      if (s <= 0) continue;
      hits.push({ name, path: file, desc: desc.slice(0, 140), scope, enabled: file === active, score: s });
    }
  }

  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return hits.slice(0, Math.max(1, Math.min(20, limit)));
}
