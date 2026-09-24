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
 * - engineWatchdog: ⛔ **已停用（2026-09-09 移除看门狗本体）**，字段仅为兼容历史 app-settings.json
 *   与调用点而保留；**没有任何界面渲染它**，`server.startWatchdog()` 是空实现（见 codex-server.ts）。
 *   保留此字段 = 老配置里的值不会被清掉；若要恢复该能力，必须先给重启加"忙碌闸"
 *   （有活动回合时只记数不重启），否则会打断正在跑的会话。守卫【140】钉住这条。
 * - adaptiveTone: 语气自适应（默认开）。按会话维护状态（心情/精力/默契），把状态映射成
 *   一句「只影响说法、不影响内容」的语气指引，随该会话自己的 developer instructions 下发；
 *   状态按会话各自一份（渲染层键族 agent-mood-<threadId>），A 会话不会改到 B 会话的语气。
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
  /** 语气自适应（默认开）：按会话维护少量状态（心情/精力/默契），随会话自己的
   *  developer instructions 下发一句「只影响说法、不影响内容」的语气指引。
   *  状态按会话各自一份（agent-mood-<threadId>），关掉即停止更新与注入。 */
  adaptiveTone?: boolean;
  /** 关闭窗口时最小化到托盘（默认**关**，09-23 加）：
   *  开着时点窗口 X 只隐藏窗口 —— 应用主进程、引擎、调度器、渠道机器人与正在跑的回合都继续活着，
   *  真正退出走托盘右键「退出」/ Cmd+Q。**开关入口在系统托盘右键菜单**（放托盘上比塞设置页更顺手）。
   *  ⛔ 默认必须是关：开着等于"点 X 不退出"，属可见行为变化，只能由用户主动打开。 */
  closeToTray?: boolean;
  /** 开发工具下载源（09-20 用户：「下载太慢了，所有工具下载加下载源选择」）。
   *  对「开发工具」页的所有按需下载生效：工具链（install-runtimes.cjs）、npm 包
   *  （CloakBrowser）、浏览器内核（Playwright / Cloak）。
   *  - "auto"（默认）：国内镜像优先 → 本机代理（若配置）→ 官方直连 → gh 加速，逐通道回落
   *  - "mirror"：国内镜像优先，失败回落官方直连
   *  - "ghproxy" / "ghfast"：GitHub 资产走对应加速前缀，失败回落官方直连（非 GitHub 资产按 auto）
   *  - "direct"：只走官方直连
   *  - "proxy"：本机代理优先（PROXY 环境变量），失败回落直连 */
  downloadSource?: "auto" | "mirror" | "ghproxy" | "ghfast" | "direct" | "proxy";
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
