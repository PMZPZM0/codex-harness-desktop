import fs from "node:fs/promises";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
/**
 * 应用级运行时开关（不写入 config.toml 的用户段落，harness 自持）。
 * 持久化在 userData/app-settings.json，跟随 memory-mode.json / personalization.json 的既有模式。
 *
 * - webSearch: 每轮 prompt 都会被引擎带上的服务端搜索工具，关掉能省掉模型「顺手联网」的往返。
 * - desktopAutomation: 桌面自动化（nuphus MCP），关闭后不注册 nuphus，引擎不再加载 35 个桌面工具。
 * - browserAutomation: 浏览器自动化（playwright-cli / cloakbrowser 命令行），关闭后从基础指令里移除
 *   调用说明并关掉 features.browser_use，模型不再被引导去操作浏览器。
 * - engineWatchdog: 引擎健康看门狗（默认开）。引擎子进程可能「活着但不响应」（interrupt 打断慢速
 *   上游请求时偶发死锁），看门狗周期性 thread/list 心跳，连续失败自动 kill+重启并恢复当前线程。
 * 以后新开关都往这里加。
 */
export type AppSettings = {
  webSearch?: boolean;
  desktopAutomation?: boolean;
  browserAutomation?: boolean;
  engineWatchdog?: boolean;
  /** 全局自动压缩比例：上下文用量达到该比例时引擎自动压缩（0.5~0.95，默认 0.8） */
  autoCompactRatio?: number;
  /** Codex 引擎更新用的 HTTP 代理（如 http://127.0.0.1:7890）。空 = 国内镜像直连 */
  engineProxyUrl?: string;
  /** 硬件加速模式（主进程在 app ready 前同步读取并应用，重启生效）：
   *  - "auto"（默认缺省）：Chromium 自行判断（健康显卡自动硬件加速，弱核显/黑名单显卡回退软件渲染）
   *  - "force"：忽略 GPU 黑名单 + 强制 GPU 光栅化/零拷贝——低配机上软件渲染卡顿时可选
   *  - "off"：完全关闭硬件加速（极个别驱动与 GPU 通道冲突时用） */
  hardwareAcceleration?: "auto" | "force" | "off";
};

let cached: AppSettings | null = null;

function settingsFile(userData: string) {
  return path.join(userData, "app-settings.json");
}

export async function readAppSettings(userData: string): Promise<AppSettings> {
  if (cached) return cached;
  try {
    const raw = await fs.readFile(settingsFile(userData), "utf8");
    cached = JSON.parse(raw) as AppSettings;
  } catch {
    cached = {};
  }
  return cached;
}

export function readAppSettingsSync(userData: string): AppSettings {
  if (cached) return cached;
  try {
    cached = JSON.parse(readFileSync(settingsFile(userData), "utf8")) as AppSettings;
  } catch {
    cached = {};
  }
  return cached;
}

export async function saveAppSettings(userData: string, patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = cached ?? (await readAppSettings(userData));
  cached = { ...current, ...patch };
  await fs.mkdir(userData, { recursive: true });
  await fs.writeFile(settingsFile(userData), JSON.stringify(cached, null, 2), "utf8");
  return cached;
}

export function invalidateAppSettings() {
  cached = null;
}
