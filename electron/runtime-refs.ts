/**
 * 运行时单例 / 路径的声明层（09-24，评估报告 P2-9）。
 *
 * ⛔ 目标：electron/features/** 不再 import "./main"（1,288 行巨石 + 启动链）。
 * 本文件只放【声明 + 惰性初始化 + setter】；**构造仍发生在 main.ts 启动链**（时序不变），
 * features 在 handler 运行期读到的都是已初始化的活绑定（TS→CJS 的 export let 是活绑定，
 * 已在 dist-electron/ 上验证过）。
 *
 * ⛔【91】凡依赖 app.getPath("userData") 的路径都在 initRuntimePaths() 里赋值；
 *    main.ts 必须在 app.setPath("userData") 之后**立即**调用它（只跑一次）。
 * ⛔ 本文件**不得** import "./main"（会成环，且整场收敛失效）。
 */
import { app, BrowserWindow, nativeTheme } from "electron";
import path from "node:path";
import QRCode from "qrcode";
import { CodexServer } from "./codex-server";
import { TerminalService } from "./terminal";
import { SshSessionManager } from "./ssh-servers";
import { DelegateRegistry } from "./delegate-registry";
import { TeamRunStore } from "./team-runs";
import { ThreadRuntimeStore } from "./thread-runtime-store";
import { MemoryLayers } from "./memory-layers";
import { MemoryStore } from "./memory-store";
import { RpaStore } from "./rpa-store";
import { readCustomModels, writeCustomModels } from "./main/01-model-catalog";
import type { CustomModelFile } from "./features/custom-model-types";
import { readAppSettings, readAppSettingsSync } from "./app-settings";
import { broadcastHarnessEvent } from "./features/window-bus";

/* ── 主窗口句柄（window-factory 经 mutableState.mainWindow = 写入）──────── */
export let mainWindow: BrowserWindow | null = null;
export function setMainWindow(win: BrowserWindow | null) { mainWindow = win; }

/* ── 路径组：已下沉到**叶子模块** runtime-paths.ts（2026-09-24 断环，见该文件头注释）。
     这里 re-export 保持全部既有引用名不变（含 initRuntimePaths）——CJS 下是 getter 转发，
     活绑定语义不变。⛔ 不要把这些声明搬回本文件：会让 runtime-refs ↔ main/01-model-catalog 成环。 */
export {
  codexHome, customModelFile, customModelsFile, channelBotFile, botStreamFile,
  memoryGatewayFile, pastedTextDir, memoryWorkspaceFile, modelCatalogFile, initRuntimePaths,
  memoryModeFile, mcpOverridesFile, connectorsFile, builtinPluginsFile, subAgentsFile,
} from "./runtime-paths";

/* ── 纯容器（顶层构造即可，不依赖 userData）──────────────────────── */
/** 主进程内部会话（记忆蒸馏等）：其事件不参与记忆捕获与远程转发，否则蒸馏输出会被当成对话写回日志。
 *  09-24 从 main.ts 下沉（main/03-turn-summary.ts 要 add/delete 它 ⇒ 原为反向依赖）。 */
export const internalThreads = new Set<string>();
export const engineActiveTurnIds = new Map<string, string>();
/** turnId → threadId（09-19：重启闸门记账） */
export const threadCwd = new Map<string, string>();
/** 弹窗窗口 → 会话 id 的同步登记表（创建时立即写入，不依赖 URL 加载完成）。 */
export const popoutThreadIds = new Map<BrowserWindow, string>();
export const terminals = new Map<string, TerminalService>();
export const sshSessions = new SshSessionManager();
export const channelLogs: { at: number; level: "info" | "error"; message: string }[] = [];

/* ── 类单例（构造在 main.ts 启动链，setter 注入）────────────────── */
export let server!: CodexServer;
export function setServer(instance: CodexServer) { server = instance; }

export let delegateRegistry!: DelegateRegistry;
export function setDelegateRegistry(instance: DelegateRegistry) { delegateRegistry = instance; }

export let teamRunStore!: TeamRunStore;
export function setTeamRunStore(instance: TeamRunStore) { teamRunStore = instance; }

export let threadRuntimeStore!: ThreadRuntimeStore;
export function setThreadRuntimeStore(instance: ThreadRuntimeStore) { threadRuntimeStore = instance; }

export let memoryLayers!: MemoryLayers;
export function setMemoryLayers(instance: MemoryLayers) { memoryLayers = instance; }

export let memoryStore!: MemoryStore;
export function setMemoryStore(instance: MemoryStore) { memoryStore = instance; }

export let rpaStore!: RpaStore;
export function setRpaStore(instance: RpaStore) { rpaStore = instance; }

/* ── 函数（自包含或仅依赖上面已承载的符号，连体迁入）──────────────── */

