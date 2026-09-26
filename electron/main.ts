/**
 * main —— 保留未分出的部分（09-22 结构改造）。
 * ⛔ 顺序即契约（若含 hook / 副作用注册，调用顺序 == 原文件顺序）⇒ 只能按文件名前缀顺序 import。
 */
import { Menu, Notification, app, BrowserWindow, clipboard, globalShortcut, ipcMain, nativeTheme, net, powerSaveBlocker, protocol, safeStorage, session, shell, systemPreferences } from "electron";
import { execSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, watch as watchFs, writeFileSync, type Dirent } from "node:fs";
import path from "node:path";
import http from "node:http";
import { ChannelBotService, type ChannelBotConfig } from "./channel-bot";
import { resolveStartupUserData } from "./data-dir";
import { CodexServer, codexBinaryPath } from "./codex-server";
import { BotPairingService } from "./bot-pairing";
import { MemoryStore, type MemoryCategory, type MemoryRemoteConfig } from "./memory-store";
import { Scheduler } from "./scheduler";
import { MemoryLayers } from "./memory-layers";
import { RpaStore, type RpaRecipe } from "./rpa-store";
import { TeamRunStore, memberThreadName } from "./team-runs";
import { DelegateRegistry } from "./delegate-registry";
import { ThreadRuntimeStore } from "./thread-runtime-store";
import { TerminalService } from "./terminal";
import { RemoteControlService } from "./remote";
import QRCode from "qrcode";
import { readPersonalization, writePersonalization, applyPersonalizationToAgentsMd, buildAgentsMd, migrateGreetedForExistingUsers } from "./personalization";
import { readAppSettings, readAppSettingsSync, saveAppSettings, type AppSettings } from "./app-settings";
import { VoiceService } from "./voice/voice-service";
import * as voiceProfiles from "./voice/voice-profiles";
import {
  deleteSshServer, execSshCommand, exportSshServers, parseSshImport, readSshServers, saveSshServer, setSshServerEnabled,
  testSshConnection, writeSshServers, SshSessionManager, type SshExecResult, type SshServer, type SshTestResult,
} from "./ssh-servers";
import {
  allBusWindows, broadcastCodexEvent, broadcastHarnessEvent, isPopoutWindow,
  popoutBusWindows, registerBusWindow, sendToWindow, unregisterBusWindow,
} from "./features/window-bus";
import type { CustomModelFile, ProviderModel } from "./features/custom-model-types";
import { bindCustomModelProbe } from "./features/custom-model-probe";
import type { ConnectorOAuthKind, ConnectorOAuthSpec, ConnectorTemplate } from "./features/connector-templates";
import { buildModelCatalog, probeCustomModel } from "./features/custom-model-probe";
import { bootApp, bindBoot } from "./features/boot";
import {
  DISPATCH_FIXED_PORT, buildDispatchCatalog, dispatchHttpPort, dispatchHttpReady, dispatchMcpTools,
  dispatchProbes, dispatchToken, ensureDispatchToken, restrictedThreadRole, setDispatchHttpPort,
  setDispatchHttpReady, stableKey,
} from "./features/dispatch-core";
import { dirEntries, fileStat, sizeLabel } from "./features/app-diagnostics";
import { registerVoiceIpc } from "./features/voice-ipc";
import { readRelayStore, registerRelayIpc, writeRelayStore } from "./features/relay-ipc";
import { IPC_DOMAINS, domainsStillInMain } from "./ipc-registry";
import { ensureBuiltinSkills, ensureExpertSkillsMarketplace, expertSkillsSourceDir } from "./builtin-skills";
import { NUPHUS_VISION_ENV_TABLE, nuphusVisionEnv, nuphusVisionEnvDrift } from "./nuphus-env";
import {
  buildChengxiangExpertTeam, buildDefaultExpertTeams, buildDongmingExpertTeam, buildTeamPhaseTool, buildTeamSystemPrompt, buildTeamTools, buildZhiweiExpertTeam, normalizeTeamConfig,
  readExpertTeams, setExpertTeamsFile, syncSkillsPathInTeam, writeExpertTeams, type ExpertTeamConfig, type ExpertTeamMember,
} from "./expert-teams";
import { applyCustomModel } from "./features/custom-model-apply";
import { fetchOpenaiModels, readOpenaiAuth, resolveLiveProxy } from "./features/openai-auth";
import { deletedThreadIds, healRolloutLineage, loadDeletedThreads, purgeDeletedThread } from "./features/thread-deletion";
import { autoInstallGitIfNeeded } from "./features/dev-runtimes";
import { engineDebugLogPath } from "./user-data-paths";
import { createAppTray, destroyAppTray, trayIconPath } from "./tray";
import { showMainWindow } from "./features/window-factory";
import { runDelegatedTask } from "./features/delegation";
import { createPopoutWindow, createWindow } from "./features/window-factory";
import { dispatchRpcCall, ensureDispatchHttp } from "./features/dispatch-rpc";
import { handleChannelMessage, handleTelegramMessage, handleWeixinMessage } from "./features/im-inbound";
import { collectSessionProviderIds } from "./features/provider-sessions";
import { botStreamPlanFor, botStreamSessions, botsFile, channelBotBindings, channelLog, channelThreadChat, dingtalkGateway, feishuGateway, loadBotBindings, persistChannelLog, qqGateway, qqReplyContexts, setWeixinGateway, startWeixinTyping, stopWeixinTyping, telegramBindings, telegramGateway, wecomWebhookGateway, weixinBindings, weixinGateway, writeBotBindings } from "./features/im-gateways";
import { EVENT_FILTER_ENABLED, eventThreadId, filterForRenderer, rendererDroppedEventCount } from "./features/renderer-fuse";
/* 运行时单例与路径（09-24 P2-9 下沉）：构造仍在下方启动链，赋值走 setXxx（见 runtime-refs.ts）。 */
import {
  appSourceRoot, botStreamFile, builtinPluginsFile, channelBotFile, channelLogs, closeToTrayEnabled, codexHome,
  connectorsFile, customModelFile, customModelsFile, delegateRegistry, engineActiveTurnIds, initRuntimePaths,
  internalThreads, modelCatalogFile,
  isInsideOrEqualTrustedRoots, isInsideTrustedRoots, mainWindow, memoryGatewayFile, memoryLayers,
  memoryStore, memoryWorkspaceFile, notifyPopoutClosed, pastedTextDir, popoutThreadIds, qrSvg,
  rpaStore, server, setAppThemeDark, setDelegateRegistry, setMainWindow, setMemoryLayers,
  setMemoryStore, setRpaStore, setServer, setTeamRunStore, setThreadRuntimeStore, sshSessions,
  syncEngineWatchdog, teamRunStore, terminals, threadCwd, threadRuntimeStore, titleBarOverlayOptions,
  trustPicked, upsertCustomModel,
} from "./runtime-refs";
import { readCustomModel, readCustomModels, writeCustomModels, healReservedProviderConfig, normalizeProvider, writeModelCatalogToml, readUserConfigSplit } from "./main/01-model-catalog";
import { distillSummarize, turnOutputText, waitForTurnCompletion } from "./main/03-turn-summary";
import { connectorEnv, readChannelBot, connectorToml, mcpToolRulesOf } from "./main/04-connector-config";
import "./features/dialog-ipc";
import "./features/clipboard-ipc";
import "./features/im-channels-ipc";
import "./features/teams-agents-ipc";
import "./features/engine-ipc";
import "./features/builtin-skills-ipc";
import "./features/connectors-mcp-ipc";
import "./features/model-custom-ipc";
import "./features/settings-app-ipc";
import "./features/data-dir-ipc";
import "./features/user-ipc";
import "./features/remote-ipc";
import "./features/memory-rpa-ipc";
import "./features/fs-ipc";
import "./features/updates-ipc";
import "./features/shell-misc-ipc";
/* 截图（全屏/框选）+ 收藏夹：用户素材链的两端（截图可收藏、收藏可发送/进记忆） */
import "./features/screenshot-favorites-ipc";
/* 历史会话搜索：顶栏 🔍 → 扫 rollout 原档搜对话内容（真相源=rollout，见 history-search-ipc.ts） */
import "./features/history-search-ipc";
import { readMemoryMode, applyMemoryMode, workspaceMemoryEnabled } from "./main/05-memory-mode";
import { readMcpOverrides, mcpOverrideEnabled } from "./main/06-mcp-overrides";
import { escapeToml, readConnectors } from "./main/07-connectors-io";
import { ensureBuiltinReviewer } from "./main/09-agents-plugins";
import { classifyProbeError, migrateLegacyRolloutHome, describeNetworkError } from "./main/11-maintenance";
import { devInstructionsInput, refreshSkillDiscipline } from "./main/12-skill-discipline";
/* 断环用叶子模块（2026-09-24）：路径常量(runtime-paths) / 上游协议表(upstream-protocols) /
   协议桥下发(bridge-dial)，只依赖 electron 与 node 内置 ⇒ 谁都能正向依赖，不成环。 */
import { normalizeUpstreamProtocol } from "./upstream-protocols";
import { bridgeDial, responsesBridge } from "./bridge-dial";




import { ensureProjectAgentsMd } from "./project-conventions";
/** 诊断计数（09-12 多会话性能）：thread/list 走了几次「rollout 全量兜底扫描」。
    旧实现每次必扫（渲染层每个回合结束都打一发 → O(N²)）；现在只在引擎索引为空时扫。
    e2e 场景据此断言「跑 10 个会话时扫描次数为 0」，避免优化被悄悄改回去。 */
let rolloutFallbackScanCount = 0;

/** 主进程耗时打点：thread/resume 总耗时 与 其中 enrich（同步解析 rollout）的耗时。
    切会话卡不卡主要看这两项——它们是主进程**同步**路径，会连带堵住所有会话的事件转发。 */
