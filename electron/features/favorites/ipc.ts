/**
 * favorites 域（09-24；**10-03 P2 批次 8 从合并文件 `screenshot-favorites-ipc.ts` 拆出**）。
 *
 * 域：**收藏夹**（截图/正文/链接都可收进来）。真相源 = `<userData>/favorites.json`。
 * 通道：favorites:list / add / update / delete / clear / touch / to-memory
 *
 * ⛔ 拆分口径（本项目硬规则）：**一个文件恒等于一个域前缀**；本域与截图域零共享状态，
 *   只共用 `userDataDir()`（三行，各自持有一份），故拆开后互不 import ⇒ 也不可能成环。
 *
 * ⛔ 所有 `app.getPath("userData")` 都在 **handler 内部**求值（守卫【91】）：
 *    main.ts 的 `app.setPath("userData", …)` 是模块体语句，被 import 的模块体先于它运行。
 */
import { app } from "electron";
import {
  addFavorite,
  clearFavorites,
  deleteFavorites,
  favoriteMemoryLine,
  readFavorites,
  touchFavorite,
  updateFavorite,
  type FavoriteItem,
} from "../favorites";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

type MemoryScope = "user" | "project" | "background" | "lessons";

function userDataDir(): string {
  return app.getPath("userData");
}

/** 追加一行（保留原文件头与既有内容，只在末尾加，并保证一个换行分隔）。 */
function appendBlock(current: string, line: string): string {
  const text = String(current ?? "").replace(/\s+$/, "");
  return text ? `${text}\n${line}\n` : `${line}\n`;
}

async function favoritesTouch(id: string) {
  try {
    return await touchFavorite(userDataDir(), String(id ?? ""));
  } catch (error) {
    // 记账失败不该挡住「发送」这条主路径 ⇒ 返回当前列表即可
    console.error("[favorites] touch 失败：", error);
    return readFavorites(userDataDir());
  }
}

/**
 * 把收藏写进 Agent 记忆（记忆金字塔的层文件）。
 * scope 语义与 `memory:layers:write` 完全一致（复用同一份 layers 实现，不自己拼文件）：
 *   user = L0 用户档案（跨项目）；project = L1 项目记忆；background = L3 项目背景；lessons = L2 纪律
 * ⛔ 只**追加**：先读该层当前文本，再写回（层文件是整份覆盖语义，不读就写 = 抹掉用户已有记忆）。
 * ⛔ 单行限长见 favoriteMemoryLine（记忆注入是硬预算）。
 */
async function favoritesToMemory(input: { ids: string[]; scope?: MemoryScope; workspace?: string }) {
  const ids = (Array.isArray(input?.ids) ? input.ids : []).filter((id) => typeof id === "string" && id);
  if (!ids.length) return { ok: false, written: 0, error: "没有选中任何收藏" };
  const scope: MemoryScope = input?.scope === "user" || input?.scope === "lessons" || input?.scope === "background" ? input.scope : "project";
  const workspace = String(input?.workspace ?? "").trim();
  if (scope !== "user" && !workspace) return { ok: false, written: 0, error: "尚未选择工作区，无法写入项目级记忆" };

  const items = (await readFavorites(userDataDir())).filter((item) => ids.includes(item.id));
  if (!items.length) return { ok: false, written: 0, error: "选中的收藏已不存在" };

  // 懒加载：main.ts 在模块体里 setPath(userData)，早于本文件的 handler 执行 ——
  // 只有在这里（handler 内）require 才能拿到正确实例。
  const { memoryLayers } = require("../main") as { memoryLayers: any };
  let written = 0;
  const failed: string[] = [];
  for (const item of items) {
    const line = favoriteMemoryLine(item);
    try {
      if (scope === "lessons") {
        const okWritten = await memoryLayers.appendLesson(workspace, line, item.title || item.content.slice(0, 40));
        if (okWritten) written += 1;
      } else if (scope === "user") {
        const current = await memoryLayers.readUser();
        await memoryLayers.writeUser(appendBlock(current, line));
        written += 1;
      } else if (scope === "background") {
        const current = await memoryLayers.readBackground(workspace);
        await memoryLayers.writeBackground(workspace, appendBlock(current, line));
        written += 1;
      } else {
        const current = await memoryLayers.readProject(workspace);
        await memoryLayers.writeProject(workspace, appendBlock(current, line));
        written += 1;
      }
    } catch (error: any) {
      failed.push(`${item.title || item.id}：${error?.message ?? error}`);
    }
  }
  return { ok: written > 0, written, error: failed.length ? failed.join("；") : undefined };
}

export const favoritesFeature = defineFeature<null>({
  id: "favorites",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    // inject 已在容器侧挡过一次；这里再挡一次只为把类型收紧（⛔ 不写 `!`：缺依赖要报得出来）
    if (!ipcHost) throw new Error("favorites: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("favorites:list", () => readFavorites(userDataDir()));
    ipcHost.handle("favorites:add", (_event, input: Partial<FavoriteItem>) => addFavorite(userDataDir(), input ?? {}));
    ipcHost.handle("favorites:update", (_event, input: { id: string; patch: Partial<FavoriteItem> }) =>
      updateFavorite(userDataDir(), String(input?.id ?? ""), input?.patch ?? {}));
    ipcHost.handle("favorites:delete", (_event, ids: string[]) => deleteFavorites(userDataDir(), Array.isArray(ids) ? ids : []));
    ipcHost.handle("favorites:clear", () => clearFavorites(userDataDir()));
    ipcHost.handle("favorites:touch", (_event, id: string) => favoritesTouch(id));
    ipcHost.handle("favorites:to-memory", (_event, input: { ids: string[]; scope?: MemoryScope; workspace?: string }) => favoritesToMemory(input));

    // 生命期：卸载时摘掉本域七条通道（收藏数据在磁盘上，不随卸载销毁 —— 那是用户数据）
    ctx.effect(() => {
      ipcHost.removeHandler("favorites:list");
      ipcHost.removeHandler("favorites:add");
      ipcHost.removeHandler("favorites:update");
      ipcHost.removeHandler("favorites:delete");
      ipcHost.removeHandler("favorites:clear");
      ipcHost.removeHandler("favorites:touch");
      ipcHost.removeHandler("favorites:to-memory");
    });
  },
});
