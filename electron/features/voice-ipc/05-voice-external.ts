/**
 * voice 域第 5 段：开源语音引擎（11-16 用户令）
 *
 * 只做 IPC 接线；安装/启停/合成实现都在 `electron/voice/external-engines.ts`。
 * 进度复用 `voice:event` 的 download / downloadDone 形态，`target = external:<id>`
 * （基础模型卡只认不带 target 的事件，互不干扰）。
 */
import {
  cancelExternalInstall,
  externalEngineInstalledDir,
  externalEngineList,
  externalEngineRepo,
  removeExternalEngine,
  setExternalEngineEnabled,
  setExternalProgressSink,
  startExternalInstall,
} from "../../voice/external-engines";
import { sendToWindow } from "../window-bus";
import type { IpcHost } from "../../ipc-host";
import type { HostCaps } from "../../runtime/seams";

/** 注册开源语音引擎的 7 条通道（列表 / 安装 / 取消 / 删除 / 启停 / 打开 / 定位）。 */
export function registerVoiceIpc5({ ipcHost, host }: { ipcHost: IpcHost; host: HostCaps }) {
  setExternalProgressSink((event) => {
    sendToWindow("voice:event", {
      type: event.kind,
      target: `external:${event.id}`,
      percent: event.percent * 100,
      message: event.message,
      ok: event.ok,
      error: event.error,
    });
  });

  ipcHost.handle("voice:external-list", () => externalEngineList());
  ipcHost.handle("voice:external-install", (_event, id: string) => startExternalInstall(String(id)));
  ipcHost.handle("voice:external-cancel", (_event, id?: string) => cancelExternalInstall(id ? String(id) : undefined));
  ipcHost.handle("voice:external-remove", (_event, id: string) => removeExternalEngine(String(id)));
  ipcHost.handle("voice:external-enable", (_event, id: string, enabled: boolean) => setExternalEngineEnabled(String(id), Boolean(enabled)));
  ipcHost.handle("voice:external-open", async (_event, id: string) => {
    const dir = externalEngineInstalledDir(String(id));
    if (dir) {
      const error = await host.shell.openPath(dir);
      return error ? { ok: false, error } : { ok: true, mode: "installed" };
    }
    const repo = externalEngineRepo(String(id));
    if (!repo) return { ok: false, error: "未知的引擎" };
    await host.shell.openExternal(repo);
    return { ok: true, mode: "repo" };
  });
  ipcHost.handle("voice:external-reveal", (_event, id: string) => {
    const dir = externalEngineInstalledDir(String(id));
    if (!dir) return { ok: false, error: "还没安装" };
    host.shell.showItemInFolder(dir);
    return { ok: true };
  });
}
