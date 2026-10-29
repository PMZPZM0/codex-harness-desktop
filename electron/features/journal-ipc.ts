/**
 * journal-ipc（10-27）：**开发日记**，按天一个 Markdown 文件。
 *
 * 用户：「第三个开发日记，日记弹窗也做好看一点，记开发日志的，功能配套齐全」。
 * 存储形态（用户选定）：`userData/dev-journal/YYYY-MM-DD.md`，一天一个文件、多条追加。
 *  · 纯 Markdown 落盘 ⇒ 以后能直接当知识库源，也能用任何编辑器打开；
 *  · 每条 = 一段 `## HH:mm 标题` + 正文；同一天再记就**追加**到该文件末尾；
 *  · 列表只回日期 + 首行摘要 + 大小，不把全文塞给渲染层（文件多了会拖慢弹层）。
 *
 * 通道：journal:list / journal:read / journal:save / journal:append / journal:remove / journal:search
 */
import fs from "node:fs/promises";
import path from "node:path";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import type { HostCaps } from "../runtime/seams";

import type { JournalDay } from "../../src/lib/rail-ipc-types";
export type { JournalDay };

/* 用户数据目录只在 setPath 之后才准求值 ⇒ 由 setup 经接缝取一次，再传进这些纯函数（【91】）。 */
const dirOf = (base: string) => path.join(base, "dev-journal");
const fileOf = (base: string, date: string) => path.join(dirOf(base), `${date}.md`);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

async function ensureDir(base: string): Promise<void> {
  await fs.mkdir(dirOf(base), { recursive: true, mode: 0o700 });
}

async function listDays(base: string): Promise<JournalDay[]> {
  await ensureDir(base);
  const names = await fs.readdir(dirOf(base)).catch(() => [] as string[]);
  const days: JournalDay[] = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    const date = name.slice(0, -3);
    if (!DATE_RE.test(date)) continue;
    const full = path.join(dirOf(base), name);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat) continue;
    const head = await fs.readFile(full, "utf8").catch(() => "");
    const firstBody = head.split("\n").map((line) => line.replace(/^#+\s*/, "").trim()).find((line) => line && !line.startsWith("<!--")) ?? "";
    days.push({ date, title: firstBody.slice(0, 80), bytes: stat.size, updatedAt: stat.mtime.toISOString() });
  }
  days.sort((a, b) => (a.date < b.date ? 1 : -1));
  return days;
}

/* ── 可复用入口（10-29）：模型侧工具（data-access）与 IPC 共用**同一套**写入逻辑。
   ⛔ 不要在工具那边重写一遍「追加一段 markdown」——两份实现迟早漂移（缩进/换行/日期兜底）。
   ⛔ 这里**只提供读与追加**：删除 / 整篇覆盖永远不给模型开放。 */
export async function readJournalDay(base: string, date: string): Promise<{ date: string; content: string }> {
  const day = DATE_RE.test(String(date ?? "")) ? String(date) : today();
  const content = await fs.readFile(fileOf(base, day), "utf8").catch(() => "");
  return { date: day, content };
}

/** 追加一条：`## HH:mm 标题` + 正文。⛔ 只追加到末尾，不改历史内容。 */
export async function appendJournalEntry(
  base: string,
  input: { date?: unknown; title?: unknown; body?: unknown },
): Promise<{ date: string; days: JournalDay[] }> {
  const day = DATE_RE.test(String(input.date ?? "")) ? String(input.date) : today();
  await ensureDir(base);
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const head = String(input.title ?? "").trim().slice(0, 120);
  const text = String(input.body ?? "").trim();
  if (!text) throw new Error("正文不能为空");
  const chunk = `## ${hhmm}${head ? ` ${head}` : ""}\n\n${text}\n\n`;
  let existing = await fs.readFile(fileOf(base, day), "utf8").catch(() => "");
  if (!existing.trim()) existing = `# 开发日记 · ${day}\n\n`;
  await fs.writeFile(fileOf(base, day), `${existing.replace(/\s*$/, "\n\n")}${chunk}`, "utf8");
  return { date: day, days: await listDays(base) };
}

/** 全文检索：命中日期 + 命中行（模型侧只给这几行，不塞全文）。 */
export async function searchJournal(base: string, query: unknown): Promise<{ hits: { date: string; lines: string[] }[] }> {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) return { hits: [] };
  const days = await listDays(base);
  const hits: { date: string; lines: string[] }[] = [];
  for (const day of days) {
    const text = await fs.readFile(fileOf(base, day.date), "utf8").catch(() => "");
    const lines = text.split("\n").filter((line) => line.toLowerCase().includes(needle)).slice(0, 3);
    if (lines.length) hits.push({ date: day.date, lines: lines.map((line) => line.trim().slice(0, 160)) });
  }
  return { hits };
}

export const journalFeature = defineFeature<null>({
  id: "journal",
  inject: ["ipc", "host"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    const host = ctx.get<HostCaps>("host");
    if (!ipcHost) throw new Error("journal: 缺少 ipc 服务（宿主未提供）");
    if (!host) throw new Error("journal: 缺少 host 接缝（宿主未提供）");
    const base = () => host.app.getPath("userData");

    ipcHost.handle("journal:list", async (): Promise<{ days: JournalDay[]; dir: string; today: string }> =>
      ({ days: await listDays(base()), dir: dirOf(base()), today: today() }));

    ipcHost.handle("journal:read", async (_event, date: string): Promise<{ date: string; content: string }> => {
      const day = String(date ?? "");
      if (!DATE_RE.test(day)) throw new Error("日期格式必须是 YYYY-MM-DD");
      return readJournalDay(base(), day);
    });

    /** 整篇覆盖（编辑器保存）。 */
    ipcHost.handle("journal:save", async (_event, date: string, content: unknown): Promise<{ days: JournalDay[]; date: string }> => {
      const day = String(date ?? "");
      if (!DATE_RE.test(day)) throw new Error("日期格式必须是 YYYY-MM-DD");
      await ensureDir(base());
      const text = String(content ?? "");
      if (text.trim()) await fs.writeFile(fileOf(base(), day), text.endsWith("\n") ? text : `${text}\n`, "utf8");
      else await fs.rm(fileOf(base(), day), { force: true });
      return { days: await listDays(base()), date: day };
    });

    /** 追加一条：`## HH:mm 标题` + 正文；同日多次记录按时间顺序落在同一个文件里。 */
    ipcHost.handle("journal:append", async (_event, date: string, title: unknown, body: unknown): Promise<{ days: JournalDay[]; date: string }> => {
      const appended = await appendJournalEntry(base(), { date, title, body });
      return { days: appended.days, date: appended.date };
    });

    ipcHost.handle("journal:remove", async (_event, date: string): Promise<{ days: JournalDay[] }> => {
      const day = String(date ?? "");
      if (!DATE_RE.test(day)) throw new Error("日期格式必须是 YYYY-MM-DD");
      await fs.rm(fileOf(base(), day), { force: true });
      return { days: await listDays(base()) };
    });

    /** 全文检索：命中文件名 + 命中的行（渲染层直接展示，不用再拉全文）。 */
    ipcHost.handle("journal:search", async (_event, query: unknown): Promise<{ hits: { date: string; lines: string[] }[] }> => {
      return searchJournal(base(), query);
    });

    ctx.effect(() => {
      for (const ch of ["journal:list", "journal:read", "journal:save", "journal:append", "journal:remove", "journal:search"]) ipcHost.removeHandler(ch);
    });
  },
});
