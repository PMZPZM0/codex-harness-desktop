/**
 * poll-ipc —— 轮询板块的主进程域（10-09 建，3 条通道）。
 *
 * 三条通道各有不可替代的理由：
 *   · `poll:config-read` / `poll:config-save`：**配置真相源在主进程**（`userData/poll-settings.json`）。
 *     wait 循环跑在主进程，读渲染层的内存变量读不到；反之主进程自己拍死 5 秒/10 分钟，
 *     用户就永远改不了。⇒ 落盘一份，两个进程都读它。
 *   · `poll:abort`：wait 循环是主进程里的一段 while，「中止」按钮在渲染层 ——
 *     这条通道是唯一接缝（见 `electron/poll-config.ts` 的登记表）。
 *
 * ⛔ 本域**不自挂载**：是否启用由 `electron/composition.json` 决定（与 queue-timer 同款）。
 */
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import type { HostCaps } from "../runtime/seams";
import { bindPollHost, isPollAborted, readPollConfig, requestPollAbort, writePollConfig } from "../poll-config";

const POLL_CHANNELS = ["poll:config-read", "poll:config-save", "poll:abort"];

export const pollFeature = defineFeature<null>({
  id: "poll",
  inject: ["ipc", "host"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    const host = ctx.get<HostCaps>("host");
    if (!ipcHost) throw new Error("poll: 缺少 ipc 服务（宿主未提供）");
    if (!host) throw new Error("poll: 缺少 host 接缝（宿主未提供）");
    // 供模块级函数惰性取用 userData（【91】：模块体不许求值 app.getPath）
    bindPollHost(host.app);

    ipcHost.handle("poll:config-read", () => readPollConfig());

    ipcHost.handle("poll:config-save", async (_event, input: { intervalMs?: number; timeoutMs?: number; maxRetry?: number }) => {
      const next = await writePollConfig({
        intervalMs: Number(input?.intervalMs) || undefined,
        timeoutMs: Number(input?.timeoutMs) || undefined,
        maxRetry: Number.isFinite(Number(input?.maxRetry)) ? Number(input?.maxRetry) : undefined,
      });
      return next;
    });

    ipcHost.handle("poll:abort", (_event, input: { taskId?: string }) => {
      const taskId = String(input?.taskId ?? "").trim();
      if (!taskId) return { ok: false, aborted: false };
      requestPollAbort(taskId);
      // ❼ 已中止的任务若根本没在等（比如早就跑完了）⇒ 如实回报，别让渲染层以为按停生效了
      return { ok: true, aborted: isPollAborted(taskId) };
    });

    ctx.effect(() => {
      for (const ch of POLL_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
