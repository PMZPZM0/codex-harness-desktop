/**
 * app-lock-ipc —— 应用密码锁（10-26）。
 *
 * 密码哈希、失败次数、待确认流程都在 `electron/app-lock.ts`（纯文件逻辑，可单测）；
 * 本域只做三件事：把主进程当前 userData 传进去、在连续错误达到上限时写重置标记并重启、
 * 用 HostCaps 取 app（不直接 import electron）。
 *
 * ⛔ 密码只在 prepare 时回传一次；status / verify 的返回体永远不含明文或哈希。
 * ⛔ 该域必须 essential（不可停用）：否则用户可以一键停用它绕过锁屏。
 */
import { defaultUserDataDir } from "../data-dir";
import { server } from "../runtime-refs";
import {
  MAX_ATTEMPTS,
  cancelAppLockSetup,
  disableAppLock,
  enableAppLockSetup,
  getAppLockStatus,
  prepareAppLockSetup,
  requestAppDataReset,
  verifyAppLockPassword,
} from "../app-lock";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import type { HostCaps } from "../runtime/seams";

const APP_LOCK_CHANNELS = [
  "app-lock:status", "app-lock:prepare", "app-lock:enable", "app-lock:cancel", "app-lock:verify", "app-lock:disable",
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const appLockFeature = defineFeature<null>({
  id: "app-lock",
  inject: ["ipc", "host"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    const host = ctx.get<HostCaps>("host");
    if (!ipcHost) throw new Error("app-lock: 缺少 ipc 服务（宿主未提供）");
    if (!host) throw new Error("app-lock: 缺少 host 接缝（宿主未提供）");

    const userData = () => host.app.getPath("userData");
    let resetScheduled = false;

    const scheduleReset = () => {
      if (resetScheduled) return;
      resetScheduled = true;
      try {
        requestAppDataReset(defaultUserDataDir(), userData());
      } catch (error) {
        /* 标记写不进去时仍重启：下次 status 看到 attempts=10 会再试一次，不会静默当没事发生。 */
        console.error("[app-lock] 写入重置标记失败：", error);
      }
      /* 给渲染层 3 秒展示「正在清空并重启」；随后新进程在 app.setPath 之前删数据。
         ⛔ 先停引擎：它持有 codex-home 下的 sessions / sqlite 句柄，不停就退出会让
         新进程的删除只成功一半（实测会留下会话与配置）。 */
      setTimeout(() => {
        try { server?.stop(); } catch { /* 引擎可能没起 */ }
        try { host.app.relaunch(); } catch { /* 重启失败也退出，避免锁文件长期停在 attempts=10 */ }
        host.app.exit(0);
      }, 3000);
    };

    const finishVerify = async (result: ReturnType<typeof verifyAppLockPassword>) => {
      if (!result.ok && !result.reset) {
        const failed = Math.max(1, MAX_ATTEMPTS - result.remaining);
        await sleep(Math.min(2000, 250 * failed));
      }
      if (result.reset) scheduleReset();
      return result;
    };

    ipcHost.handle("app-lock:status", () => {
      const status = getAppLockStatus(userData());
      if (status.resetRequired) scheduleReset();
      return status;
    });

    ipcHost.handle("app-lock:prepare", (_event, input: { mode?: string; password?: string } = {}) =>
      prepareAppLockSetup(userData(), input ?? {}));

    ipcHost.handle("app-lock:enable", (_event, setupId: string) => enableAppLockSetup(userData(), String(setupId ?? "")));

    ipcHost.handle("app-lock:cancel", (_event, setupId: string) => cancelAppLockSetup(String(setupId ?? "")));

    ipcHost.handle("app-lock:verify", async (_event, password: string) =>
      finishVerify(verifyAppLockPassword(userData(), String(password ?? ""))));

    ipcHost.handle("app-lock:disable", async (_event, password: string) =>
      finishVerify(disableAppLock(userData(), String(password ?? ""))));
  },
});
