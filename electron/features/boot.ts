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
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { WeixinGateway } from "../weixin-gateway";
import { markBoot } from "../boot-timing";
import { debugMemoryCapture } from "../memory-capture-debug";
import { sendToWindow } from "./window-bus";

import { shouldRegisterNuphus } from "../automation-policy";
import { BotStreamSession, readBotStreamSettingsSync } from "../bot-stream";
import { ensureBuiltinSkills, ensureExpertSkillsMarketplace } from "../builtin-skills";
import { developerInstructionsLine } from "../developer-instructions";
import { broadcastCodexEvent, broadcastHarnessEvent } from "./window-bus";
import { nuphusVisionEnvDrift } from "../nuphus-env";
import { applyPersonalizationToAgentsMd, migrateGreetedForExistingUsers, readPersonalization } from "../personalization";
import { ensurePonytailPlugin } from "../ponytail-plugin";
import { repairSkillBomScan } from "../skills-market";
import { augmentedPath, nuphusBinary, toolsRoot } from "../toolchain";
import { net, safeStorage, session } from "electron";
import { pathToFileURL } from "node:url";

// ── 由 main.ts 注入的顶层依赖（同名声明 ⇒ 块体保持逐字不变）──
let codexHome!: any;
let loadDeletedThreads!: any;
let responsesBridge!: any;
let userSkillsDir!: any;
let ensureBuiltinReviewer!: any;
let refreshSkillDiscipline!: any;
let readCustomModel!: any;
let server!: any;
let isInsideTrustedRoots!: any;
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
  responsesBridge = deps.responsesBridge;
  userSkillsDir = deps.userSkillsDir;
  ensureBuiltinReviewer = deps.ensureBuiltinReviewer;
  refreshSkillDiscipline = deps.refreshSkillDiscipline;
  readCustomModel = deps.readCustomModel;
  server = deps.server;
  isInsideTrustedRoots = deps.isInsideTrustedRoots;
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

