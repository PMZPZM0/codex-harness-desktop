/**
 * queue-timer-ipc（2026-09-28 新增；**2026-10-03 改为插件形态**，主进程插件容器的第一个示范域）。
 *
 * 为什么定时器在主进程：主窗口最小化/被遮挡时渲染层 setTimeout 会被 Chromium 节流
 * （hidden → 1Hz，深度节流 1/min），分钟级定时可能严重迟到；主进程 timer 不受节流。
 * 渲染层（part04c2）收到 `queue-timer:due` 后执行真正的启动（复用「立即」的落点语义：
 * 空闲 → thread/queue/start；忙 → reorder 队头交给既有的回合结束 auto-start）。
 *
 * 生命周期：应用退出 ⇒ 引擎队列清空 + 本域定时器清空 ⇒ 定时一并失效 —— 与排队消息自身的
 * 生命周期一致（排队消息也在引擎内存里），因此不需要持久化。窗口 reload 不杀主进程 ⇒
 * 状态仍在；渲染层恢复时用 `queue-timer:set` 幂等覆盖即可。
 *
 * 到点只广播、不直接调引擎：启动动作涉及 steer/钉顶/429 兜底/toast，全在渲染层
 * startQueued一族里；引擎事件流（queue/changed、turn/started）会照常推给 UI。
 *
 * ── 10-03 改造要点（P0：容器能承载一个真域，且对外契约一字不改）───────────────
 *   · 依赖经 `inject: ["ipc"]` **声明**，⛔ 不再直接 import electron —— 宿主能力走容器注入；
 *   · 两个通道名 / 校验 / 返回值 / 广播 payload **逐字保留**（改容器不许改对外契约）；
 *   · 定时器 Map 搬进 `setup` 闭包，并挂一个 `ctx.effect`：卸载时清定时器 + 摘 handler
 *     —— 插件必须能**干净卸载**，这是"插件"与"模块级 side effect"的分水岭。
 *   · 挂载仍由本文件自己完成（`mountFeature`）：`main.ts` 那行副作用 import 保持不动，
 *     行为零变化、也不去碰并发写入期的 shell 文件。
 */
import { broadcastToAll } from "./window-bus";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

type QueueTimerEntry = { threadId: string; runAt: number; timer: ReturnType<typeof setTimeout> | null };

export const queueTimerFeature = defineFeature<null>({
  id: "queue-timer",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    // inject 已在容器侧挡过一次；这里再挡一次只为把类型收紧（⛔ 不写 `!`：缺依赖要报得出来）
    if (!ipcHost) throw new Error("queue-timer: 缺少 ipc 服务（宿主未提供）");

    const timers = new Map<string, QueueTimerEntry>();
    const clearTimer = (id: string) => {
      const entry = timers.get(id);
      if (!entry) return;
      if (entry.timer != null) clearTimeout(entry.timer);
      timers.delete(id);
    };

    ipcHost.handle("queue-timer:set", (_event, input: { threadId: string; queuedSubmissionId: string; runAt: number }) => {
      const threadId = String(input?.threadId ?? "");
      const id = String(input?.queuedSubmissionId ?? "");
      const runAt = Number(input?.runAt ?? 0);
      if (!threadId || !id || !Number.isFinite(runAt)) return { ok: false, scheduled: false };
      clearTimer(id);
      const delay = Math.max(0, runAt - Date.now());
      // 已过期（恢复场景）也照样触发一次 due：由渲染层判断这条还在不在队列里
      const timer = setTimeout(() => {
        timers.delete(id);
        broadcastToAll("queue-timer:due", { threadId, queuedSubmissionId: id });
      }, delay);
      timers.set(id, { threadId, runAt, timer });
      return { ok: true, scheduled: true };
    });

    ipcHost.handle("queue-timer:cancel", (_event, input: { queuedSubmissionId: string }) => {
      clearTimer(String(input?.queuedSubmissionId ?? ""));
      return { ok: true };
    });

    // 生命期：卸载时清掉未到点的定时器 + 摘掉本域注册的两个通道（未到点的定时器若留着，
    // 卸载后还会广播一次 `queue-timer:due` —— 那正是"卸载不干净"的典型症状）
    ctx.effect(() => {
      for (const id of [...timers.keys()]) clearTimer(id);
      ipcHost.removeHandler("queue-timer:set");
      ipcHost.removeHandler("queue-timer:cancel");
    });
  },
});

// ⛔ 本域**不自挂载**（P1 shell 收敛）：是否启用由 `electron/composition.json` 决定，
//    挂载由生成物 `electron/composition.gen.ts` 负责（依赖方向恒为 生成物 → 域，**禁止反向 import**，
//    否则成环 ⇒ plugin 为 undefined ⇒ 启动即崩）。