let resumeTotalMs = 0;

let resumeCount = 0;

let resumeEnrichMs = 0;

let resumeMaxMs = 0;

/** thread/list 的请求次数（多会话性能验证用）：渲染层原本**每个回合结束都打一发**，
    改成「本地补丁 + 去抖兜底」后应显著下降。 */
let threadListRequestCount = 0;

function enrichScanCountSnapshot() {
  return {
    rolloutFallbackScans: rolloutFallbackScanCount,
    droppedForInactiveSession: rendererDroppedEventCount,
    // 09-14：裁剪是否真的在生效（accept 断言用它区分「真的裁了」与「碰巧没事件」）。
    eventFilterEnabled: EVENT_FILTER_ENABLED,
    threadListRequests: threadListRequestCount,
    resumeCount,
    resumeAvgMs: resumeCount ? Math.round(resumeTotalMs / resumeCount) : 0,
    resumeMaxMs: Math.round(resumeMaxMs),
    resumeEnrichAvgMs: resumeCount ? Math.round(resumeEnrichMs / resumeCount) : 0,
  };
}

protocol.registerSchemesAsPrivileged([{ scheme: "harness-image", privileges: { secure: true, supportFetchAPI: true } }]);

app.setName("Codex Harness Desktop");

app.setPath("userData", resolveStartupUserData());

/* 自定义 AUMID（AppUserModelID）—— **只在打包版设置，dev 一律不设**。
   Windows 用 AUMID 把"运行中的进程"与"注册了同一 AUMID 的快捷方式"配对：配对成功 ⇒ 任务栏取
   该快捷方式的图标；**配对失败 ⇒ 回退到进程 exe 的图标，并且此时窗口图标（BrowserWindow.icon）
   会被完全忽略**。dev 形态 exe 是 node_modules/electron/dist/electron.exe ⇒ 回退即 Electron 原子图标。
   ⛔ 09-25 A/B 实证（同一份 build/icon.ico、同一个窗口，仅差一行 AUMID，任务栏截图 md5）：
     · 不设 AUMID           → 任务栏 = 我们的图标 ✓
     · 设 .dev AUMID        → 任务栏 = Electron 原子图标 ✗（正是用户反复报的症状）
   原因是「系统里存在注册了该 AUMID 的快捷方式」这条前提**不可靠**：快捷方式文件在、字段对，
   但 Shell 的应用解析器不一定会认（实测 Get-StartApps 里根本没有本应用），dev 下随时可能失效，
   失效后不是"没有图标"而是"被 exe 图标顶掉 + 窗口图标失效"—— 这就是图标反复掉的真根因。
   ⇒ 打包版由 electron-builder NSIS 写入规范快捷方式（AUMID 可解析），保留设置；
     dev 不设，让 Windows 走窗口图标那条路（window-factory 已把 icon 锚在 app.getAppPath()/build/icon.ico）。 */
if (app.isPackaged) app.setAppUserModelId("com.codexharness.desktop");

if (process.env.CODEX_HARNESS_DEBUG_PORT) app.commandLine.appendSwitch("remote-debugging-port", process.env.CODEX_HARNESS_DEBUG_PORT);

// 硬件加速策略：默认全部保持 Chromium 默认（健康显卡自动走硬件加速）。
// 曾试过 ignore-gpu-blocklist / enable-gpu-rasterization / enable-zero-copy / disable-frame-rate-limit
// 四开关无脑强推，健康显卡上用户实测「点击延迟明显变高」——强开对本来就走 GPU 的机器反而是劣化。
// 低配机（弱核显/黑名单显卡）却恰恰相反：默认回退软件渲染，这个 React 应用渲染重 → 卡顿。
// 因此做成用户可选的「硬件加速」开关（设置 → 通用），默认 auto，低配机可选 force，需重启生效。
// 必须在 app ready 之前同步应用（commandLine 开关只在启动早期生效）。
try {
  const accel = readAppSettingsSync(app.getPath("userData")).hardwareAcceleration;
  if (accel === "force") {
    app.commandLine.appendSwitch("ignore-gpu-blocklist");
    app.commandLine.appendSwitch("enable-gpu-rasterization");
    app.commandLine.appendSwitch("enable-zero-copy");
  } else if (accel === "off") {
    app.disableHardwareAcceleration();
  }
} catch { /* 设置读取失败不影响启动，保持默认 */ }

// 测试开关（与 CODEX_HARNESS_USER_DATA / CODEX_HARNESS_DEBUG_PORT 同源）：
// 把 GPU 进程合并进主进程。无 GPU 的机器 / CI / 沙箱里，Chromium 的 GPU 子进程会反复
// 起不来并最终 FATAL 自杀（`GPU process isn't usable. Goodbye.`），表现为 e2e 连不上 CDP。
// 只在显式设置该变量时生效，真实用户不受影响。
if (process.env.CODEX_HARNESS_IN_PROCESS_GPU) {
  app.commandLine.appendSwitch("in-process-gpu");
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("disable-software-rasterizer");
  // 只在测试开关下挂：渲染进程崩溃时打出确切原因（crashed / oom / killed），
  // 否则 e2e 只能看到一句「Target crashed」，没法定位。
  app.on("render-process-gone", (_event, _contents, details) => {
    console.error(`[e2e-diag] 渲染进程退出 reason=${details?.reason} exitCode=${details?.exitCode}`);
  });
}

/**
 * 崩溃取证（09-12 新增）：用户反馈「开实时语音一会就闪退」，但应用跑 e2e 之外的路径
 * 没有任何崩溃日志——渲染进程一死 → 窗口关闭 → window-all-closed → app.quit()，
 * 从用户视角就是「应用自己没了」，且不留证据。
 * 现在两件事一起做：① 落盘确切原因（reason/exitCode/时间）到 userData/voice-crash.log；
 * ② 渲染进程异常退出时重载窗口（应用不再整体退出），把「闪退」降级成「闪一下自动恢复」。
 */
function logCrash(scope: string, detail: unknown): void {
  try {
    const line = `[${new Date().toISOString()}] ${scope} ${typeof detail === "string" ? detail : JSON.stringify(detail)}\n`;
    void fs.appendFile(path.join(app.getPath("userData"), "voice-crash.log"), line).catch(() => undefined);
    console.error("[crash]", line.trim());
  } catch {
    /* 取证失败不能影响主流程 */
  }
}

app.on("render-process-gone", (_event, contents, details) => {
  logCrash("renderer-gone", { reason: details?.reason, exitCode: details?.exitCode });
  if (details?.reason === "clean-exit") return;
  try {
    if (!contents.isDestroyed()) contents.reload();
  } catch {
    /* 重载失败就交给用户手动重开 */
  }
});

process.on("uncaughtException", (error) => logCrash("main-uncaught", String(error?.stack ?? error)));

process.on("unhandledRejection", (reason) => logCrash("main-unhandled", String((reason as any)?.stack ?? reason)));

void app.whenReady().then(() => {
  try {
    const gpuStatus = app.getGPUFeatureStatus();
    console.log("[gpu] feature status:", JSON.stringify(gpuStatus));
  } catch { /* 诊断日志，失败不影响启动 */ }
});

initRuntimePaths();










const memoryFile = path.join(app.getPath("userData"), "memory.json");



const scheduleFile = path.join(app.getPath("userData"), "scheduled-tasks.json");

// 专家团（Team 型专家）：团队定义 + 内置示例首次启动写入
const expertTeamsFile = path.join(app.getPath("userData"), "expert-teams.json");

setExpertTeamsFile(expertTeamsFile);

void (async () => {
  try {
    const existing = await readExpertTeams();
    if (!existing.length) await writeExpertTeams(buildDefaultExpertTeams());
    // 内置单人专家（知微/呈象/洞明）每次启动都确保存在：用户可能删掉后再想要回来，随包分发不该一次性的
    // 洞明要带「技能包绝对路径」兜底（见 expert-teams.ts 里 skillsDir 的说明）
    const builtinSoloTeams = [buildZhiweiExpertTeam(), buildChengxiangExpertTeam(), buildDongmingExpertTeam(expertSkillsSourceDir())];
    let teams = existing.length ? existing : await readExpertTeams();
    // 一次性清理：审查专家曾用过 `mingjian-code-review` 这个临时 id（未随包发布，改名窗口内
    // 启动过的 profile 可能把它播进去）。留着会在专家中心多出一张「明鉴」孤儿卡，删掉。
    const LEGACY_SOLO_TEAM_IDS = ["mingjian-code-review"];
    const kept = teams.filter((entry) => !LEGACY_SOLO_TEAM_IDS.includes(entry.teamId));
    if (kept.length !== teams.length) { teams = kept; await writeExpertTeams(teams); }
    for (const solo of builtinSoloTeams) {
      const stored = teams.find((entry) => entry.teamId === solo.teamId);
      if (!stored) {
        teams = [...teams, solo];
        await writeExpertTeams(teams);
        continue;
      }
      // 已存在 ≠ 已最新：洞明的 systemPrompt 里带技能包**绝对路径**，安装位置一变（开发版 ↔ 打包版、
      // 项目目录改名/搬家）存档里那条旧路径就失效 —— 而专家读不到技能包时**不报错、静默降级**
      // （表现为「洞明突然不读规则集了」）。这里只同步路径那一行，其余内容逐字保留；没变则不写盘。
      const refreshed = syncSkillsPathInTeam(stored, solo);
      if (refreshed) {
        teams = teams.map((entry) => (entry.teamId === solo.teamId ? refreshed : entry));
        await writeExpertTeams(teams);
      }
    }
    // 内置团队改名同步（09-13 全员改笔名）：内置团队在老存档里残留的旧名，按
    // teamId + memberId 就地更新为最新内置名；只动 name 字段，不碰启用态与用户自定义团队
    let renamed = false;
    for (const def of buildDefaultExpertTeams()) {
      const stored = teams.find((entry) => entry.teamId === def.teamId);
      if (!stored) continue;
      const syncName = (target: ExpertTeamMember | undefined, source: ExpertTeamMember) => {
        if (target && target.name !== source.name) { target.name = source.name; renamed = true; }
      };
      syncName(stored.lead, def.lead);
      for (const m of def.members) syncName(stored.members?.find((x) => x.id === m.id), m);
    }
    if (renamed) await writeExpertTeams(teams);
  } catch { /* 忽略初始化失败 */ }
})();

