/**
 * memory-rpa-ipc（09-21 架构改造：从 electron/main.ts 按**域**拆出，纯搬迁）
 *
 * 域：memory(17) / rpa(4) / tasks(4) / scheduler(4)
 * 通道：memory:delete / memory:distill / memory:gateway:read / memory:gateway:save / memory:gateway:test / memory:layers:context / memory:layers:read / memory:layers:write / memory:list / memory:mode-read / memory:mode-set / memory:recall / memory:reset / memory:save / memory:search / memory:workspace-enabled:read / memory:workspace-enabled:set / rpa:delete / rpa:list / rpa:record / rpa:save / scheduler:delete / scheduler:list / scheduler:run / scheduler:save / tasks:add / tasks:delete / tasks:list / tasks:update
 *
 * 代码与原地逐字一致（仅整体缩进 + 顶部 import + 文件头注释）。
 * 跨域**只读**符号经 `import … from "../main"` 取用 —— 活绑定（TS→CJS 编译成 `main_1.X` 属性访问），
 * 因此 main 里被重新赋值的 `let`（窗口句柄等）也能读到最新值。
 * 本域未使用跨域可变状态。
 * 注册时机不变：main.ts 模块加载期 import 本文件 ⇒ ipcMain.handle 立即执行。
 */
import path from "node:path";
import fs from "node:fs/promises";
import { app, ipcMain, safeStorage } from "electron";
import { saveAppSettings } from "../app-settings";
import { memoryBackendStatus, type MemoryBackend } from "../memory-backend";
import { RpaStore } from "../rpa-store";
import { CLEANUP_RULES, HYGIENE_ACTION_LABEL, isHygieneAction, planHygiene, suggestedActions } from "../memory-hygiene";
import type { MemoryCategory, MemoryRemoteConfig } from "../memory-store";
import { applyMemoryMode, readMemoryMode, workspaceMemoryEnabled } from "../main/05-memory-mode";
import { distillSummarize } from "../main/03-turn-summary";
import { readMemoryGateway } from "../main/08-channel-bot-io";
import { readWorkspaceMemorySettings } from "../main/05-memory-mode";
import { memoryGatewayFile, memoryLayers, memoryStore, memoryWorkspaceFile, rpaStore } from "../runtime-refs";
import { scheduler } from "../main";
import type { MemoryMode, StoredMemoryGateway } from "../main";
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
  if (config.apiKey && !safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法安全保存 Memory Gateway Key");
  await fs.writeFile(memoryGatewayFile, JSON.stringify({ endpoint: config.endpoint, sessionKey: config.sessionKey, userId: config.userId, encryptedApiKey: config.apiKey ? safeStorage.encryptString(config.apiKey).toString("base64") : undefined } satisfies StoredMemoryGateway, null, 2), "utf8");
  // 填了网关地址就切到云端（Codex 从此去云端找记忆），清空地址则回到本地
  await applyMemoryMode(config.endpoint ? "cloud" : "local");
  return { ...memoryStore.remoteStatus(), sessionKey: config.sessionKey, userId: config.userId, hasApiKey: Boolean(config.apiKey) };
}
ipcMain.handle("memory:list", (_event, category?: string) => memoryStore.list(category));
ipcMain.handle("memory:search", (_event, query: string, workspace?: string) => memoryStore.search(query, 8, { workspace }));
ipcMain.handle("memory:recall", (_event, query: string, workspace?: string) => memoryStore.recall(query, { workspace }));
ipcMain.handle("memory:mode-read", async () => readMemoryMode());
ipcMain.handle("memory:mode-set", async (_event, mode: MemoryMode) => {
  if (mode === "cloud" && !(await readMemoryGateway())?.endpoint) throw new Error("请先配置云端 Gateway 地址，再切到云端记忆");
  return applyMemoryMode(mode === "cloud" ? "cloud" : "local");
});
/* 记忆后端二选一（09-25，设置页「记忆 → 记忆后端」的读写）。
   ⛔ 这里只持久化**用户的选择**；实际生效的后端由 effectiveMemoryBackend() 决定
      （装了服务才让位，否则回退内置 —— 宁可回退也不能让记忆一处都不写）。
   ⛔ MCP 服务按用户要求走「命令安装」，本文件**不**跑安装器（不在主进程 spawn npm）。 */
