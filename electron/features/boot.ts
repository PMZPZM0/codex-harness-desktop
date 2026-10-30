/**
 * 启动编排（原先内联在 main.ts 的 `app.whenReady().then(async () => {...})`，452 行）。
 *
 * 09-21 架构改造：整块搬出，**块体逐字未改**（缩进也一致 —— 首行与 `export async function` 同构）。
 * 块内引用的 main 顶层单例/函数走 bindBoot() 注入（boot.ts 里同名声明 ⇒ 调用处一字不改）。
 * ⛔ 唯一改写：块内对 `weixinGateway`（声明在块之后、main 侧另有 18 处引用）的赋值改成
 *    局部常量 + setWeixinGateway() 写回 —— 语义等价，且 main 侧引用点零改动。
 */
import { app, BrowserWindow, dialog, ipcMain, shell, protocol } from "electron";
import fs from "node:fs/promises";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import os from "node:os";
import { WeixinGateway } from "../weixin-gateway";
import { markBoot } from "../boot-timing";
import { reasoningItemText } from "../reasoning-text";
import { clearGrants } from "./data-access-ipc";
import { gcSessionWorkspaces, removeSessionWorkspace, setSessionWorkspaceState } from "./session-workspace";
import { clearSessionPrivateMemory } from "../memory-fabric";
import { debugMemoryCapture } from "../memory-capture-debug";
import { bossMemoryWorkspace, isBossSession } from "../boss-groups/session-registry";
import { healEngineInstall } from "../engine-install-heal";
import { debugTurnFiles } from "../debug/turn-files-debug";
import { noteEngineEvent } from "./task-monitor";
import { sendToWindow } from "./window-bus";
import { getMusicStream } from "../music-streams";
import { dropStoredReports, emitTurnFileChanges, setTurnFileWatchBroadcast, setTurnFileWatchDiag, setTurnFileWatchStore, settleTurnByTurnId, snapshotTurnWorkspace, storedReportsForThread } from "../turn-file-watch";
import { dropStoredCompactions, loadCompactionStore, setCompactionWatchDirs, watchTurnCompleted } from "../compaction-watch";

import { SKETCH_SCHEME, sketchResponse } from "../sketch-protocol";
import { BotStreamSession, readBotStreamSettingsSync } from "../bot-stream";
import { ensureBuiltinSkills, ensureEgoBrowserSkill, ensureExpertSkillsMarketplace } from "../builtin-skills";
import { syncLocalMemoryConnector } from "../memory-mcp-connector";
import { developerInstructionsLine } from "../developer-instructions";
import { normalizeAutoCompactRatio, readAppSettings, readAppSettingsSync, saveAppSettings } from "../app-settings";
import { backupTurnIfEnabled as backupTurnIfEnabledImpl, normalizeBackupDir } from "./change-backup";
import { broadcastCodexEvent, broadcastHarnessEvent } from "./window-bus";
import { handleRoleMemoryToolCall } from "../role-memory-tool";
import { handleOpenfilmToolCall } from "../openfilm/tools";
import { handleMcpToolCall } from "../mcp-bridge";
import { handleDelegateHarnessToolCall } from "../delegate-harness-tool";
import { handleTeamToolCall } from "../team-tool-fallback";
import { isThreadDelivered } from "./renderer-fuse";
import { settleBackgroundRunsOnTurnEnd } from "../delegation/delegate-settle";
import { isTurnEndMethod } from "../turn-end";
import { forgetRoleSession } from "../role-memory";
import { sweepFabric, pickWorkspacesToSweep, archiveSessionMemory } from "../memory-fabric";
import { applyPersonalizationToAgentsMd, migrateGreetedForExistingUsers, readPersonalization } from "../personalization";

import { repairSkillBomScan } from "../skills-market";
import { migrateBuiltinPluginSecrets, builtinPluginEnv, readBuiltinPlugins } from "../main/09-agents-plugins";
import { applyProcessPath, augmentedPath, existingToolPath, toolsRoot } from "../toolchain";
import { ensurePonytailPlugin } from "../ponytail-plugin";
import { healPonytailInstall } from "../ponytail-heal";
import { getPonytailMode } from "../conventions/ponytail-mode";
import { net, safeStorage, session } from "electron";
import { pathToFileURL } from "node:url";
import { startWalCheckpointWatch, trimEngineLogs } from "../sqlite-wal";
import { petAssetRoots, readPetSettings } from "./pet-ipc";
import { feedPetEvent } from "./pet-state";
import { applyPetSettings } from "./pet-window";

// ── 由 main.ts 注入的顶层依赖（同名声明 ⇒ 块体保持逐字不变）──
let codexHome!: any;
let loadDeletedThreads!: any;
let deletedThreadIds!: any;
let responsesBridge!: any;
let userSkillsDir!: any;
let refreshSkillDiscipline!: any;
let readCustomModel!: any;
let server!: any;
let placeholderPngResponse!: any;
let createWindow!: any;
let filterForRenderer!: any;
let channelBot!: any;
let voiceService!: any;
let syncEngineWatchdog!: any;
let eventThreadId!: any;
let purgeDeletedThread!: any;
let threadRuntimeStore!: any;
let teamRunStore!: any;
let delegateRegistry!: any;
let dispatchProbes!: any;
let stableKey!: any;
let engineActiveTurnIds!: any;
let botStreamSessions!: any;
let stopWeixinTyping!: any;
let botStreamPlanFor!: any;
let botStreamFile!: any;
let startWeixinTyping!: any;
let captureBuffers!: any;

/**
 * 回合 id 的**宽容取法**（与 boot 内 engineActiveTurnIds 那处同一口径，:359）：
 * ⛔ 09-22 实测 turn/completed 的 id 在 `params.turn.id` —— 写端曾用 `p.turnId` ⇒ 两端 key 对不上
 *    （`tid:undefined` vs `tid:null`）⇒ buffer 永远取不到、assistant 也累积不到 ⇒ 整条捕获链静默断掉。
 */
function turnIdOf(params: any): string {
  return String(params?.turn?.id ?? params?.turnId ?? params?.id ?? "");
}

/**
 * 回合收尾落「改动备份」（10-13）。
 *
 * ⛔ **阶梯第 2 级「本仓已有吗」**：`turn-file-watch` 已经把工作区走完并算出这回合改了哪些
 *   文件（带 additions/deletions，跑过 IGNORE 表与 4000 全局 / 600 单目录两级预算），
 *   这里**只搬运不重算** —— 自己再写一遍遍历就是两处真相源，且忽略规则必然与它漂移。
 * ⛔ 开关关闭 ⇒ 直接返回、一行不落盘（用户没主动开之前不该产生任何产物）。
 * ⛔ 内部线程（记忆蒸馏等）不备份：那不是用户的代码，备份它只会污染回看列表。
 * ⛔ 永不抛：磁盘满/路径失效只记日志（旁路能力，打断回合才是真损失）。
 */
function backupTurnIfEnabled(threadId: string, turnId: string): Promise<unknown> {
  return backupTurnIfEnabledImpl(threadId, turnId, {
    filesForTurn: (tid, rid) => {
      // ⚠️ emitTurnFileChanges 会清掉快照；这里紧接着读，取的是**同一批**文件条目。
      // 取不到就退成该会话最后一个回合的报告（引擎形态差异时 turnId 可能对不上）。
      const reports = storedReportsForThread(tid);
      const hit = reports.find((r) => r.turnId === rid) ?? reports[reports.length - 1];
      return (hit?.files ?? []) as any[];
    },
    readSettings: () => {
      const settings = readAppSettingsSync(app.getPath("userData"));
      return {
        enabled: Boolean(settings.changeBackupEnabled),
        dir: normalizeBackupDir(settings.changeBackupDir).dir,
      };
    },
    // ⛔ 容量裁剪要把最旧的备份**移进回收站**（10-13 用户令「最大 3G，超了删除旧的放回收站」）——
    //   备份是用户代码的唯一副本，直接 rm = 不可恢复地删掉别人写的东西。
    //   `shell.trashItem` 只有主进程有 ⇒ 在这里注入；change-backup 本模块不 import electron，
    //   因此仍能被纯 Node 环境真跑测试（守卫 12i 依赖这一点）。
    trash: async (target: string) => {
      try {
        await shell.trashItem(target);
        return true;
      } catch {
        return false;   // ⛔ 失败就**保留**那份，绝不退化成硬删
      }
    },
  });
}

/**
 * 记忆捕获：取该回合的 buffer 并移除。
 * ⛔ 精确 key（threadId:turnId）取不到时按 threadId 前缀兜底 —— 09-22 实测捕获链静默断掉
 *    （L2 一条没写），而 item/started 与 turn/completed 的 turnId 字段名/有无并不一致，
 *    只要两端对不上，buffer 就永远取不到、assistant 也累积不了 ⇒ 整个回合被静默跳过。
 */
function takeCaptureBuffer(threadId: string, turnId: unknown): { buffer?: { user: string; assistant: string; cwd?: string }; via: string } {
  const exact = `${threadId}:${turnId}`;
  const hit = captureBuffers.get(exact);
  if (hit) { captureBuffers.delete(exact); return { buffer: hit, via: "exact" }; }
  const fallbackKey = [...captureBuffers.keys()].find((k: string) => k.startsWith(`${threadId}:`));
  if (fallbackKey) { const buf = captureBuffers.get(fallbackKey); captureBuffers.delete(fallbackKey); return { buffer: buf, via: "thread-fallback" }; }
  return { via: "none" };
}

/** 只读地取当前回合 buffer（delta / item/completed 累积文本用），同样带 threadId 兜底 */
function peekCaptureBuffer(threadId: string, turnId: unknown) {
  return captureBuffers.get(`${threadId}:${turnId}`) ?? captureBuffers.get([...captureBuffers.keys()].find((k: string) => k.startsWith(`${threadId}:`)) ?? "");
}
let threadCwd!: any;
let remoteEventForwarders!: any;
/** 已经流式发过思考摘要的**条目**（`threadId:turnId:itemId`）：完整条目兜底时跳过，免得出现两遍。
 *  ⛔ 必须到条目粒度：一个回合里模型常有多段思考，按回合记会把后一段（未流式的）整段误跳过。 */
const remoteThinkStreamed = new Set<string>();
/* 回合结束的「错误/已停止」只给手机发一次：aborted 与 completed 两种事件形态可能都到（10-31 实测） */
const remoteTurnEndNotified = new Set<string>();

/** 文件变更：逐文件一行（最多 5 行，与桌面文件卡同口径：+N −M / 已删除） */
function remoteFilesText(files: any[]): string {
  const list = files.filter((file) => file && file.path);
  if (!list.length) return "";
  const lines = list.slice(0, 5).map((file) => {
    if (file.status === "deleted") return `${file.path} 已删除`;
    const badge = file.status === "added" ? "新建 " : "";
    return `${badge}${file.path} +${Number(file.added) || 0} −${Number(file.deleted) || 0}`;
  });
  if (list.length > 5) lines.push(`等 ${list.length} 个文件`);
  return `修改文件 · ${list.length} 个\n` + lines.join("\n");
}

/** 询问 / 审批压成手机端可点的卡片数据（引擎原生请求与 agent_ask 两种来源） */
function remoteAskOf(method: string, params: any, event: any): { kind: string; requestId?: string; questionId?: string; question: string; options: { label: string; description?: string }[]; text: string } | null {
  if (method === "item/tool/call") {
    const args = params?.arguments ?? {};
    const options = (Array.isArray(args.options) ? args.options : []).map((option: any) => ({ label: String(option ?? "") })).filter((option: any) => option.label).slice(0, 8);
    const question = String(args.question ?? "请选择：");
    if (!options.length) return null;
    return { kind: "agentAsk", question, options, text: `❓ ${question}` };
  }
  // ⛔ 权限请求的回包形状是 `{ permissions: {}, scope: "turn" }`（不是 decision）⇒ 手机上不给按钮，
  //    回落「去电脑端确认」，免得点出一个形状不对的回包。
  if (method.includes("permissions")) return null;
  if (method === "item/tool/requestUserInput") {
    const questions = Array.isArray(params?.questions) ? params.questions : [];
    // 多问题形态手机上给不全（answers 要按 question id 全填）⇒ 回落提示，别只答一半
    if (questions.length !== 1) return null;
    const first = questions[0];
    const options = (Array.isArray(first?.options) ? first.options : [])
      .map((option: any) => ({ label: String(option?.label ?? ""), description: String(option?.description ?? "") }))
      .filter((option: any) => option.label)
      .slice(0, 8);
    if (!options.length) return null;
    const question = String(first?.question ?? first?.header ?? "请选择");
    return { kind: "userInput", requestId: String(event?.id ?? ""), questionId: String(first?.id ?? ""), question, options, text: `❓ ${question}` };
  }
  const isFile = method.includes("fileChange");
  return {
    kind: "approval",
    requestId: String(event?.id ?? ""),
    question: isFile ? "允许修改这些文件吗？" : "允许执行这条命令吗？",
    options: [{ label: "允许" }, { label: "拒绝" }],
    text: `❓ ${isFile ? "文件修改" : "命令执行"}需要确认`,
  };
}

