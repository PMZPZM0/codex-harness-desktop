/**
 * memory-ipc（10-03 从 `features/memory-rpa-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：memory(17 通道 + gateway/backend/mcp/hygiene 子面)
 *
 * 为什么拆出来：原 `memory-rpa-ipc.ts` 一个板块承载 memory / rpa / tasks / scheduler 四个前缀，
 * 其中 `memory` 一家就占了绝大部分（记忆金字塔 + 后端切换 + MCP 安装器 + 整洁清理），
 * 混在一起时"记忆"这个功能的边界完全看不出来。
 *
 * ⛔⛔ 三条不能动的实证口径（本次纯搬迁，一字未改）：
 *   1. **切换后端必须当场落盘并同步**（09-25 用户实测报障：「切到本地记忆 MCP 了，但技能没配套」）——
 *      ① `ensureBuiltinSkills` 做 memory-classify ⇄ memory-mcp-backend 互斥改名；
 *      ② `syncLocalMemoryConnector` 同步连接器启用态。两处都 try/catch（设置已存成功，
 *      同步失败不能让整次切换看起来像"没切成"）。
 *   2. **MCP 安装器一律用应用自带的 node**（装与跑同 ABI；新电脑无需预装 Node.js），且显式传
 *      `CODEX_HARNESS_USER_DATA` —— 否则数据目录自定义后会装到旧锚点，引擎找不到 =「装不上」。
 *   3. **`memory:hygiene:apply` 必须 `confirm === true` + 动作走白名单** —— 冷存档是真删，
 *      守卫【107】盯着这两条。
 * ⛔ `memoryMcpBusy` / `runMemoryInstaller` 只服务本域 ⇒ 随板块走（防连点并发，npm install 很重）。
 * ⛔ 待接缝化（阶段 2）：app / safeStorage / spawn / fs 均为宿主能力，将来经接缝注入。
 */
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { app } from "electron";
import { saveAppSettings } from "../app-settings";
import { ensureBuiltinSkills } from "../builtin-skills";
import { bundledNodePath, memoryBackendStatus, memoryInstallerPath, type MemoryBackend } from "../memory-backend";
import { lookupRoleSession, listRoleSessions } from "../role-memory";
import { agentOfRoleRef, handleFabricWrite } from "../memory-fabric-tool";
import { buildContext, getMemoryHandles, listNamespaces, readNamespace } from "../memory-fabric";
import { syncLocalMemoryConnector } from "../memory-mcp-connector";
import { CLEANUP_RULES, HYGIENE_ACTION_LABEL, isHygieneAction, planHygiene, suggestedActions } from "../memory-hygiene";
import type { MemoryCategory, MemoryRemoteConfig } from "../memory-store";
import { applyMemoryMode, readMemoryMode, readWorkspaceMemorySettings, workspaceMemoryEnabled } from "../main/05-memory-mode";
import { distillSummarize } from "../main/03-turn-summary";
import { readMemoryGateway } from "../main/08-channel-bot-io";
import { memoryGatewayFile, memoryLayers, memoryStore, memoryWorkspaceFile } from "../runtime-refs";
import { MEMORY_SCALE_OPTIONS } from "../memory-layers";
import { userSkillsDir } from "../main";
import type { MemoryMode, StoredMemoryGateway } from "../main";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import type { HostCaps } from "../runtime/seams";

async function setWorkspaceMemoryEnabled(workspace: string, enabled: boolean): Promise<boolean> {
  const key = path.resolve(workspace);
  const settings = await readWorkspaceMemorySettings();
  settings[key] = Boolean(enabled);
  await fs.mkdir(path.dirname(memoryWorkspaceFile), { recursive: true });
  await fs.writeFile(memoryWorkspaceFile, JSON.stringify(settings, null, 2), "utf8");
  return settings[key];
}