ipcMain.handle("memory:backend:read", () => memoryBackendStatus());
ipcMain.handle("memory:backend:set", async (_event, backend: unknown) => {
  const next: MemoryBackend = backend === "mcp" ? "mcp" : "builtin";
  await saveAppSettings(app.getPath("userData"), { memoryBackend: next });
  return memoryBackendStatus();
});
ipcMain.handle("memory:save", (_event, input: unknown) => memoryStore.upsert(input as { content: string; category: MemoryCategory; sourceThreadId?: string; sourceTurnId?: string; confidence?: number }));
ipcMain.handle("memory:delete", (_event, id: string) => memoryStore.remove(id));
ipcMain.handle("memory:reset", () => memoryStore.reset());
ipcMain.handle("memory:gateway:read", async () => { const value = await readMemoryGateway(); return { ...memoryStore.remoteStatus(), sessionKey: value?.sessionKey ?? "", userId: value?.userId ?? "codex-harness", hasApiKey: Boolean(value?.apiKey) }; });
ipcMain.handle("memory:gateway:save", (_event, input: unknown) => saveMemoryGateway(input));
ipcMain.handle("memory:layers:read", async (_event, workspace?: string) => ({ ...(await memoryLayers.snapshot(workspace)), entries: await memoryStore.stats() }));
ipcMain.handle("memory:layers:context", (_event, workspace?: string, includeWorkspace = true) => memoryLayers.context(workspace, includeWorkspace));
ipcMain.handle("memory:workspace-enabled:read", (_event, workspace?: string) => workspaceMemoryEnabled(workspace));
ipcMain.handle("memory:workspace-enabled:set", (_event, input: { workspace?: string; enabled?: boolean }) => {
  if (!input?.workspace) throw new Error("尚未选择工作区");
  return setWorkspaceMemoryEnabled(input.workspace, Boolean(input.enabled));
});
ipcMain.handle("memory:layers:write", async (_event, input: { scope: "user" | "background" | "project" | "lessons"; content: string; workspace?: string }) => {
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
ipcMain.handle("memory:distill", async (_event, workspace?: string) => {
  if (!workspace) throw new Error("尚未选择工作区，无法蒸馏项目记忆");
  const result = await memoryLayers.distill(workspace, distillSummarize, true);
  if (!result.ok) throw new Error(result.reason ?? "没有需要蒸馏的日志");
  return result;
});

/* ── 记忆整洁与清理（09-22 用户：「记忆管理和记忆整洁，记忆清理规则都要写好」）──
   · plan = 只读：把「哪层满了 / 哪里格式不齐 / 能清什么」算成待办 + 附上清理规则表（规则单一真相源在 memory-hygiene）。
   · apply = 动作：⛔ **必须** `confirm === true`（UI 走二次确认弹窗才置位），否则任何渲染层 bug / 误点
     都能把冷存档真删掉；⛔ 动作走**白名单**（未知动作拒绝）。守卫【107】断言这两条。 */
ipcMain.handle("memory:hygiene:plan", async (_event, workspace?: string) => {
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
ipcMain.handle("memory:hygiene:apply", async (_event, input: { action?: string; workspace?: string; confirm?: boolean }) => {
  if (!input || input.confirm !== true) throw new Error("清理动作需要二次确认（confirm=true）");
  if (!isHygieneAction(input.action)) throw new Error(`未知的清理动作：${String(input.action ?? "")}`);
  if (input.action === "purge-archive") return { action: input.action, result: await memoryLayers.purgeArchive(input.workspace) };
  if (input.action === "tidy-lessons") return { action: input.action, result: await memoryLayers.tidyLessons(input.workspace) };
  return { action: input.action, result: { pruned: await memoryStore.pruneNow() } };
});
ipcMain.handle("rpa:list", () => rpaStore.listRecipes());
ipcMain.handle("rpa:save", (_e, input: unknown) => rpaStore.saveRecipe(input as Parameters<RpaStore["saveRecipe"]>[0]));
ipcMain.handle("rpa:delete", (_e, id: string) => rpaStore.deleteRecipe(id));
ipcMain.handle("rpa:record", (_e, input: { id: string; ok: boolean; error?: string }) => rpaStore.recordRun(input.id, input.ok, input.error));
ipcMain.handle("tasks:list", () => rpaStore.listTasks());
ipcMain.handle("tasks:add", (_e, input: unknown) => rpaStore.addTask(input as { text: string; priority?: "low" | "medium" | "high" }));
ipcMain.handle("tasks:update", (_e, input: { id: string; patch: unknown }) => rpaStore.updateTask(input.id, input.patch as any));
ipcMain.handle("tasks:delete", (_e, id: string) => rpaStore.deleteTask(id));
ipcMain.handle("memory:gateway:test", async (_event, input: any) => {
  const endpoint = String(input.endpoint ?? "").trim().replace(/\/$/, "");
  if (!endpoint) throw new Error("请填写 Memory Gateway 地址");
  const startedAt = Date.now();
  const response = await fetch(`${endpoint}/health`, { headers: input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Gateway HTTP ${response.status}`);
  return { ok: true, latencyMs: Date.now() - startedAt, health: await response.json() };
});
ipcMain.handle("scheduler:list", () => scheduler.list());
ipcMain.handle("scheduler:save", (_event, input: unknown) => scheduler.save(input as any));
ipcMain.handle("scheduler:delete", (_event, id: string) => scheduler.remove(id));
ipcMain.handle("scheduler:run", (_event, id: string) => scheduler.runNow(id));
