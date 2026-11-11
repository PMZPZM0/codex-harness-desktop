/**
 * 记忆原子 · 格式层（纯函数，无 IO）
 *
 * 一条记忆 = 一个 .md 文件：受限 YAML frontmatter + 正文。
 * ⛔ 为什么自己解析而不引 `yaml` 依赖：只要一个子集（字符串 / 列表 / 一层嵌套），
 *   而多一个运行时依赖就多一份打包裁剪与版本漂移的风险（本项目已踩过原生模块的坑）。
 * ⛔ 解析失败必须返回 `null` 并**不写入**（⛔ 不许当空对象 —— 那会把用户原有文件整个覆盖）。
 */

export type AtomType = "fact" | "decision" | "rule" | "preference" | "runbook";
export type AtomStatus = "active" | "superseded" | "expired";
export type AtomScope = "project" | "rule" | "session";
export type AtomConfidence = "confirmed" | "tentative";
export type AtomSourceKind = "session" | "workspace" | "user";

export type AtomMeta = {
  id: string;
  /** 索引里显示的那一行（≤ 40 字）。 */
  summary: string;
  /* ⛔ 11-10 用户确认：「工作伙伴记忆按群和会话每个独立一套」。
     群级记忆要能**只在本群注入**，所以条目必须带归属群；空串 = 工作区级（跨群共享）。 */
  group: string;
  type: AtomType;
  scope: AtomScope;
  status: AtomStatus;
  confidence: AtomConfidence;
  created: string;
  updated: string;
  source: { kind: AtomSourceKind; ref: string; quote?: string };
  tags: string[];
  supersedes: string[];
  expiresAt: string;
  evidence: string[];
};

export const ATOM_TYPES: readonly AtomType[] = ["fact", "decision", "rule", "preference", "runbook"];
export const ATOM_STATUSES: readonly AtomStatus[] = ["active", "superseded", "expired"];
export const ATOM_SCOPES: readonly AtomScope[] = ["project", "rule", "session"];
export const ATOM_CONFIDENCES: readonly AtomConfidence[] = ["confirmed", "tentative"];
export const SUMMARY_MAX = 40;

const one = <T extends string>(list: readonly T[], value: unknown, fallback: T): T => {
  const v = String(value ?? "").trim() as T;
  return list.includes(v) ? v : fallback;
};