async function saveMemoryGateway(input: any) {
  const previous = await readMemoryGateway();
  const config: MemoryRemoteConfig = {
    endpoint: String(input.endpoint ?? "").trim().replace(/\/$/, ""),
    sessionKey: String(input.sessionKey ?? "").trim(),
    userId: String(input.userId ?? "codex-harness").trim(),
    apiKey: String(input.apiKey ?? "").trim() || previous?.apiKey || "",
  };
  if (config.endpoint && !/^https?:\/\//.test(config.endpoint)) throw new Error("Memory Gateway 地址必须使用 http 或 https");
  if (config.endpoint && (!config.sessionKey || !config.userId)) throw new Error("Gateway 模式需要 session key 和 user ID");
  if (config.apiKey && !secureHost().isEncryptionAvailable()) throw new Error("当前系统无法安全保存 Memory Gateway Key");
  await fs.writeFile(memoryGatewayFile, JSON.stringify({ endpoint: config.endpoint, sessionKey: config.sessionKey, userId: config.userId, encryptedApiKey: config.apiKey ? secureHost().encryptString(config.apiKey).toString("base64") : undefined } satisfies StoredMemoryGateway, null, 2), "utf8");
  // 填了网关地址就切到云端（Codex 从此去云端找记忆），清空地址则回到本地
  await applyMemoryMode(config.endpoint ? "cloud" : "local");
  return { ...memoryStore.remoteStatus(), sessionKey: config.sessionKey, userId: config.userId, hasApiKey: Boolean(config.apiKey) };
}

let memoryMcpBusy = false; // ⛔ 防连点并发（npm install 很重，并发会互相踩 node_modules）

/** 记忆容量倍率的读回体：read / set **同一形状** —— 渲染层拿它整体替换状态，少一个字段就会出现
 *  「设置完水位条不更新」那类安静 bug（09-22 的 layers:write 踩过同型）。 */
function memoryScalePayload() {
  const b = memoryLayers.budget;
  return {
    scale: memoryLayers.getScale(),
    options: [...MEMORY_SCALE_OPTIONS],
    budget: { user: b.user, background: b.background, project: b.project, lessons: b.lessons, logs: b.logs, total: b.total },
  };
}

async function runMemoryInstaller(extra: string[]): Promise<{ code: number | null; result: any; log: string }> {
  if (memoryMcpBusy) throw new Error("已有安装/卸载正在进行，请稍候");
  const nodeExe = bundledNodePath();
  const script = memoryInstallerPath();
  if (!existsSync(nodeExe)) throw new Error(`找不到应用自带的 node：${nodeExe}`);
  if (!existsSync(script)) throw new Error(`找不到安装器：${script}`);
  memoryMcpBusy = true;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(nodeExe, [script, ...extra], {
        windowsHide: true,
        env: {
          ...process.env,
          NODE_OPTIONS: "",
          // ⛔ 安装器的落点必须与引擎找服务的目录一致：显式传当前 userData（数据目录自定义后
          //    安装器自己解析只会拿到硬编码旧锚点 ⇒ 装到 C 盘旧目录、引擎在 D:\11 找不到 =「装不上」）
          CODEX_HARNESS_USER_DATA: app.getPath("userData"),
        },
      });
      let out = "", err = "";
      const timer = setTimeout(() => {
        try { child.kill(); } catch { /* 已退出 */ }
        reject(new Error("安装超时（10 分钟）：可能是网络取不到 npm registry"));
      }, 10 * 60 * 1000);
      child.stdout.on("data", (d) => { out += d.toString(); });
      child.stderr.on("data", (d) => { err += d.toString(); });
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("close", (code) => {
        clearTimeout(timer);
        const line = out.trim().split("\n").filter(Boolean).pop() ?? "";
        let parsed: any = null;
        try { parsed = JSON.parse(line); } catch { /* 非 JSON 行（崩了） */ }
        resolve({ code, result: parsed, log: err.split("\n").filter(Boolean).slice(-12).join("\n") });
      });
    });
  } finally {
    memoryMcpBusy = false;
  }
}

const MEMORY_CHANNELS = [
  "memory:list", "memory:search", "memory:recall", "memory:mode-read", "memory:mode-set",
  "memory:scale:read", "memory:scale:set",
  "memory:backend:read", "memory:backend:set", "memory:mcp:install", "memory:mcp:uninstall", "memory:mcp:verify",
  "memory:save", "memory:delete", "memory:reset", "memory:gateway:read", "memory:gateway:save", "memory:gateway:test",
  "memory:layers:read", "memory:layers:context", "memory:layers:write",
  "memory:workspace-enabled:read", "memory:workspace-enabled:set",
  "memory:distill", "memory:hygiene:plan", "memory:hygiene:apply",
  "memory:fabric-namespaces", "memory:fabric-entries",
  "memory:role-context",
];

