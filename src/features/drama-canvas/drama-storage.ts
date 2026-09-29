/**
 * 画布与分镜表的**持久化适配层**（域内私有）。
 *
 * 两条落点，各司其职：
 *  · **画布快照** → localStorage。它是纯 UI 状态（谁摆在哪），不需要给引擎看。
 *  · **分镜表** → localStorage + **工作区文件** `.drama-canvas/storyboards/<名>.json`。
 *    后者是给引擎读的：引擎会话、命令行重跑拿到的必须是同一份，否则"画布上改了台词、
 *    引擎照旧台词重生一遍"（这是参考实现踩过、也写进它文档里的坑）。
 *
 * ⛔ 两边都存，就必须定一条**谁赢**的规矩（不然读哪份都能吵起来）：
 *    **看 `updatedAt`，新的赢**；文件赢的时候给用户一句提示（见 useDramaBoard 的 toast）。
 *    没有工作区 / 文件不可读 ⇒ 静默退到 localStorage，不影响画布可用。
 */
import {
  dramaNormalizeSnapshot,
  DRAMA_SNAPSHOT_VERSION,
  type DramaSnapshot,
} from "../../lib/drama-canvas-model.mjs";
import { storyboardNormalize, type Storyboard } from "../../lib/drama-storyboard.mjs";

const NS = "codex-harness.drama-canvas";
const BOARD_INDEX_KEY = `${NS}.boards`;
const STORY_INDEX_KEY = `${NS}.storyboards`;
const boardKey = (name: string) => `${NS}.board:${name}`;
const storyKey = (name: string) => `${NS}.storyboard:${name}`;

export interface BoardMeta {
  name: string;
  title: string;
  nodes: number;
  updatedAt: number;
  /** 分镜表名（画布与分镜表一一对应；空表示这张画布还没挂表） */
  board?: string;
}

export interface StoryboardMeta {
  name: string;
  title: string;
  shots: number;
  scenes: number;
  updatedAt: number;
  /** 是否有工作区文件副本（界面上标出来：引擎读的是这份） */
  file?: boolean;
}

function safeGet(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* 隐私模式 / 配额满：画布仍可用，只是不落盘 */ }
}

