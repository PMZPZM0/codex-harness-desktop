/**
 * 收藏夹（harness 自持，不入 config.toml）。
 *
 * 形态与 ssh-servers.ts 一致：**纯数据层**，不碰 ipcMain（IPC 在 features/screenshot-favorites-ipc.ts）。
 * 持久化 = `userData/favorites.json`（读盘归一化 + 临时文件原子替换）。
 *
 * 为什么单独一份文件而不是塞进某个已有 store：
 *   · 收藏是**跨会话/跨项目**的用户资产（对话消息、截图、文件、链接、手写片段混装），
 *     生命周期与任何单个会话都不同；
 *   · 它要被三个面同时消费：设置页（批量管理）、输入框加号菜单（一键发送）、
 *     记忆层（加入 Agent 记忆）—— 真相源必须唯一，否则三处各存一份必然分叉。
 *
 * ⛔ 删除一律走「显式 id 列表」（`deleteFavorites(userData, ids)`），不提供「删全部但不用确认」的隐式入口：
 *    收藏内容不可再生（用户手攒的），误删无法从会话里复原。批量选中 → 一次显式 id 列表 ⇒ 一次确认。
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/** 收藏类型：正文片段 / 图片 / 文件 / 链接。 */
export type FavoriteKind = "text" | "image" | "file" | "link";

export type FavoriteSource = {
  /** 来源会话（从某条消息收藏时记下，便于回溯） */
  threadId?: string;
  threadName?: string;
  turnId?: string;
  messageId?: string;
  /** 来源角色：user / assistant / manual（手写） */
  role?: string;
};

export type FavoriteItem = {
  id: string;
  kind: FavoriteKind;
  /** 展示标题（列表/芯片都用它；不填则从 content 推） */
  title: string;
  /** text: 正文；image/file: 绝对路径；link: URL */
  content: string;
  /** 用户备注（可选） */
  note?: string;
  tags: string[];
  source?: FavoriteSource;
  createdAt: string;
  updatedAt: string;
  /** 被发送/插入的次数（列表排序「常用优先」用；只由 touch 递增） */
  useCount: number;
  lastUsedAt?: string;
};

const FAVORITES_VERSION = 1;
/** 单条收藏正文上限：防止一条巨型粘贴把 favorites.json 与「加入记忆」的行撑爆。 */
export const FAVORITE_CONTENT_MAX = 8000;
/** 「加入 Agent 记忆」时单行截断长度：记忆注入预算是硬上限（见 electron/memory-layers.ts 的 MEMORY_BUDGET），
 *  收藏是用户可无限追加的来源 ⇒ 必须在写入这一刻限长，否则一条长收藏就能挤掉整个常驻块。 */
export const FAVORITE_MEMORY_LINE_MAX = 300;

function favoritesFile(userData: string): string {
  return path.join(userData, "favorites.json");
}

function nowIso(): string {
  return new Date().toISOString();
}

/** 不信任磁盘内容：任何字段都可能来自旧版本或被手改。 */
function normalizeKind(value: unknown): FavoriteKind {
  const raw = String(value ?? "").toLowerCase();
  if (raw === "image" || raw === "file" || raw === "link") return raw;
  return "text";
}

function normalizeItem(raw: any): FavoriteItem | null {
  if (!raw || typeof raw !== "object") return null;
  const content = typeof raw.content === "string" ? raw.content : "";
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id : crypto.randomUUID();
  if (!content.trim() && !String(raw.title ?? "").trim()) return null;
  const createdAt = typeof raw.createdAt === "string" && raw.createdAt ? raw.createdAt : nowIso();
  return {
    id,
    kind: normalizeKind(raw.kind),
    title: String(raw.title ?? "").trim(),
    content: content.slice(0, FAVORITE_CONTENT_MAX),
    note: typeof raw.note === "string" && raw.note.trim() ? raw.note.trim() : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t: unknown) => typeof t === "string" && t.trim()).map((t: string) => t.trim()).slice(0, 12) : [],
    source: raw.source && typeof raw.source === "object" ? {
      threadId: typeof raw.source.threadId === "string" ? raw.source.threadId : undefined,
      threadName: typeof raw.source.threadName === "string" ? raw.source.threadName : undefined,
      turnId: typeof raw.source.turnId === "string" ? raw.source.turnId : undefined,
      messageId: typeof raw.source.messageId === "string" ? raw.source.messageId : undefined,
      role: typeof raw.source.role === "string" ? raw.source.role : undefined,
    } : undefined,
    createdAt,
    updatedAt: typeof raw.updatedAt === "string" && raw.updatedAt ? raw.updatedAt : createdAt,
    useCount: Number.isFinite(Number(raw.useCount)) ? Math.max(0, Math.round(Number(raw.useCount))) : 0,
    lastUsedAt: typeof raw.lastUsedAt === "string" && raw.lastUsedAt ? raw.lastUsedAt : undefined,
  };
}

export async function readFavorites(userData: string): Promise<FavoriteItem[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(favoritesFile(userData), "utf8"));
    const list = Array.isArray(parsed) ? parsed : parsed?.items;
    if (!Array.isArray(list)) return [];
    return list.map(normalizeItem).filter((item): item is FavoriteItem => Boolean(item));
  } catch (error: any) {
    // ⛔ 文件不存在 = 空收藏（正常首启）；**其它错误**（JSON 坏了/权限）也要降级成空列表 +
    //    留痕，不能让设置页与加号菜单因为一份坏文件整体打不开。
    if (error?.code !== "ENOENT") console.error("[favorites] 读取失败，按空列表降级：", error?.message ?? error);
    return [];
  }
}