/** 二维码 SVG（官方 qrcode 包：mask/纠错全规范实现，自研版有机读缺陷已弃用） */
export function qrSvg(text: string) {
  return QRCode.toString(text, { type: "svg", margin: 2, errorCorrectionLevel: "M" });
}

/** 打包运行：resources 目录（tools/*.mjs 等可改文件在此）；源码运行：项目根 */
export function appSourceRoot() {
  return app.isPackaged ? process.resourcesPath : app.getAppPath();
}

/** 「用户亲自选过」的路径 = 可信来源（09-13 审计 S5 的安全版修法）。 */
const userPickedPaths = new Set<string>();

export const trustPicked = (paths: readonly string[]) => {
  for (const p of paths) {
    if (!p) continue;
    const resolved = path.resolve(String(p));
    userPickedPaths.add(resolved);
    if (userPickedPaths.size > 200) userPickedPaths.delete(userPickedPaths.values().next().value as string);
  }
};

/** 可信根集合：主进程记着的各会话工作目录 + userData + 用户亲自选过的路径（含其所在目录）。 */
const trustedRoots = () => {
  const roots = [app.getPath("userData"), ...[...threadCwd.values()].filter(Boolean).map((cwd) => String(cwd))];
  for (const picked of userPickedPaths) roots.push(picked, path.dirname(picked));
  return roots.filter(Boolean).map((root) => path.resolve(root));
};

export const isInsideTrustedRoots = (target: string) => {
  const resolved = path.resolve(target);
  return trustedRoots().some((root) => {
    const rel = path.relative(root, resolved);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  });
};

/** 同上，但允许目标**就是**可信根本身（reveal 工作区 / userData 目录这类合法用法）。 */
export const isInsideOrEqualTrustedRoots = (target: string) => {
  const resolved = path.resolve(target);
  return trustedRoots().some((root) => {
    const rel = path.relative(root, resolved);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  });
};

export async function upsertCustomModel(value: CustomModelFile) {
  const list = await readCustomModels();
  const index = list.findIndex((entry) => entry.provider === value.provider);
  if (index >= 0) list[index] = value; else list.push(value);
  await writeCustomModels(list);
}

/** 引擎健康看门狗开关同步：按 app-settings.json 的 engineWatchdog（默认开）启停。
 *  ⛔ 09-24 更正：`server.startWatchdog/stopWatchdog` 目前是**空实现**（看门狗本体 2026-09-09
 *  被有意移除，理由见 codex-server.ts 的注释）⇒ 这里现在实际什么都不做。保留调用点是为了
 *  将来恢复时只改一处；**不要**因为"看起来没接上"就把心跳接回来（会打断运行中的会话）。 */
export async function syncEngineWatchdog() {
  const settings = await readAppSettings(app.getPath("userData"));
  if (settings.engineWatchdog !== false) server.startWatchdog();
  else server.stopWatchdog();
}

/** 弹窗被关闭 → 通知主窗口（popout-closed 隐藏回侧栏 + popout-return 自动打开该会话）。 */
export function notifyPopoutClosed(threadId: string) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  try {
    mainWindow.webContents.send("harness:event", { type: "popout-closed", threadId, at: Date.now() });
    mainWindow.webContents.send("harness:event", { type: "popout-return", threadId, at: Date.now() });
  } catch { /* 主窗口可能已关 */ }
}

/** 「关闭窗口时最小化到托盘」（托盘右键菜单里的开关）。默认关。 */
export function closeToTrayEnabled(): boolean {
  return Boolean(readAppSettingsSync(app.getPath("userData")).closeToTray);
}

/* 记忆后端判定在 ./memory-backend（⛔ 不能定义在这里：本文件已 import memory-layers，
   在此定义再被 memory-layers 反向 import 会形成 require 环）。这里只做转发。 */
export { memoryBackend, type MemoryBackend } from "./memory-backend";

/** 当前主题是否深色（main.ts 的 applyWindowChrome 维护；未设置时回退系统）。 */
let appThemeDark: boolean | null = null;
export function setAppThemeDark(v: boolean | null) { appThemeDark = v; }
export function titleBarOverlayOptions() {
  const dark = appThemeDark ?? nativeTheme.shouldUseDarkColors;
  // ⛔ 符号色必须与 main.ts 的 CHROME_SYMBOL_DARK/LIGHT 逐字一致（664/666 行）——
  //   改任一处都要同步另一处（守卫【132】比对）。
  return { color: "#00000000", symbolColor: dark ? "#e8e8e5" : "#1b1b1a", height: 43 };
}

/* ⛔ appThemeDark 的取值在 main.ts 的 applyWindowChrome 维护——上面 titleBarOverlayOptions
 *   依赖它 ⇒ main.ts 每次设置主题时调 setAppThemeDark(dark)。symbolColor 的明暗两值
 *   原写在 main.ts 的 CHROME_SYMBOL_DARK/LIGHT 常量里，此处按原值内联。 */