// 引擎直管的 MCP 服务器（如内置 nuphus）不在 connectors 列表里，单独存一份 名字 -> 是否启用。
// ⛔ 路径常量 mcpOverridesFile 已下沉 electron/runtime-paths.ts（2026-09-24 断环收尾）。

// 粘贴长文本落盘目录（见 `pasted-text:save`）。与 images 同层，属应用数据、不进用户工作区。


// 1x1 透明 PNG（base64），图片文件缺失时的兜底响应
const PLACEHOLDER_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function placeholderPngResponse(): Response {
  return new Response(Buffer.from(PLACEHOLDER_PNG_B64, "base64"), {
    headers: { "content-type": "image/png" },
  });
}

setServer(new CodexServer(codexHome));

// ── 重启闸门接线（09-19 用户：「又莫名其妙断了，能一次性从根上解决嘛」）────────────
// 主进程自己按引擎的 turn/started | turn/completed 记账（engineActiveTurnIds），
// 是"有没有回合在跑"的**引擎侧真相**，不依赖渲染层上报（渲染层可能没开/切走了）。
// 注入了它以后，**所有** `server.restart()`（20+ 处：改模型/改供应商/装插件/装技能/
// 改连接器/改沙箱…）都会在有任务在跑时自动推迟到任务结束，不再打断用户的任务。
server.setBusyGate(() => engineActiveTurnIds.size);

server.setBusyNotice((waiting, reason) => {
  // 通知渲染层：改动还没生效（等任务结束会自动生效）。用既有 toast 通道，不新造 UI。
  try {
    if (waiting) {
      sendToWindow("engine:restart-deferred", { reason: reason ?? "", activeTurns: engineActiveTurnIds.size });
    } else {
      sendToWindow("engine:restart-flushed", { reason: reason ?? "" });
    }
  } catch { /* 窗口可能已销毁，忽略 */ }
});

// ⛔ 引擎进程一换，旧回合**全部不存在** ⇒ 记账必须跟着清（否则闸门与 turn/start 安全网永久卡住，
//   见 codex-server.ts 里 spawn 处的注释）。顺手留一条台账：下次"任务莫名断了"能一眼看出
//   是"引擎换了进程（含换了几个回合）"还是别的原因。
server.setEngineSpawnHook(() => {
  const stale = [...engineActiveTurnIds.entries()];
  engineActiveTurnIds.clear();
  if (stale.length) {
    const byThread = new Map<string, number>();
    for (const [, owner] of stale) byThread.set(owner, (byThread.get(owner) ?? 0) + 1);
    console.warn(`[engine] 引擎进程已重启：作废 ${stale.length} 个失效回合记账（会话 ${[...byThread.keys()].map((t) => t.slice(0, 8)).join(", ")}）`);
  }
});

/* 本地协议桥单例 + bridgeDial 已抽成叶子模块 electron/bridge-dial.ts（2026-09-24 断环收尾：
   两者原在本文件，而 main/03-turn-summary.ts 要调 bridgeDial ⇒ 反向依赖 main.ts）。
   本文件按名 import 后原样 re-export（见文件末 export 块），feature / main 侧引用名不变。 */

/**
 * 供应商 id → 上游协议（桥转发用）。**内存映射**，避免每个请求都去读盘。
 *
 * ⛔ 为什么必须有它：`bridgeDial` 是**同步**函数、而档案读取是异步的。而且注册点不止一处
 *   （下发 config.toml、以及 codex:request 入口的兜底改写 `bridgeRewriteProviderConfig`），
 *   那里只拿得到 provider id —— 所以只能靠这张表把协议设置带过去。
 * 刷新时机：启动时一次 + 每次 `writeCustomModels` 之后（写档案 = 设置变化的唯一出口）。
 *
 * 上游协议表已抽成叶子模块 electron/upstream-protocols.ts（2026-09-24 断环：
 *   它原先在本文件，而 main/01-model-catalog.ts 要写它 ⇒ 那边反向依赖 main.ts）。
 *   bridgeDial（现于 bridge-dial.ts）读表、model-catalog 写表，两边都是正向依赖。
 */

/**
 * 兜底收口：把 «任意来源» 的内联 provider 配置改成走桥。
 *
 * 渲染层有若干处会自带 config（会话接力、导入会话、会话内切模型…），里面的 base_url 是真实上游
 * 地址；将来新增下发点也未必想到桥。所以在 codex:request 这一个入口处统一改写 —— 判据是
 * 「params.config.model_providers 里出现了 base_url」，与具体方法名无关，覆盖所有线程生命周期调用。
 * 桥未启动时 bridgeDial 原样返回，等于不改（直连）。
 */


  // turnId → threadId（09-19：见记账处注释）
/** 关窗确认只问一次（用户点过「仍然关闭」后不再拦）。 */
let closeConfirmed = false;

// 记忆捕获：turnId → { user, assistant, cwd }；threadId → cwd（thread/start 响应与 settings/updated 维护）
const captureBuffers = new Map<string, { user: string; assistant: string; cwd?: string }>();



/** 弹窗窗口 → 会话 id 的同步登记表：创建时立即写入（不依赖 URL 加载完成）。
 *  之前的实现靠「读窗口 URL 里的 ?popout=」反查，但 loadFile 异步加载、URL 未就绪时
 *  popoutList 拿到空 → 主窗口侧栏隐藏不生效（用户 09-13 实测）。 */

// ⛔ 窗口集合与广播（broadcastCodexEvent / sendToWindow / broadcastHarnessEvent）已收敛到
//   features/window-bus：原先就地维护 `mainWindow` + `popoutWindows`，导致每个想按域拆出去的
//   feature 都必须反向依赖 main.ts（语音域 39 个 handler 全卡在这一条）。
//   这里保留 `mainWindow` 本地引用（dialog / 关窗 / show 等局部用途），但窗口登记进总线。
//   导出名与旧函数同名 ⇒ 全文 100+ 个调用点一行未改。

// ── 专家团运行记录（09-14）：成员线程复用映射 / 委托记录落盘 / 运行期流式增量广播 ──
// 权威必须在主进程 —— 成员线程的流式事件只有这里看得到，而且 popout 独立窗口的
// 渲染层没有 teamThreadMapRef，只能靠这份映射才知道自己打开的会话属于哪个团。
setTeamRunStore(new TeamRunStore(app.getPath("userData"), (payload) => broadcastHarnessEvent(payload as Record<string, unknown>)));

/** 被调度的临时会话登记表（09-15）：侧栏标记 / L3 硬闸 / 任务完成后询问归档都靠它 */
setDelegateRegistry(new DelegateRegistry(path.join(app.getPath("userData"), "delegate-threads.json")));

// ── 会话运行时配置（模型 / 思考档位 / 权限）的主进程权威存放处 + 多窗口并发保护（09-14） ──
// 渲染层用 localStorage 作**同步读缓存**（大量同步读不能全改异步 IPC），权威值在这里：
//   · 写入天然串行（主进程单点），字段级合并不丢更新；
//   · baseRev 与当前 rev 不等 = 另一个窗口在你读之后改过 → 回报 conflict，渲染层据此刷新界面；
//   · 每次变更广播给所有窗口 → 其它窗口的镜像与 React 状态跟着更新。
const threadRuntimeFile = path.join(app.getPath("userData"), "thread-runtime.json");

setThreadRuntimeStore(new ThreadRuntimeStore(threadRuntimeFile));

// 调度独占锁的当前持有者（全局唯一）。渲染层用它把非持有会话的开关灰掉并显示占用者。
// 释放某个会话的调度独占锁（会话被归档/删除后的兜底 + 渲染层自愈调用入口）。
// ⛔ 09-17 用户实测「都关掉了还提示被另一个会话占用」：锁的持有者是从记录派生的，而归档/删除
//   会话时历史上**没有任何地方清这条记录** ⇒ 孤儿记录永久占锁，且该会话在侧栏已找不到，
//   用户没有任何入口能关它。这里提供显式释放 + 下面的引擎事件清理。
// 该会话是否属于「不允许开调度」的受保护会话（专家 / 专家团 / 被调度的临时会话）——
// 渲染层据此**禁用**调度按钮；真正作准的是下面 patch 里的硬闸。



/** 引擎流式事件 → 手机对话页转发器（remote.ts 的 onThreadEvent 注册） */
const remoteEventForwarders: ((event: { threadId: string; kind: string; text: string }) => void)[] = [];