function readJSON<T>(key: string, fallback: T): T {
  const raw = safeGet(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

/* ------------------------------------------------------------------ 索引 */

export function listBoards(): BoardMeta[] {
  const list = readJSON<BoardMeta[]>(BOARD_INDEX_KEY, []);
  return Array.isArray(list) ? list.filter((b) => b && b.name) : [];
}

export function upsertBoard(meta: BoardMeta): BoardMeta[] {
  const list = listBoards().filter((b) => b.name !== meta.name);
  list.push(meta);
  list.sort((a, b) => b.updatedAt - a.updatedAt);
  safeSet(BOARD_INDEX_KEY, JSON.stringify(list));
  return list;
}

export function removeBoard(name: string): BoardMeta[] {
  const list = listBoards().filter((b) => b.name !== name);
  safeSet(BOARD_INDEX_KEY, JSON.stringify(list));
  try { window.localStorage.removeItem(boardKey(name)); } catch { /* 忽略 */ }
  return list;
}

export function listStoryboards(): StoryboardMeta[] {
  const list = readJSON<StoryboardMeta[]>(STORY_INDEX_KEY, []);
  return Array.isArray(list) ? list.filter((b) => b && b.name) : [];
}

export function upsertStoryboard(meta: StoryboardMeta): StoryboardMeta[] {
  const list = listStoryboards().filter((b) => b.name !== meta.name);
  list.push(meta);
  list.sort((a, b) => b.updatedAt - a.updatedAt);
  safeSet(STORY_INDEX_KEY, JSON.stringify(list));
  return list;
}

/** 删分镜表（09-29 项目管理）：索引 + 本机那份快照。⛔ **工作区文件不在这里删**
 *  （那是主进程的事，走 `drama-canvas:storyboard-file-remove`）——
 *  这里只清渲染层自己的两份状态，两件事在 `deleteStory` 里一起做。 */
export function removeStoryboard(name: string): StoryboardMeta[] {
  const list = listStoryboards().filter((b) => b.name !== name);
  safeSet(STORY_INDEX_KEY, JSON.stringify(list));
  try { window.localStorage.removeItem(storyKey(name)); } catch { /* 忽略 */ }
  return list;
}

/* ------------------------------------------------------------------ 画布 */

/** 读画布快照。**永不抛**：坏数据按空画布处理并把修复记录带出去。 */
export function readBoard(name: string): { snapshot: DramaSnapshot; repaired: string[]; existed: boolean } {
  const raw = readJSON<unknown>(boardKey(name), null);
  if (!raw) return { snapshot: dramaNormalizeSnapshot(null) as unknown as DramaSnapshot, repaired: [], existed: false };
  const norm = dramaNormalizeSnapshot(raw);
  return { snapshot: norm as unknown as DramaSnapshot, repaired: norm.repaired, existed: true };
}

export function writeBoard(name: string, snapshot: DramaSnapshot): void {
  safeSet(boardKey(name), JSON.stringify({ ...snapshot, version: DRAMA_SNAPSHOT_VERSION, updatedAt: Date.now() }));
}

/* -------------------------------------------------------------- 分镜表 */

/** 取 `data:<mime>;base64,` 后面的 payload；不是 data URL 就原样返回。 */
export function base64Payload(value: string): string {
  const s = String(value || "");
  const comma = s.indexOf(",");
  return s.startsWith("data:") && comma >= 0 ? s.slice(comma + 1) : s;
}

/** base64 → 文本。分镜表里有中文，必须走 TextDecoder（`atob` 出来的是字节串，直接拼会乱码）。 */
export function decodeBase64Text(b64: string): string {
  const bin = atob(base64Payload(b64));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

export function storyboardFilePath(workspace: string, name: string): string {
  const safe = String(name || "main").replace(/[\\/:*?"<>|]/g, "_").replace(/\.json$/i, "") || "main";
  const root = String(workspace || "").replace(/[\\/]+$/, "");
  return `${root}/.drama-canvas/storyboards/${safe}.json`;
}

/** 读工作区里那份分镜表（供引擎读的那份）。读不到就返回 null，**不抛**。 */
export async function readStoryboardFile(workspace: string, name: string): Promise<Storyboard | null> {
  if (!workspace) return null;
  try {
    const exists = await window.codex.fileExists(storyboardFilePath(workspace, name));
    if (!exists?.exists) return null;
    const file = await window.codex.readFile(storyboardFilePath(workspace, name));
    const parsed = JSON.parse(decodeBase64Text(file.dataBase64));
    return storyboardNormalize(parsed).data;
  } catch {
    return null;
  }
}

export async function writeStoryboardFile(workspace: string, name: string, data: Storyboard): Promise<string | null> {
  if (!workspace) return null;
  try {
    const target = storyboardFilePath(workspace, name);
    await window.codex.writeFile(target, JSON.stringify(data, null, 2), workspace);
    return target;
  } catch {
    return null;
  }
}

export function readStoryboardLocal(name: string): Storyboard | null {
  const raw = readJSON<unknown>(storyKey(name), null);
  if (!raw) return null;
  return storyboardNormalize(raw).data;
}

export function writeStoryboardLocal(name: string, data: Storyboard): void {
  safeSet(storyKey(name), JSON.stringify(data));
}

/**
 * 分镜表：**两份取新的**。
 * `updatedAt` 由写入方打；文件那份可能是引擎改的（我们不控制它的时间戳），
 * 所以文件存在且它的 `updatedAt` 不早于本机那份时，一律采用文件那份。
 */
export async function loadStoryboard(workspace: string, name: string): Promise<{ data: Storyboard | null; fromFile: boolean }> {
  const local = readStoryboardLocal(name);
  const file = await readStoryboardFile(workspace, name);
  if (!file) return { data: local, fromFile: false };
  const fileAt = Number((file as any).updatedAt) || 0;
  const localAt = Number((local as any)?.updatedAt) || 0;
  if (!local || fileAt >= localAt) return { data: file, fromFile: true };
  return { data: local, fromFile: false };
}

/** 保存分镜表：本机那份立刻写，工作区文件副本尽力而为（失败不影响画布）。 */
export async function saveStoryboard(workspace: string, name: string, data: Storyboard): Promise<{ path: string | null; meta: StoryboardMeta }> {
  const stamped = { ...data, updatedAt: Date.now() } as Storyboard & { updatedAt: number };
  writeStoryboardLocal(name, stamped);
  const path = await writeStoryboardFile(workspace, name, stamped);
  let shots = 0;
  for (const scene of stamped.scenes || []) shots += (scene.shots || []).length;
  const meta: StoryboardMeta = {
    name,
    title: stamped.title || name,
    shots,
    scenes: (stamped.scenes || []).length,
    updatedAt: stamped.updatedAt,
    file: Boolean(path),
  };
  upsertStoryboard(meta);
  return { path, meta };
}