/**
 * 宿主密钥能力（10-03 阶段 2b 由 electron 的 safeStorage 改为接缝注入）。
 *
 * ⛔ bind 注入的原因：本域的加解密在**模块级函数** `saveMemoryGateway` 里用，不接收 ctx。
 * ⛔ 未注入时明确抛错，不静默返回 undefined。
 */
let secureRef: HostCaps["secure"] | null = null;
export function bindMemorySecure(host: HostCaps): void {
  secureRef = host.secure;
}
function secureHost(): HostCaps["secure"] {
  if (!secureRef) throw new Error("memory-ipc: 宿主密钥能力未注入（组合表挂载时应调 bindMemorySecure）");
  return secureRef;
}

export const memoryFeature = defineFeature<null>({
  id: "memory",
  inject: ["ipc", "host"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    bindMemorySecure(ctx.get<HostCaps>("host")!);   // 供模块级函数惰性取用（【91】：不在模块体求值）
    if (!ipcHost) throw new Error("memory: 缺少 ipc 服务（宿主未提供）");

    /* ── 统一记忆（fabric）只读通道 ─────────────────────────────────────────
       ⛔⛔ 这两个通道是**前端能看见新记忆的唯一入口**（10-05 用户报「前端不好看、
          不好区分」的根因：新作用域的条目前端一个都没接，只看得到旧碎片池）。
       · fabric-namespaces：命名空间概览（两种作用域 + 条数 + 字符数）⇒ 前端做分区
       · fabric-entries   ：某个命名空间的条目（含来源智能体 / 权重 / 归档态）⇒ 前端做卡片
       ⛔ 只读：删除/编辑走既有管理通道，⛔ 不在这里开写口（避免两条写入路径）。
       ⛔ 工作区**必须由前端传**：「当前管理项目」是渲染层状态（bag.memoryManagementWorkspace），
          主进程没有 ⇒ 传空就返回空列表（⛔ 不猜路径：对任意目录读扫描等于越界）。 */
    ipcHost.handle("memory:fabric-namespaces", async (_event, workspace?: string) => {
      const ws = String(workspace ?? "");
      if (!ws) return [];
      return listNamespaces(ws);
    });
    ipcHost.handle("memory:fabric-entries", async (_event, input: { workspace?: string; namespace?: string; includeArchived?: boolean }) => {
      const ws = String(input?.workspace ?? "");
      const ns = String(input?.namespace ?? "");
      if (!ws || !ns) return [];
      const entries = await readNamespace(ws, ns);
      /* ⛔ 默认过滤已归档（与内核的检索口径一致）—— 前端要显式勾选才看得到历史。 */
      const list = input?.includeArchived ? entries : entries.filter((e) => e.archivedAt == null);
      /* ⛔ 排序：重要度降序 → 时间新优先（与注入顺序一致，前端所见 = 模型所读）。 */
      return list.sort((a, b) => b.weight - a.weight || b.createdAt - a.createdAt);
    });

    /* 会话↔角色归属表（10-05 记忆前端用）：fabric 的命名空间只带 threadId，
       前端要靠它把条目归到「哪位专家/哪个子智能体」名下。⛔ 只读，不开写口。 */
    ipcHost.handle("memory:role-sessions", async () => listRoleSessions(app.getPath("userData")));

    ipcHost.handle("memory:list", (_event, category?: string) => memoryStore.list(category));
    ipcHost.handle("memory:search", (_event, query: string, workspace?: string) => memoryStore.search(query, 8, { workspace }));
    ipcHost.handle("memory:recall", (_event, query: string, workspace?: string) => memoryStore.recall(query, { workspace }));
    ipcHost.handle("memory:mode-read", async () => readMemoryMode());
    ipcHost.handle("memory:mode-set", async (_event, mode: MemoryMode) => {
      if (mode === "cloud" && !(await readMemoryGateway())?.endpoint) throw new Error("请先配置云端 Gateway 地址，再切到云端记忆");
      return applyMemoryMode(mode === "cloud" ? "cloud" : "local");
    });
    /* 记忆后端二选一（09-25，设置页「记忆 → 记忆后端」的读写）。
       ⛔ 这里只持久化**用户的选择**；实际生效的后端由 effectiveMemoryBackend() 决定
          （装了服务才让位，否则回退内置 —— 宁可回退也不能让记忆一处都不写）。
       ⛔⛔ **切换必须当场落盘**（09-25 用户实测报障）：此前只 saveAppSettings 就返回，互斥改名与
         连接器同步只在启动链里跑 ⇒ 不重启应用就等于没切。现在当场做两件事（与启动链同一套口径）。
       ⚠️ 引擎侧（config.toml）仍由**启动自愈**在下次启动时重写 ⇒ 切换后需重启应用才在引擎里生效。
       ⛔ 两处都包 try/catch：设置已经保存成功，同步失败不能让整次切换看起来像"没切成"。 */
    ipcHost.handle("memory:backend:read", () => memoryBackendStatus());
    ipcHost.handle("memory:backend:set", async (_event, backend: unknown) => {
      const next: MemoryBackend = backend === "mcp" ? "mcp" : "builtin";
      await saveAppSettings(app.getPath("userData"), { memoryBackend: next });
      /* ⛔ 时序防御：userSkillsDir 由启动链注入，理论上窗口创建早于它的赋值不可能，但这里显式判一下
         —— 传 undefined 进去只会在深处抛 TypeError，被下面的 catch 吞成一条 warn，表现是
         「切换时技能没同步、用户以为切了」。宁可在日志里说清楚。 */
      if (!userSkillsDir) console.warn("[memory] userSkillsDir 尚未就绪（启动链未完成？）⇒ 本次跳过技能同步，重启应用会补上");
      try {
        if (userSkillsDir) await ensureBuiltinSkills(userSkillsDir);
      } catch (error: any) {
        console.warn("[memory] 切后端时同步内置技能失败（重启应用会补上）：", error?.message ?? error);
      }
      try {
        await syncLocalMemoryConnector();
      } catch (error: any) {
        console.warn("[memory] 切后端时同步本地 MCP 连接器失败（重启应用会补上）：", error?.message ?? error);
      }
      return memoryBackendStatus();
    });
    ipcHost.handle("memory:mcp:install", async (_event, options?: { force?: boolean }) => {
      const r = await runMemoryInstaller(options?.force ? ["--force"] : []);
      await syncLocalMemoryConnector(); // 装完立刻把连接器同步成正确形态（自带 node 当 runner）
      return { ...r, status: memoryBackendStatus() };
    });
    ipcHost.handle("memory:mcp:uninstall", async () => {
      const r = await runMemoryInstaller(["--uninstall"]);
      return { ...r, status: memoryBackendStatus() };
    });
    ipcHost.handle("memory:mcp:verify", async () => {
      const r = await runMemoryInstaller(["--verify"]);
      return { ...r, status: memoryBackendStatus() };
    });
    ipcHost.handle("memory:save", (_event, input: unknown) => memoryStore.upsert(input as { content: string; category: MemoryCategory; sourceThreadId?: string; sourceTurnId?: string; confidence?: number }));
    ipcHost.handle("memory:delete", (_event, id: string) => memoryStore.remove(id));
    ipcHost.handle("memory:reset", () => memoryStore.reset());
    ipcHost.handle("memory:gateway:read", async () => { const value = await readMemoryGateway(); return { ...memoryStore.remoteStatus(), sessionKey: value?.sessionKey ?? "", userId: value?.userId ?? "codex-harness", hasApiKey: Boolean(value?.apiKey) }; });
    ipcHost.handle("memory:gateway:save", (_event, input: unknown) => saveMemoryGateway(input));
    ipcHost.handle("memory:layers:read", async (_event, workspace?: string) => ({ ...(await memoryLayers.snapshot(workspace)), entries: await memoryStore.stats() }));
    /* 记忆容量倍率（10-10 用户要求「记忆库容量增加倍率功能」）：×1 基准按 1/2/4/8/10/16 放大。
       ⛔ 改完**当场生效**（setScale）后再落盘 —— 只落盘不应用就是"用户以为改了其实没改"
          （本项目点过名的那类 bug）。下次启动由 main.ts 从 app-settings 读回。
       ⛔ 归一化在 setScale 里做：乱传（0 / 3 / "8" / NaN）一律回退基准，返回**实际生效值**。 */
    ipcHost.handle("memory:scale:read", () => memoryScalePayload());
    ipcHost.handle("memory:scale:set", async (_event, scale: unknown) => {
      const applied = memoryLayers.setScale(scale);
      await saveAppSettings(app.getPath("userData"), { memoryScale: applied });
      return memoryScalePayload();
    });
    ipcHost.handle("memory:layers:context", (_event, workspace?: string, includeWorkspace = true) => memoryLayers.context(workspace, includeWorkspace));
    ipcHost.handle("memory:workspace-enabled:read", (_event, workspace?: string) => workspaceMemoryEnabled(workspace));
    /* 10-05 角色私有记忆（读）：渲染层发送路径用它把「当前会话所属角色」的私有记忆拼进上下文。
       ⛔ 按 threadId 反查归属（索引在主进程，模型/渲染层都伪造不了），查不到就返回空段 ——
          普通会话没有角色记忆，此时行为与今天完全一致。 */
    /* ⛔⛔ 10-05 架构改造：统一记忆上下文的**读**入口。
       ⛔ 主会话、被调度专家、用户亲自与某角色对话 —— **全部走这一个 handler**。
       分两处拼装就会出现"派出去的专家拿不到自己刚写的东西"这类只在部分路径复现的 bug。

       · session 段：按 threadId 寻址 ⇒ **只可能是本会话自己的**（别的会话读不到，物理隔离）
       · project 段：全项目共享（主会话写的事实，角色也读得到 —— 这就是"共享"）
       · legacy 段：上一轮 roles/<键>/MEMORY.md（架构文档 §7：不删，读得到）

       ⛔ fabric 段**自带标题但不自带注入标记** —— 由渲染层拼进既有 [Harness 常驻记忆] 之内，
          自己发明标记会让显示侧剥不掉（机器块漏进用户气泡）。 */
    ipcHost.handle("memory:role-context", async (_event, input: { threadId?: string; workspace?: string; query?: string }) => {
      const threadId = String(input?.threadId ?? "");
      const workspace = String(input?.workspace ?? "");
      if (!threadId && !workspace) return { text: "", key: "", counts: { project: 0, session: 0, legacy: 0 } };
      /* 角色身份：查会话归属索引。查不到 = 普通会话（用 main 身份，仍有 session + project 两段）。 */
      const found = threadId ? await lookupRoleSession(app.getPath("userData"), threadId).catch(() => null) : null;
      const ws = workspace || found?.workspace || "";
      const agent = found ? agentOfRoleRef(found.ref) : { kind: "main" as const, id: "main", label: "主会话" };
      const handles = await getMemoryHandles({ sessionId: threadId, workspace: ws || undefined, agent });
      const built = await buildContext({ handles, query: input?.query, legacyRole: found?.ref ?? null, workspace: ws || undefined });
      return { text: built.text, key: handles.private?.namespace ?? "", counts: built.counts };
    });

    /* ⛔⛔ 统一记忆的**写**入口（10-05 架构改造）：主会话的 `memory_write` 与被调度角色的
       走**同一个内核**（`handleFabricWrite`）——⛔ 不允许出现第二套写入语义。
       ⛔ 身份用**引擎下发/渲染层带来的 threadId**，工作区以传入为准；
         agent 身份由会话归属索引反查（查不到 = 主会话）。
       ⚠️ 渲染层那条路拿不到**被委派会话**的事件（会被 filterForRenderer 裁掉），
          所以被委派会话的写入由 boot.ts 的 handleRoleMemoryToolCall 应答 —— 同一个 handler。 */
    ipcHost.handle("memory:fabric-write", async (_event, input: {
      threadId?: string; workspace?: string; scope?: string; category?: string;
      content: string; weight?: number; pinned?: boolean;
    }) => {
      const threadId = String(input?.threadId ?? "");
      const found = threadId ? await lookupRoleSession(app.getPath("userData"), threadId).catch(() => null) : null;
      const workspace = String(input?.workspace ?? "") || found?.workspace || "";
      const agent = found ? agentOfRoleRef(found.ref) : { kind: "main" as const, id: "main", label: "主会话" };
      return handleFabricWrite({
        args: {
          scope: input?.scope,
          category: input?.category,
          content: input?.content,
          weight: input?.weight,
          pinned: input?.pinned,
          // ⛔⛔ promote 只由**主进程**在确认用户已同意后才可能为真；渲染层传什么都无效 ——
          // 角色会话的 promote 只能由主进程应答路径（boot.ts）处理，那里有身份硬闸。
        },
        threadId,
        workspace: workspace || undefined,
        agent,
      });
    });

    ipcHost.handle("memory:workspace-enabled:set", (_event, input: { workspace?: string; enabled?: boolean }) => {
      if (!input?.workspace) throw new Error("尚未选择工作区");
      return setWorkspaceMemoryEnabled(input.workspace, Boolean(input.enabled));
    });
    ipcHost.handle("memory:layers:write", async (_event, input: { scope: "user" | "background" | "project" | "lessons"; content: string; workspace?: string }) => {
      if (input.scope === "user") await memoryLayers.writeUser(input.content ?? "");
      else if (input.scope === "background") {
        if (!input.workspace) throw new Error("尚未选择工作区，无法保存项目背景");
        await memoryLayers.writeBackground(input.workspace, input.content ?? "");
      }
      else if (input.scope === "lessons") {
        // L1.5 坑与纪律：用户/UI 可整理（捕获链自动追加的那部分在 memory-lessons 里）
        if (!input.workspace) throw new Error("尚未选择工作区，无法保存踩坑记录");
        await memoryLayers.writeLessons(input.workspace, input.content ?? "");
      }
      else {
        if (!input.workspace) throw new Error("尚未选择工作区，无法保存项目记忆");
        await memoryLayers.writeProject(input.workspace, input.content ?? "");
      }
      // ⛔ 返回体必须与 memory:layers:read 同形状（含 entries）：渲染层拿它整体替换状态，
      //    少一个字段就会让「保存后健康度行消失」（09-22 评审）。
      return { ...(await memoryLayers.snapshot(input.workspace)), entries: await memoryStore.stats() };
    });
    ipcHost.handle("memory:distill", async (_event, workspace?: string) => {
      if (!workspace) throw new Error("尚未选择工作区，无法蒸馏项目记忆");
      const result = await memoryLayers.distill(workspace, distillSummarize, true);
      if (!result.ok) throw new Error(result.reason ?? "没有需要蒸馏的日志");
      return result;
    });

    /* ── 记忆整洁与清理（09-22 用户：「记忆管理和记忆整洁，记忆清理规则都要写好」）──
       · plan = 只读：把「哪层满了 / 哪里格式不齐 / 能清什么」算成待办 + 附上清理规则表。
       · apply = 动作：⛔ **必须** `confirm === true`，⛔ 动作走**白名单**。守卫【107】断言这两条。 */
    ipcHost.handle("memory:hygiene:plan", async (_event, workspace?: string) => {
      const snapshot = await memoryLayers.snapshot(workspace);
      const [archive, pool] = await Promise.all([memoryLayers.archiveStats(workspace), memoryStore.stats()]);
      const issues = planHygiene({
        layers: snapshot.layers,
        lessonText: snapshot.lessons,
        archive,
        fragments: { total: pool.total, expiring: pool.expiringSoon, expired: pool.expiring },
        hasWorkspace: snapshot.hasWorkspace,
      });
      return {
        rules: CLEANUP_RULES,
        labels: HYGIENE_ACTION_LABEL,
        actions: suggestedActions(issues),
        issues,
        layers: snapshot.layers,
        lessonGroups: snapshot.lessonGroups,
        archive,
        pool: { total: pool.total, pinned: pool.pinned, expiring: pool.expiring, max: pool.max, ttlDays: pool.ttlDays },
      };
    });
    ipcHost.handle("memory:hygiene:apply", async (_event, input: { action?: string; workspace?: string; confirm?: boolean }) => {
      if (!input || input.confirm !== true) throw new Error("清理动作需要二次确认（confirm=true）");
      if (!isHygieneAction(input.action)) throw new Error(`未知的清理动作：${String(input.action ?? "")}`);
      if (input.action === "purge-archive") return { action: input.action, result: await memoryLayers.purgeArchive(input.workspace) };
      if (input.action === "tidy-lessons") return { action: input.action, result: await memoryLayers.tidyLessons(input.workspace) };
      return { action: input.action, result: { pruned: await memoryStore.pruneNow() } };
    });
    ipcHost.handle("memory:gateway:test", async (_event, input: any) => {
      const endpoint = String(input.endpoint ?? "").trim().replace(/\/$/, "");
      if (!endpoint) throw new Error("请填写 Memory Gateway 地址");
      const startedAt = Date.now();
      const response = await fetch(`${endpoint}/health`, { headers: input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`Gateway HTTP ${response.status}`);
      return { ok: true, latencyMs: Date.now() - startedAt, health: await response.json() };
    });

    ctx.effect(() => {
      for (const ch of MEMORY_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
