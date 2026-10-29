/**
 * data-access-ipc（10-29）：把「收藏夹 / 开发日记 / 密码本」按**会话 + 模块 + 读/写**三元组
 * 授权给模型（Codex）使用。
 *
 * 用户定的权限模型（原话）：
 *  · 收藏夹 / 开发日记：会话级开关，**默认关**；开启后允许 read + append（只追加，不删除、不覆盖历史）；
 *  · 密码本：**默认永不进模型上下文**；只允许 copy / 存在性查询（模型拿不到明文）；
 *    任何写入需一次性确认弹窗；
 *  · 一次授权粒度 = 会话 + 模块 + 读/写；**结束会话即失效**；删除类操作永不开放给模型。
 *
 * 落点选择（为什么是这个文件）：
 *  · 授权状态是**安全边界**，必须在主进程（渲染层只是 UI）；
 *  · 但模型工具调用由渲染层应答（`item/tool/call`），所以渲染层把 `event.params.threadId`
 *    （引擎下发，模型伪造不了）带下来，主进程按它查授权 —— 每个执行通道**自己**再判一次，
 *    渲染层那道不算数（双闸，主进程为准）。
 *
 * 状态含两份：
 *  · `GRANTS`：会话级授权，纯内存 ⇒ 应用退出即失效（"结束会话即失效"的物理实现）；
 *  · 不出现在任何磁盘文件里（⛔ 不许持久化，否则重启后旧会话仍被授权）。
 *
 * 通道：
 *   dataaccess:state / dataaccess:grant / dataaccess:revoke-all   —— UI 用
 *   dataaccess:favorites-list / -append                           —— 模型工具用（favorites）
 *   dataaccess:journal-read / -search / -append                    —— 模型工具用（journal）
 *   dataaccess:vault-find / -copy / -save                          —— 模型工具用（vault）
 * ⛔ 没有任何 delete / update / overwrite 类通道：删除类操作不开放给模型。
 */
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import type { HostCaps } from "../runtime/seams";
import { addFavorite, readFavorites } from "./favorites/store";
import { appendJournalEntry, readJournalDay, searchJournal } from "./journal-ipc";
import { copyVaultSecret, findVaultItems, saveVaultItem } from "./vault-ipc";

export type DataModule = "favorites" | "journal" | "vault";
export type DataLevel = "read" | "write";
export type ModuleGrant = Record<DataLevel, boolean>;
export type GrantSnapshot = Record<DataModule, ModuleGrant>;

const MODULES: DataModule[] = ["favorites", "journal", "vault"];

const emptyGrants = (): GrantSnapshot => ({
  favorites: { read: false, write: false },
  journal: { read: false, write: false },
  vault: { read: false, write: false },
});

/** 会话 → 授权。⛔ 只在内存：应用退出即全部失效。 */
const GRANTS = new Map<string, GrantSnapshot>();

const isModule = (value: unknown): value is DataModule => MODULES.includes(String(value) as DataModule);
const isLevel = (value: unknown): value is DataLevel => value === "read" || value === "write";

/** 会话 id 只认非空字符串；空 id 一律当"没有会话"处理（拒绝，不放行）。 */
function threadOf(value: unknown): string {
  return String(value ?? "").trim().slice(0, 200);
}

export function grantSnapshot(threadId: string): GrantSnapshot {
  const found = GRANTS.get(threadId);
  return found ? { favorites: { ...found.favorites }, journal: { ...found.journal }, vault: { ...found.vault } } : emptyGrants();
}

export function setGrant(threadId: string, module: DataModule, level: DataLevel, on: boolean): GrantSnapshot {
  if (!threadId) throw new Error("缺少会话 id：授权必须绑定到具体会话");
  const current = grantSnapshot(threadId);
  current[module][level] = on === true;
  GRANTS.set(threadId, current);
  return current;
}

export function clearGrants(threadId: string): void {
  if (threadId) GRANTS.delete(threadId);
}