const remote = new RemoteControlService({
  getStatus: () => "idle",
  storageFile: path.join(app.getPath("userData"), "remote-sessions.json"),
  onDeviceConnected: (device) => { try { mainWindow?.webContents.send("remote:device", device); } catch { /* ignore */ } },
  onCommand: (command, device) => { try { mainWindow?.webContents.send("remote:command", { command, device }); } catch { /* ignore */ } },
  // 手机提交了正确的 6 位配对码 → 挂起等电脑端在应用里点「允许/拒绝」
  onPairRequest: (request) => { try { mainWindow?.webContents.send("remote:pair-request", request); } catch { /* ignore */ } },
  // 手机对话 UI 的引擎桥：选会话 / 新建会话 / 发消息 / 实时收流式回复
  listThreads: async () => {
    const result = await server.request("thread/list", { limit: 30, sortKey: "updated_at", sortDirection: "desc", archived: false }) as any;
    // 已永久删除的会话不进手机端列表：这条链路直接打引擎（不过 thread/list 的合并逻辑），
    // 不挡的话手机上会看到电脑端已经删掉的会话（见 purgeDeletedThread 注释）。
    return (result.data ?? [])
      .filter((entry: any) => !deletedThreadIds.has(String(entry.id ?? "").toLowerCase()))
      .map((entry: any) => ({ id: entry.id, name: entry.name ?? null, preview: entry.preview ?? "", updatedAt: entry.updatedAt ?? 0 }));
  },
  getThreadMessages: async (threadId) => {
    const resumed = await server.request("thread/resume", { threadId, excludeTurns: false }) as any;
    const messages: { role: "user" | "assistant" | "system"; text: string }[] = [];
    for (const turn of resumed.thread?.turns ?? []) {
      for (const item of turn.items ?? []) {
        if (item.type === "userMessage") messages.push({ role: "user", text: (item.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n") });
        else if (item.type === "agentMessage" && item.text?.trim()) messages.push({ role: "assistant", text: item.text });
      }
    }
    return messages;
  },
  newThread: async () => {
    const model = await readCustomModel();
    if (!model) throw new Error("尚未配置自定义模型");
    const apiKey = model.encryptedKey && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(model.encryptedKey, "base64")) : "";
    server.setApiKey(apiKey);
    ensureProjectAgentsMd(process.cwd());
    const started = await server.request("thread/start", {
      model: model.model,
      cwd: process.cwd(),
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      // 官方订阅是伪供应商：引擎配置里没有 model_providers.openai-official 段，
      // 传给 thread/start 会导致流反复断开重连——省略让引擎走内置 openai + ChatGPT 登录凭据
      ...(model.provider === "openai-official" ? {} : { modelProvider: model.provider }),
    }) as any;
    return { id: started.thread.id };
  },
  sendMessage: async (threadId, text) => {
    const model = await readCustomModel();
    await server.request("turn/start", { threadId, input: [{ type: "text", text, text_elements: [] }], model: model?.model, effort: "high" });
  },
  onThreadEvent: (listener) => {
    remoteEventForwarders.push(listener);
    return () => { const index = remoteEventForwarders.indexOf(listener); if (index >= 0) remoteEventForwarders.splice(index, 1); };
  },
});

const rpaFile = path.join(app.getPath("userData"), "rpa-recipes.json");

const taskListFile = path.join(app.getPath("userData"), "task-list.json");

setRpaStore(new RpaStore(rpaFile, taskListFile));

setMemoryStore(new MemoryStore(memoryFile));

setMemoryLayers(new MemoryLayers(app.getPath("userData")));

// 自动捕获的出口接到 L2 日志层：从此对话原文不再进检索池
memoryStore.setLayers(memoryLayers);

/** 主进程内部会话（记忆蒸馏等）：其事件不参与记忆捕获与远程转发，否则蒸馏输出会被当成对话写回日志。
 *  ⛔ 容器已下沉 electron/runtime-refs.ts（2026-09-24 断环收尾：main/03-turn-summary.ts 要用它）。 */

const scheduler = new Scheduler(scheduleFile, server, async () => {
  const model = await readCustomModel();
  return model ? { model: model.model, provider: model.provider, name: model.name, baseUrl: model.baseUrl } : null;
}, (message) => sendToWindow("harness:event", { type: "scheduler", message, at: Date.now() }));

/** 内置连接器模板：把官方/社区 MCP 服务的真实配置固化成可填表模板 */


const channelBot = new ChannelBotService(
  server,
  path.join(app.getPath("userData"), "channel-bindings.json"),
  async () => {
    const model = await readCustomModel();
    return model ? { provider: model.provider, name: model.name, model: model.model, baseUrl: model.baseUrl } : null;
  },
  (level, message) => {
    channelLogs.push({ at: Date.now(), level, message });
    if (channelLogs.length > 50) channelLogs.shift();
    sendToWindow("channel-bot:event", { level, message, at: Date.now(), status: channelBot.status() });
  },
);

// ---- 语音通话（旁挂新增：不改动任何既有输入链路） ----
// 模型放 userData 而非应用目录：重装应用不丢，与其它用户数据一致。
const voiceModelsRoot = path.join(app.getPath("userData"), "voice-models");

const voiceLogs: { at: number; level: "info" | "error"; message: string }[] = [];

const voiceService = new VoiceService({
  server,
  getModel: async () => {
    const model = await readCustomModel();
    return model ? { provider: model.provider, name: model.name, model: model.model, baseUrl: model.baseUrl } : null;
  },
  modelsRoot: voiceModelsRoot,
  userDataDir: app.getPath("userData"),
  log: (level, message) => {
    voiceLogs.push({ at: Date.now(), level, message });
    if (voiceLogs.length > 50) voiceLogs.shift();
    if (level === "error") console.error(`[voice] ${message}`);
  },
  emit: (event) => sendToWindow("voice:event", event),
});

// 09-13：下线的内置音色预设（台湾腔·小美 / AI管家·贾维斯风）——把它们在用户档案里
// 已创建的同名克隆档案一并清掉，否则「内置音色」列表没了、
// 「我的音色」里还挂着两个来源不明的条目。
void (async () => {
  const removed = ["台湾腔 · 小美", "AI 管家 · 贾维斯风"];
  try {
    for (const profile of await voiceProfiles.listProfiles(app.getPath("userData"))) {
      if (removed.includes(profile.name)) {
        await voiceProfiles.deleteProfile(app.getPath("userData"), profile.id);
        console.log(`[voice] 已清理下线预设的音色档案：${profile.name}`);
      }
    }
  } catch { /* 清理失败不阻塞启动 */ }
})();

// ── 语音通话 IPC 面（39 个 handler）已按域拆到 features/voice-ipc.ts；仍在此处注册以保持时机不变 ──
registerVoiceIpc({ voiceService, voiceModelsRoot });



/**
 * 为当前供应商的所有模型生成 model_catalog.json。
 *
 * 背景：Codex 引擎对「不在内置目录里的自定义模型」会用 fallback 元数据（上下文 ~121K）。
 * 引擎支持 model_catalog_json 指向一个自定义模型目录 JSON，加载后引擎认识这些模型
 * （实测 0.150.1 接受精简格式，Unknown model 警告消失）。
 *
 * ⛔ 09-16 修正（用户实测「模型上下文只生效默认那个」后查清）：顶层 model_context_window
 * **一律不写**。它是引擎的**全局单值**，过去取「写配置那一刻的生效模型」的 contextWindow，
 * 而模型上下文是**每模型**的 → 顶层一落下就是全局覆盖：切到别的模型仍是旧值。
 * 探针实证（scripts/probe-context-window.cjs，mock API + 真实 app-server 跑真实 turn，
 * 读引擎自己写的 rollout 里上报的 model_context_window）：
 *   · 写顶层 128000：模型 A(128000)→128000、模型 B(1000000)→**128000**（被压掉）；
 *   · 不写顶层：  模型 A→128000、模型 B→**1000000**（引擎按当前模型取 catalog 的值）。
 * 故上下文只由 catalog 的每模型 context_window 决定（buildModelCatalog 已写入）。
 * 官方订阅走引擎内置模型目录，同样不需要顶层值。
 *
 * 这里为供应商下每个模型生成一条 catalog 记录，contextWindow 取模型自己的
 * contextWindow（缺省用供应商级 entry.contextWindow）。
 */
/* modelCatalogFile 已随 codexHome 一起进 runtime-paths（叶子模块，见文件头注释）。 */


/** 收集所有被历史会话引用过的 `model_provider` id。
 *  用途：这些 id 必须继续在 config.toml 里有段（否则旧会话 resume 报
 *  `failed to load configuration: Model provider \`X\` not found`），且必须指向当前生效供应商
 *  —— 见 applyCustomModel 里「旧会话永远走当前供应商」的实证说明。
 *
 *  ⛔ 09-16 修 Bug 8（口径要准确，别夸大）：旧实现**只**扫 `sessions/**\/*.jsonl` 首行取
 *  `model_provider`。两个真实缺陷：① 只覆盖 `sessions/`，**归档会话**（rollout 已移到
 *  `archived_sessions/`）一律漏掉；② 依赖 rollout 文件内容，文件被清理/迁移/损坏就静默返回空集
 *  （用户机上实测 4/4 线程的 rollout 全没了，而引擎索引里仍记着 `custom906`）。
 *  现在以引擎自己的线程索引为**权威源**（`thread/list` 的 `modelProvider`，含归档态、
 *  不解析任何文件内容），rollout 扫描降级为补充源（覆盖索引里已不存在的极老会话）。
 *  ⚠️ 这不解决「rollout 已经丢光」的会话：实测引擎会把 rollout 丢失的线程**从 `thread/list`
 *  隐藏**，所以那类会话任何来源都拿不到 provider id —— 它们本来也打不开
 *  （`thread/resume` 报 `no rollout found for thread id ...`），与 provider 段无关。
 *  结果缓存 60s，避免每次切换供应商都打一遍 RPC / 全盘扫描。 */
let sessionProviderIdsCache: { at: number; ids: Set<string> } | null = null;

/**
 * 记忆来源模式：local 只用本机 memory.json；cloud 走 TencentDB Gateway。
 * 这个开关必须落到主进程——真正决定 recall/capture 去哪儿的是 MemoryStore 有没有 remote。
 * ⛔ 路径常量 memoryModeFile 已下沉 electron/runtime-paths.ts（2026-09-24 断环收尾）。
 */



/** 独立会话弹窗：打开一个只显示指定会话对话区的新窗口（09-13）。
 *  样式与主窗口一致（hidden titleBar + overlay 43px + 同款图标），可拖出应用外；
 *  渲染层通过 URL query `?popout=<threadId>` 进入弹窗模式（只渲染对话区并锁定该会话）。
 *  主题/事件都走全局广播，弹窗无需额外维护。 */

// 无边框标题栏（Windows titleBarOverlay）的符号色：深色主题用浅符号，亮色主题近黑。
const CHROME_SYMBOL_DARK = "#e8e8e5";

const CHROME_SYMBOL_LIGHT = "#1b1b1a";

/** 应用当前主题（由 theme:apply 写入）。null = 渲染层还没告知过 ⇒ 退回跟随系统。 */
let appThemeDark: boolean | null = null;


/** 把主题应用到**所有**应用窗口的原生外观（窗口底色 + 标题栏控制钮符号色）。
 *  ⛔ 必须遍历全部窗口：独立会话窗口（popout）是另建的 BrowserWindow，只改 mainWindow
 *  会让它在深色模式下控制钮符号仍是近黑的 #1b1b1a，而顶栏也是深色 ⇒「看不见但能点」
 *  （09-21 用户实测）。日志打「已下发的符号色 + 覆盖窗口数」——⛔ Electron 本版**没有
 *  getTitleBarOverlay 读回接口**（写出来 TS 直接报 TS2551），所以真机是否可见只能看窗口右上角。 */
function applyWindowChrome(dark: boolean) {
  const symbol = dark ? CHROME_SYMBOL_DARK : CHROME_SYMBOL_LIGHT;
  const targets = allBusWindows().filter((win) => Boolean(win && !win.isDestroyed()));
  for (const win of targets) {
    try { win.setBackgroundColor(dark ? "#1b1b1a" : "#ffffff"); } catch { /* 窗口可能正在销毁 */ }
    try { win.setTitleBarOverlay({ color: "#00000000", symbolColor: symbol, height: 43 }); } catch { /* overlay 未启用（非 win32 等）时忽略 */ }
  }
  if (targets.length) console.log(`[theme] 窗口外观 → ${dark ? "dark" : "light"}；已给 ${targets.length} 个窗口下发标题栏符号色 ${symbol}`);
}

// 前端切主题时同步窗口外观：nativeTheme.themeSource 让系统标题栏与 Chromium 默认
// 滚动条跟随应用主题（不影响系统全局，只作用于本应用窗口）；同时更新窗口底色，
// 避免深色模式下「外边框/滚轮」残留浅色。
// ⛔ 多主题扩展点（09-24，主题清单见 src/lib/themes.ts）：这里只有"暗/不暗"二元 ——
//    新增非暗色系主题无需动这里；新增**暗色系**第三主题时，把判定换成注册表口径。
ipcMain.handle("theme:apply", (_event, theme: string) => {
  const dark = theme === "dark";
  appThemeDark = dark;
  setAppThemeDark(dark);
  nativeTheme.themeSource = dark ? "dark" : "light";
  applyWindowChrome(dark);
  return { ok: true };
});

// ── 单实例锁：防止启动两个应用前端（两份引擎 + 共享 codex-home 会互相打架） ──
// 第二个实例启动时 requestSingleInstanceLock 返回 false → 立即退出；
// 已运行实例收到 second-instance 事件 → 聚焦已有窗口（唤起）。
const gotSingleLock = app.requestSingleInstanceLock();

if (!gotSingleLock) {
  app.quit();
}

app.on("second-instance", () => {
  // 「显示主窗口」的唯一实现（不存在则建、最小化则还原、隐藏则显示再聚焦）——
  // ⛔ 托盘开启「关闭窗口时最小化到托盘」后窗口是 hidden 而非 destroyed，只管 focus() 会把用户晾在那儿。
  showMainWindow();
});

// ── 启动编排（app.whenReady 里那一大段）已按域拆到 features/boot.ts；仍在此处注册以保持时机不变 ──
app.whenReady().then(() => bootApp());

// ── 系统托盘（09-23 用户：「要在系统托盘里面常驻，系统托盘右键功能菜单齐全一下」）──
// 与 bootApp 分开注册：托盘是**可选**副作用，起不来（缺图标 / 平台限制）只打日志，不拖垮启动链。
// ⛔ 机内 no-op 兜底：`activeTurnCount` 用 engineActiveTurnIds 实时取，菜单每次弹出重建（见 electron/tray.ts）。
app.whenReady().then(() => {
  try {
    createAppTray({
      getMainWindow: () => mainWindow,
      showMainWindow,
      activeTurnCount: () => engineActiveTurnIds.size,
      userDataDir: () => app.getPath("userData"),
      logFilePath: engineDebugLogPath,
      readCloseToTray: closeToTrayEnabled,
      writeCloseToTray: (next) => {
        void saveAppSettings(app.getPath("userData"), { closeToTray: next }).catch(() => undefined);
      },
      // 退出前先把 closeConfirmed 置真：否则关窗守卫会把 quit 变成 hide，应用退不掉。
      quit: () => {
        mutableState.closeConfirmed = true;
        app.quit();
      },
    });
    console.log(`[tray] 系统托盘已创建（图标 ${trayIconPath()}；closeToTray=${closeToTrayEnabled()}）`);
  } catch (error) {
    console.warn("[tray] 托盘创建失败（不影响启动）：", error instanceof Error ? error.message : error);
  }
});

// IPC 域账本（架构改造进度可观测；纯日志，零行为影响）
console.log(`[ipc-registry] ${IPC_DOMAINS.length} 个 IPC 域，${domainsStillInMain().length} 个仍在 main.ts 待拆`);

/** 收集「能力选型」所需的环境观测值。
 *
 *  ⛔ 判据必须与**真实决策处同源**，不在这里另读一遍设置/插件（那正是本项目反复踩过的漂移）：
 *   · 总闸 → `devInstructionsInput()`（与 config.toml 写出、指令组装同一来源）
 *   · 视觉 env → `nuphusVisionEnv()`（与 config.toml 的 env 段同一来源） */

/** 「当前能力链路」：同一件事有多个后端时，现在实际走哪条、其余为什么没走。
 *  为什么需要这个入口：原先这些规则散在技能文案与代码注释里，用户只能看到零散的安装状态，
 *  出问题时无法回答"到底走的哪条"（对标 Agent-Reach 的 doctor 思路）。 */

/** 渲染层上报「当前正在查看哪个会话」：主进程据此只转发该会话的高频事件（P1）。 */
/** 当前窗口是否为独立会话弹窗：优先读登记表，URL query 兜底。 */
ipcMain.handle("window:popout-id", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return null;
  const registered = popoutThreadIds.get(win);
  if (registered) return registered;
  try {
    return new URL(win.webContents.getURL()).searchParams.get("popout") ?? null;
  } catch { return null; }
});

/** 所有独立会话弹窗锁定的会话 id 列表：主窗口据此在侧栏隐藏这些会话
 *  （避免主窗口与弹窗重复渲染同一会话，用户 09-13 明确要求）。
 *  读同步登记表（创建时立即写入），不受窗口 URL 加载时序影响。 */
ipcMain.handle("window:popout-list", () => {
  const ids: string[] = [];
  for (const [win, id] of popoutThreadIds) {
    if (!win.isDestroyed()) ids.push(id);
  }
  return ids;
});


/** 独立会话弹窗：按 threadId 打开一个新窗口（渲染层在顶栏/侧栏长按触发）。
 *  允许同时存在多个弹窗；主窗口关闭不会带走弹窗（window-all-closed 只在全部窗口
 *  关闭后触发，弹窗还开着时应用保持运行）。 */
ipcMain.handle("window:popout-thread", (_event, threadId: unknown) => {  const tid = threadId == null ? "" : String(threadId);
  if (!tid) throw new Error("缺少会话 ID");
  // 同一会话已弹窗 → 聚焦已有窗口，不重复开（避免开着开着冒出几十个）。读同步登记表。
  for (const [win, id] of popoutThreadIds) {
    if (!win.isDestroyed() && id === tid) { win.focus(); return { ok: true, focused: true }; }
  }
  createPopoutWindow(tid);
  return { ok: true };
});

/** 弹窗「返回主应用」：关闭该弹窗，并把主窗口带到指定会话（渲染层据此恢复视角）。 */
ipcMain.handle("window:popout-close", (event, threadId: unknown) => {
  const tid = threadId == null ? "" : String(threadId);
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && isPopoutWindow(win) && !win.isDestroyed()) win.close();
  // ⛔ 不在这里发 popout-return：win.close() 会触发 closed → notifyPopoutClosed
  // 统一发（含 popout-closed 解除侧栏隐藏），避免「返回按钮」路径重复 openThread。
  if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  return { ok: true };
});