function remoteThinkKey(p: any): string {
  return `${p?.threadId ?? ""}:${turnIdOf(p)}:${String(p?.itemId ?? p?.item?.id ?? "")}`;
}

/** 回合收尾时清掉这个回合的思考去重记录（中断的回合没有 item/completed） */
function dropRemoteThinkKeys(threadId: string, turnId: string): void {
  const prefix = `${threadId}:${turnId}:`;
  for (const key of remoteThinkStreamed) if (key.startsWith(prefix)) remoteThinkStreamed.delete(key);
}

/** 把引擎 item 压成手机端能看懂的一行步骤（返回空串 = 这一步不上报）。 */
function remoteStepOf(item: any, phase: "started" | "completed"): string {
  const type = String(item?.type ?? "");
  if (phase === "completed") return "";
  if (type === "commandExecution") {
    const cmd = String(item?.command ?? "").replace(/\s+/g, " ").trim();
    return cmd ? `命令 · ${cmd.slice(0, 60)}` : "命令";
  }
  // 文件变更不在这里报：引擎的 fileChange 不带行数，改由宿主追踪器的 live 报告（kind:"files"）
  if (type === "mcpToolCall" || type === "dynamicToolCall" || type === "functionCall") {
    /* 与桌面工具卡同口径：带 server 前缀 + 参数摘要（截断），手机端至少能看出「调了什么、传了什么」 */
    const server = String(item?.server ?? "").slice(0, 24);
    const tool = String(item?.tool ?? item?.name ?? "工具").slice(0, 48);
    let args = "";
    try {
      if (item?.arguments) args = JSON.stringify(item.arguments).replace(/\s+/g, " ").slice(0, 80);
    } catch { args = ""; }
    return `工具 · ${server ? `${server}/` : ""}${tool}${args ? ` ${args}` : ""}`;
  }
  if (type === "webSearch") {
    const query = String(item?.query ?? "").slice(0, 40);
    return query ? `搜索 · ${query}` : "搜索";
  }
  // 思考不在这里报一行标签：它有自己的摘要流（kind:"think"），内容实时可见
  return "";
}
let internalThreads!: any;
let workspaceMemoryEnabled!: any;
let memoryStore!: any;
let memoryLayers!: any;
let distillSummarize!: any;
let resolveLiveProxy!: any;
let connectorEnv!: any;
let readConnectors!: any;
let migrateLegacyRolloutHome!: any;
let healRolloutLineage!: any;
let readCustomModels!: any;
let ensureDispatchHttp!: any;
let writeModelCatalogToml!: any;
let devInstructionsInput!: any;
let ensureDispatchToken!: any;
let getDispatchToken!: any;
let applyMemoryMode!: any;
let scheduler!: any;
let remote!: any;
let DISPATCH_FIXED_PORT!: any;
let mcpOverrideEnabled!: any;
let readMcpOverrides!: any;
let escapeToml!: any;
let applyCustomModel!: any;
let readMemoryMode!: any;
let autoInstallGitIfNeeded!: any;
let healReservedProviderConfig!: any;
let handleWeixinMessage!: any;
let channelLogs!: any;
let persistChannelLog!: any;
let telegramGateway!: any;
let feishuGateway!: any;
let dingtalkGateway!: any;
let qqGateway!: any;
let wecomWebhookGateway!: any;
let readChannelBot!: any;
let setWeixinGateway!: (g: any) => void;

/** 启动前自愈 model-catalog.json（10-24 用户报「启动不了：model-catalog.json EOF」）：
 *  写 catalog 是非原子写，进程被强杀时可能留下空文件；而引擎按 config.toml 的
 *  model_catalog_json 指向启动，读到空文件整份拒载（用户看到的就是那串 raw 报错）。
 *  这里赶在 server.start 之前：有自定义模型 → 原子重写；没模型/写不出 → 删坏文件 +
 *  摘掉 config 引用；修复动作写一条 app-settings 回执，渲染层读一次弹成可见提醒。 */
async function healModelCatalogBeforeStart(custom: any) {
  const catalogPath = path.join(codexHome, "model-catalog.json");
  let broken = false;
  try {
    const raw = await fs.readFile(catalogPath, "utf8");
    if (!raw.trim()) broken = true;
    else JSON.parse(raw);
  } catch (error: any) {
    if (error?.code !== "ENOENT") broken = true;
  }
  const noteRepair = async (detail: string): Promise<void> => {
    try {
      await saveAppSettings(app.getPath("userData"), {
        modelCatalogRepairNotice: `检测到模型目录文件损坏，已自动修复（${detail}）。若模型列表仍异常，请到「设置 → 模型」重新选择一次。`,
      });
    } catch { /* 提醒写不进不影响启动 */ }
  };
  if (custom) {
    if (broken) {
      const bad = `${catalogPath}.bad-${Date.now()}`;
      await fs.rename(catalogPath, bad).catch(async () => { await fs.rm(catalogPath, { force: true }).catch(() => undefined); });
      await noteRepair(`原文件已备份为 ${path.basename(bad)}`);
      console.warn(`[boot] model-catalog.json 损坏，已备份为 ${bad} 并按当前供应商重写`);
    }
    await writeModelCatalogToml(custom);
    return;
  }
  // 没配自定义模型：config.toml 不应再引用 catalog —— 引用着坏/丢文件 = 引擎整份拒载。
  const cfgText = await fs.readFile(path.join(codexHome, "config.toml"), "utf8").catch(() => "");
  const referenced = /model_catalog_json\s*=/.test(cfgText);
  if (!broken && !referenced) return;
  await fs.rm(catalogPath, { force: true }).catch(() => undefined);
  const cleaned = cfgText.replace(/^\s*model_catalog_json\s*=\s*.*(?:\r?\n)?/gm, "");
  if (cleaned !== cfgText) await fs.writeFile(path.join(codexHome, "config.toml"), cleaned, "utf8");
  if (broken || referenced) {
    await noteRepair("config.toml 里的引用已一并摘除");
    console.warn("[boot] model-catalog.json 缺失/损坏且无自定义模型，已摘除 config 引用");
  }
}

export function bindBoot(deps: Record<string, any>) {
  setWeixinGateway = deps.setWeixinGateway;
  DISPATCH_FIXED_PORT = deps.DISPATCH_FIXED_PORT;
  mcpOverrideEnabled = deps.mcpOverrideEnabled;
  readMcpOverrides = deps.readMcpOverrides;
  escapeToml = deps.escapeToml;
  applyCustomModel = deps.applyCustomModel;
  readMemoryMode = deps.readMemoryMode;
  autoInstallGitIfNeeded = deps.autoInstallGitIfNeeded;
  healReservedProviderConfig = deps.healReservedProviderConfig;
  handleWeixinMessage = deps.handleWeixinMessage;
  channelLogs = deps.channelLogs;
  persistChannelLog = deps.persistChannelLog;
  telegramGateway = deps.telegramGateway;
  feishuGateway = deps.feishuGateway;
  dingtalkGateway = deps.dingtalkGateway;
  qqGateway = deps.qqGateway;
  wecomWebhookGateway = deps.wecomWebhookGateway;
  readChannelBot = deps.readChannelBot;
  codexHome = deps.codexHome;
  loadDeletedThreads = deps.loadDeletedThreads;
  deletedThreadIds = deps.deletedThreadIds;
  responsesBridge = deps.responsesBridge;
  userSkillsDir = deps.userSkillsDir;
  refreshSkillDiscipline = deps.refreshSkillDiscipline;
  readCustomModel = deps.readCustomModel;
  server = deps.server;
  placeholderPngResponse = deps.placeholderPngResponse;
  createWindow = deps.createWindow;
  filterForRenderer = deps.filterForRenderer;
  channelBot = deps.channelBot;
  voiceService = deps.voiceService;
  syncEngineWatchdog = deps.syncEngineWatchdog;
  eventThreadId = deps.eventThreadId;
  purgeDeletedThread = deps.purgeDeletedThread;
  threadRuntimeStore = deps.threadRuntimeStore;
  teamRunStore = deps.teamRunStore;
  delegateRegistry = deps.delegateRegistry;
  dispatchProbes = deps.dispatchProbes;
  stableKey = deps.stableKey;
  engineActiveTurnIds = deps.engineActiveTurnIds;
  botStreamSessions = deps.botStreamSessions;
  stopWeixinTyping = deps.stopWeixinTyping;
  botStreamPlanFor = deps.botStreamPlanFor;
  botStreamFile = deps.botStreamFile;
  startWeixinTyping = deps.startWeixinTyping;
  captureBuffers = deps.captureBuffers;
  threadCwd = deps.threadCwd;
  remoteEventForwarders = deps.remoteEventForwarders;
  internalThreads = deps.internalThreads;
  workspaceMemoryEnabled = deps.workspaceMemoryEnabled;
  memoryStore = deps.memoryStore;
  memoryLayers = deps.memoryLayers;
  distillSummarize = deps.distillSummarize;
  resolveLiveProxy = deps.resolveLiveProxy;
  connectorEnv = deps.connectorEnv;
  readConnectors = deps.readConnectors;
  migrateLegacyRolloutHome = deps.migrateLegacyRolloutHome;
  healRolloutLineage = deps.healRolloutLineage;
  readCustomModels = deps.readCustomModels;
  ensureDispatchHttp = deps.ensureDispatchHttp;
  writeModelCatalogToml = deps.writeModelCatalogToml;
  devInstructionsInput = deps.devInstructionsInput;
  ensureDispatchToken = deps.ensureDispatchToken;
  getDispatchToken = deps.getDispatchToken;
  applyMemoryMode = deps.applyMemoryMode;
  scheduler = deps.scheduler;
  remote = deps.remote;
}

setTurnFileWatchBroadcast((payload: any) => {
  sendToWindow("harness:event", payload);
  // 手机端「运行步骤」里的文件变更：引擎的 fileChange 不带行数，只有宿主追踪器有 ±N
  if (payload?.type === "turn-file-changes-live" && payload.threadId && Array.isArray(payload.files)) {
    const text = remoteFilesText(payload.files);
    // data 带结构化清单：运行中「查看改动」用它（落盘报告要回合结束才写，拿它会是上一轮的）
    const files = payload.files.map((file: any) => ({
      path: String(file?.path ?? ""),
      status: String(file?.status ?? ""),
      added: Number(file?.added) || 0,
      deleted: Number(file?.deleted) || 0,
    }));
    if (text) for (const forward of remoteEventForwarders) forward({ threadId: String(payload.threadId), kind: "files", text, data: { files } });
  }
});