export async function bootApp() {
  markBoot("app-ready");   // 启动耗时测量（见 electron/boot-timing.ts）
  await fs.mkdir(codexHome, { recursive: true });
  // 已删除会话的墓碑必须在**第一次 thread/list 之前**载入：渲染层启动就会拉列表，靠懒加载
  // 会让首屏短暂出现幽灵会话（见 purgeDeletedThread 注释）。失败不阻塞启动。
  try { await loadDeletedThreads(); } catch (error) { console.warn("deleted-threads 载入失败：", error); }
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
  // 内置「评审」子智能体（09-21）：用干净上下文复审的现成对象。⚠️ 必须包 try/catch ——
  // 启动链里一处裸 await 抛出会掐死整条链（界面能开、核心服务没起来，日志只有一行）。
  try { await ensureBuiltinReviewer(); } catch (error) { console.warn("[reviewer] 内置评审子智能体种入失败（不影响启动）：", error); }
  // 启动自愈：剥掉已安装技能 SKILL.md 的 UTF-8 BOM。带 BOM 的文件引擎会判「缺 frontmatter」
  // 整份拒载（装了但永远不被使用），市场包/本地导入都可能带 BOM——这里兜住存量文件。
  try {
    const bomFixed = await repairSkillBomScan(userSkillsDir);
    if (bomFixed > 0) console.log(`[skills] 修复 ${bomFixed} 个带 BOM 的 SKILL.md`);
  } catch (error) { console.warn("skill BOM repair failed:", error); }
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
  protocol.handle("harness-image", async (request) => {
    let imagePath = new URL(request.url).searchParams.get("path");
    if (!imagePath) return new Response("Missing path", { status: 400 });
    // 双编码兼容：渲染层传的是双编码路径（Chromium 会自行解一层）；若解出来还不是
    // 盘符/根路径形态，再手动解一层（兼容旧的单编码 URL）。
    if (!/^[a-zA-Z]:[\\/]/.test(imagePath) && !imagePath.startsWith("/")) {
      try { imagePath = decodeURIComponent(imagePath); } catch { /* 原样使用 */ }
    }
    // ⛔ 收敛到「图片 + 可信根内」（09-13 审计 S5）：这个协议注册在**默认 session** 上，
    // 而渲染层要渲染模型输出 / 内置浏览器里的网页 / 渠道消息 —— 不收敛就等于给它们一个
    // `harness-image://img/?path=C:/任意文件` 的任意文件读取原语。
    // 允许：常见图片扩展名，且落在 userData / images 缓存目录 / 任一已知会话工作目录内。
    if (!/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(imagePath)) {
      return new Response("Unsupported media type", { status: 415 });
    }
    {
      const resolved = path.resolve(imagePath);
      if (!isInsideTrustedRoots(resolved)) return new Response("Forbidden", { status: 403 });
      imagePath = resolved;
    }
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
  server.on("event", (event: any) => {
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
          void (async () => {
            const changed = event.method === "thread/deleted"
              ? await threadRuntimeStore.remove(goneId)
              : await threadRuntimeStore.releaseDispatch(goneId);
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
      } else if (/^turn\/(completed|aborted|failed|interrupted)$/.test(METHOD)) {
        const id = turnIdOf(p);
        if (id) engineActiveTurnIds.delete(id);
        else if (threadIdOf) {
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
      // 回合结束：流式会话负责最终回复；「正在输入」指示器这时要收掉
      if (event.method === "turn/completed") stopWeixinTyping(String(p?.threadId ?? ""));
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
      } else if (event.method === "item/completed" && p?.item?.type === "agentMessage" && p.item.text) {
        const buffer = peekCaptureBuffer(String(p.threadId), turnIdOf(p));
        if (buffer) buffer.assistant = p.item.text;
      } else if (event.method === "turn/completed") {
        if (!internalThreads.has(String(p?.threadId))) for (const forward of remoteEventForwarders) forward({ threadId: p?.threadId, kind: "done", text: "" });
      }
      // ⛔ 中断 / 失败的回合也必须释放缓冲：否则它永久留在 Map 里，
      //    下一次兜底会错取到它（L2 记忆串台到上一回合）
      if (/^turn\/(aborted|failed|interrupted)$/.test(String(event.method ?? ""))) {
        takeCaptureBuffer(String(p?.threadId ?? ""), turnIdOf(p));
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
          void workspaceMemoryEnabled(buffer.cwd).then((enabled: any) => memoryStore.captureTurn(p?.threadId ?? "", buffer.user, buffer.assistant, { workspace: buffer.cwd, includeWorkspace: enabled })).catch((error: any) => sendToWindow("harness:event", { type: "memory", message: `Memory Gateway 捕获失败：${error.message}`, at: Date.now() }));
        }
        // 会话结束自动蒸馏：主进程内部节流（6 小时一次），异常全吞，绝不影响主流程
        if (buffer.cwd) {
          void workspaceMemoryEnabled(buffer.cwd).then((enabled: any) => {
            if (!enabled) return null;
            return memoryLayers.autoDistill(buffer.cwd!, distillSummarize).then((result: any) => {
              if (result?.ok) sendToWindow("harness:event", { type: "memory", message: `记忆自动蒸馏完成：${result.dates.length} 天日志已提炼进项目记忆`, at: Date.now() });
              return result;
            });
          }).catch(() => undefined);
        }
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
       的成功/失败两条路径会清。应用被中断 ⇒ 残留记录让 runningCount() 只增不减，攒满
       MAX_CONCURRENT_DISPATCH(4) 后 **永久拒绝所有委派**（跨重启累积，prune 只清 finished 救不了）。
       ⛔ 必须在任何 admitDispatch 之前跑完 —— 放在 server.start() 之前的启动链上最稳。
       失败只降级不阻塞启动（与上面几条自愈同口径）。 */
    try {
      const orphanDelegates = await delegateRegistry.reconcileRunning();
      if (orphanDelegates) console.log(`[delegate] 启动自愈：${orphanDelegates} 条残留「运行中」调度记录已收成 failed（否则并发闸会被永久占满）`);
    } catch (error) { console.warn("delegate registry reconcile failed:", error); }
    await server.start();
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
      // ⛔ nuphus 视觉 env 漂移（09-20，与上面的「安装目录漂移」同一类：只问「键在不在」不够）：
      //   用户改插件里的 key / model 时上面所有判据都不动 ⇒ 不重写 ⇒ nuphus 仍拿旧 key。
      //   判定抽成纯函数（nuphus-env.ts）——「恒真 ⇒ 每次启动整份重写」是这里最危险的失效模式，
      //   内联在 main.ts 里只能 grep 断言，抽出来预检才能跑真行为断言（含收敛性）。
      // 覆盖表读失败按「启用」兜底：真坏了 applyCustomModel 自己也会抛（那条 try/catch 负责收尾），
      // 不该因为一个损坏的 json 把整段自愈判据一起带崩。
      const nuphusRegisteredNow = shouldRegisterNuphus({ desktop: devInputNow.desktop, browser: devInputNow.browser })
        && Boolean(nuphusBinary()) && mcpOverrideEnabled(await readMcpOverrides().catch(() => ({} as any)), "nuphus");
      const nuphusVisionStale = nuphusVisionEnvDrift({
        vision: devInputNow.nuphusVision,
        registered: nuphusRegisteredNow,
        configText,
        escape: escapeToml,
      });
      if (legacyContextKey || providerOutdated || environmentOutdated || envPathStale || instructionsOutdated || nuphusVisionStale || disabledMissing || dispatchMcpBad) {
        console.warn(`[custom-model] config drift: providerOutdated=${providerOutdated}, environment=${environmentOutdated}, envPathStale=${envPathStale}, instructions=${instructionsOutdated}, nuphusVision=${nuphusVisionStale}, disabledMissing=${disabledMissing}, dispatchMcpCount=${dispatchMcpCount}; rewriting`);
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
  // ponytail 写代码模式插件随包直装（09-16 用户「直接内置，不用解压啥的」）：生产包必有
  // tools/ponytail-plugin。只在 config.toml **完全没有** ponytail 注册段时自动种（全新安装）；
  // 段已存在（已装/用户显式卸载置 false）就不再动 —— 否则卸载后下次启动又给装回来，卸载失效。
  // 失败降级不阻塞启动，开发工具页按钮仍可手动种。必须在 server.start() 之后——要写 config.toml。
  try {
    const bundledPonytail = path.join(toolsRoot(), "ponytail-plugin");
    const ponytailCache = path.join(codexHome, "plugins", "cache", "ponytail");
    if (bundledPonytail && existsSync(bundledPonytail) && !existsSync(ponytailCache)) {
      const configText = await fs.readFile(path.join(codexHome, "config.toml"), "utf8").catch(() => "");
      if (!configText.includes('ponytail@ponytail')) {
        // ensurePonytailPlugin 自己就把注册段（含 enabled = true）写进 config.toml，这里不再额外
        // 走 config/value/write —— 引擎要求该请求必带 mergeStrategy，多于一次写只是多一个失败点。
        void ensurePonytailPlugin(codexHome, bundledPonytail)
          .catch((error) => console.warn("[boot] ponytail auto-seed failed (降级继续):", error));
      }
    }
  } catch (error) { console.warn("[boot] ponytail auto-seed failed (降级继续):", error); }
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