/** 先写临时文件再 rename：写一半断电/被强杀不会留下半个 JSON。 */
export async function writeFavorites(userData: string, items: FavoriteItem[]): Promise<void> {
  await fs.mkdir(userData, { recursive: true });
  const target = favoritesFile(userData);
  const tmp = `${target}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ version: FAVORITES_VERSION, items }, null, 2), "utf8");
  await fs.rename(tmp, target);
}

/** 标题兜底：不填就从正文推一行（列表里不能出现空标题条目）。 */
export function favoriteTitleOf(input: { title?: string; content?: string; kind?: FavoriteKind }): string {
  const title = String(input.title ?? "").trim();
  if (title) return title.slice(0, 80);
  const kindLabel = input.kind === "image" ? "截图" : input.kind === "file" ? "文件" : input.kind === "link" ? "链接" : "收藏";
  const first = String(input.content ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  return first ? first : kindLabel;
}

export async function addFavorite(
  userData: string,
  input: Partial<FavoriteItem>,
): Promise<{ items: FavoriteItem[]; item: FavoriteItem }> {
  const items = await readFavorites(userData);
  const kind = normalizeKind(input.kind);
  const content = String(input.content ?? "").slice(0, FAVORITE_CONTENT_MAX);
  if (!content.trim()) throw new Error("收藏内容为空");
  const stamp = nowIso();
  const item: FavoriteItem = {
    id: crypto.randomUUID(),
    kind,
    title: favoriteTitleOf({ title: input.title, content, kind }),
    content,
    note: input.note?.trim() || undefined,
    tags: Array.isArray(input.tags) ? input.tags.filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim()).slice(0, 12) : [],
    source: input.source,
    createdAt: stamp,
    updatedAt: stamp,
    useCount: 0,
  };
  const next = [item, ...items];
  await writeFavorites(userData, next);
  return { items: next, item };
}

export async function updateFavorite(
  userData: string,
  id: string,
  patch: Partial<Pick<FavoriteItem, "title" | "note" | "tags" | "content" | "kind">>,
): Promise<FavoriteItem[]> {
  const items = await readFavorites(userData);
  const next = items.map((item) => {
    if (item.id !== id) return item;
    return {
      ...item,
      title: patch.title != null ? favoriteTitleOf({ title: patch.title, content: item.content, kind: item.kind }) : item.title,
      note: patch.note != null ? (patch.note.trim() || undefined) : item.note,
      tags: patch.tags != null ? patch.tags.filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim()).slice(0, 12) : item.tags,
      content: patch.content != null ? String(patch.content).slice(0, FAVORITE_CONTENT_MAX) : item.content,
      kind: patch.kind != null ? normalizeKind(patch.kind) : item.kind,
      updatedAt: nowIso(),
    };
  });
  await writeFavorites(userData, next);
  return next;
}

/**
 * 批量删除：**只认显式 id**。
 * 返回剩余列表与删除条数——渲染层据此把「批量管理」的选中态清干净，
 * 而不是自己算（算错会让已删除的条目留在选中集合里，下次批量操作又命中幽灵 id）。
 */
export async function deleteFavorites(userData: string, ids: string[]): Promise<{ items: FavoriteItem[]; removed: number }> {
  const wanted = new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === "string" && id.trim()));
  if (!wanted.size) return { items: await readFavorites(userData), removed: 0 };
  const items = await readFavorites(userData);
  const next = items.filter((item) => !wanted.has(item.id));
  await writeFavorites(userData, next);
  return { items: next, removed: items.length - next.length };
}

export async function clearFavorites(userData: string): Promise<{ items: FavoriteItem[]; removed: number }> {
  const items = await readFavorites(userData);
  await writeFavorites(userData, []);
  return { items: [], removed: items.length };
}

/** 记一次「用过」：一键发送/插入成功时调用。失败不抛（记账不该挡住发送）。 */
export async function touchFavorite(userData: string, id: string): Promise<FavoriteItem[]> {
  const items = await readFavorites(userData);
  const next = items.map((item) => item.id === id
    ? { ...item, useCount: item.useCount + 1, lastUsedAt: nowIso() }
    : item);
  await writeFavorites(userData, next);
  return next;
}

/**
 * 一条收藏 → 一行可写进记忆层的文本。
 * ⛔ 限长（FAVORITE_MEMORY_LINE_MAX）：记忆注入是硬预算，收藏是可无限追加的来源。
 */
export function favoriteMemoryLine(item: FavoriteItem): string {
  const body = String(item.content ?? "").replace(/\s+/g, " ").trim();
  const head = item.title?.trim() && item.title.trim() !== body.slice(0, item.title.trim().length) ? `${item.title.trim()}：` : "";
  const text = `${head}${body}`.trim();
  const clipped = text.length > FAVORITE_MEMORY_LINE_MAX ? `${text.slice(0, FAVORITE_MEMORY_LINE_MAX)}…` : text;
  return `- 收藏｜${item.kind === "image" ? "截图" : item.kind === "file" ? "文件" : item.kind === "link" ? "链接" : "片段"}：${clipped}`;
}