/** 去掉文件名/双链里会出问题的字符；中文保留（可读性 > ASCII 洁癖）。 */
export function normalizeId(raw: unknown): string {
  const text = String(raw ?? "")
    .normalize("NFC")
    .trim()
    .replace(/\.md$/i, "")
    .replace(/[[\]]/g, "")
    .replace(/[\\/:*?"<>|#\n\r\t]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return text.slice(0, 60);
}

/** 标题/首行 → 可做 id 的短名。 */
export function slugOf(title: unknown, fallbackIndex = 0): string {
  const slug = normalizeId(title);
  if (slug) return slug;
  return `atom-${Date.now().toString(36)}-${fallbackIndex}`;
}

/** 压缩成一行（索引用）：去 markdown 标记、空白折叠、超长截断加省略号。 */
export function oneLineSummary(text: unknown, max = SUMMARY_MAX): string {
  const plain = String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*`_~|-]{1,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "";
  /* ⛔ 按字符截断（中文一个字算一个），不是按字节 —— 按字节会把中文切成半个字。 */
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

/* ── frontmatter 子集解析 ─────────────────────────────────────────
   支持：
     key: value
     key: "quoted value"
     tags: [a, b]
     tags:
       - a
       - b
     source:
       kind: session
       ref: xxx
   不支持（会被忽略、不报错）：多行字符串、锚点、对象数组。
   ⛔ 非法顶层行（没有冒号且不在列表里）⇒ 整体失败，避免把坏文件读成"半条记忆"。 */
export function parseFrontmatter(text: string): { raw: Record<string, unknown>; body: string } | null {
  const src = String(text ?? "").replace(/\r\n/g, "\n");
  if (!src.startsWith("---\n")) return null;
  const end = src.indexOf("\n---", 3);
  if (end < 0) return null;
  const head = src.slice(4, end);
  const body = src.slice(end + 4).replace(/^\n+/, "");

  const raw: Record<string, unknown> = {};
  const listTarget: { key: string; items: string[] } | null = null;
  let currentList: { key: string; items: string[] } | null = listTarget;
  let currentMap: { key: string; value: Record<string, unknown> } | null = null;

  const unquote = (v: string) => {
    const t = v.trim();
    if ((t.startsWith('"') && t.endsWith('"') && t.length > 1) || (t.startsWith("'") && t.endsWith("'") && t.length > 1)) {
      return t.slice(1, -1);
    }
    return t;
  };
  const inlineList = (v: string) => {
    const inner = v.trim().replace(/^\[/, "").replace(/\]$/, "");
    if (!inner.trim()) return [];
    return inner.split(",").map((x) => unquote(x)).filter(Boolean);
  };

  for (const line of head.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.length - line.replace(/^[ \t]+/, "").length;
    const trimmed = line.trim();

    if (indent > 0) {
      /* 嵌套：`- item` 归上一个列表键；`k: v` 归上一个对象键。 */
      if (trimmed.startsWith("- ")) {
        if (currentList) currentList.items.push(unquote(trimmed.slice(2)));
        continue;
      }
      const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(trimmed);
      if (kv && currentMap) currentMap.value[kv[1]] = unquote(kv[2]);
      continue;
    }

    const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(trimmed);
    if (!kv) return null;
    const key = kv[1];
    const rest = kv[2].trim();
    if (rest === "") {
      /* 空值 ⇒ 可能是列表或对象，先占位，看后续缩进行决定。 */
      raw[key] = [];
      currentList = { key, items: raw[key] as string[] };
      currentMap = { key, value: {} };
      continue;
    }
    if (rest.startsWith("[")) {
      raw[key] = inlineList(rest);
      currentList = null;
      currentMap = null;
      continue;
    }
    raw[key] = unquote(rest);
    currentList = null;
    currentMap = null;
  }
  /* 空值占位若是对象形态（source:），从 currentMap 收回。 */
  for (const key of Object.keys(raw)) {
    const list = raw[key];
    if (Array.isArray(list) && list.length === 0) {
      /* 保持空数组 / 空对象都无害：调用方按字段类型取。 */
      raw[key] = list;
    }
  }
  /* 顶层空值被当作数组处理，但对象键（source）需要二次识别：扫描 head 里 `source:` 下的子行。 */
  const nested = /^source:\s*\n((?:[ \t]+[^\n]*\n?)+)/m.exec(head);
  if (nested) {
    const obj: Record<string, unknown> = {};
    for (const line of nested[1].split("\n")) {
      const kv = /^\s+([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
      if (kv) obj[kv[1]] = unquote(kv[2]);
    }
    if (Object.keys(obj).length) raw.source = obj;
  }
  return { raw, body };
}

const str = (v: unknown, fallback = "") => {
  if (Array.isArray(v)) return "";
  const s = String(v ?? "").trim();
  return s || fallback;
};
const list = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map((x) => String(x ?? "").trim()).filter(Boolean);
  const s = String(v ?? "").trim();
  return s ? [s] : [];
};

/** 宽松解析成 meta（缺字段补默认）；⛔ id/summary 缺失 ⇒ null（这条记忆不能被索引）。 */
export function toMeta(raw: Record<string, unknown>, fallback: { id?: string; scope?: AtomScope } = {}): AtomMeta | null {
  const id = normalizeId(raw.id ?? fallback.id ?? "");
  const summary = oneLineSummary(raw.summary ?? raw.description ?? "");
  if (!id || !summary) return null;
  const srcRaw = raw.source;
  const src = srcRaw && typeof srcRaw === "object" && !Array.isArray(srcRaw) ? (srcRaw as Record<string, unknown>) : {};
  const created = str(raw.created ?? raw.modified) || new Date().toISOString().slice(0, 10);
  return {
    id,
    summary,
    group: str(raw.group),
    type: one(ATOM_TYPES, raw.type, "fact"),
    scope: one(ATOM_SCOPES, raw.scope, fallback.scope ?? "project"),
    status: one(ATOM_STATUSES, raw.status, "active"),
    confidence: one(ATOM_CONFIDENCES, raw.confidence, "confirmed"),
    created,
    updated: str(raw.updated ?? raw.modified) || created,
    source: {
      kind: one(["session", "workspace", "user"] as const, src.kind, "workspace"),
      ref: str(src.ref, "未记录"),
      ...(str(src.quote) ? { quote: str(src.quote) } : {}),
    },
    tags: list(raw.tags),
    supersedes: list(raw.supersedes),
    expiresAt: str(raw.expiresAt),
    evidence: list(raw.evidence),
  };
}

/** 解析整份文件。⛔ 返回 null 表示"文件坏了或不是条目" —— 调用方必须跳过而不是当空条目。 */
export function parseAtom(text: string, fallback: { id?: string; scope?: AtomScope } = {}): { meta: AtomMeta; body: string } | null {
  const fm = parseFrontmatter(text);
  if (!fm) return null;
  const meta = toMeta(fm.raw, fallback);
  if (!meta) return null;
  return { meta, body: fm.body.trim() };
}

/** 稳定的键顺序输出（便于 git diff 与人工审阅）。 */
export function serializeAtom(meta: AtomMeta, body: string): string {
  const q = (v: string) => `"${String(v).replace(/"/g, "'")}"`;
  const lines: string[] = [
    "---",
    `id: ${meta.id}`,
    `summary: ${q(meta.summary)}`,
    `group: ${q(meta.group ?? "")}`,
    `type: ${meta.type}`,
    `scope: ${meta.scope}`,
    `status: ${meta.status}`,
    `confidence: ${meta.confidence}`,
    `created: ${meta.created}`,
    `updated: ${meta.updated}`,
    "source:",
    `  kind: ${meta.source.kind}`,
    `  ref: ${q(meta.source.ref)}`,
    ...(meta.source.quote ? [`  quote: ${q(meta.source.quote)}`] : []),
    meta.tags.length ? `tags: [${meta.tags.join(", ")}]` : "tags: []",
    meta.supersedes.length ? `supersedes: [${meta.supersedes.join(", ")}]` : "supersedes: []",
    `expiresAt: ${q(meta.expiresAt)}`,
    meta.evidence.length ? "evidence:" : "evidence: []",
    ...meta.evidence.map((e) => `  - ${e}`),
    "---",
    "",
    String(body ?? "").trimEnd(),
    "",
  ];
  return lines.join("\n");
}

/** 到期判定（纯函数）：空串 = 永不过期。 */
export function isExpired(meta: AtomMeta, now = Date.now()): boolean {
  if (!meta.expiresAt) return false;
  const at = Date.parse(meta.expiresAt);
  return Number.isFinite(at) && at <= now;
}

/** 是否参与注入（生命周期 + 到期两条口径唯一实现）。 */
export function isInjectable(meta: AtomMeta, now = Date.now()): boolean {
  return meta.status === "active" && !isExpired(meta, now);
}