export function isGranted(threadId: string, module: DataModule, level: DataLevel): boolean {
  if (!threadId) return false;
  return GRANTS.get(threadId)?.[module]?.[level] === true;
}

const LEVEL_LABEL: Record<DataModule, Record<DataLevel, string>> = {
  favorites: { read: "读取收藏夹", write: "向收藏夹追加" },
  journal: { read: "读取开发日记", write: "向开发日记追加" },
  vault: { read: "查询/复制密码本", write: "写入密码本" },
};

/**
 * 授权闸（面向模型的文案）：被拒时把「缺哪个授权、去哪开」讲清楚，
 * 让模型能如实回报并引导用户，而不是换个工具名瞎试。
 */
function assertGranted(threadId: string, module: DataModule, level: DataLevel): void {
  if (isGranted(threadId, module, level)) return;
  const what = LEVEL_LABEL[module][level];
  const where = "输入框左侧快捷条 →「数据授权」";
  throw new Error(
    `未授权：本会话不允许${what}（当前会话的 ${module}/${level} 是关闭的）。`
    + `请让用户在「${where}」里为**本会话**打开它，然后重试。`
    + `⛔ 不要换别的工具或绕道文件系统尝试，授权只能由用户本人开启。`,
  );
}

export const dataAccessFeature = defineFeature<null>({
  id: "dataaccess",
  inject: ["ipc", "host"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    const host = ctx.get<HostCaps>("host");
    if (!ipcHost) throw new Error("dataaccess: 缺少 ipc 服务（宿主未提供）");
    if (!host) throw new Error("dataaccess: 缺少 host 接缝（宿主未提供）");
    const userData = () => host.app.getPath("userData");
    const secure = host.secure;

    /* ── UI：读/设授权 ───────────────────────────────────────── */
    ipcHost.handle("dataaccess:state", async (_event, threadId: unknown): Promise<{ threadId: string; grants: GrantSnapshot }> => {
      const id = threadOf(threadId);
      return { threadId: id, grants: grantSnapshot(id) };
    });

    ipcHost.handle("dataaccess:grant", async (_event, input: Record<string, unknown>): Promise<{ threadId: string; grants: GrantSnapshot }> => {
      const id = threadOf(input?.threadId);
      if (!isModule(input?.module)) throw new Error("未知模块（只能是 favorites / journal / vault）");
      if (!isLevel(input?.level)) throw new Error("未知级别（只能是 read / write）");
      return { threadId: id, grants: setGrant(id, input.module, input.level, input.on === true) };
    });

    ipcHost.handle("dataaccess:revoke-all", async (_event, threadId: unknown): Promise<{ threadId: string; grants: GrantSnapshot }> => {
      const id = threadOf(threadId);
      clearGrants(id);
      return { threadId: id, grants: emptyGrants() };
    });

    /* ── 模型侧执行通道（每个都自己判授权）──────────────────── */
    ipcHost.handle("dataaccess:favorites-list", async (_event, input: Record<string, unknown>) => {
      const threadId = threadOf(input?.threadId);
      assertGranted(threadId, "favorites", "read");
      const needle = String(input?.query ?? "").trim().toLowerCase();
      const limit = Math.min(Math.max(Number(input?.limit ?? 30) || 30, 1), 100);
      const items = await readFavorites(userData());
      const matched = needle
        ? items.filter((item) => [item.title, item.content, item.note, ...(item.tags ?? [])].join(" ").toLowerCase().includes(needle))
        : items;
      return {
        total: items.length,
        matched: matched.length,
        items: matched.slice(0, limit).map((item) => ({
          id: item.id,
          title: item.title,
          kind: item.kind,
          content: item.content.slice(0, 600),
          tags: item.tags,
          createdAt: item.createdAt,
        })),
      };
    });

    ipcHost.handle("dataaccess:favorites-append", async (_event, input: Record<string, unknown>) => {
      const threadId = threadOf(input?.threadId);
      assertGranted(threadId, "favorites", "write");
      /* 模型只写文本/链接两类（图片、文件要真实路径，交给界面收藏更合适）。 */
      const result = await addFavorite(userData(), {
        title: typeof input?.title === "string" ? input.title : undefined,
        content: String(input?.content ?? ""),
        kind: input?.kind === "link" ? "link" : "text",
        note: typeof input?.note === "string" ? input.note : undefined,
        tags: Array.isArray(input?.tags) ? (input.tags as string[]) : [],
        /* 记下来源自哪个会话：用户日后能回溯"这是哪次对话里存的" */
        source: { threadId, role: "codex" },
      });
      return { ok: true, id: result.item.id, title: result.item.title, total: result.items.length };
    });

    ipcHost.handle("dataaccess:journal-read", async (_event, input: Record<string, unknown>) => {
      const threadId = threadOf(input?.threadId);
      assertGranted(threadId, "journal", "read");
      const day = await readJournalDay(userData(), String(input?.date ?? ""));
      return { date: day.date, content: day.content.slice(0, 12000), truncated: day.content.length > 12000 };
    });

    ipcHost.handle("dataaccess:journal-search", async (_event, input: Record<string, unknown>) => {
      const threadId = threadOf(input?.threadId);
      assertGranted(threadId, "journal", "read");
      return searchJournal(userData(), input?.query);
    });

    ipcHost.handle("dataaccess:journal-append", async (_event, input: Record<string, unknown>) => {
      const threadId = threadOf(input?.threadId);
      assertGranted(threadId, "journal", "write");
      const appended = await appendJournalEntry(userData(), { date: input?.date, title: input?.title, body: input?.body });
      return { ok: true, date: appended.date, days: appended.days.length };
    });

    ipcHost.handle("dataaccess:vault-find", async (_event, input: Record<string, unknown>) => {
      const threadId = threadOf(input?.threadId);
      assertGranted(threadId, "vault", "read");
      const items = await findVaultItems(userData(), input?.query);
      /* ⛔ 只回公开字段：id / 标题 / 用户名 / 是否有密码。明文永远不出现在返回值里。 */
      return {
        total: items.length,
        items: items.map((item) => ({ id: item.id, title: item.title, username: item.username, url: item.url, hasSecret: item.hasSecret })),
      };
    });

    ipcHost.handle("dataaccess:vault-copy", async (_event, input: Record<string, unknown>) => {
      const threadId = threadOf(input?.threadId);
      assertGranted(threadId, "vault", "read");
      const id = String(input?.id ?? "").trim();
      if (!id) throw new Error("需要传入条目 id（先用 vault 的 find 动作查 id）");
      const result = await copyVaultSecret(userData(), secure, id);
      /* 返回体只说"复制成功"，**不含明文** —— 模型无法从结果里读到密码。 */
      return result.ok
        ? { ok: true, title: result.title ?? "", note: "密码已复制到系统剪贴板，30 秒后若未粘贴会自动清除；请让用户直接粘贴。" }
        : { ok: false, reason: result.reason ?? "复制失败" };
    });

    ipcHost.handle("dataaccess:vault-save", async (_event, input: Record<string, unknown>) => {
      const threadId = threadOf(input?.threadId);
      assertGranted(threadId, "vault", "write");
      /* ⛔ 走到这里说明用户在渲染层的「一次性确认」里点了允许 —— 那个确认框是模型无法伪造的人类动作。 */
      const result = await saveVaultItem(userData(), secure, (input?.item ?? {}) as Record<string, unknown>);
      return { ok: true, total: result.items.length };
    });

    ctx.effect(() => {
      for (const ch of [
        "dataaccess:state", "dataaccess:grant", "dataaccess:revoke-all",
        "dataaccess:favorites-list", "dataaccess:favorites-append",
        "dataaccess:journal-read", "dataaccess:journal-search", "dataaccess:journal-append",
        "dataaccess:vault-find", "dataaccess:vault-copy", "dataaccess:vault-save",
      ]) ipcHost.removeHandler(ch);
    });
  },
});
