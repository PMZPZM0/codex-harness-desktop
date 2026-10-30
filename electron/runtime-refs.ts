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
import { threadCwd } from "./thread-cwd";
import { appendFileSync, readFileSync } from "node:fs";
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
import { readCustomModel, readCustomModels, writeCustomModels } from "./main/01-model-catalog";
import { describeNetworkError } from "./main/11-maintenance";
import type { CustomModelFile } from "./features/custom-model-types";
import { readAppSettings, readAppSettingsSync, saveAppSettings } from "./app-settings";
import { sendToWindow } from "./features/window-bus";

/* ── 域插件化后跨域取用的基座门面（10-03 阶段 2/3）───────────────────────────
   relay 域改 defineFeature 后，deps 不再由 main.ts 传参，而是经本门面取**活绑定**。
   ⛔ 这两个符号原先只在 main.ts 的具名 import 里可达，域要取就得有门面 —— 这不是"为了方便
   而乱加导出"，而是【132】反向依赖原则的正面用法：**跨域共用符号归基座层**。
   ⚠️ 必须是 re-export 而不是拷贝：TS→CJS 下才是 getter 转发（活绑定），
   拷贝会在 main/ 段重新初始化时留下过期引用。 */
export { describeNetworkError, readCustomModel };
/** 10-03：relay 域插件化后也要经门面取（原先由 main.ts 传参，组合表挂载时 main.ts 的 import 尚未完成） */
export { readCustomModels };

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
/* ⛔ 10-30：threadCwd 本体搬到叶子模块 `thread-cwd.ts`（codex-server 要在 thread/start 钩子里写它，
   而本文件 import codex-server ⇒ 直接放在这里会成环）。习惯的 import 点不用改，这里原样再导出。 */
export { threadCwd };
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

/* ── 语音服务单例（10-03：voice 域改插件形态后要经门面取）────────────────────
   ⛔ **为什么必须走 setter 注入而不是直接 import**：voiceService 在 main.ts 第 542 行构造
   （依赖 server / getModel / userDataDir），而 voice 域改由组合表挂载（import 在第 96 行）
   ⇒ 挂载时 `new VoiceService()` 还没执行。域内只能**延后取**（handler 回调体内），
   或者由 main.ts 在构造完成后注入 —— 后者与 server / delegateRegistry 同款范式。
   ⛔ 模型根目录同理：它是 `path.join(app.getPath("userData"), …)`，模块体求值会拿到
   错的 userData（【91】），必须等 app.setPath 之后再算。 */
export let voiceService: import("./voice/voice-service").VoiceService | null = null;
export function setVoiceService(instance: import("./voice/voice-service").VoiceService) { voiceService = instance; }
export let voiceModelsRoot = "";
export function setVoiceModelsRoot(dir: string) { voiceModelsRoot = dir; }

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

/* ── 用户一次性授权的路径（10-18 预览修复）：按**目录**记，持久化到 userData/trusted-paths.json
   ⛔ 语义仍是「用户亲自点过授权」= 可信来源；⛔ 不是放开任意读（每次新增都要一次用户手势）。 */
let persistedTrustLoaded = false;
function trustFilePath() { return path.join(app.getPath("userData"), "trusted-paths.json"); }
function loadPersistedTrust() {
  if (persistedTrustLoaded) return;
  persistedTrustLoaded = true;
  try {
    const rows = JSON.parse(readFileSync(trustFilePath(), "utf8"));
    if (Array.isArray(rows)) for (const row of rows) if (typeof row === "string" && row) userPickedPaths.add(path.resolve(row));
  } catch { /* 首次运行/文件坏 => 空集 */ }
}
/* 10-29：allowUserPath 已删除 —— 预览 / 编辑不再需要授权，它唯一的调用方（fs:allow）同轮删除。
   历史 trusted-paths.json 仍会被读取（loadPersistedTrust），让其余**资产类**闸门认旧授权。 */

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
  loadPersistedTrust();
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

/** 窗口事件落盘诊断（10-16，与云助手同轮同步）：排查「关闭独立弹窗后主窗没反应」时发现，
 *  主进程侧的窗口通知**一句日志都没有** ⇒ 用户报「没自动回来」时无法区分「通知没发出」
 *  「发给了空集合」「渲染层没处理」三种情形（云助手那边的真根因恰好是第一种）。
 *  落 `userData/window-events.log`（无头形态没有可见终端，只能落盘）。 */
function windowEventDiag(msg: string) {
  try {
    appendFileSync(path.join(app.getPath("userData"), "window-events.log"), `${new Date().toISOString()} ${msg}\n`);
  } catch { /* 诊断写失败不影响功能 */ }
}

