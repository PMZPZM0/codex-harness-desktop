/**
 * data-access/tool-handler（10-29）：模型工具 `favorites` / `dev_journal` / `password_book` 的执行端。
 *
 * 位置选择：模型工具调用由**渲染层**应答（`item/tool/call`），所以这里只做"取参 → 转发 → 说人话"；
 * 真正的权限判定与存储都在主进程（`dataaccess:*`），渲染层这道不承担安全责任。
 *
 * ⛔ 会话 id 一律取**引擎下发的** `params.threadId`（模型伪造不了）—— 不要用 bag 里的"当前会话"，
 *    那在委派/后台回合里会指错，等于把 A 会话的授权借给 B 会话用。
 * ⛔ 密码本的写入必须先过 `requestVaultWrite`（用户点「允许」才落盘）；模型不能跳过这一步。
 * ⛔ 没有任何删除/覆盖动作 —— 这个函数只转发读与追加。
 */
import { requestVaultWrite } from "./vault-write-gate";

type Responder = { send: (id: string | number, payload: unknown) => Promise<unknown> | unknown };

type ToolEvent = {
  id?: string | number;
  params?: { tool?: string; threadId?: string; arguments?: unknown };
};

const DATA_TOOLS = new Set(["favorites", "dev_journal", "password_book"]);

const say = (text: string, success: boolean) => ({ contentItems: [{ type: "inputText", text }], success });
const errText = (error: unknown) => String((error as Error)?.message ?? error ?? "未知错误");

const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

