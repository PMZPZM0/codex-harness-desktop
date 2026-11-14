/**
 * 工作伙伴群「已读游标」（2026-11-14，抄 Pachat 的「先读再说」）。
 *
 * 背景（用户令「工作伙伴群聊借鉴 Pachat 的运作逻辑」）：Pachat 的每个 agent 各自记「读到哪」，
 * 只把**它没读过的新消息**喂给它，先读完再开口 ⇒ 少「各说各话 / 没看就回 / 回两遍」。
 * 我们原来是「每轮塞最近 N 条（不管读没读）」，成员之间接不上、还会重复。
 *
 * ⛔ 落盘独立小文件（不进 harness-teams.json）：那是全量群消息 store，每次改都要 normalize 一遍，
 *    读写游标不该跟它抢锁、也不该放大竞争。
 * ⛔ 路径必须**惰性**求值（`app.setPath("userData")` 在 main 模块体里，先于本模块任何调用；
 *    顶层求值会拿到默认 userData，写错目录 —— 同 personalization / bot-bindings 的既有约定）。
 * ⛔ 纯主进程用；不带 IPC（渲染层不需要知道"读到哪"）。
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

let cache: Record<string, number> | null = null;
let loadedFor = "";

function cursorsFile(): string {
  return path.join(app.getPath("userData"), "group-read-cursors.json");
}

function load(): Record<string, number> {
  const file = cursorsFile();
  if (cache && loadedFor === file) return cache;
  loadedFor = file;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    cache = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, number>) : {};
  } catch {
    cache = {}; // 不存在 / 坏文件：当作全都没读过（成员首轮会收到最近上下文）
  }
  return cache as Record<string, number>;
}

function persist(): void {
  try {
    const file = cursorsFile();
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache ?? {}), "utf8");
    fs.renameSync(tmp, file);
  } catch {
    /* 写失败不影响本轮；下次推进再试（内存值仍生效） */
  }
}

/** 某成员在某个群的已读游标（毫秒时间戳）。取不到 / 非法 ⇒ 0（= 全都没读过）。 */
export function getGroupReadCursor(groupId: string, memberId: string): number {
  if (!groupId || !memberId) return 0;
  const n = Number(load()[`${groupId}::${memberId}`]);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 推进某成员的已读游标（⛔ 只前移、绝不回退：并发/乱序时不会把已读变未读）。 */
export function markGroupRead(groupId: string, memberId: string, at: number): void {
  if (!groupId || !memberId) return;
  const map = load();
  const key = `${groupId}::${memberId}`;
  const prev = Number(map[key]) || 0;
  const next = Math.max(prev, Number(at) || 0);
  if (next <= prev) return;
  map[key] = next;
  persist();
}