/** 弹窗被关闭 → 通知**主窗**（popout-closed 解锁侧栏 + popout-return 自动切回该会话）。
 *
 *  ⛔⛔ 走窗口总线的**主窗**通道，不再只发 `mainWindow`（与云助手同轮同步）：云助手形态
 *     根本不创建桌面版主窗 ⇒ `mainWindow` 恒为 null ⇒ 原先那句 `if (!mainWindow …) return;`
 *     让通知**一次都发不出去**（用户报「关闭独立弹窗后没有自动回来，会话选不了」）。
 *     `sendToWindow` 的目标是总线里 { primary: true } 的窗口集合 ⇒ 两种形态通吃
 *     （桌面版 = mainWindow；助手形态 = assistant-window）。
 *  ⛔ 也不要用 broadcastToAll：`popout-return` 若广播给**其它仍开着的**弹窗，
 *     会让它们把自己的会话切走、并清掉自己的弹窗标识（弹窗壳整个坏掉）。
 *  调用点已在 unregisterBusWindow 之后 ⇒ 已关的弹窗不会收到。 */
export function notifyPopoutClosed(threadId: string) {
  windowEventDiag(`弹窗已关 → 通知主窗（threadId=${threadId}）`);
  sendToWindow("harness:event", { type: "popout-closed", threadId, at: Date.now() });
  sendToWindow("harness:event", { type: "popout-return", threadId, at: Date.now() });
}

/** 「关闭窗口时最小化到托盘」（托盘右键菜单里的开关）。默认关。 */
export function closeToTrayEnabled(): boolean {
  return Boolean(readAppSettingsSync(app.getPath("userData")).closeToTray);
}

/* 关闭确认弹窗（10-13）：点 X 弹「最小化到托盘 / 完全退出 / 取消」+「不再询问」。
   记住的是**动作**：勾选「不再询问」时把动作写进 closeToTray（true=托盘 / false=退出）
   并置 closePromptSeen=true，此后点 X 不再弹窗、直接按 closeToTray 走。 */
/** 「不再询问」是否已勾选过（勾过就不再弹窗）。默认否。 */
export function closePromptSeen(): boolean {
  return Boolean(readAppSettingsSync(app.getPath("userData")).closePromptSeen);
}
/** 记住用户在关闭确认弹窗里选的动作（action=true = 最小化到托盘 / false = 完全退出）。 */
export function rememberCloseChoice(action: boolean): void {
  void saveAppSettings(app.getPath("userData"), { closeToTray: action, closePromptSeen: true }).catch(() => undefined);
}

/* 关闭确认弹窗的**跨域桥**（10-13）：关窗守卫在 window-factory、弹窗 UI 在渲染层、
   回包处理在 close-confirm-ipc —— 三方经这个可变桥对接（与 mutableState 同一纪律：
   ESM 的 import 绑定不可赋值 ⇒ 用对象属性读写，跨模块改值才不会静默丢失）。 */
export const closeConfirmBridge: {
  /** 待决的关窗（preventDefault 后等用户选）；null = 没有在等的 */
  pending: { busy: number } | null;
  /** 渲染层回包后执行（hide / 二次 close）；由 window-factory 在建窗时注入 */
  respond: ((action: "tray" | "quit" | "cancel", remember: boolean) => void) | null;
} = { pending: null, respond: null };

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

/** 把**当前主题**的原生外观应用到**单个**窗口（建窗后 / 首次显示后各补设一次）。
 *
 *  ⛔ 存在的理由（10-16 用户实测：「暗色主题下独立窗口右上角的系统缩小/全屏/叉掉看不见」）：
 *     建窗只在构造参数里读了一次 `titleBarOverlayOptions()`（而且那时 appThemeDark 可能还是
 *     null ⇒ 退到**系统**主题）。Windows 又会在窗口**首次显示**时做边框延展，把构造期设好的
 *     属性覆盖掉 —— 与 `win-rounded-corners.ts` 记的圆角时序坑是同一件事。
 *     ⇒ 暗色顶栏上画的是系统主题的近黑符号 = 看不见。所以：建窗补一次、`show` 之后再补一次（幂等）。
 *  ⛔ 与 applyWindowChrome 的分工：那个遍历**全部**总线窗口、由主题切换触发；
 *     这个只管传入的那一个、由建窗/首显触发 —— 两者互补，缺一就会出现
 *     「新开的窗口外观不对 / 换了主题旧窗口不跟」。 */
export function applyThemeToWindow(win: BrowserWindow): void {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  const dark = appThemeDark ?? nativeTheme.shouldUseDarkColors;
  try { win.setBackgroundColor(dark ? "#1b1b1a" : "#ffffff"); } catch { /* 窗口可能正在销毁 */ }
  try { win.setTitleBarOverlay(titleBarOverlayOptions()); } catch { /* overlay 未启用（非 win32 等）时忽略 */ }
}