// ── Codex 引擎在线更新（设置 → 控制台 → Codex 引擎更新） ──
/**
 * 重启台账（诊断）：返回最近的引擎重启记录 —— 每条含「谁触发的、当时是否有任务在跑、
 * 是立即执行还是推迟到任务结束后补做」。
 * ⛔ 存在理由：用户报「又莫名其妙断了」时，过去只能靠猜（图片自愈？改配置？引擎崩了？）。
 * 有了它就能一句话回答"是谁把任务打断的"，也能反过来证明闸门确实生效了。
 */
/** 当前活跃回合数（0 = 引擎可以安全重启）。验收与诊断都要靠它确认闸门拿到了真实计数。 */

// ── 内置插件：生图 + 视觉辅助（路径 builtinPluginsFile 已下沉 runtime-paths.ts）──

/** 把生图结果落盘到 `<userData>/images/`，返回本地绝对路径；失败返回 ""。
 *
 *  ⛔ 存在的理由（09-21 实测取证，不是预防性设计）：多数生图网关**不返回托管 url，只返回
 *  `b64_json`**。我们原来把它拼成 data URL 回给渲染层，渲染层再拼进工具返回文本 ——
 *  于是**单条工具输出 = 3.03 MB 的 base64 文本**（实测 `rollout` 里 base64 片段长 3,177,992
 *  字符），它进对话历史、并且**每一轮都被重发**。
 *
 *  与 `resources/tools/harness-media.mjs`（命令行那条路径）用**同一目录与命名**，
 *  避免出现第二套图片落点（它早就做对了：落盘 + 只回 path）。 */


