/**
 * 「用对应 Craft App 打开文件」的共享状态与动作（11-16）。
 *
 * ⛔ 已装名单来自主进程扫描 Launcher 安装目录（artcraft:status），模块级缓存 + 20s 轮询 +
 *    窗口回到前台刷新 —— 文件卡菜单和媒体卡都读同一份，别各自轮询。
 * ⛔ 打开动作走 `artcraft:run` 的 open（spawn 官方主程序带文件参数），不开 shell。
 */
import { useEffect, useState } from "react";
import { notifyToast } from "../../lib/ui-channels";
import { craftOpenersFor } from "../../lib/craft-openers.mjs";

type CraftInstalled = { id: string; name: string; cliPath: string };

let cachedIds: string[] = [];
let inflight: Promise<string[]> | null = null;
const listeners = new Set<(ids: string[]) => void>();

async function loadInstalledIds(): Promise<string[]> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const status = await window.codex.artcraftStatus?.();
      const apps = Array.isArray(status?.installedApps) ? (status.installedApps as CraftInstalled[]) : [];
      cachedIds = apps.map((app) => String(app?.id ?? ""));
      listeners.forEach((listener) => listener(cachedIds));
      return cachedIds;
    } catch {
      return cachedIds;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** 已安装的 Craft App id 列表（模块级共享；20s 轮询 + 窗口回前台刷新）。 */
export function useInstalledCraftIds(): string[] {
  const [ids, setIds] = useState<string[]>(cachedIds);
  useEffect(() => {
    listeners.add(setIds);
    void loadInstalledIds();
    const timer = window.setInterval(() => { void loadInstalledIds(); }, 20000);
    const onFocus = () => { void loadInstalledIds(); };
    window.addEventListener("focus", onFocus);
    return () => {
      listeners.delete(setIds);
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  return ids;
}

/** 用某个 Craft App 打开文件（失败给 toast；不抛）。 */
export async function openPathInCraft(appId: string, filePath: string, appName = appId): Promise<void> {
  try {
    const result = await window.codex.artcraftRun({ app: appId, action: "open", path: filePath });
    if (!result?.ok) notifyToast(`用 ${appName} 打开失败`, result?.text ?? result?.error);
  } catch (error) {
    notifyToast(`用 ${appName} 打开失败`, String((error as Error)?.message ?? error).slice(0, 200));
  }
}

/** 某个文件可以用哪些已装 App 打开（限制展示条数）。 */
export function craftOpeners(path: string, installedIds: string[], limit = 3): Array<{ id: string; name: string }> {
  return craftOpenersFor(path, installedIds, { limit }) as Array<{ id: string; name: string }>;
}