/** 返回 true = 这个调用已由本模块应答（调用方不要再往下走）。 */
export async function handleDataAccessTool(event: ToolEvent, args: Record<string, unknown>, respond: Responder): Promise<boolean> {
  const tool = String(event.params?.tool ?? "");
  if (!DATA_TOOLS.has(tool)) return false;
  if (event.id === undefined) return false;

  const threadId = String(event.params?.threadId ?? "");
  const action = String(args.action ?? "");
  const reply = (text: string, ok: boolean) => respond.send(event.id as string | number, say(text, ok));

  try {
    if (tool === "favorites") {
      if (action === "list") {
        const result = await window.codex.dataaccessFavoritesList?.({
          threadId,
          query: str(args.query) || undefined,
          limit: num(args.limit),
        });
        const items = result?.items ?? [];
        if (!items.length) {
          await reply(result?.total ? `共 ${result.total} 条收藏，但没有匹配「${str(args.query)}」的。` : "收藏夹还是空的。", true);
          return true;
        }
        const lines = items.map((item, index) =>
          `${index + 1}. ${item.title}（${item.kind}${item.tags?.length ? ` · ${item.tags.join("/")}` : ""}）\n${item.content}`);
        await reply(`共 ${result?.total ?? items.length} 条收藏，这里是最多 ${items.length} 条：\n\n${lines.join("\n\n")}`, true);
        return true;
      }
      if (action === "append") {
        const content = str(args.content).trim();
        if (!content) { await reply("没有内容可收藏：content 不能为空。", false); return true; }
        const created = await window.codex.dataaccessFavoritesAppend?.({
          threadId,
          title: str(args.title) || undefined,
          content,
          kind: args.kind === "link" ? "link" : "text",
          tags: Array.isArray(args.tags) ? (args.tags as string[]).filter((tag) => typeof tag === "string") : undefined,
        });
        await reply(`已收藏：「${created?.title ?? content.slice(0, 40)}」（收藏夹现在共 ${created?.total ?? "?"} 条）。`, true);
        return true;
      }
      await reply(`favorites 只支持 action=list / append，收到的是「${action}」。⛔ 修改和删除只能用户自己在界面做。`, false);
      return true;
    }

    if (tool === "dev_journal") {
      if (action === "read") {
        const day = await window.codex.dataaccessJournalRead?.({ threadId, date: str(args.date) || undefined });
        const content = String(day?.content ?? "").trim();
        await reply(content
          ? `${day?.date} 的开发日记：\n\n${content}`
          : `${day?.date} 还没有记录。`, true);
        return true;
      }
      if (action === "search") {
        const query = str(args.query).trim();
        if (!query) { await reply("search 需要 query。", false); return true; }
        const result = await window.codex.dataaccessJournalSearch?.({ threadId, query });
        const hits = result?.hits ?? [];
        await reply(hits.length
          ? `在 ${hits.length} 天里找到「${query}」：\n\n${hits.map((hit) => `${hit.date}：\n${hit.lines.map((line) => `  - ${line}`).join("\n")}`).join("\n\n")}`
          : `没有找到包含「${query}」的日记。`, true);
        return true;
      }
      if (action === "append") {
        const body = str(args.body).trim();
        if (!body) { await reply("append 需要正文（body）。", false); return true; }
        const appended = await window.codex.dataaccessJournalAppend?.({
          threadId,
          date: str(args.date) || undefined,
          title: str(args.title) || undefined,
          body,
        });
        await reply(`已追加到 ${appended?.date} 的开发日记（该天有 ${appended?.days ?? "?"} 天记录）。`, true);
        return true;
      }
      await reply(`dev_journal 只支持 action=read / search / append，收到的是「${action}」。⛔ 覆盖与删除只能用户自己做。`, false);
      return true;
    }

    /* password_book ───────────────────────────────────────────── */
    if (action === "find") {
      const result = await window.codex.dataaccessVaultFind?.({ threadId, query: str(args.query) || undefined });
      const items = result?.items ?? [];
      if (!items.length) { await reply("密码本里没有匹配的条目。", true); return true; }
      const lines = items.map((item, index) =>
        `${index + 1}. ${item.title}${item.username ? ` · ${item.username}` : ""}${item.url ? ` · ${item.url}` : ""}`
        + `${item.hasSecret ? "（有密码）" : "（没有存密码）"} — id: ${item.id}`);
      await reply(`找到 ${result?.total ?? items.length} 条：\n\n${lines.join("\n")}\n\n⛔ 密码明文我读不到；需要的话用 action=copy 把它复制到剪贴板，让用户自己粘贴。`, true);
      return true;
    }
    if (action === "copy") {
      const id = str(args.id).trim();
      if (!id) { await reply("copy 需要 id（先用 action=find 查到 id）。", false); return true; }
      const result = await window.codex.dataaccessVaultCopy?.({ threadId, id });
      await reply(result?.ok
        ? `已把「${result.title || "该条目"}」的密码复制到剪贴板。${result.note ?? ""}`
        : `没能复制：${result?.reason ?? "未知原因"}`, result?.ok === true);
      return true;
    }
    if (action === "save") {
      const password = str(args.password);
      const title = str(args.title).trim() || "未命名";
      const draft = {
        id: str(args.id) || undefined,
        title,
        username: str(args.username),
        url: str(args.url),
        note: str(args.note),
        hasPassword: password.length > 0,
        passwordLength: password.length,
      };
      /* ⛔ 用户必须亲自点「允许」——这个 await 卡住模型，直到人做了选择 */
      const allowed = await requestVaultWrite(draft);
      if (!allowed) {
        await reply("用户没有允许这次写入（一次性确认被拒绝）。不要重试，也不要换个方式绕；可以问问用户要不要自己改。", false);
        return true;
      }
      const saved = await window.codex.dataaccessVaultSave?.({
        threadId,
        item: {
          id: draft.id,
          title: draft.title,
          username: draft.username,
          url: draft.url,
          note: draft.note,
          /* 空字符串 = 保留原密码（主进程口径：password 省略/空 ⇒ 不改） */
          ...(password ? { password } : {}),
        },
      });
      await reply(`已写入密码本：「${title}」（现在共 ${saved?.total ?? "?"} 条）。`, saved?.ok === true);
      return true;
    }
    await reply(`password_book 只支持 action=find / copy / save，收到的是「${action}」。⛔ 删除只能用户自己在界面做。`, false);
    return true;
  } catch (error: unknown) {
    /* 未授权 / 加密不可用 / 日期非法等都由主进程抛出，原样转述给模型 —— 它才能引导用户去开授权 */
    await reply(`没能完成：${errText(error)}`, false);
    return true;
  }
}
