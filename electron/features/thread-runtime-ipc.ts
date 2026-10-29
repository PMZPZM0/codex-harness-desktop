/**
 * thread-runtime-ipc（10-03 从 `features/engine-ipc/` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：thread-runtime(4)
 * 通道：thread-runtime:get / list / seed / patch
 *
 * 会话运行态（模型 / 思考档位 / 权限 / 调度许可）的权威账本在 `threadRuntimeStore`（`../runtime-refs`）。
 *
 * ⛔⛔ 10-29 删除了 `dispatch-owner` / `release-dispatch` 两条通道：调度**全局独占锁**（09-16 的
 *     「同一时间只允许一个会话调度」）与用户令「每个会话都可以调度它们」直接冲突，锁 / 接管 /
 *     孤儿锁自愈一起下线 ⇒ 这两条通道不再有消费者，留着就是死通道（守卫【2】按欠账处理）。
 *
 * ⛔⛔ 身份闸不能省（`patch` 里带 `dispatch` 时）：专家会话 / 专家团会话一律不许改调度许可
 *     （09-16 用户要求；10-29 只放开"默认可用"，没有放开"这些会话也能对外派人"）。UI 已禁用
 *     按钮，这里再挡一道 —— 快捷键 / 多窗口 / 旧版本渲染层都绕不过去。
 */
import { broadcastHarnessEvent } from "./window-bus";
import { restrictedThreadRole } from "../main";
import { threadRuntimeStore } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

const THREAD_RUNTIME_CHANNELS = [
  "thread-runtime:get", "thread-runtime:list", "thread-runtime:seed", "thread-runtime:patch",
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
    ipcHost.handle("thread-runtime:patch", async (_event, input: { threadId?: string; patch?: unknown; baseRev?: number }) => {
      const threadId = String(input?.threadId ?? "");
      if (!threadId) throw new Error("threadId 不能为空");
      // 身份闸（09-16 用户要求「专家会话、专家团会话也要禁用掉」）：这些会话一律不许改调度许可。
      // UI 已经把按钮禁用了，这里再挡一道 —— 快捷键/多窗口/旧版本渲染层都绕不过去。
      if ((input?.patch as any)?.dispatch && typeof (input?.patch as any).dispatch === "object") {
        const role = await restrictedThreadRole(threadId);
        if (role.restricted) {
          const current = await threadRuntimeStore.get(threadId);
          return { runtime: current, conflict: false, changed: false, restrictedBy: role.label };
        }
      }
      const result = await threadRuntimeStore.patch(threadId, input?.patch, typeof input?.baseRev === "number" ? input.baseRev : undefined);
      if (result.changed) {
        broadcastHarnessEvent({ type: "thread-runtime", threadId, runtime: result.runtime, at: Date.now() });
      }
      return result;
    });

    ctx.effect(() => {
      for (const ch of THREAD_RUNTIME_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