/** 图片引用 → 上游能吃的形态：`http(s)` / `data:` 原样透传，本地路径读文件转 data URL。
 *
 *  ⛔ 为什么必须支持本地路径（不是可选增强）：**引擎消息里的图片就是本地文件路径**，
 *  模型照用法原样传过来时上游会 400「invalid image」。命令行那条路径
 *  （`resources/tools/harness-media.mjs` 的 vision 分支）早就这么做对了 —— 这里补齐，
 *  避免同一件事在两条路径上行为不一致（那是最难查的一类问题）。 */



// ── 中转站账户域（登录/多账户/余额/套餐/密钥/订阅支付）已按域拆到 features/relay-ipc.ts；仍在此处注册以保持时机不变 ──
registerRelayIpc({
  readCustomModels,
  readCustomModel,
  upsertCustomModel,
  customModelFile,
  describeNetworkError,
  server,
});

// ⚠️ 必须 await：`remote.start()` 是 async，不 await 时 port 是个 Promise 对象（渲染层拿到
// `{}`、二维码地址也可能在 token 生成前取），这正是 09-13 冒烟测试第一次跑就超时的原因。
// 配对码 + 审批（09-13 二次加固：手机首次连接 = 6 位配对码 + 电脑端点允许）
// ── Bot Channel 配对门卫（09-13：机器人聊天的首次使用 = 聊天里发 6 位授权码 + 电脑端点允许）──
// 与「手机远控」共用同一个 6 位码（电脑端只显示一个数字）；approved 持久化到 userData/bot-pairing.json
const botPairing = new BotPairingService(
  () => remote.pairingCode(),
  (request) => { try { mainWindow?.webContents.send("bot:pair-request", request); } catch { /* ignore */ } },
  (approved) => { void fs.writeFile(path.join(app.getPath("userData"), "bot-pairing.json"), JSON.stringify(approved, null, 2), "utf8").catch(() => undefined); },
);

try {
  const saved = JSON.parse(readFileSync(path.join(app.getPath("userData"), "bot-pairing.json"), "utf8")) as Record<string, unknown>;
  botPairing.restoreApproved(saved ?? {});
} catch { /* 首次运行无文件 */ }

// CloakBrowser 常驻助手：单个 node 进程托管指纹浏览器窗口（headed + humanize），
// stdin 逐行喂 URL；stdout 回传 JSON 事件（boot / launching / ready / opened / error / closed）。
let cloakProc: ReturnType<typeof spawn> | null = null;

const userSkillsDir = path.join(codexHome, "skills");

const skillsRegistryFile = path.join(codexHome, "skills-registry.json");

/** 给引擎动态工具用的轻量安装：**不重启引擎**（重启会杀掉正在跑的回合）——
 *  写目录 + 刷新注册表 + forceReload 重扫（下一回合即可用）+ 刷新 AGENTS 纪律区间。 */

/**
 * 解析 SKILL.md frontmatter 里的 allowed-tools 白名单。支持两种 YAML 写法：
 *   allowed-tools:
 *     - Read
 *     - Bash(git:*)
 * 或行内列表：allowed-tools: [Read, Bash]
 * 引擎不强制这个字段（引擎技能对象只有 enabled），这里仅解析展示用；不声明返回空数组。
 */

/** 只改文件名，不重启；批量操作由调用方统一重启一次，避免每个技能都拉起一次引擎 */
/**
 * 卸载技能：与安装对称——分批发出进度事件（校验 → 删除 → 清理登记 → 重启引擎 → 确认移除），
 * 让渲染层用安装同款进度弹窗呈现，结束时明确回报「引擎是否已不再发现该技能」。
 * 兼容旧调用：入参传字符串时按「文件夹名」处理。
 */
/**
 * 信任钩子：Codex 默认不执行未信任的钩子（装了等于没装）。
 * 信任记录写在 config.toml 的 [hooks.state."<hook key>"].trusted_hash，
 * 值与 hooks/list 返回的 currentHash 一致；写完后无需重启即可生效。
 */
/** 把 hook key 转义成能安全写进 TOML 点路径的形式（反斜杠与引号都要处理） */

/** 单条钩子的启停：状态在 config.toml 的 [hooks.state."<key>"] enabled */


/**
 * 联动开关：插件、它的全部钩子、它提供的全部技能一起开/关。
 * 用户要的是「钩子开关联动对应技能与插件」，这里把三处状态一次性对齐：
 *   1. config.toml 的 [plugins."<id>"] enabled
 *   2. 该插件每条钩子的 [hooks.state."<key>"] enabled
 *   3. 技能目录里带 .plugin.json（pluginId 相同）的 SKILL.md ↔ SKILL.md.disabled
 * 最后只重启一次引擎，避免每个技能重启一次导致界面长时间卡住。
 */

/**
 * 插件启用/停用：Codex 没有 plugin/enable 这类 RPC，开关状态存在
 * config.toml 的 [plugins."<id>"] enabled，通过 config/value/write 改写。
 * 支持批量，最后统一重新拉一次插件列表校验是否真的生效。
 */
// —— 连接器 OAuth 授权（跳转官方授权页，授权完成自动保存令牌并重启引擎） ——
type OAuthSession = {
  kind: ConnectorOAuthKind;
  child?: ReturnType<typeof spawn>;
  server?: http.Server;
  timer: NodeJS.Timeout;
  state: string;
};

const oauthSessions = new Map<string, OAuthSession>();

/** 本地回调服务器：接收授权页 redirect 回来的 code/state，返回成功提示页 */

/** Windows 下 npx 是 npx.cmd，spawn 必须用带扩展名的二进制名，否则 ENOENT；stdio 恒为 pipe，stdout 非空 */

/** 飞书：官方 lark-mcp login 子进程回显授权 URL；授权完成后进程以 0 退出并自行保存 token */





// 单个或批量启用/停用：ids 传一个等价单卡开关，传多个走批量勾选。每次改动都重启引擎使 config.toml 生效

// —— app-server MCP 服务器启停（页面上的「app-server MCP 状态」卡片用） ——
// 同一个入口同时处理两类服务器：名字能匹配到连接器的走 connectors.json，
// 其余（内置 nuphus 等）走覆盖表。渲染层因此不需要区分来源。
// 渲染层只需要 名字 -> 是否启用；原文（toml）是主进程恢复用的内部数据，不外泄

// —— MCP 服务器按工具权限（deny/ask/allow）——
// 复刻 WorkBuddy 工具级权限模型：对某个服务器的某个工具设/清权限档位。
// mode 传 "deny" | "ask" | "allow"；传 null 清除该工具规则。改动落覆盖表，
// 重写 config.toml（[permissions.*] 段）并重启引擎。未知服务器 id 直接忽略。
// 读接口返回 { server: { tool: mode } }，供渲染层展示每个工具的当前档位。

// —— 个性化：称呼 + 自定义指令。走 Codex 原生 AGENTS.md 机制（$CODEX_HOME/AGENTS.md），
// 引擎每个会话开始时自动注入 prompt；纯 Markdown 落盘，无 TOML 转义风险 ——
/** 首次见面引导保存（identity_onboard 工具的落点）：全维度写个性化档案
 *  （助手名/称呼/场景/职业/风格/语气/爱好/习惯 + onboarded=true），重建 AGENTS.md
 *  即时生效——刻意不重启引擎、不重写 config.toml（AGENTS.md 每新会话由引擎读取）。 */
/** 标记「身份引导已打过招呼」（09-12 用户反馈「怎么每次新会话都强制引导」）：
    第一次对话注入引导指令后调用一次，此后新会话不再引导、直接干活——
    与 `onboarded` 分开：那个表示用户**真的回答了**，这个只表示**问过一次**。 */

// 应用级运行时开关（联网搜索等）。改完重写 config.toml 让引擎重载生效。
// 外部模型规格规则（userData/model-specs.json）：数据与代码分离，更新模型数据无需重新构建。
// 文件不存在返回 null，渲染层用内置表兜底；更新 JSON 后重启应用生效。

// SSH 服务器连接管理：列表 CRUD + 启用开关 + 连接测试 + 命令执行 + 交互式会话（userData/ssh-servers.json）

// 交互式 shell 会话：一次 open 建立一个 ssh2 连接，数据/退出通过窗口事件推送给渲染层
// 导出连接配置：弹出保存对话框，支持「不含凭据」的安全导出
// ── 会话备份导入/导出：导出 = 引擎 rollout 原档 + 元信息打包成单文件 .json；
//    导入 = rollout 原样写回 codex-home/sessions，主进程扫描兜底立即可见，不依赖引擎索引。──
// 单会话只读全文预览（全局搜索「会话」命中点开）：直接读 rollout 原档渲染消息序列，不动引擎焦点
// 导入外部对话记录（主流 AI / 官方 Codex /export 导出的 .md/.txt 文本）→ 自动新建一个命名会话：
// 标题「导入：原会话名」带导入标识，会话本身留空（不自动跑）。渲染层在用户发出该会话第一条
// 消息时，把整段记录附在消息前发给引擎，并把界面折叠成一条可展开的「导入的会话记录」卡。
// 仅更新称呼（昵称）：只写 personalization.json + AGENTS.md，不重启引擎。// AGENTS.md 是 Codex 原生动态加载机制（每个请求都重新读），下次对话即生效，无需重启。
// 用于左下角账户名改名的轻量联动，避免打断正在进行的对话。
// 回读真实落盘的 AGENTS.md，确认个性化确实在引擎会读取的位置——避免「保存成功但没生效」
// emoji 基础段始终存在：AGENTS.md 永不删除，inSync = 落盘内容与 buildAgentsMd 逐字一致（无论个性化是否为空）

