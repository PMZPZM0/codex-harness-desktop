/**
 * session-workspace-ipc（10-29 用户令）
 *
 * 域：sessionspace(6)
 * 通道：sessionspace:ensure / :state / :list / :set-state / :remove / :gc
 *
 * 逻辑全在 `features/session-workspace.ts`（纯函数 + 文件系统），本文件只做 IPC 皮。
 * ⛔ 记忆寻址**不经过这里** —— 工作区目录不是 workspace，见该模块头注。
 */
import { app } from "electron";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import {
  ensureSessionWorkspace,
  gcSessionWorkspaces,
  listSessionWorkspaces,
  removeSessionWorkspace,
  setSessionWorkspaceState,
} from "./session-workspace";

/** ⛔ userData 惰性求值：本模块在 main.ts 模块体之前被 import，顶层取会拿到默认目录。 */
const userData = () => app.getPath("userData");

export const sessionWorkspaceFeature = defineFeature<null>({
  id: "sessionspace",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("sessionspace: 缺少 ipc 服务（宿主未提供）");

    /* 新建会话后调一次。projectRoot 必须是**项目地址**，不是会话 cwd、不是工作区目录。 */
    ipcHost.handle("sessionspace:ensure", async (_event, threadId: string, projectRoot: string) =>
      ensureSessionWorkspace(userData(), threadId, projectRoot));

    ipcHost.handle("sessionspace:state", async (_event, threadId: string) => {
      const all = await listSessionWorkspaces(userData());
      return all.find((record) => record.threadId === threadId) ?? null;
    });

    ipcHost.handle("sessionspace:list", async () => listSessionWorkspaces(userData()));

    ipcHost.handle("sessionspace:set-state", async (_event, threadId: string, state: string) => {
      /* 只接受两态：删除是 remove 通道，不许从这条路走。 */
      if (state !== "active" && state !== "archived") return { ok: false, reason: "状态只支持 active / archived" };
      return setSessionWorkspaceState(userData(), threadId, state);
    });

    ipcHost.handle("sessionspace:remove", async (_event, threadId: string) =>
      removeSessionWorkspace(userData(), threadId));

    ipcHost.handle("sessionspace:gc", async (_event, options?: { maxAgeDays?: number; dryRun?: boolean }) => {
      const days = Number(options?.maxAgeDays);
      return gcSessionWorkspaces(userData(), {
        maxAgeMs: Number.isFinite(days) && days > 0 ? days * 24 * 3600_000 : undefined,
        dryRun: options?.dryRun === true,
      });
    });

    ctx.effect(() => {
      for (const channel of [
        "sessionspace:ensure",
        "sessionspace:state",
        "sessionspace:list",
        "sessionspace:set-state",
        "sessionspace:remove",
        "sessionspace:gc",
      ]) {
        ipcHost.removeHandler(channel);
      }
    });
  },
});