export async function bootApp() {
  markBoot("app-ready");   // 启动耗时测量（见 electron/boot-timing.ts）
  /* ⛔ 第一件事：把增强 PATH 写回本进程（mac GUI 只有系统目录，继承环境的子进程找不到工具）。
     为什么需要、为什么只做一次、为什么放这里 —— 见 toolchain.applyProcessPath 的完整说明。 */
  applyProcessPath();
  await fs.mkdir(codexHome, { recursive: true });
  // 回合文件变更报告的落盘目录（10-06 夜二改：重启后「已更改 N 个文件」卡与冻结编辑行还在）。
  // ⛔ 必须在这个时点求值（app.setPath("userData") 之后）；模块顶层 import 期求值会静默漂移。
  setTurnFileWatchStore(path.join(app.getPath("userData"), "turn-file-changes"));
  // 追踪链诊断落盘（10-07，mac「已编辑文件不展示」排查）：静默跳过点写 userData/turn-files-diag.log。
  setTurnFileWatchDiag(debugTurnFiles);
  // 压缩侦测的落盘目录 + rollout 根（10-07）——同一条"启动后求值"纪律（见上一行注释）。
  setCompactionWatchDirs(path.join(app.getPath("userData"), "compaction-records"), codexHome);
  loadCompactionStore();
  /* 启动自报（10-01，排查「改了没生效」）：把本次启动加载的产物路径 + 渲染层 bundle 文件名 +
     时间写进 userData/startup-report.json。排查脚本读它即可确定用户启动的是哪份产物，不必互相猜。
     ⛔ 只写自己的报告文件、只读 dist/index.html，不碰任何业务状态；失败不影响启动。 */
  void (async () => {
    try {
      const appPath = app.getAppPath();
      const html = await fs.readFile(path.join(appPath, "dist", "index.html"), "utf8").catch(() => "");
      const bundleFile = /assets\/(index-[\w.-]+\.js)/.exec(html)?.[1] ?? "";
      await fs.writeFile(path.join(app.getPath("userData"), "startup-report.json"), JSON.stringify({
        at: new Date().toISOString(),
        appPath,
        execPath: process.execPath,
        bundleFile,
      }, null, 2), "utf8");
    } catch { /* 自报失败不阻塞启动 */ }
  })();
  // 已删除会话的墓碑必须在**第一次 thread/list 之前**载入：渲染层启动就会拉列表，靠懒加载
  // 会让首屏短暂出现幽灵会话（见 purgeDeletedThread 注释）。失败不阻塞启动。
  try { await loadDeletedThreads(); } catch (error) { console.warn("deleted-threads 载入失败：", error); }

  /* 10-29 用户令：启动时收口「孤立工作区」。
     两类：记录在但目录不在（会话被外部删掉 / 用户手删了目录）、目录在但记录不在
     （删除时目录被占用没删掉、或注册文件丢了）。② 超过 30 天才删 —— 刚建出来还没来得及
     登记的目录立刻删会误伤正在创建的会话。⛔ 不 await：清目录可能很慢，不能拖慢启动。 */
  void gcSessionWorkspaces(app.getPath("userData")).then((stats) => {
    if (stats.recordsRemoved || stats.dirsRemoved) {
      console.log(`[sessionspace] 启动收口：清记录 ${stats.recordsRemoved} 条、清孤儿目录 ${stats.dirsRemoved} 个、重试 orphan ${stats.orphanRetried} 条（扫描 ${stats.scanned} 条）`);
    }
  }).catch((error) => console.warn("[sessionspace] 启动收口失败（不影响启动）：", String(error?.message ?? error).slice(0, 160)));
  // ⛔ 协议桥必须赶在**任何 config.toml 写入之前**起来：写配置时 base_url 要换成桥地址，
  //    桥没起来就只能直连（chat-only 网关由此不可用）。启动失败不致命：bridgeDial 自动降级直连，
  //    与旧版本行为一致；同样必须包 try/catch —— 裸 await 抛出会掐死整条启动链（界面能开、引擎不 spawn）。
  try {
    const bridgePort = await responsesBridge.start();
    console.log(`[bridge] 本地协议桥监听 http://127.0.0.1:${bridgePort}（引擎按 Responses 调用，桥上按上游实际协议转发）`);
  } catch (error) {
    console.warn("[bridge] 启动失败，本次运行直连上游：", error);
  }
  // 专家技能市场（cheat-on-content / ppt-master）原位注册，零拷贝——见 ensureExpertSkillsMarketplace
  await ensureExpertSkillsMarketplace(codexHome);
  await ensureBuiltinSkills(userSkillsDir);
  // Ego Lite 的官方 ego-browser 技能由安装器写到 ~/.agents/skills；Codex 只扫 codexHome/skills，
  // 启动时镜像一份，引擎的技能列表里才会同时出现官方技能与本应用的 browser-skill。
  await ensureEgoBrowserSkill(userSkillsDir);
  /* 记忆后端 → 本地 MCP 连接器同步（09-25）：后端=mcp 时启用 local-memory 连接器
     （引擎可见 MCP 记忆工具、写入走 MCP），builtin 时停用它（写入走内置金字塔）。
     ⛔ 两边必须同源，否则「内置在写 + MCP 工具也可见」会让模型两边都写 = 双份记忆。
     幂等：状态一致时不写盘。⚠️ 包 try/catch —— 启动链里裸 await 抛出会掐死整条链。 */
  try {
    const action = await syncLocalMemoryConnector();
    if (action !== "absent") console.log(`[memory] 本地 MCP 连接器：${action}（记忆后端=${action === "enabled" ? "mcp" : "builtin"}）`);
  } catch (error) { console.warn("[memory] 本地 MCP 连接器同步失败（不影响启动）：", error); }
  // 启动自愈：剥掉已安装技能 SKILL.md 的 UTF-8 BOM。带 BOM 的文件引擎会判「缺 frontmatter」
  // 整份拒载（装了但永远不被使用），市场包/本地导入都可能带 BOM——这里兜住存量文件。
  try {
    const bomFixed = await repairSkillBomScan(userSkillsDir);
    if (bomFixed > 0) console.log(`[skills] 修复 ${bomFixed} 个带 BOM 的 SKILL.md`);
  } catch (error) { console.warn("skill BOM repair failed:", error); }
  // 启动自愈：内置插件（生图 / 视觉）的密钥从**明文**升级成加密存储（10-13 体检 P0-1）。
  // 存量用户的 builtin-plugins.json 里 apiKey 是明文，而同一应用的 custom-models 早就
  // 走 safeStorage 加密了 —— 这里把老口径一次性收口。加密不可用时原样留着，绝不冒险改写。
  try {
    if (await migrateBuiltinPluginSecrets()) console.log("[builtin] 内置插件密钥已从明文升级为加密存储");
  } catch (error) { console.warn("builtin plugin secret migration failed:", error); }
  // 内置插件密钥 → 引擎进程 env（**必须在 server.start 之前**：spawn 之后再设对已起的进程无效）。
  // 这是命令行兜底 `harness-media.mjs` 取密钥的唯一途径 —— 配置文件里现在是密文，它解不开。
  try {
    server.setBuiltinPluginEnv(builtinPluginEnv(await readBuiltinPlugins()));
  } catch (error) { console.warn("builtin plugin env injection failed:", error); }
  /* ⛔⛔ 10-19 实证修复：连接器密钥（知识库 / 记忆的 Bearer token）必须**每次启动**注入 env。
     旧实现只在 `applyCustomModel` 里 `setExternalEnv`，而它在启动时**只有 config 漂移才跑**
     ⇒ 配置没漂移的那次启动引擎 env 里根本没有 `CLOUD_KB_MCP_TOKEN` ⇒ MCP 收到空 bearer
     ⇒ 每次重启都 401（知识库累计 396 次、`missing bearer token` 的根因）。
     必须在 server.start() 之前 —— spawn 之后再设对已起的进程无效。 */
  try {
    server.setExternalEnv(connectorEnv(await readConnectors()));
  } catch (error) { console.warn("connector env injection failed:", error); }
  /* P1-4（10-19 复检报告）：引擎 SQLite 的 WAL 定期 checkpoint（启动一次 + 每 6 小时）。
     ⛔ 只碰**已存在**的库，失败只记日志 —— 绝不能因为磁盘/占用把启动链带崩。 */
  try {
    const stopWalWatch = startWalCheckpointWatch([
      path.join(codexHome, "state_5.sqlite"),
      path.join(codexHome, "thread_history_1.sqlite"),
      path.join(codexHome, "logs_2.sqlite"),
    ]);
    app.once("will-quit", stopWalWatch);
  } catch (error) { console.warn("wal checkpoint watch failed to start:", error); }
  /* P2-8（10-19 复检报告）：引擎日志库归档（默认保留 14 天）。⛔ 必须在 server.start() 之前做
     —— VACUUM 需要独占，引擎连着时做不了；失败只记日志，绝不影响启动。 */
  try {
    const trimmed = trimEngineLogs(path.join(codexHome, "logs_2.sqlite"));
    if (!trimmed.ok) console.warn(`[logs] 归档跳过：${trimmed.error}`);
    else if (trimmed.deleted) console.log(`[logs] 引擎日志归档：删除 ${trimmed.deleted} 行（14 天前），回收 ${Math.max(0, Math.round(((trimmed.before ?? 0) - (trimmed.after ?? 0)) / 1024))} KB`);
  } catch (error) { console.warn("engine log trim failed:", error); }
  // 启动即补齐 AGENTS.md（emoji + 中文语言规范基础段）：老版本升级后没有这些段，
  // 重写让模型默认用中文思考与回复；AGENTS.md 引擎每请求动态重读，无需重启即生效。
  try {
    await applyPersonalizationToAgentsMd(await readPersonalization(), codexHome);
    void refreshSkillDiscipline();
  } catch (error) { console.warn("AGENTS.md bootstrap failed:", error); }
  // 身份引导存量迁移（09-12 用户反馈「怎么每次思考还说新会话引导」）：老档案没有 greeted
  // 字段，于是「装了很久、聊过很多次、但没回答过那套引导提问」的用户升级后又被当成第一次见面。
  // 判定改为「只要这个 profile 已有历史会话，就认定早打过招呼」→ 直接落 greeted=true。
  // 必须放在 server.start() 之前（引擎启动前把档案定稿），且按 preflight【5】包 try/catch，
  // 裸 await 抛出会掐死整条启动链（界面能开、引擎不 spawn）。
  try {
    if (await migrateGreetedForExistingUsers(codexHome)) {
      console.log("[personalization] 存量用户已有历史会话 → 标记 greeted=true（不再做初次见面引导）");
    }
  } catch (error) { console.warn("greeted migration failed:", error); }
  const custom = await readCustomModel();
  if (custom?.provider === "openai-official") {
    server.setApiKey("");
  } else if (custom?.encryptedKey && safeStorage.isEncryptionAvailable()) {
    try {
      server.setApiKey(safeStorage.decryptString(Buffer.from(custom.encryptedKey, "base64")));
    } catch (error) {
      console.warn("custom-model API key decrypt failed, starting without key:", error);
    }
  }
  // ⛔ 10-24 自愈：catalog 坏/空文件会让引擎启动即拒载（见 healModelCatalogBeforeStart 注释）。
  //    必须赶在 server.start 之前跑 —— 旧版把它放在 server.start 之后（第 928 行附近），
  //    那时引擎已经死了，重写 catalog 也救不回来（用户报障现场）。
  try {
    await healModelCatalogBeforeStart(custom);
  } catch (error) {
    console.warn("[boot] model-catalog self-heal failed (降级继续):", error);
  }
  protocol.handle("harness-image", async (request) => {
    let imagePath = new URL(request.url).searchParams.get("path");
    if (!imagePath) return new Response("Missing path", { status: 400 });
    // 双编码兼容：渲染层传的是双编码路径（Chromium 会自行解一层）；若解出来还不是
    // 盘符/根路径形态，再手动解一层（兼容旧的单编码 URL）。
    if (!/^[a-zA-Z]:[\\/]/.test(imagePath) && !imagePath.startsWith("/")) {
      try { imagePath = decodeURIComponent(imagePath); } catch { /* 原样使用 */ }
    }
    /* ⛔ 10-29 用户令：「不管哪里的文件，都要可以预览和编辑」⇒ 不再判可信根。
       仍保留**扩展名白名单**（这是正确性约束：非图片交给 img 只会得到乱码，不是安全闸）。
       ⚠️ 残余风险已知并接受：本协议注册在默认 session，主文档里的任意 HTML 都能取本机图片。 */
    if (!/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(imagePath)) {
      return new Response("Unsupported media type", { status: 415 });
    }
    imagePath = path.resolve(imagePath);
    // 斜杠方向兜底：引擎/宿主写入的路径斜杠方向可能不一致
    if (!existsSync(imagePath)) {
      const backslash = imagePath.replace(/\//g, "\\");
      const forward = imagePath.replace(/\\/g, "/");
      if (existsSync(backslash)) imagePath = backslash;
      else if (existsSync(forward)) imagePath = forward;
    }
    // 兜底：图片被清理/不存在时返回 1x1 透明占位，避免渲染层破图报错
    try {
      if (!existsSync(imagePath)) return placeholderPngResponse();
      return net.fetch(pathToFileURL(imagePath).toString());
    } catch {
      return placeholderPngResponse();
    }
  });
  /* `harness-media://`：本地视频/音频**流式读取**（10-20，对话媒体播放器）。
     ⛔ 不能复用 harness-image：它只放图片后缀，非图片 415；也不能用 file://（渲染层 CSP/webSecurity 挡）。
     ⛔ 必须支持 Range：<video>/<audio> 拖进度依赖 206 + Content-Range；整文件 base64 读进内存不可取。
     安全口径与 harness-image 一致：MIME 白名单 + 可信根内。 */
  const MEDIA_MIME: Record<string, string> = {
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", m4v: "video/x-m4v", ogv: "video/ogg",
    mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", flac: "audio/flac", opus: "audio/ogg",
  };
  protocol.handle("harness-media", async (request) => {
    let mediaPath = new URL(request.url).searchParams.get("path");
    if (!mediaPath) return new Response("Missing path", { status: 400 });
    // 双编码兼容：与 harness-image 同口径（Chromium 会先解一层 percent 编码）
    if (!/^[a-zA-Z]:[\\/]/.test(mediaPath) && !mediaPath.startsWith("/")) {
      try { mediaPath = decodeURIComponent(mediaPath); } catch { /* 原样使用 */ }
    }
    const ext = path.extname(mediaPath).slice(1).toLowerCase();
    const mime = MEDIA_MIME[ext];
    if (!mime) return new Response("Unsupported media type", { status: 415 });
    /* ⛔ 10-29 用户令：媒体同样不再判可信根（能预览图片就要能预览音视频）。保留 MIME 白名单。 */
    mediaPath = path.resolve(mediaPath);
    // 斜杠方向兜底（与 harness-image 同款）
    if (!existsSync(mediaPath)) {
      const backslash = mediaPath.replace(/\//g, "\\");
      const forward = mediaPath.replace(/\\/g, "/");
      if (existsSync(backslash)) mediaPath = backslash;
      else if (existsSync(forward)) mediaPath = forward;
    }
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try { stat = await fs.stat(mediaPath); } catch { return new Response("Not found", { status: 404 }); }
    if (!stat.isFile()) return new Response("Not found", { status: 404 });
    const headers: Record<string, string> = {
      "Content-Type": mime,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    };
    if (request.method === "HEAD") {
      return new Response(null, { headers: { ...headers, "Content-Length": String(stat.size) } });
    }
    const range = request.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
      if (!match) {
        return new Response("Range Not Satisfiable", { status: 416, headers: { "Content-Range": `bytes */${stat.size}`, "Accept-Ranges": "bytes" } });
      }
      let start = match[1] === "" ? NaN : Number(match[1]);
      let end = match[2] === "" ? NaN : Number(match[2]);
      if (Number.isNaN(start)) {
        // suffix range（bytes=-N）：取末尾 N 字节
        start = Math.max(0, stat.size - (Number.isNaN(end) ? 0 : end));
        end = stat.size - 1;
      } else if (Number.isNaN(end)) {
        end = stat.size - 1;
      }
      if (start < 0 || end >= stat.size || start > end) {
        return new Response("Range Not Satisfiable", { status: 416, headers: { "Content-Range": `bytes */${stat.size}`, "Accept-Ranges": "bytes" } });
      }
      return new Response(Readable.toWeb(createReadStream(mediaPath, { start, end })) as any, {
        status: 206,
        headers: {
          ...headers,
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        },
      });
    }
    return new Response(Readable.toWeb(createReadStream(mediaPath)) as any, {
      headers: { ...headers, "Content-Length": String(stat.size) },
    });
  });

  /* `harness-music://stream/<token>`：音乐源取流代理（10-20）。
     真实音频地址 + Referer/UA 只留在主进程的短命令牌表（music-streams）；渲染层拿不到任意 URL。
     协议按 token 反查，带 Range 转发（播放器拖进度要 206），并补 CORS。 */
  protocol.handle("harness-music", async (request) => {
    const url = new URL(request.url);
    const token = url.hostname === "stream" ? url.pathname.replace(/^\/+/, "") : url.hostname;
    const stream = getMusicStream(token);
    if (!stream) return new Response("Not found", { status: 404 });
    const headers = new Headers(stream.headers);
    const range = request.headers.get("range");
    if (range) headers.set("range", range);
    let upstream: Response;
    try {
      upstream = await net.fetch(stream.url, { headers, redirect: "follow" });
    } catch (error) {
      return new Response(`Upstream failed: ${String((error as Error)?.message ?? error)}`, { status: 502 });
    }
    const out = new Headers();
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(name);
      if (value) out.set(name, value);
    }
    out.set("Access-Control-Allow-Origin", "*");
    out.set("Cache-Control", "no-store");
    return new Response(upstream.body, { status: upstream.status, headers: out });
  });

  /* `pet://`：只服务**宠物目录下的图集**（09-30 加）。
     ⛔ 为什么不用 harness-image：宠物包可能装在 `~/.codex/pets`、`~/.petdex/pets`，
        它们**不在可信根**里（可信根 = userData + 会话工作目录 + 用户手选的路径）。
        放宽 harness-image 的可信根 = 把「任意文件读取」的面扩大，属安全回归（红线）。
        ⇒ 另开窄口径协议：目录白名单（pet-ipc 的 petRoots）+ 图片扩展名，两个条件同时满足。
     路径形态：`pet://asset/?path=<绝对路径>`（与 harness-image 的 `?path=` 同构）。 */
  protocol.handle("pet", async (request) => {
    let assetPath = new URL(request.url).searchParams.get("path");
    if (!assetPath) return new Response("Missing path", { status: 400 });
    if (!/^[a-zA-Z]:[\\/]/.test(assetPath) && !assetPath.startsWith("/")) {
      try { assetPath = decodeURIComponent(assetPath); } catch { /* 原样使用 */ }
    }
    if (!/\.(png|webp|jpe?g|gif|avif)$/i.test(assetPath)) {
      return new Response("Unsupported media type", { status: 415 });
    }
    const resolved = path.resolve(assetPath);
    const roots = petAssetRoots().map((root) => path.resolve(root));
    const inside = roots.some((root) => {
      const rel = path.relative(root, resolved);
      return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
    });
    if (!inside) return new Response("Forbidden", { status: 403 });
    if (!existsSync(resolved)) return new Response("Not found", { status: 404 });
    try {
      return net.fetch(pathToFileURL(resolved).toString());
    } catch {
      return new Response("Read failed", { status: 500 });
    }
  });

  /* `sketch://`：随包的**前端开发画布静态站**（10-05 加，m3e-canvas 的 next 静态导出）。
     根恒等于打包内 dist/sketch、扩展名走白名单 ⇒ 能读的文件集合就是"随包只读资源"那一圈，
     面没有扩大（三条为什么不另做他选的论证写在 electron/sketch-protocol.ts 头部）。 */
  protocol.handle(SKETCH_SCHEME, (request) => sketchResponse(request.url));

  // 语音通话：授予麦克风权限。此前全项目没有任何权限处理，getUserMedia 会被直接拒绝。
  // 只放行 media，其余权限一律沿用 Electron 默认（不放大授权面）。
  // macOS 上还需要 Info.plist 的 NSMicrophoneUsageDescription（见 build/entitlements 与文档），
  // 且首次调用会弹系统授权框，由系统偏好设置持久记忆。
  try {
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === "media");
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
      return permission === "media";
    });
  } catch (error) {
    console.warn("voice permission handler failed:", error);
  }
  markBoot("pre-create-window");
  createWindow();
  markBoot("window-created");
  /* 桌面宠物：上次是开着的话恢复出来（设置里 enabled=true）。
     ⛔ 必须排在 createWindow 之后 —— 浮窗是 alwaysOnTop，先建它会被主窗口盖住、
     用户以为"没生效"；而且拿不到主窗口的屏位做默认定位。失败一律降级，不阻断启动链。 */
  try {
    const petSettings = readPetSettings();
    if (petSettings.enabled) applyPetSettings(petSettings);
  } catch (error) {
    console.warn("[pet] 恢复桌面宠物失败:", (error as Error)?.message ?? error);
  }
  server.on("event", (event: any) => {
    /* 10-05 角色私有记忆写入：被委派会话的 `item/tool/call` 会被下面的 filterForRenderer
       裁掉（它不在 RENDERER_CROSS_SESSION_METHODS 白名单里，渲染层也收不到）⇒ 只能在这里应答。
       ⛔ 必须排在 filterForRenderer **之前**（事件一旦被裁掉就再也拿不到了）。
       ⛔ 只处理 role_memory_save 这一个工具；返回 false = 不是它，照原流程往下走。 */
    void handleRoleMemoryToolCall({ userDataDir: app.getPath("userData"), event, respond: (id, result) => server.respond(id as any, result) })
    /* MCP 工具（dynamicTools 注册的那批）：带连接器前缀的才认，其余交回原流程 */
    void handleMcpToolCall({ event, respond: (id, result) => server.respond(id as any, result) })
      .catch(() => false);
    /* 10-10 被委派会话的**能力网关**（用户令「全开 harness_tools」）：同上，被委派会话的事件会被
       filterForRenderer 裁掉 ⇒ 必须在主进程应答。
       ⛔ 只回答 `harness_tools` 一个工具名；返回 false = 不是它，照原流程往下走。 */
    void handleDelegateHarnessToolCall({ userDataDir: app.getPath("userData"), event, respond: (id, result) => server.respond(id as any, result) })
      .catch(() => false);
    /* 10-27 OpenFilm 工具（openfilm_status / make_film / check / render / get / skill）：
       命令全在主进程 spawn，前台会话与后台会话走同一条路 —— ⛔ 不排这一层的话，
       被 filterForRenderer 裁掉的会话（专家/子智能体）调了工具没人应答，一直挂到超时。
       返回 false = 不是 openfilm_ 前缀，照原流程往下走。 */
    void handleOpenfilmToolCall({ event, respond: (id, result) => server.respond(id as any, result) })
      .catch(() => false);
    /* 10-22 专家团工具兜底（`team_member_invoke` / `team_phase_invoke`）：这两条原来只由渲染层应答，
       而 `item/tool/call` 不在跨会话白名单里 ⇒ 后台跑的团队主理人（从普通会话 agent_invoke(kind:"team")
       派出去的）根本没人应答，成员永远不被调用（用户报「无法调用成员干活」）。
       ⛔ 只在**送不到渲染层**时接管：两边都答 = 同一个成员被调度两次。 */
    void handleTeamToolCall({ event, respond: (id, result) => server.respond(id as any, result), delivered: isThreadDelivered })
      .catch(() => false);
    /* 10-10「委派超时转后台」的**收尾点**：宿主提前放手后，记录要保持 running 直到回合真正结束
       ⇒ 必须在引擎事件流里收敛（原来只有 delegation/teams-ipc 的 await 路径会做，一旦放手就永远
       停在 running）。幂等：正常路径早已收敛的记录这里直接跳过。详见 electron/delegate-settle.ts。 */
    try { settleBackgroundRunsOnTurnEnd(event); } catch { /* 收敛失败不影响事件流向 */ }
    // 桌面宠物：旁听同一份事件流归约成九态（不改事件流向、也不消费正文内容）。
    // ⛔ 无条件喂：状态要一直维护着，用户中途打开宠物时才能立刻是对的状态（窗口关着时
    //    归约只写一个对象、不产生任何推送，成本可忽略）。
    feedPetEvent(event);
    // 裁剪后可能为 null（09-14 启用按会话过滤）——null 绝不能进 broadcastCodexEvent，
    // 否则渲染层收到一条空事件。channelBot / voiceService 拿的是未裁剪的原始事件。
    const forwarded = filterForRenderer(event);
    if (forwarded) broadcastCodexEvent(forwarded);
    channelBot.handleCodexEvent(event);
    // 语音通话：只旁听事件（正文增量 / 回合生命周期），不改变事件本身的任何流向
    voiceService.handleCodexEvent(event);
    // 引擎就绪后按设置启停健康看门狗（engineWatchdog 默认开）
    if (event.kind === "status" && event.status === "ready") void syncEngineWatchdog();
    // 手机对话页实时同步：流式增量 / 用户消息 / 回合完成
    if (event.kind === "notification") {
      // ⛔ 调度独占锁的孤儿记录清理（09-17 用户实测「都关掉了，怎么还提示被锁住了」）：
      //   锁的持有者是从 thread-runtime 记录**派生**的（第一个 dispatch.enabled 的线程），而会话被
      //   **归档 / 删除**时历史上没有任何地方清这条记录 ⇒ 孤儿记录永久占着全局唯一的调度权，
      //   且该会话在侧栏上已经找不到，用户**没有任何入口**能关它。
      //   实测证据：用户 thread-runtime.json 有 1 条 enabled，其 threadId 在引擎 state 库里已不存在。
      //   归档 → 只关开关（保留模型/权限等配置，恢复会话后不丢）；删除 → 整条移除。
      if (event.method === "thread/archived" || event.method === "thread/deleted") {
        const goneId = eventThreadId(event.params);
        if (goneId) {
          // ⛔ 引擎侧发起的删除（不经渲染层 thread/delete 请求）同样要清磁盘残留 + 记墓碑，
          //   否则侧栏的 rollout 兜底扫描在下次启动把它捞回来（见 purgeDeletedThread 注释）。
          if (event.method === "thread/deleted") void purgeDeletedThread(goneId).catch(() => undefined);
          if (goneId) clearGrants(goneId); // 10-29：会话删了 ⇒ 三模块授权作废（另一入口在 codex-ipc 的 purgeTarget）
          /* 10-29 用户令：会话专属工作区的状态跟着引擎事件走。
             删除 ⇒ 目录 + 记录一起清；归档 ⇒ **只打标记，目录保留**（取消归档要能接着用）。
             ⛔ 这是第二条入口（引擎侧发起的删除/归档），codex-ipc 的 purgeTarget 是第一条 —— 两处都要有。 */
          if (goneId) {
            if (event.method === "thread/deleted") {
              /* 删除：工作区目录 + **该会话的私有记忆目录**（private__<id>/）一起清。
                 ⛔ 用工作区记录里的 projectRoot 定位记忆，不用 threadCwd 缓存 ——
                    重启后再删旧会话时缓存可能是空的，那就定位不到、只剩垃圾。
                 ⛔ 顺序：先删工作区拿到 projectRoot，再删记忆（记忆归 memory-fabric，别在这里拼路径）。 */
              void removeSessionWorkspace(app.getPath("userData"), goneId)
                .then(async (out) => {
                  const memoryWs = out.projectRoot || threadCwd.get(goneId) || "";
                  if (!memoryWs) return;
                  const dropped = await clearSessionPrivateMemory(memoryWs, goneId).catch(() => false);
                  if (dropped) console.log(`[sessionspace] 已清会话私有记忆：${goneId.slice(0, 8)}`);
                })
                .catch(() => undefined);
            } else {
              /* 归档：只打标记，目录与记忆**都保留**（取消归档要能接着用）。 */
              void setSessionWorkspaceState(app.getPath("userData"), goneId, "archived").catch(() => undefined);
            }
          }
          /* 10-05 角色记忆：会话被删 ⇒ 它的角色归属索引也清掉（否则索引无限增长，
             且那个 threadId 永远查不到归属、也永远占着一条记录）。记忆内容本身**留着** —
             角色还在（专家/子智能体定义没删），下次派出会继续用它自己的记忆。 */
          if (event.method === "thread/deleted") void forgetRoleSession(app.getPath("userData"), goneId).catch(() => undefined);
          /* 10-05 统一记忆：会话被删 ⇒ 给它的记忆条目**打归档标记**（⛔ 不删内容：
             角色还在，下次派出同一角色继续用它积累的经验）。
             ⛔ 这条必须有调用点 —— 上一轮 `prune()` 的教训：写了不接线 = 等于没写。
             归档后的条目**不再参与召回**（memory-fabric 的 rankEntries 默认过滤）。 */
          if (event.method === "thread/deleted") {
            /* ⛔ 工作区从 `threadCwd` 反查（⛔ 不猜路径：归档到错目录比不归档更糟）。
               ⛔ 查不到就跳过 —— 那说明这个会话本来就没有工作区记忆。 */
            const goneCwd = threadCwd.get(goneId) || "";
            if (goneCwd) void archiveSessionMemory(goneCwd, goneId, true).catch(() => undefined);
          }
          /* 10-05：委托登记表里的记录**跟着会话一起走** —— 记录是「这个会话被委派过」的凭证，
             会话都没了它就只是幽灵 ⇒ 办公室里会多一个点不开的人（用户 10-05 报的那个）。
             ⛔ 归档**不清**：归档是"收起"（记录要留着防重复询问），删除才是"不存在了"。
             ⚠️ 另一条删除入口在 features/codex-ipc.ts（渲染层发起的 thread/delete）—— 两处都要有。 */
          if (event.method === "thread/deleted") void delegateRegistry.forget([goneId]).then((n: number) => {
            if (n) broadcastHarnessEvent({ type: "delegates-changed", threadId: goneId } as any);
          }).catch(() => undefined);
          // 会话被删 ⇒ 文件变更报告的落盘也跟着走（否则 userData/turn-file-changes 越攒越多）
          if (event.method === "thread/deleted") dropStoredReports(goneId);
          // 压缩侦测记录同理（否则 userData/compaction-records 越攒越多）
          if (event.method === "thread/deleted") dropStoredCompactions(goneId);
          /* 10-29：归档**不动**运行时记录（没有调度锁要释放了）—— 归档是"收起"，
             恢复后模型 / 档位 / 权限 / 调度许可原样还在；只有删除才清记录。 */
          void (async () => {
            if (event.method !== "thread/deleted") return;
            const changed = await threadRuntimeStore.remove(goneId);
            if (changed) {
              const runtime = await threadRuntimeStore.get(goneId);
              broadcastHarnessEvent({ type: "thread-runtime", threadId: goneId, runtime, at: Date.now() });
            }
          })().catch(() => undefined);
        }
      }
      // 专家团成员线程的流式文本 → 广播给所有窗口（成员工作弹窗实时渲染）。
      // 只认「正在跑的成员线程」，其它会话的增量一律不碰。
      teamRunStore.handleEngineEvent(event);
      // 被调度的临时会话：同样把流式文本广播出去 —— 右侧「调度头像轨」的实时工作内容靠它
      // （09-16 用户要求：调度时右侧显示专家头像 + 点开看工作内容，跟专家团一致）。
      const delegated = delegateRegistry.handleEngineEvent(event);
      if (delegated) broadcastHarnessEvent({ type: "delegate-run", phase: "delta", threadId: delegated.threadId, text: delegated.text, chars: delegated.chars, at: Date.now() });
      // 调度 MCP 旁证：item/started 事件携带**真实调用者线程**，参数指纹 → threadId
      // （HTTP 执行端据此对号入座，模型谎报 originThreadId 也绕不过独占锁/身份闸）。
      if (event.method === "item/started") {
        const item: any = (event.params as any)?.item ?? {};
        if (item?.type === "mcpToolCall" && /harness-dispatch/.test(String(item.server ?? item.serverName ?? item.server_tool ?? item.tool ?? ""))) {
          dispatchProbes.push({ threadId: String((event.params as any)?.threadId ?? ""), argsKey: stableKey(item.arguments ?? {}), at: Date.now() });
          if (dispatchProbes.length > 100) dispatchProbes.shift();
        }
      }
      // ⛔ 临时诊断（验证完删）：抓 MCP 服务器启动状态与工具调用事件
      if (/^mcpServer\//.test(event.method ?? "") || /mcpToolCall/.test(String((event.params as any)?.item?.type ?? "")) || /mcpToolCall/.test(event.method ?? "")) {
        console.warn("[mcp-diag]", event.method, JSON.stringify((event.params as any)?.item ?? event.params ?? {}).slice(0, 400));
      }
      const p = event.params as any;
      // ⛔ 回合记账必须**宽容**（09-19 实测：只认 `params.turn.id` 会漏掉 `turnId` 形态的引擎版本，
      //    于是记账恒空 → 重启闸门形同虚设、台账里 activeTurns 永远是 0）。
      //    三种标识形态都收；结束事件按方法名族匹配（completed / aborted / failed 都算结束）。
      // ⛔ 存 **turnId → threadId** 而不是裸集合：线程变空闲时只能释放**它自己**的回合，
      //    否则「A 会话跑完」会把 B 会话正在跑的记账也清掉 → 闸门误判为空闲 → 直接打断 B。
      const turnIdOf = (params: any) => String(params?.turn?.id ?? params?.turnId ?? params?.id ?? "");
      const METHOD = String(event.method ?? "");
      const threadIdOf = String(p?.threadId ?? "");
      if (METHOD === "turn/started" || METHOD === "turn/begin") {
        const id = turnIdOf(p);
        if (id) engineActiveTurnIds.set(id, threadIdOf);
        /* 文件变更追踪（10-01 用户令）：回合开始记工作目录快照；cwd 跟随会话（threadCwd）。
           ⛔ 快照键 = 线程 id（一线程同时只有一个活跃回合，正好实现「新回合补算上一回合」），
           但必须**把回合 id 一并存下**——结算广播的 turnId 要用它（渲染层按 turn.id 取报告，10-06 修）。 */
        const startCwd = threadCwd.get(threadIdOf);
        if (startCwd) snapshotTurnWorkspace(threadIdOf, id, startCwd);
        /* ⛔ 诊断（10-07，mac 实测「shell 改了文件但汇总下没有已编辑文件」）：链路两侧全平台
           同构、无平台分支，断点只可能落在这三个静默跳过点之一 —— ① 回合开始事件拿不到
           threadId；② 该线程 cwd 未登记；③ 回合 id 缺失（结算广播按 turnId 取报告，缺了
           渲染层对不上号）。各打一行 warn（带前缀易 grep），mac 下一次复现即可定位断点。
           ⛔ 只在「本该有快照却没有」时打，正常运行零输出。 */
        else if (id || threadIdOf) {
          console.warn("[turn-files-diag] 回合开始未记快照：threadId=", threadIdOf || "(空)", "turnId=", id || "(空)", "cwd 未登记");
          debugTurnFiles({ point: "started-no-cwd", threadId: threadIdOf || "(空)", turnId: id || "(空)" });
        }
      } else if (/^turn\/(completed|aborted|failed|interrupted)$/.test(METHOD)) {
        const id = turnIdOf(p);
        if (id) engineActiveTurnIds.delete(id);
        /* 回合收尾 = 汇报时点：算工作目录差异并广播 turn-file-changes（ZCode 式汇总的数据源）。
           ⛔ 双保险（10-06 夜，新机器实测「运行中行有、收尾卡没有」）：先按线程键结算；
           再按**回合 id 反查**兜底——部分引擎版本的结束事件形态不同、拿不到 threadId 时，
           没有这一发收尾就静默漏结算（运行中行不受影响，因为它用的是快照自存的回合 id）。 */
        emitTurnFileChanges(threadIdOf);
        if (id) settleTurnByTurnId(id);
        /* 改动备份（10-13）：把上面那份「这回合改了哪些文件」落成可回看的备份档案。
           ⛔ **不重写 diff、不重写遍历** —— 直接复用 turn-file-watch 已算好的结果
           （它带 additions/deletions，还跑过 IGNORE 表与 4000/600 两级预算），
           再写一套 walker 就是两处真相源，且必然与它的忽略规则漂移。
           ⛔ 开关关闭 ⇒ 一行都不落盘（用户没主动开之前不产生任何产物）。
           ⛔ 备份失败只记日志，永不打断回合（旁路能力，用户正在写的东西比备份重要）。 */
        if (!internalThreads.has(String(threadIdOf))) void backupTurnIfEnabled(threadIdOf, id);
        // ⛔ 10-03 语法修复：58afb8b 把这里写成了 `else if (threadIdOf)`，但上面的
        //   `} else if (...)` 分支已闭合 ⇒ 整个文件解析失败（tsc TS1128），主进程编译不过。
        //   按本段注释的原意（"id 形态不认识 → 只释放该线程名下的回合"）补回条件：
        //   有 id 时上面已 delete 过，这里只在**没有 id** 时才遍历释放。
        if (!id && threadIdOf) {
          // id 形态不认识 → 只释放该线程名下的回合（绝不动别的会话）
          for (const [turnId, owner] of [...engineActiveTurnIds]) if (owner === threadIdOf) engineActiveTurnIds.delete(turnId);
        }
      } else if (METHOD === "thread/status/changed") {
        // 线程变成 idle/notLoaded ⇒ 该线程不可能还有活跃回合（引擎侧权威信号）
        const st = (p?.status as any)?.type ?? p?.status;
        if (threadIdOf && (st === "idle" || st === "notLoaded" || st === "systemError")) {
          for (const [turnId, owner] of [...engineActiveTurnIds]) if (owner === threadIdOf) engineActiveTurnIds.delete(turnId);
        }
      }
      if (engineActiveTurnIds.size === 0) void server.flushDeferredRestart().catch(() => undefined);
      // 频道机器人流式回复：回合开始建流式会话（同步读设置，开关即时生效），
      // 后续所有事件喂入会话；turn/completed 的最终回复由会话负责（见各 handler 的兜底判断）
      if (event.method === "turn/started") {
        const streamThreadId = String(p?.threadId ?? "");
        if (streamThreadId) {
          botStreamSessions.delete(streamThreadId);
          stopWeixinTyping(streamThreadId); // 新回合重开计时器，防上一轮的泄漏
          const plan = botStreamPlanFor(streamThreadId);
          if (plan) {
            botStreamSessions.set(streamThreadId, new BotStreamSession(plan.sink, readBotStreamSettingsSync(botStreamFile), plan.budget));
            if (plan.typingFrom) startWeixinTyping(streamThreadId, plan.typingFrom);
          }
        }
      }
      // 任务监控（10-30）：每轮的技能 / MCP / 插件 / 产物 + 本轮自我改进建议。
      // ⛔ 同步调用、绝不 await —— 采集只是记账，生成走它自己内部的 async；抛出会打断整条事件分发。
      try { noteEngineEvent(event.method, p); } catch { /* 监控失败不影响对话 */ }
      // 回合结束（四类，见 turn-end.ts）：流式会话负责最终回复；「正在输入」指示器这时要收掉
      // ⛔ 只认 completed 时，被中断 / 失败的回合微信端「正在输入」永远不停（同型缺陷）
      if (isTurnEndMethod(event.method)) stopWeixinTyping(String(p?.threadId ?? ""));
      const botStreamSession = botStreamSessions.get(String(p?.threadId ?? ""));
      if (botStreamSession) botStreamSession.handle(event.method, p);
      // 记忆捕获缓冲：turn/completed 不带完整 items，必须靠流式事件累积文本（同 channel-bot 的做法）
      if (event.method === "item/started" && p?.item?.type === "userMessage") {
        const text = (p.item.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n");
        // ⛔ 内部线程（记忆蒸馏等）不写缓冲：它的 turn/completed 会被下面跳过 ⇒ 写了没人删（永久泄漏）
        if (text && !internalThreads.has(String(p.threadId))) {
          captureBuffers.set(`${p.threadId}:${turnIdOf(p)}`, { user: text, assistant: "", cwd: threadCwd.get(String(p.threadId)) });
          // 上限保护：回合被中断 / 应用被杀时没人来删，别让 Map 无限长（正常同时活跃回合是个位数）
          if (captureBuffers.size > 64) { const oldest = captureBuffers.keys().next().value; if (oldest) captureBuffers.delete(oldest); }
        }
      } else if (event.method === "item/agentMessage/delta" && p?.delta) {
        const buffer = peekCaptureBuffer(String(p.threadId), turnIdOf(p));
        if (buffer) buffer.assistant += p.delta;
        for (const forward of remoteEventForwarders) forward({ threadId: p.threadId, kind: "delta", text: p.delta });
      } else if (event.method === "item/started" && p?.item?.type === "reasoning") {
        // 思考开始：先给手机一个空块（页面会显示「思考：」），后到的增量/全文往里填
        if (!internalThreads.has(String(p?.threadId ?? ""))) for (const forward of remoteEventForwarders) forward({ threadId: p.threadId, kind: "think", text: "" });
      } else if (event.method === "item/reasoning/summaryTextDelta" && (p?.delta || p?.text)) {
        // 手机端「思考内容」：与桌面折叠区同一股摘要流（原始 textDelta 太长，只发摘要）
        // ⛔ 取文本必须 delta ?? text —— 引擎这条事件两种字段都出现过（桌面端也是这么取的）
        if (!internalThreads.has(String(p?.threadId ?? ""))) {
          remoteThinkStreamed.add(remoteThinkKey(p));
          for (const forward of remoteEventForwarders) forward({ threadId: p.threadId, kind: "think", text: String(p.delta ?? p.text) });
        }
      } else if (event.method === "item/commandExecution/outputDelta" && p?.delta) {
        // 命令输出：桌面对话框的「命令卡」里有结果，手机端也要（挂在对应命令步骤下面）
        if (!internalThreads.has(String(p?.threadId ?? ""))) for (const forward of remoteEventForwarders) forward({ threadId: p.threadId, kind: "output", text: String(p.delta) });
      } else if (event.method === "item/completed" && p?.item?.type === "reasoning") {
        /* ⛔ 中转供应商常常**不流式**发思考摘要（实测 rollout 里 reasoning 条目的 summary 齐全，
           但一条 summaryTextDelta 都没有）⇒ 只转发增量的话手机端永远空白。这里用完整条目兜底，
           已经流式发过的**这一条**不重复发（否则同一段思考会出现两遍）。 */
        const thinkKey = remoteThinkKey(p);
        if (!internalThreads.has(String(p?.threadId ?? "")) && !remoteThinkStreamed.has(thinkKey)) {
          const text = reasoningItemText(p?.item);
          if (text) for (const forward of remoteEventForwarders) forward({ threadId: p.threadId, kind: "think", text });
        }
        remoteThinkStreamed.delete(thinkKey);
      } else if (event.method === "item/completed" && p?.item?.type === "agentMessage" && p.item.text) {
        const buffer = peekCaptureBuffer(String(p.threadId), turnIdOf(p));
        if (buffer) buffer.assistant = p.item.text;
      } else if (/requestApproval$/.test(String(event.method ?? "")) || event.method === "item/tool/requestUserInput" || (event.method === "item/tool/call" && p?.tool === "agent_ask")) {
        /* 询问 / 审批：手机端做成**可点卡片**。
           · 引擎原生请求（requestUserInput / 两种 requestApproval）→ 主进程 server.respond 回包；
           · agent_ask 是宿主动态工具，应答必须经渲染层 resolve（见 AppView 的 remote-agent-ask-answer 桥）。 */
        const askThreadId = String(p?.threadId ?? "");
        if (!internalThreads.has(askThreadId)) {
          const ask = remoteAskOf(String(event.method ?? ""), p, event);
          if (ask) for (const forward of remoteEventForwarders) forward({ threadId: askThreadId, kind: "ask", text: ask.text, data: ask });
          else {
            const why = String(event.method ?? "").includes("permissions")
              ? "权限申请"
              : event.method === "item/tool/requestUserInput"
                ? "多项选择"
                : String(event.method ?? "").includes("fileChange")
                  ? "文件修改"
                  : "命令执行";
            for (const forward of remoteEventForwarders) forward({ threadId: askThreadId, kind: "notice", text: `⚠ 需要在电脑端确认：${why}` });
          }
        }
      } else if (event.method === "item/completed" && p?.item?.type === "commandExecution") {
        // 命令结束：引擎带 exitCode / status 时给出结论（不带就静默，别瞎猜）
        const exitCode = p?.item?.exitCode;
        const status = String(p?.item?.status ?? "");
        const text = exitCode != null
          ? (Number(exitCode) === 0 ? "命令完成" : `命令失败（退出码 ${exitCode}）`)
          : /^(completed|succeeded|success)$/i.test(status) ? "命令完成"
          : /^(failed|error)$/i.test(status) ? "命令失败"
          : "";
        if (text && !internalThreads.has(String(p?.threadId ?? ""))) for (const forward of remoteEventForwarders) forward({ threadId: p.threadId, kind: "step", text });
      } else if (event.method === "item/started" || event.method === "item/completed") {
        /* 手机端「运行步骤」：与桌面对话框同一批 item 事件 —— 命令 / 文件变更 / 工具 / 搜索 / 思考，
           手机只会看到被打平的一行行短标签（桌面的折叠区同理，只是形态更细）。 */
        const step = remoteStepOf(p?.item, event.method === "item/started" ? "started" : "completed");
        if (step && !internalThreads.has(String(p?.threadId ?? ""))) {
          for (const forward of remoteEventForwarders) forward({ threadId: p.threadId, kind: "step", text: step });
        }
      } else if (event.method === "turn/started" || event.method === "turn/begin") {
        /* 回合开始（无论从电脑端还是手机端发起）：手机同步「运行中」，否则电脑端在跑时
           手机还显示「发送」，既看不到状态也按不了停止（10-31 用户实测）。 */
        if (!internalThreads.has(String(p?.threadId ?? ""))) {
          for (const forward of remoteEventForwarders) forward({ threadId: p.threadId, kind: "running", text: "" });
        }
      } else if (event.method === "turn/completed") {
        /* 另一种引擎形态：结束原因在 turn.status（interrupted / failed），没有单独的 aborted 事件 */
        {
          const status = String((p as any)?.turn?.status ?? "completed");
          const endThreadId = String(p?.threadId ?? eventThreadId(p) ?? "");
          if (status !== "completed" && endThreadId && !internalThreads.has(endThreadId)) {
            const endKey = endThreadId + ":" + (turnIdOf(p) || "");
            if (!remoteTurnEndNotified.has(endKey)) {
              remoteTurnEndNotified.add(endKey);
              if (remoteTurnEndNotified.size > 200) remoteTurnEndNotified.clear();
              const reason = String((p as any)?.turn?.error?.message ?? "").trim();
              const text = status === "failed" ? ("运行失败" + (reason ? "：" + reason : "")) : "已停止";
              for (const forward of remoteEventForwarders) forward({ threadId: endThreadId, kind: "error", text });
            }
          }
        }
        if (!internalThreads.has(String(p?.threadId))) {
          /* 最后一道兜底：有些供应商连单条的 item/completed 都不发，整轮的 items 里却齐全。
             在 done **之前**把没发过的思考补上（done 一到手机就把运行块折叠了）。 */
          for (const item of p?.turn?.items ?? []) {
            if (item?.type !== "reasoning") continue;
            const key = `${p.threadId}:${turnIdOf(p)}:${String(item?.id ?? "")}`;
            if (remoteThinkStreamed.has(key)) continue;
            const text = reasoningItemText(item);
            if (!text) continue;
            remoteThinkStreamed.add(key);
            for (const forward of remoteEventForwarders) forward({ threadId: p.threadId, kind: "think", text });
          }
          for (const forward of remoteEventForwarders) forward({ threadId: p?.threadId, kind: "done", text: "" });
        }
        /* 引擎真压缩的宿主侦测（10-07）：当前引擎的压缩不发 item 事件（item 只落 rollout，
           且自动压缩是**内联**在用户回合里完成的）——这里每个回合结束时增量扫 rollout 新增段、
           按压缩记录自己的 turn_id 归因（== 刚完成回合 id 才认）→ 命中则落盘 + 广播（渲染层画线）。 */
        void watchTurnCompleted(String(p?.threadId ?? ""), turnIdOf(p));
      }
      // ⛔ 中断 / 失败的回合也必须释放缓冲：否则它永久留在 Map 里，
      //    下一次兜底会错取到它（L2 记忆串台到上一回合）
      if (/^turn\/(aborted|failed|interrupted)$/.test(String(event.method ?? ""))) {
        /* ⛔ 引擎的 aborted/failed 事件**常常不带 threadId**（实测），必须用 eventThreadId 兜底，
           否则手机端收不到「已停止/失败」——旧实现只发 done，且 threadId 为空被页面丢掉。 */
        const endedThreadId = String(p?.threadId ?? eventThreadId(p) ?? "");
        takeCaptureBuffer(endedThreadId, turnIdOf(p));
        dropRemoteThinkKeys(endedThreadId, turnIdOf(p));
        /* 手机端的错误反馈：失败要给出原因，被停要说「已停止」——旧实现只发 done，
           手机端看起来就是「什么都没发生 / 一直转圈」（10-31 用户：「报错反馈没有」）。 */
        if (!internalThreads.has(endedThreadId)) {
          const failed = String(event.method ?? "") === "turn/failed";
          const reason = String(
            (p as any)?.error?.message
            ?? (p as any)?.turn?.error?.message
            ?? (p as any)?.message
            ?? "",
          ).trim();
          const text = failed ? ("运行失败" + (reason ? "：" + reason : "")) : "已停止";
          const endKey = endedThreadId + ":" + (turnIdOf(p) || "");
          if (!remoteTurnEndNotified.has(endKey)) {
            remoteTurnEndNotified.add(endKey);
            if (remoteTurnEndNotified.size > 200) remoteTurnEndNotified.clear();
            for (const forward of remoteEventForwarders) forward({ threadId: endedThreadId, kind: "error", text });
          }
        }
        // 手机端「运行中」也只认 done：中断/失败/中止同样要收尾，否则停止后按钮/状态一直挂着
        if (!internalThreads.has(endedThreadId)) for (const forward of remoteEventForwarders) forward({ threadId: endedThreadId, kind: "done", text: "" });
      }
      if (event.method === "turn/completed" && !internalThreads.has(String(p?.threadId))) {
        const threadId = String(p?.threadId ?? "");
        const taken = takeCaptureBuffer(threadId, turnIdOf(p));
        const buffer = taken.buffer ?? { user: "", assistant: "", cwd: undefined };
        // completed.items 有内容时兜底覆盖
        const items = p?.turn?.items ?? [];
        if (items.length) {
          buffer.user = items.filter((item: any) => item.type === "userMessage").flatMap((item: any) => item.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n") || buffer.user;
          buffer.assistant = items.filter((item: any) => item.type === "agentMessage").map((item: any) => item.text ?? "").join("\n") || buffer.assistant;
        }
        // 欢迎语隐藏线程（[welcome-gen] 标记）不进记忆：一次性生成文案的内部线程
        const isWelcomeGen = buffer.user.includes("[welcome-gen]") || items.some((item: any) => JSON.stringify(item?.content ?? item).includes("[welcome-gen]"));
        const willCapture = !isWelcomeGen && Boolean(buffer.user.trim() || buffer.assistant.trim());
        debugMemoryCapture({ method: "turn/completed", threadId, turnId: turnIdOf(p) || null, via: taken.via, userLen: buffer.user.length, assistantLen: buffer.assistant.length, itemsLen: items.length, cwd: buffer.cwd ?? null, isWelcomeGen, willCapture });
        if (willCapture) {
          /* ⛔⛔ 10-25 用户令：「记忆板块里面加一个BOSS会话记忆板块，跟普通会话完全拆开」。
             BOSS 会话跑在用户选的项目目录里 ⇒ 捕获写入若还用 `buffer.cwd`，
             它的日志/纪律会**写进那个项目的记忆** ⇒ 与普通会话混在一起。
             ⇒ BOSS 会话改写它自己的专属记忆目录（`<userData>/boss-home/memories/<threadId>`）。
                名单在主进程（session-registry.ts），这里能直接判。 */
          void (async () => {
            let ws = buffer.cwd;
            try {
              if (await isBossSession(threadId)) ws = bossMemoryWorkspace(threadId) || buffer.cwd;
            } catch { /* 名单读不到就退回原行为（别把记忆写丢） */ }
            const enabled = await workspaceMemoryEnabled(ws);
            await memoryStore.captureTurn(threadId, buffer.user, buffer.assistant, { workspace: ws, includeWorkspace: enabled });
          })().catch((error: any) => sendToWindow("harness:event", { type: "memory", message: `Memory Gateway 捕获失败：${error.message}`, at: Date.now() }));
        }
        /* ⛔⛔ 10-25 用户令：「这个记忆蒸馏器又是什么玩意啊…删了，让 codex 自己蒸馏记忆」。
           原来这里在**会话结束时**自动调 autoDistill → 它会开一个内部只读会话
           （首句「你是记忆蒸馏器。下面是某个项目过去的工作日志…」）⇒ 侧栏多出一堆垃圾会话。
           ⇒ **应用不再自动蒸馏**：蒸馏由 Codex 自己按 memory-distill 技能做
              （developer-instructions 第 9 条本来就写着「用户明确要求由你做，而不是由应用做」）。
           记忆水位的判定与提示仍在（那条在常驻记忆块里，Codex 看到就自己蒸）。 */

      }
    }
  });
  try {
    // 官方订阅走 chatgpt.com 后端（区域受限）：必须在引擎 spawn 之前注入代理 env——
    // spawn 后再 setExternalEnv 对已运行进程无效，引擎会一直直连导致流反复断开（Reconnecting x/10）。
    if (custom?.provider === "openai-official") {
      const proxy = await resolveLiveProxy();
      if (proxy) {
        const officialEnv = connectorEnv(await readConnectors());
        Object.assign(officialEnv, { HTTPS_PROXY: proxy, HTTP_PROXY: proxy, NO_PROXY: "localhost,127.0.0.1,::1", no_proxy: "localhost,127.0.0.1,::1" });
        server.setExternalEnv(officialEnv);
      }
    }
    // ⛔ 启动自愈（必须赶在 server.start 之前）：存量 config.toml 里的 `wire_api = "chat"`
    // 会让新版引擎**整份配置拒载** —— 症状是应用起来后所有 codex:request 都报
    // 「failed to load configuration ... wire_api = "chat" is no longer supported」（09-14
    // 用户实测截图，来自另一位用户的机器）。生成侧已改为恒写 responses，这里兜住老文件。
    try {
      const configPath = path.join(codexHome, "config.toml");
      const raw = await fs.readFile(configPath, "utf8").catch(() => "");
      if (/wire_api\s*=\s*"chat"/.test(raw)) {
        await fs.writeFile(`${configPath}.chat-bak`, raw, "utf8").catch(() => undefined);
        await fs.writeFile(configPath, raw.replace(/wire_api\s*=\s*"chat"/g, 'wire_api = "responses"'), "utf8");
        console.log('[config] 已把 wire_api="chat" 迁移为 "responses"（原文件备份为 config.toml.chat-bak）');
      }
    } catch (error) { console.warn("wire_api repair failed:", error); }
    // 旧家 rollout 迁移（09-18）：必须在 server.start() 之前——引擎起来后侧栏第一次
    // thread/list 就要扫到这些文件；失败只降级不阻塞启动（老会话晚点再迁也不丢）。
    try {
      await migrateLegacyRolloutHome();
    } catch (error) { console.warn("legacy rollout migration failed:", error); }
    // 血缘自愈（09-19）：⛔ 必须在 server.start() **之前**，而且要 await ——
    //   引擎一起来（甚至只是加载会话元数据）就会把 `forked_from_id` 读进内存/缓存，
    //   之后再改 rollout 文件**同一次运行内不生效**（09-19 实测：文件已自愈、血缘字段
    //   已摘掉，但 resume 仍报 `missing source rollout`，直到重启应用才好）。
    //   放在这里 = 引擎读到的就是修好的文件，中招的用户升级后第一次启动即可用。
    //   函数内部自带 try/catch 降级，失败不阻塞启动。
    await healRolloutLineage();
    // 「上游协议」映射必须在引擎起来之前就绪（09-19 代码审查发现，P1）：
    //   `bridgeDial` 是**同步**函数，协议取自内存表 `upstreamProtocols`；而启动链上
    //   第一次 bridgeDial 未必晚于第一次 readCustomModels（例如 codex:request 入口的
    //   兜底改写 `bridgeRewriteProviderConfig`、以及历史别名段补齐）—— 表为空时注册给
    //   桥的协议就回落成 `auto` ⇒ 用户配的「强制 chat」**重启后失效**（表现：重启又不行了、
    //   得再进设置点一次保存）。这里提前读一次（该函数顺带 sync 这张表），幂等且无副作用。
    //   失败只降级（表为空 ⇒ 回落 auto，与旧行为一致，不会阻塞启动）。
    try {
      await readCustomModels();
    } catch (error) { console.warn("[bridge] 预填上游协议映射失败（回落 auto）:", error); }
    /* 委派记录启动自愈（09-24，评估报告 §4.3）：status="running" 是**持久化**的，只有 delegation
       的成功/失败两条路径会清。应用被中断 ⇒ 残留记录永远卡在 running，侧栏状态与头像轨也不会收。
       ⇒ 启动时收成 failed（清 activeThreads）。必须在 server.start() 之前（否则第一次清理前侧栏会显示残留的“运行中”）。
       失败只降级不阻塞启动（与上面几条自愈同口径）。 */
    try {
      const orphanDelegates = await delegateRegistry.reconcileRunning();
      if (orphanDelegates) console.log(`[delegate] 启动自愈：${orphanDelegates} 条残留「运行中」调度记录已收成 failed（治理残留运行中记录）`);
    } catch (error) { console.warn("delegate registry reconcile failed:", error); }
    /* 10-05 补齐两件遗留（登记表只增不减）：
       · forgetDeleted —— 「线程已被删除」但记录还在的幽灵。删除事件可能发生在应用**没运行**时
         （手机上删的、另一个实例删的），事件早没了 ⇒ 拿墓碑集合对账（与侧栏过滤同源）。
       · prune —— 7 天保留期之前**从未被调用过**（方法写好了但没有调用点）。
       都必须包 try/catch：裸 await 抛出会掐死整条启动链（界面能开、引擎不 spawn）。 */
    try {
      const ghosts = await delegateRegistry.forgetDeleted(deletedThreadIds);
      if (ghosts) console.log(`[delegate] 启动对账：${ghosts} 条指向已删除会话的委托记录已清理`);
      const expired = await delegateRegistry.prune();
      if (expired) console.log(`[delegate] 启动清理：${expired} 条过期（>7 天）委托记录已丢弃`);
    } catch (error) { console.warn("delegate registry cleanup failed:", error); }

    /* ⛔⛔ 10-05 统一记忆生命周期清扫：**必须在启动路径上调用**才有意义。
       教训来自上一轮：`DelegateRegistry.prune()` 方法写好了但**全仓无调用点**，
       记录只增不减 ⇒ 等于没写。任何「清理器」不接到启动 = 不存在。
       扫的是工作区记忆目录：① 会话记忆过 90 天 → **归档**（不删，见架构文档 §6）
                              ② 单命名空间超量 → 裁掉最不重要且最久没用的（pinned 永不裁）
       ⛔ 工作区来源 = 已知集合（会话 cwd + 委托登记表），**不猜路径** ——
          对任意目录做读扫描等于越界。 */
    try {
      /* ⛔ 工作区来源 = `threadCwd` 的值（每个会话的 cwd，主进程侧的权威登记）。
         ⛔ 不猜路径：DelegateRecord 里没有 workspace 字段，硬拼一个就是错的工作区
            （清扫错目录比不清扫更糟）。 */
      for (const ws of pickWorkspacesToSweep([...threadCwd.values()])) {
        const swept = await sweepFabric(ws);
        if (swept.archived || swept.trimmed) {
          console.log(`[memory] 启动清扫 ${ws}：归档 ${swept.archived} 条、裁剪 ${swept.trimmed} 条（${swept.namespaces} 个命名空间）`);
        }
      }
    } catch (error) { console.warn("[memory] 启动清扫失败:", error); }
    /* ⛔ 10-28 实测事故：在线更新把 live vendor 目录搬走后落位/回滚都失败，`bin/codex.exe` 消失
       ⇒ 技能 / 钩子 / 插件读取全报 `spawn … ENOENT`（设置页一片红，看着像功能坏了）。
       启动时从上一代备份或上次解压产物搬回来；必须在 server.start() 之前（spawn 时就要能解析到二进制）。 */
    try {
      const healed = await healEngineInstall();
      if (healed.healed) console.log(`[boot] ${healed.message}（来源：${healed.from}）`);
      else if (healed.message !== "引擎在位") console.warn(`[boot] ${healed.message}`);
    } catch (error) { console.warn("[boot] 引擎自愈失败：", error); }
    /* ponytail 自愈（10-30 事故）：引擎 0.16x 要求 marketplace 目录带清单文件，旧布局被丢 ⇒
       插件/技能/钩子一起消失、控制台「写代码模式」开关点了没反应。这里在引擎启动前补齐
       「带清单的本地市场 + 注册段」；引擎自己会扫描加载（无需重启）。
       ⛔ 只在用户**本来就要它**（写代码模式 ≠ off）时执行 —— 不给没装的人偷偷装。 */
    let ponytailNeedsHeal = false;
    try {
      if ((await getPonytailMode()) !== "off") {
        const bundled = existingToolPath("ponytail-plugin") || path.join(toolsRoot(), "ponytail-plugin");
        // 先把「带清单的本地市场 + 注册段」落盘（必须早于 server.start：引擎启动时扫市场）
        await ensurePonytailPlugin(codexHome, bundled);
        ponytailNeedsHeal = true;
      }
    } catch (error) { console.warn("[boot] ponytail 自愈检查失败：", error); }
    await server.start();
    // 引擎起来后再补注册 + 按 currentHash 信任钩子（失败不阻塞启动）
    if (ponytailNeedsHeal) void healPonytailInstall().catch((error) => console.warn("[boot] ponytail 自愈失败：", error));
  } catch (error) {
    broadcastCodexEvent({ kind: "status", status: "error", message: String(error) });
  }
  // ⛔ 调度 MCP 的 HTTP 执行端必须**无条件**启动（不依赖是否配了自定义模型）：
  //    它是 /mcp 端点的宿主，引擎按 config.toml 的 url 连的就是它；没起 = 工具永远注册不上。
  void ensureDispatchHttp();
  // 自愈：catalog 每次启动都重写（幂等），确保包含所有启用供应商的模型。
  // ⛔ 09-16：**不再检查、也不再写顶层 model_context_window**（该键已废弃 —— 它是引擎的全局
  // 单值，会覆盖 catalog 里每个模型各自的 context_window，表现为「只有默认那个模型的上下文
  // 生效」，用户实测）。**别恢复这个检查**：删掉写入后 `written !== wanted` 会恒为真
  // （written 恒 0、wanted 恒正数）→ 每次启动都整份重写 config.toml。
  if (custom) {
    try {
      // catalog 每次启动都重写（幂等）：确保包含所有启用供应商的模型——
      // 旧会话切换到任何供应商的模型时引擎都查得到，不会报「不支持」。
      await writeModelCatalogToml(custom);
      const configText = await fs.readFile(path.join(codexHome, "config.toml"), "utf8").catch(() => "");
      const environmentOutdated = !configText.includes("[shell_environment_policy.set]") || !configText.includes("PYTHON_EXECUTABLE");
      // ⛔ 与**写出内容逐字同源**地比对（09-20 修）：旧写法只 grep `"Never infer Python availability"`
      //    —— 这句老配置里本来就有 ⇒ 该判据恒为 false ⇒ 指令升级永远不落地（本轮实测踩到：
      //    技能文件已更新、config.toml 的 developer_instructions 还是旧文案）。
      //    这里用与 applyCustomModel 完全相同的输入重新生成整行：命中即最新；
      //    输入同源 ⇒ 不会恒 true（否则每次启动整份重写，09-16 踩过）。
      const devInputNow = await devInstructionsInput();
      const instructionsOutdated = !configText.includes(developerInstructionsLine(devInputNow));
      // ⛔ 09-16：废止键残留检查 —— 老版本把顶层 model_context_window 写成全局单值（会覆盖
      //    catalog 里每模型的上下文）。升级后必须**主动清掉已写下的旧值**：preserveUserConfig
      //    会丢弃该键，所以整份重写一次它就消失、下次启动不再触发（幂等）。
      //    没这个检查时，若其它漂移条件恰好都不满足就不会重写 → 旧值一直生效，用户重启后 bug 依旧
      //    （教训：「删掉写入」不等于「清掉已写下的值」）。
      const legacyContextKey = /^\s*model_context_window\s*=/m.test(configText);
      /* ⛔ 自动压缩阈值漂移（09-25 加；code review 抓到）。上面所有判据都只问「键在不在 / 模型对不对」，
         没有一个会因「压缩比例变了」而重写 ⇒ 改了设置页那个下拉（只写 app-settings.json）、
         或改了 `DEFAULT_AUTO_COMPACT_RATIO` 默认值，**config.toml 里的旧阈值会一直生效**
         —— 正是本项目反复踩的「删掉写入 ≠ 清掉已写下的值」那一类。
         ⛔ 期望值必须与 applyCustomModel 的算法**逐字同源**（同一个 normalizeAutoCompactRatio、
            同一个 activeContext 表达式、同一个 Math.round），否则要么恒 false（永不落地）、
            要么恒 true（每次启动整份重写 —— 09-16 踩过）。跨文件不同源由守卫【159】钉住。 */
      const compactWindow = Number(custom.models?.find((m: any) => m.id === custom.model)?.contextWindow ?? custom.contextWindow ?? 128000);
      const compactApplied = await readAppSettings(app.getPath("userData"));
      const expectedCompact = Math.round(compactWindow * normalizeAutoCompactRatio(compactApplied.autoCompactRatio));
      const compactStale = !new RegExp(`model_auto_compact_token_limit = ${expectedCompact}\\b`).test(configText);
      // ⛔⛔ 09-28 键位迁移残留（0.157.1 实测）：旧写入器把 model_auto_compact_token_limit /
      //    _scope / model_max_output_tokens 写在**各 provider 段内**，0.157.1 已不认
      //    ⇒ 每次启动引擎报 N 条「unrecognized configuration settings」（用户截图：弹两条重复
      //    警告）。⚠️ 判据不能用缩进区分（写入器的段内键本就无缩进）——按 TOML 语义逐行扫：
      //    「段内出现旧键」或「顶层（首个 [table] 之前）没有 auto_compact 行」都算残留；
      //    命中 ⇒ 整份重写一次即收敛（新写入器：顶层三行 + 段内零旧键）。
      //    误判代价 = 多一次整份重写（幂等无害）；developer_instructions 多行串内恰有一行
      //    以这些键开头的概率忽略不计。
      const compactKeyResidue = (() => {
        let inTable = false;
        let topLevelCompactSeen = false;
        for (const raw of configText.split(/\r?\n/)) {
          const line = raw.trim();
          if (/^\[/.test(line)) { inTable = true; continue; }
          if (/^model_auto_compact_token_limit\s*=/.test(line)) {
            if (inTable) return true;
            topLevelCompactSeen = true;
          }
          // ⛔ 顶层 scope 非法值（09-28 用户现场）：scope 在 0.157.1 是枚举 total /
          //    body_after_prefix，旧写入器写过 "model" ⇒ 整份配置解析失败（using defaults
          //    ⇒ 供应商全丢）。出现即重写（新写入器已不写 scope）。
          if (!inTable && (/^model_auto_compact_token_limit_scope\s*=\s*"model"/.test(line) || /^model_max_output_tokens\s*=/.test(line))) return true;
        }
        return !topLevelCompactSeen;
      })();
      // 供应商/模型漂移：custom-model.json（当前激活）与 config.toml 顶层 model / model_provider 不一致时重写。
      // 场景：UI 切换供应商只保存配置（延迟生效），用户没点「重启生效」就退出应用——下次启动必须
      // 按新配置生效，否则引擎继续跑旧供应商（self-heal 原只查 context_window，查不出这种漂移）。
      const cfgModel = /^\s*model\s*=\s*"([^"]*)"/m.exec(configText)?.[1];
      const cfgProvider = /^\s*model_provider\s*=\s*"([^"]*)"/m.exec(configText)?.[1];
      const providerOutdated = cfgModel !== custom.model || (custom.provider !== "openai-official" && cfgProvider !== custom.provider);
      // 禁用供应商的 provider 段必须保留在 config.toml：历史线程 resume 时按创建时的
      // model_provider 加载配置，段被移除会报 "Model provider `X` not found" → 会话内容全空。
      // 旧版本 applyCustomModel 写配置时过滤了禁用供应商——检测到缺失就整份重写补回。
      const disabledMissing = (await readCustomModels()).some((candidate: any) => candidate.enabled === false && !configText.includes(`[model_providers.${candidate.provider}]`));
      // 调度 MCP（harness-dispatch）：段缺失（老配置）/ 重复（09-16 保留机制漏排除的历史文件）
      // 都触发重写。⛔ 端口已固定、令牌已持久化 → url 跨运行稳定，不再有「每次启动都过期」的问题；
      // 但仍要校验端口/令牌真的对得上（旧版本写过随机端口的历史文件必须被纠正）。
      const dispatchMcpCount = (configText.match(/\[mcp_servers\.harness-dispatch\]/g) || []).length;
      await ensureDispatchToken(); // 令牌持久化在文件里，这里读出来才能比对配置是否过期
      const dispatchMcpBad = dispatchMcpCount !== 1 || !configText.includes(`:${DISPATCH_FIXED_PORT}/mcp`) || !configText.includes(getDispatchToken());
      // ⛔ 安装目录漂移（09-19 用户：「还有没有绝对路径的，通通查出来了解决掉」）：
      //   上面所有检查都只问「键**在不在**」，不问「路径**还对不对**」。而 config.toml 里的
      //   PATH / PYTHON / PYTHONHOME / tools 相关绝对路径是**按当时的安装目录生成**的 ——
      //   应用一搬家（便携版换盘、改名、D:\10\… → D:\…），这些路径全部指向旧目录，
      //   且因为别的漂移条件都不满足而**永远不会自愈** ⇒ exec 与工具调用莫名失败、
      //   任务莫名中断（真机证据：config.toml 的 PATH 首项与实际安装目录不符）。
      //   这里补上「安装目录漂移」检查：当前应有的首个 PATH 项不在配置里就整份重写。
      const cfgPathLine = /^\s*PATH\s*=\s*"([^"]*)"/m.exec(configText)?.[1] ?? "";
      const expectedFirst = augmentedPath().split(path.delimiter)[0] ?? "";
      // ⛔ 切分必须用 path.delimiter（09-20 mac 审计抓到的真缺口）：mac 上 PATH 分隔符是 `:`，
      //   写死 `;` 会把整条 PATH 当成一个元素 → 与 expectedFirst 永不相等 → **每次启动都误判
      //   「安装目录漂移」并整份重写 config.toml**。上面 expectedFirst 已经用了 path.delimiter，
      //   两处口径必须一致。
      const envPathStale = Boolean(expectedFirst)
        && !cfgPathLine.replace(/\\\\/g, "\\").split(path.delimiter).map((entry) => entry.trim()).filter(Boolean).includes(expectedFirst);
      // 覆盖表读失败按「启用」兜底：真坏了 applyCustomModel 自己也会抛（那条 try/catch 负责收尾），
      // 不该因为一个损坏的 json 把整段自愈判据一起带崩。
      // ⛔ 10-30 撤 nuphus 视觉 env 漂移判据：视觉辅助插件整体移除后
      //    原 nuphus-env 纯函数已删，老 config.toml 的残留 env 段由 preserveUserConfig 收敛（与「不需要 env」分支同型）。
      if (legacyContextKey || providerOutdated || environmentOutdated || envPathStale || instructionsOutdated || disabledMissing || dispatchMcpBad || compactStale || compactKeyResidue) {
        console.warn(`[custom-model] config drift: providerOutdated=${providerOutdated}, environment=${environmentOutdated}, envPathStale=${envPathStale}, instructions=${instructionsOutdated}, disabledMissing=${disabledMissing}, dispatchMcpCount=${dispatchMcpCount}, compactStale=${compactStale}(期望 ${expectedCompact}), compactKeyResidue=${compactKeyResidue}; rewriting`);
        await applyCustomModel(custom);
      }
    } catch (error) {
      console.warn("[custom-model] config self-heal failed:", error);
    }
  } else {
    // 没配自定义模型（如被清空/首次运行）：config.toml 也要保证有调度 MCP 段，
    // 否则引擎起来后连不上 → 工具永远注册不上。直接做一次最小重写。
    try {
      await ensureDispatchToken();
      const cfgPath = path.join(codexHome, "config.toml");
      const existing = await fs.readFile(cfgPath, "utf8").catch(() => "");
      const block = `[mcp_servers.harness-dispatch]\nurl = "http://127.0.0.1:${DISPATCH_FIXED_PORT}/mcp?token=${getDispatchToken()}"\nstartup_timeout_sec = 60\n`;
      const count = (existing.match(/\[mcp_servers\.harness-dispatch\]/g) || []).length;
      if (count !== 1 || !existing.includes(`:${DISPATCH_FIXED_PORT}/mcp`) || !existing.includes(getDispatchToken())) {
        const cleaned = existing.replace(/\[mcp_servers\.harness-dispatch\][^\[]*/g, "").replace(/\[mcp_servers\.harness-dispatch\.env\][^\[]*/g, "");
        await fs.writeFile(cfgPath, cleaned.trimEnd() + "\n\n" + block, "utf8");
      }
    } catch (error) {
      console.warn("[dispatch] MCP 段兜底写入失败：", error);
    }
  }
  // 启动副作用一律「尽力而为」：这里任何一处抛出都会让 whenReady 的 promise 变成
  // unhandled rejection，**整条启动链就此中断、引擎根本不 spawn** —— 表现是「界面能打开、
  // 发消息完全没有回复」，且日志里只有一行 EPERM（实测：memory-mode.json 写不进去，
  // 例如被安全软件/同步盘占用或磁盘满）。周边 channelBot.configure 早已是 try/catch，
  // 这三处漏了，补齐；记忆模式/调度/远端的失败都只降级、不影响会话可用。
  try { await applyMemoryMode(await readMemoryMode()); }
  catch (error) { console.warn("[boot] applyMemoryMode failed (降级继续):", error); }
  try { await scheduler.start(); }
  catch (error) { console.warn("[boot] scheduler.start failed (降级继续):", error); }
  try { await remote.start(); }
  catch (error) { console.warn("[boot] remote.start failed (降级继续):", error); }
  // Git 自动安装（后台、不阻塞）：瘦身版不再内置 git，引擎 shell 依赖它，缺就静默补装
  // （函数内部自带 catch 与 done 事件广播，不会冒泡成 unhandled rejection）
  void autoInstallGitIfNeeded();
  // 保留 provider id 自愈（09-19 真实用户事故）：老版本档案里存过 provider=openai →
  // config.toml 写成 [model_providers.openai] → 引擎**整份拒载**，用户发消息必报错。
  // 启动时把已写坏的段清掉并修正档案，让这类用户升级后自动恢复（不必手动改文件）。
  void healReservedProviderConfig();
  // 血缘自愈已移到 `server.start()` **之前**（见上方：引擎起来后再改同一次运行内不生效）。
  // ponytail 写代码模式插件 —— ⛔ 09-27 起改为**默认不种**（用户：写代码模式写的很烂、
  //   且「一切可下载的拓展都按需安装」是引擎初始化原则）：
  //   旧逻辑 = 全新安装（config 里无 ponytail@ponytail 段）就自动种 enabled=true，导致每个
  //   新会话都注入 ponytail 及其 6 个子技能（实测 ~640 token/次），与「按需安装」原则相悖。
  //   现在的行为：**不自动种**。想用：开发工具页「ponytail 写代码模式插件」卡片手动安装
  //   （runtime:install id=ponytail，见 04-dev-runtime-install.ts:149 —— 路径保留未动）；
  //   已装用户不受影响（config 里的段还在就是还在，卸载语义同样不变）。
  //   ⛔ 守卫【26】已同步：断言从「自动种被调用」改为「自动种不被调用」（见 06-app-behavior.mjs）。
  // 微信机器人网关：扫码登录 → 微信消息 → Codex 会话处理 → 回复发回微信
  const weixinGw = new WeixinGateway(path.join(app.getPath("userData"), "weixin-accounts"), {
    onMessage: (message) => void handleWeixinMessage(message),
    log: (level, message) => {
      channelLogs.push({ at: Date.now(), level, message });
      persistChannelLog(level, message);
      sendToWindow("channel-bot:event", { level, message, at: Date.now(), status: channelBot.status() });
    },
  });
  setWeixinGateway(weixinGw);
  void weixinGw.resume();
  void telegramGateway.resume().catch(() => undefined);
  void feishuGateway.resume().catch(() => undefined);
  void dingtalkGateway.resume().catch(() => undefined);
  void qqGateway.resume().catch(() => undefined);
  void wecomWebhookGateway.resume().catch(() => undefined);
  try {
    await channelBot.configure(await readChannelBot());
  } catch (error) {
    channelLogs.push({ at: Date.now(), level: "error", message: `频道机器人启动失败：${String(error)}` });
    sendToWindow("channel-bot:event", { level: "error", message: `频道机器人启动失败：${String(error)}`, at: Date.now(), status: channelBot.status() });
  }
}