// —— 自定义斜杠命令：$CODEX_HOME/commands + <cwd>/.codex/commands 下的 .md 文件 ——
// 把命令模板展开成可直接发送的 prompt（参数替换 / @file 注入 / !`cmd` 转执行指令）

// —— 子智能体（用户自定义；跟随当前会话模型/effort，codex 通过 dynamicTools 真正调用）——
//    ⛔ 路径常量 subAgentsFile 已下沉 electron/runtime-paths.ts（2026-09-24 断环收尾）。

// —— 专家团（Team 型专家）：团队 CRUD + 成员调度（复用子智能体引擎） ——
/** 团队会话工具参数（供前端把 team_member_invoke 注册进 dynamicTools） */
/** 团队会话启动参数（thread/start 用的 system 注入 + dynamicTools） */
/** 一站式启动团队会话：建线程（带 team_member_invoke 工具）+ 发首条任务（注入团队系统提示）。
 *  defer=true 时只建带角色配置的空会话（标题=团队名）不发起回合：用户的第一条消息由前端
 *  发送管线自动包装成 SYSTEM TASK（渲染折叠为「需求已发起」），实现「点击即进对话框」的入口体验。 */
/** 成员直达会话：以成员角色提示开一个可持续对话的线程（用户与单个成员直接交流，不挂团队调度工具）。
 *  defer=true 时只建空会话（标题=团队名·成员名），用户首条消息由前端包装成 SYSTEM TASK 注入成员角色。 */
/** 调度一个团队成员在独立会话执行子任务并返回结构化结果（供 team_member_invoke 工具调用） */


/** 调度工具的统一执行入口（MCP /mcp 与 stdio /rpc 共用）——安全闸全部在这里。 */


/** 起一个「被调度的会话」并把任务跑完，返回它的最终产出。三类对象共用这一条链路。 */


/** 工具说明书：目录 + 用法（模型据此知道「有什么可调」——这是闭环的前提） */

/** 本会话要下发给 Codex 的调度提示词（开启开关时自动发的那条告知消息） */

/** 关闭开关时的告知消息（让 Codex 立刻知道权限被收回了） */

/** 全部「被调度的临时会话」——渲染层据此做注册侧过滤（L2）与侧栏标记 */

/** 某个会话调度出来的临时会话（任务完成后询问归档时用） */

/** 统一调度入口：kind 决定调谁 */

/** 归档被调度的临时会话（用户在 Codex 询问后确认 → Codex 调它） */

/** 把「粘贴进来的长文本」落盘成 .txt，返回绝对路径（09-18 用户：「复制的内容超过 200 字的时候
 *  把文本直接显示成一个 .txt 文件的方式」）。
 *
 *  为什么必须新增 IPC 而不是复用 `fs:write`：那个 handler **限定只能写工作区内**
 *  （`仅允许保存工作区内的文件`）—— 粘贴的文本是"用户的临时素材"，写进用户项目目录会污染仓库。
 *  落点放在应用自己的 userData（与 `imagesDir` 同层），随应用数据一起存在。
 *
 *  ⛔ 文件名按**内容哈希**去重：同一段文本粘两次得到同一个文件（幂等）。用时间戳命名会每粘一次
 *  就多一个文件、且历史消息里的引用各自指向不同副本（内容相同却看起来像两份）。
 *  ⛔ 文件**不自动清理**：消息里的 chip 点击要能打开它、模型也可能在后续回合里读它。 */
/** 目标路径是否落在应用自己的粘贴文本目录内。
 *  ⛔ 读/写这两个通道**必须**做这个校验：渲染层传来的路径不可信，不校验就等于给了渲染层
 *  一个"任意文件读写"的入口（粘贴文本目录是应用数据，用户自己的文件不该被这条链碰到）。 */
/** 读取粘贴文本（供输入框 chip 点击后的大窗口预览/编辑）。
 *  返回 `editable:false` 表示"这不是应用保存的粘贴文本" → 渲染层回退到普通文件预览，
 *  **不靠路径猜**（靠猜会把用户自己目录里同名的 .txt 也当可编辑，一保存就改了他的文件）。 */
/** 保存编辑后的粘贴文本。
 *  ⛔ **不改名**：文件名里的哈希表示"创建时的内容"，编辑后不重算 —— 重算就要改名，而已经发出
 *  的消息里引用的正是旧路径（改名即断链）。代价只是"同一段内容可能对应两个文件"，可接受。 */
// ⛔ `file:` 只在**工作区内的 .html** 上放行（09-13 审计 S5）：这条链是
// `shell.openExternal` = 交给系统默认程序执行 —— 放行任意 `file:` 意味着渲染层（它要渲染
// 模型输出 / 市场条目描述 / 内置浏览器里的网页）可以 `file:///C:/.../x.exe` 让系统去跑它。
// 本地预览只需要工作区里的 html，其余一律拒。
const filePreviewAllowed = (target: URL) => {
  if (target.protocol !== "file:") return false;
  let p = "";
  try { p = require("node:url").fileURLToPath(target); } catch { return false; }
  if (!/\.html?$/i.test(p)) return false;
  // 可信根 = 主进程自己记着的会话工作目录 + userData + **用户亲自用系统对话框选过的路径**
  // （后者是文件对话框返回值，渲染层伪造不出来 —— 所以不牺牲"我能自己选文件"的自由度）
  return isInsideTrustedRoots(p);
};

/**
 * 「用户亲自选过」的路径 = **可信来源**（09-13 审计 S5 的安全版修法，用户要求"别把口子焊死"）。
 * 为什么这样既安全又不憋屈：这些路径是**主进程自己弹的系统对话框**返回的，渲染层伪造不出来；
 * 而渲染层里跑着模型输出 / 内置浏览器网页 / 渠道消息，它们想凭空写 `C:\Windows\...` 是拿不到
 * 这条信任的。于是：工作区/userData（主进程记着的）+ 用户选过的路径 → 放行；其余一律拒。
 */





/** 欢迎页「无项目」会话的临时工作目录：每次调用在基础目录下新建一个独立子目录。
 *  09-22 收紧：**全平台一律 userData**（%APPDATA%\Codex Harness Desktop\scratch）。
 *  旧实现优先 exe 同级目录（当年便携安装的可写要求），但实测后果严重：开发模式落在
 *  dist/scratch —— 构建即清，会话记忆全丢；打包后在 Program Files 又只读。
 *  scratch 现在承载会话 cwd ⇒ 记忆/技能发现都跟着它走，必须持久。 */
// 协议桥状态：设置页展示「引擎的请求实际怎么走」（直通 / 转换），也是排查 chat-only 网关的依据。
/** 在同一供应商内切换生效模型：保留 models 列表，只改 model 字段 */
/** 全局互斥兜底：provider 成为唯一启用者后，其余启用中的供应商全部停用。
 *  save / set-enabled 原本就有；set-model（下拉跨供应商切换）与 select（直接选档案）
 *  同样会改变生效者——漏掉会出现「中转站登录后模型列表里其他供应商仍显示启用」。 */
/** 供应商→中转站反向联动的信号：任何供应商成为当前生效后广播给渲染层，
 *  渲染层据此清掉不再匹配的 relay-active（localStorage 在渲染层，主进程清不了）。 */
/** 思考等级档案持久化：写进 custom-model.json（models[].effort + 顶层 effort），
 *  并同步 config.toml 顶层 model_reasoning_effort（restart:false 不重启引擎——
 *  会话内显式档位由每轮 turn/start 的 effort 下发，config.toml 只做重启后的兜底默认）。
 *  与「模型自报」同步案同源：档案不写，切供应商/重装后档位就丢了。 */
/** 延迟生效：读取当前激活供应商并重启引擎使配置生效（供应商切换「重启生效」按钮用，幂等） */
/** 添加或更新供应商下的一个模型（按模型 ID 匹配）；新模型不自动生效 */
/** 从供应商的模型列表里删掉一个；允许删空，删的是当前模型时自动切到剩余模型 */
/** 启用/禁用供应商；禁用当前供应商时清空生效配置并重启 Codex */

// ── 退出统一清理：确保所有子进程/服务都被终止，应用「退得干净」 ──
// 覆盖：引擎(codex.exe)、node-pty 终端、CloakBrowser 助手、远程隧道+HTTP 服务、
// 频道机器人 HTTP、调度器、微信/Telegram 网关轮询。
let cleanupDone = false;

function cleanupAll() {
  if (cleanupDone) return;
  cleanupDone = true;
  // node-pty 终端：逐个 kill（intentionalKill 置位，不弹「进程已退出」）
  for (const terminal of terminals.values()) { try { terminal.kill(); } catch { /* 已退出 */ } }
  terminals.clear();
  // CloakBrowser 常驻助手
  try { cloakProc?.kill(); } catch { /* 已退出 */ }
  cloakProc = null;
  // 远程控制：隧道(cloudflared) + HTTP 服务
  remote.stop();
  // 频道机器人 HTTP 服务、调度器、引擎子进程
  void channelBot.stop();
  scheduler.stop();
  server.stop();
  // 微信/Telegram 网关：停止轮询循环
  weixinGateway?.stop();
  telegramGateway.stop();
}

