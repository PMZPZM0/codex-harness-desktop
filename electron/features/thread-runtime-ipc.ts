/**
 * thread-runtime-ipc（10-03 从 `features/engine-ipc/` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：thread-runtime(6)
 * 通道：thread-runtime:get / list / seed / patch / dispatch-owner / release-dispatch
 *
 * 会话运行态（谁在调度、能否调度）的权威账本在 `threadRuntimeStore`（`../runtime-refs`）。
 *
 * ⛔⛔ 身份闸不能省（`patch` 里 `dispatch.enabled === true` 时）：专家会话 / 专家团会话一律不许
 *    开调度（09-16 用户要求）。UI 已禁用按钮，这里再挡一道 —— 快捷键 / 多窗口 / 旧版本渲染层
 *    都绕不过去。少了这层就是"绕过 UI 就能开"。
 * ⛔ 独占接管后**被摘锁的那个线程也要广播**，否则别的窗口还挂着「调度中」的旧状态。
 */
import { broadcastHarnessEvent } from "./window-bus";
import { restrictedThreadRole } from "../main";
import { threadRuntimeStore } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

const THREAD_RUNTIME_CHANNELS = [
  "thread-runtime:get", "thread-runtime:list", "thread-runtime:seed",
  "thread-runtime:patch", "thread-runtime:dispatch-owner", "thread-runtime:release-dispatch",
];

export const threadRuntimeFeature = defineFeature<null>({
  id: "thread-runtime",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("thread-runtime: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("thread-runtime:get", async (_event, threadId: string) => threadRuntimeStore.get(String(threadId ?? "")));
    ipcHost.handle("thread-runtime:list", async () => threadRuntimeStore.list());
    ipcHost.handle("thread-runtime:seed", async (_event, input: { threadId?: string; runtime?: unknown }) => {
      const threadId = String(input?.threadId ?? "");
      if (!threadId) return null;
      return threadRuntimeStore.seed(threadId, input?.runtime);
    });
    ipcHost.handle("thread-runtime:patch", async (_event, input: { threadId?: string; patch?: unknown; baseRev?: number; takeover?: boolean }) => {
      const threadId = String(input?.threadId ?? "");
      if (!threadId) throw new Error("threadId 不能为空");
      // 身份闸（09-16 用户要求「专家会话、专家团会话也要禁用掉」）：这些会话一律不许开调度。
      // UI 已经把按钮禁用了，这里再挡一道 —— 快捷键/多窗口/旧版本渲染层都绕不过去。
      if ((input?.patch as any)?.dispatch?.enabled === true) {
        const role = await restrictedThreadRole(threadId);
        if (role.restricted) {
          const current = await threadRuntimeStore.get(threadId);
          return { runtime: current, conflict: false, changed: false, restrictedBy: role.label };
        }
      }
      const result = await threadRuntimeStore.patch(threadId, input?.patch, typeof input?.baseRev === "number" ? input.baseRev : undefined, { takeover: input?.takeover === true });
      if (result.changed) {
        broadcastHarnessEvent({ type: "thread-runtime", threadId, runtime: result.runtime, at: Date.now() });
      }
      // 独占接管：被摘掉锁的那个线程也要广播出去，否则别的窗口/别的会话还挂着「调度中」的旧状态
      if (result.tookOverFrom) {
        const released = await threadRuntimeStore.get(result.tookOverFrom);
        if (released) broadcastHarnessEvent({ type: "thread-runtime", threadId: result.tookOverFrom, runtime: released, at: Date.now() });
      }
      return result;
    });
    ipcHost.handle("thread-runtime:dispatch-owner", async () => ({ threadId: await threadRuntimeStore.dispatchOwner() }));
    ipcHost.handle("thread-runtime:release-dispatch", async (_event, threadId: string) => {
      const id = String(threadId ?? "");
      if (!id) return { released: false };
      const released = await threadRuntimeStore.releaseDispatch(id);
      if (released) {
        const runtime = await threadRuntimeStore.get(id);
        broadcastHarnessEvent({ type: "thread-runtime", threadId: id, runtime, at: Date.now() });
      }
      return { released };
    });

    ctx.effect(() => {
      for (const ch of THREAD_RUNTIME_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