app.on("window-all-closed", () => {
  // ⛔ mac 适配（09-17 审计）：macOS 上「关掉窗口」不等于「退出应用」——红点关窗后应用仍在 Dock 里，
  // 点 Dock 图标会走 activate → createWindow 重开窗口。这里若照 Windows 那样 cleanupAll()，
  // 引擎子进程 / 本地 HTTP 服务 / 调度器 / 渠道机器人全被停掉，重开的窗口就是**「窗口在、功能全哑」**
  // （发不出消息、调度不跑、手机端连不上），用户只能退出应用重新打开。mac 上保持服务存活，
  // 真正的清理交给 before-quit（那里也会调用 cleanupAll，cleanupDone 保证幂等）。
  if (process.platform === "darwin") return;
  cleanupAll();
  app.quit();
});

app.on("before-quit", () => {
  // ⛔ 退出已经开始：必须在这里把 closeConfirmed 置真 —— 否则开了「关闭窗口时最小化到托盘」时，
  //    关窗守卫会把这次 quit 变成 hide，应用**退不掉**（托盘「退出」/ Cmd+Q / 系统关机全中）。
  mutableState.closeConfirmed = true;
  // 托盘图标要显式销毁：Windows 上不销毁会残留到鼠标划过才消失。
  destroyAppTray();
  // 兜底：无论窗口事件如何，退出前都清理一次（幂等，cleanupDone 去重）
  cleanupAll();
  // SSH 会话持有 ssh2 连接，不主动断开会让退出流程挂住
  sshSessions.closeAll();
  // 挂断后保活的语音工作线程：退出时彻底销毁（否则 90s 内进程里还挂着两份 ONNX 模型）
  voiceService.disposeIdleWorkers();
});

app.on("activate", () => {
  // mac：点 Dock 图标 —— 窗口不存在就建；存在但被托盘藏起来了要**显示出来**（只 focus 看不见的窗口没用）。
  showMainWindow();
});

// ── 依赖注入给 features/boot.ts（必须在所有顶层声明之后调用：它按值取这些单例）──
bindBoot({
  codexHome, loadDeletedThreads, responsesBridge, userSkillsDir, ensureBuiltinReviewer, refreshSkillDiscipline, readCustomModel, server, isInsideTrustedRoots, placeholderPngResponse, createWindow, filterForRenderer, channelBot, voiceService, syncEngineWatchdog, eventThreadId, purgeDeletedThread, threadRuntimeStore, teamRunStore, delegateRegistry, dispatchProbes, stableKey, engineActiveTurnIds, botStreamSessions, stopWeixinTyping, botStreamPlanFor, botStreamFile, startWeixinTyping, captureBuffers, threadCwd, remoteEventForwarders, internalThreads, workspaceMemoryEnabled, memoryStore, memoryLayers, distillSummarize, resolveLiveProxy, connectorEnv, readConnectors, migrateLegacyRolloutHome, healRolloutLineage, readCustomModels, ensureDispatchHttp, writeModelCatalogToml, devInstructionsInput, ensureDispatchToken, applyMemoryMode, scheduler, remote,
  DISPATCH_FIXED_PORT, mcpOverrideEnabled, readMcpOverrides, escapeToml, applyCustomModel, readMemoryMode, autoInstallGitIfNeeded, healReservedProviderConfig, handleWeixinMessage, channelLogs, persistChannelLog, telegramGateway, feishuGateway, dingtalkGateway, qqGateway, wecomWebhookGateway, readChannelBot,
  setWeixinGateway,
  // dispatchToken 是 let 且运行时才赋值 ⇒ 必须给 getter（按值 bind 会拿到旧值）
  getDispatchToken: () => dispatchToken,
});

// ── 注入给 features/custom-model-probe.ts（放在文件末尾：所有声明之后）──
bindCustomModelProbe({ normalizeProvider, readOpenaiAuth, readCustomModel, fetchOpenaiModels, classifyProbeError });

// 供 features/ 取用（活绑定：main 里重新赋值也能读到）




// 供 features/ 取用（活绑定：main 里重新赋值也能读到）




/** 诊断计数快照（app:perf-counters 搬走后由 features/app-diagnostics.ts 取用）。 */




// 供 features/ 取用（活绑定：main 里重新赋值也能读到）


// 供 features/ 取用（活绑定：main 里重新赋值也能读到）


// 供 features/ 取用（活绑定：main 里重新赋值也能读到）




// ── 供 electron/features/** 读写的共享可变状态（09-21 架构改造：随按域拆分引入）──
// ⛔ 为什么用访问器对象而不是直接 export：ESM 里 `import` 进来的绑定**不可赋值**（TS2632）。
//    这些符号既要读也要写（计数器 / 子进程句柄 / 缓存），所以经 getter/setter 暴露；
//    main 侧现有代码一行未改。
export const mutableState = {
  get cloakProc() { return cloakProc; },
  set cloakProc(v: typeof cloakProc) { cloakProc = v; },
  get resumeCount() { return resumeCount; },
  set resumeCount(v: typeof resumeCount) { resumeCount = v; },
  get resumeEnrichMs() { return resumeEnrichMs; },
  set resumeEnrichMs(v: typeof resumeEnrichMs) { resumeEnrichMs = v; },
  get resumeMaxMs() { return resumeMaxMs; },
  set resumeMaxMs(v: typeof resumeMaxMs) { resumeMaxMs = v; },
  get resumeTotalMs() { return resumeTotalMs; },
  set resumeTotalMs(v: typeof resumeTotalMs) { resumeTotalMs = v; },
  get rolloutFallbackScanCount() { return rolloutFallbackScanCount; },
  set rolloutFallbackScanCount(v: typeof rolloutFallbackScanCount) { rolloutFallbackScanCount = v; },
  get threadListRequestCount() { return threadListRequestCount; },
  set threadListRequestCount(v: typeof threadListRequestCount) { threadListRequestCount = v; },
  get closeConfirmed() { return closeConfirmed; },
  set closeConfirmed(v: typeof closeConfirmed) { closeConfirmed = v; },
  get dispatchHttpPort() { return dispatchHttpPort; },
  set dispatchHttpPort(v: typeof dispatchHttpPort) { setDispatchHttpPort(v); },
  get dispatchHttpReady() { return dispatchHttpReady; },
  set dispatchHttpReady(v: typeof dispatchHttpReady) { setDispatchHttpReady(v); },
  get mainWindow() { return mainWindow; },
  set mainWindow(v: typeof mainWindow) { setMainWindow(v); },
  get sessionProviderIdsCache() { return sessionProviderIdsCache; },
  set sessionProviderIdsCache(v: typeof sessionProviderIdsCache) { sessionProviderIdsCache = v; },
};

// ── 09-22 架构改造 A 前置：聚合导出集中到文件末尾（纯搬移；export 位置与求值顺序无关）──
// 动机：它们原先交错在顶层声明之间，机械删定义时会被「定义体切片」连带吃掉。
export { decryptSecret } from "./main/07-connectors-io";
export { readStoredChannelBot } from "./main/08-channel-bot-io";
export { botPairing, botStreamFile, botsFile, channelBot, channelBotBindings, channelBotFile, channelLogs, dingtalkGateway, feishuGateway, loadBotBindings, qqGateway, qrSvg, readChannelBot, remote, server, telegramBindings, telegramGateway, wecomWebhookGateway, weixinBindings, weixinGateway, writeBotBindings };
export { bridgeDial, buildDispatchCatalog, codexHome, delegateRegistry, readCustomModel, restrictedThreadRole, runDelegatedTask, teamRunStore, threadCwd, turnOutputText, waitForTurnCompletion };
export { engineActiveTurnIds, mainWindow, responsesBridge, threadRuntimeStore };
export { applyCustomModel, builtinPluginsFile, describeNetworkError, dirEntries, refreshSkillDiscipline, skillsRegistryFile, userSkillsDir };
export { enrichScanCountSnapshot };
export { connectorEnv, connectorsFile, mcpOverrideEnabled, oauthSessions, readConnectors, readMcpOverrides };
export { customModelFile, customModelsFile, normalizeProvider, normalizeUpstreamProtocol, readCustomModels, upsertCustomModel, writeCustomModels };
export { filePreviewAllowed, fileStat, pastedTextDir, sshSessions, syncEngineWatchdog, terminals };
export { devInstructionsInput };
export { applyMemoryMode, distillSummarize, memoryGatewayFile, memoryLayers, memoryStore, memoryWorkspaceFile, readMemoryMode, rpaStore, scheduler, workspaceMemoryEnabled };
export { collectSessionProviderIds, connectorToml, dispatchHttpPort, dispatchToken, ensureDispatchHttp, escapeToml, mcpToolRulesOf, readUserConfigSplit, writeModelCatalogToml };
export { notifyPopoutClosed, popoutThreadIds, titleBarOverlayOptions };
export { DISPATCH_FIXED_PORT, dispatchMcpTools, dispatchProbes, ensureDispatchToken, stableKey };
export { appSourceRoot, voiceService };
export { botStreamSessions, channelLog, channelThreadChat, qqReplyContexts };
export type { StoredChannelBot, StoredMemoryGateway } from "./main/08-channel-bot-io";
export { readSubAgents, writeSubAgents, readBuiltinPlugins } from "./main/09-agents-plugins";
export type { SubAgentConfig, BuiltinPluginConfig } from "./main/09-agents-plugins";
export { safeConnectorId } from "./main/07-connectors-io";
export { writeMcpOverrides } from "./main/06-mcp-overrides";
export type { ConnectorConfig, ConnectorTransport } from "./main/07-connectors-io";
export type { McpOverrides } from "./main/06-mcp-overrides";
export { readMemoryGateway } from "./main/08-channel-bot-io";
export { readWorkspaceMemorySettings } from "./main/05-memory-mode";
export type { MemoryMode } from "./main/05-memory-mode";
export { installContextMenu } from "./main/10-window-menu";
