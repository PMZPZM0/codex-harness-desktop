/**
 * engine-ipc 的「thread-runtime-codex-bridge」部分（09-22 从同目录 engine-ipc.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { app, dialog, ipcMain, safeStorage, shell } from "electron";
import { broadcastHarnessEvent, sendToWindow } from "../../features/window-bus";
import { safeProviderId } from "../../provider-id";
import { enrichThreadWithRolloutToolsAsync, listRolloutThreadsAsync } from "../../rollout-pool";
import { markMissingRollouts, mergeThreadList } from "../../session-tools";
import { rendererActiveByWindow } from "../renderer-fuse";
import { bridgeDial, readCustomModel, responsesBridge, restrictedThreadRole } from "../../main";
import { codexHome, engineActiveTurnIds, mainWindow, server, threadCwd, threadRuntimeStore } from "../../runtime-refs";
import { deletedThreadIds, forgetDeletedThreads, purgeDeletedThread } from "../thread-deletion";
import { mutableState } from "../../main";
import { ensureProjectAgentsMd } from "../../project-conventions";
let rendererActiveThreadId = "";

function bridgeRewriteProviderConfig(params: any) {
  const providers = params?.config?.model_providers;
  if (!providers || typeof providers !== "object") return;
  for (const [id, entry] of Object.entries<any>(providers)) {
    if (entry && typeof entry.base_url === "string" && entry.base_url) {
      entry.base_url = bridgeDial(id, entry.base_url) ?? entry.base_url;
    }
  }
}

ipcMain.handle("thread-runtime:get", async (_event, threadId: string) => threadRuntimeStore.get(String(threadId ?? "")));

ipcMain.handle("thread-runtime:list", async () => threadRuntimeStore.list());

ipcMain.handle("thread-runtime:seed", async (_event, input: { threadId?: string; runtime?: unknown }) => {
  const threadId = String(input?.threadId ?? "");
  if (!threadId) return null;
  return threadRuntimeStore.seed(threadId, input?.runtime);
});

ipcMain.handle("thread-runtime:patch", async (_event, input: { threadId?: string; patch?: unknown; baseRev?: number; takeover?: boolean }) => {
  const threadId = String(input?.threadId ?? "");
  if (!threadId) throw new Error("threadId 不能为空");
  // 身份闸（09-16 用户要求「专家会话、专家团会话也要禁用掉」）：这些会话一律不许开调度。
  // UI 已经把按钮禁用了，这里再挡一道 —— 快捷键/多窗口/旧版本渲染层都绕不过去。
  if ((input?.patch as any)?.dispatch?.enabled === true) {
    const role = await restrictedThreadRole(threadId);
    if (role.restricted) {
      const current = await threadRuntimeStore.get(threadId);
      return { runtime: current, conflict: false, changed: false, restrictedBy: role.label };
    }
  }
  const result = await threadRuntimeStore.patch(threadId, input?.patch, typeof input?.baseRev === "number" ? input.baseRev : undefined, { takeover: input?.takeover === true });
  if (result.changed) {
    broadcastHarnessEvent({ type: "thread-runtime", threadId, runtime: result.runtime, at: Date.now() });
  }
  // 独占接管：被摘掉锁的那个线程也要广播出去，否则别的窗口/别的会话还挂着「调度中」的旧状态
  if (result.tookOverFrom) {
    const released = await threadRuntimeStore.get(result.tookOverFrom);
    if (released) broadcastHarnessEvent({ type: "thread-runtime", threadId: result.tookOverFrom, runtime: released, at: Date.now() });
  }
  return result;
});

ipcMain.handle("thread-runtime:dispatch-owner", async () => ({ threadId: await threadRuntimeStore.dispatchOwner() }));

ipcMain.handle("thread-runtime:release-dispatch", async (_event, threadId: string) => {
  const id = String(threadId ?? "");
  if (!id) return { released: false };
  const released = await threadRuntimeStore.releaseDispatch(id);
  if (released) {
    const runtime = await threadRuntimeStore.get(id);
    broadcastHarnessEvent({ type: "thread-runtime", threadId: id, runtime, at: Date.now() });
  }
  return { released };
});

ipcMain.handle("codex:request", async (_event, method: string, params: unknown) => {
  let result: unknown;
  const __reqT0 = performance.now();
  // 协议桥兜底收口（09-16）：渲染层自带的内联 provider 配置在这里统一换成桥地址，
  // 保证「引擎发出的每个请求都经过桥」，不依赖各下发点自觉（见 bridgeRewriteProviderConfig）。
  bridgeRewriteProviderConfig(params);
  // ⛔ 永久删除的本地收尾（09-18）：不论引擎返回成功还是抛错，都要把磁盘 rollout 与墓碑处理掉。
  //   刻意用 finally 而不是「成功后才做」——引擎对「索引里本就不存在」的 id 会直接报错，
  //   而那条会话恰恰最需要清理：它就是兜底扫描从磁盘捞回来的幽灵会话，引擎早已不认识它。
  const purgeTarget = method === "thread/delete" ? String((params as any)?.threadId ?? "") : "";
  // ⛔ 会话绝对独立（09-19 用户：「不准再因为切换会话、别的独立弹窗关闭影响正在运行的会话，
  //   每个会话都是绝对独立运行状态，互不影响……除了用户停止，不许再断」）：
  //   引擎侧一个 thread 同时只能有一个活动回合，`turn/start` 会**打断**已有回合。渲染层只要
  //   有任何一次"以为它没在跑"（切会话时快照里看不到 inProgress 回合、独立窗口开关导致状态重建、
  //   收到一条快照式的 thread/status/changed idle……），下一条消息就会走 turn/start —— 正在跑的
  //   任务当场被掐掉，用户看到的就是「运行莫名停止」。
  //   所以在这里用**引擎侧真相**兜底：该会话仍有活动回合 → 拒绝这条 turn/start，让它改走
  //   `thread/queue/add`（排队）或 `turn/steer`（并入当前回合）。这一层不依赖渲染层的状态是否正确，
  //   是"绝对独立"的最后一道硬闸；记账本身由 turn/started|completed 与进程重启维护。
  if (method === "turn/start") {
    const guardThreadId = String((params as any)?.threadId ?? "");
    if (guardThreadId && [...engineActiveTurnIds.values()].includes(guardThreadId)) {
      console.warn(`[turn/start] 拒绝：会话 ${guardThreadId.slice(0, 8)} 仍有活动回合在跑（引擎侧记账），已阻止打断`);
      throw new Error("该会话仍有任务在运行（引擎侧确认），本次发送未执行以免打断它。等它结束，或点停止后再发。");
    }
  }
  // ⛔ 必须赶在引擎处理 thread/start **之前**：引擎那时就读 <cwd>/AGENTS.md，响应侧才建会让本会话错过
  if (method === "thread/start") {
    const startCwd = String((params as any)?.cwd ?? "");
    if (startCwd) ensureProjectAgentsMd(startCwd);
  }
  try {
    result = await server.request(method, params);
  } catch (error: any) {
    const firstMessage = String(error?.message ?? "");
    // ⛔ 幽灵会话的删除按成功处理（09-18，与 purgeDeletedThread 同一根因）：
    //   引擎索引里已经没有这条线程（用户删过一次、或它本就是磁盘残留被兜底扫描捞出来的），
    //   `thread/delete` 会报 "failed to delete thread / failed to read session metadata"。
    //   但这类会话的**本地残留已在 finally 里清掉、墓碑也记了**（列表不会再显示、重启不复活），
    //   用户点「永久删除」的意图已经达成 —— 把这种错误抛回去只会让他以为没删掉、反复再点。
    //   只吞「引擎确认删不掉」这一类；别的错误（含引擎重启窗口的瞬态）照旧走下面的分支。
    if (purgeTarget && /failed to delete thread|failed to read session metadata|no rollout found|thread[^.]{0,40}not found/i.test(firstMessage)) {
      console.warn("[thread/delete] 引擎侧删除失败，但本地残留已清理并按成功处理：", firstMessage.slice(0, 200));
      return { ok: true, localCleanupOnly: true };
    }
    // 保存/切换供应商会重启引擎：撞上重启窗口的在途请求被 reject「Codex app-server restarted」。
    // 这是瞬态错误（restart() 会 reject 全部 pending 再拉起新进程），等新引擎就绪后自动重试，
    // 不把吓人的报错甩给用户（设置页黄色横幅）。重试 2 次（1.2s / 2.4s），仍失败才抛出。
    if (/app-server restarted/i.test(firstMessage)) {
      let recovered = false;
      for (const delay of [1200, 2400]) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        try { result = await server.request(method, params); recovered = true; break; } catch (retryError: any) {
          if (!/app-server restarted/i.test(String(retryError?.message ?? ""))) { error = retryError; break; }
        }
      }
      if (!recovered) throw error;
    } else {
      // 历史线程引用了已删除/换 ID 的供应商（rollout 里硬编码旧 model_provider）：
      // 引擎 resume 报 "Model provider `X` not found" → 会话内容全空。
      // 自动补一个指向当前生效端点的同名 provider 段，重启引擎后重试——内容找回。
      const missing = /Model provider `([^`]+)` not found/.exec(firstMessage);
      const active = missing ? await readCustomModel() : null;
      if (!missing || !active?.baseUrl) throw error;
      const alias = safeProviderId(missing[1]);   // 旧 session 记的 id 同样可能是保留名（openai）
      const configText = await fs.readFile(path.join(codexHome, "config.toml"), "utf8").catch(() => "");
      if (configText.includes(`[model_providers.${alias}]`)) throw error;
      // ⛔ 恒 responses（09-16 真实引擎探针实证，见 scripts/probe-wire-api.cjs）：引擎对
      // `wire_api = "chat"` 是**整份配置拒载**（原文：`wire_api = "chat"` is no longer supported.
      // How to fix: set `wire_api = "responses"`），所有请求随之失败。这里原先把档案里的
      // savedWire / 生效供应商的 chat 透传进 config.toml —— 而 active 来自 readCustomModel()，
      // 那个函数**不经过 normalizeProvider**，档案里一旦有 chat 残留就会把应用写死。别名段
      // 的唯一合法值就是 responses。
      await fs.appendFile(path.join(codexHome, "config.toml"), `\n[model_providers.${alias}]\nname = "${alias}"\nbase_url = "${bridgeDial(alias, active.baseUrl)}"\nenv_key = "CODEX_HARNESS_API_KEY"\nwire_api = "responses"\n`);
      await server.restart();
      result = await server.request(method, params);
    }
  } finally {
    // 见 purgeDeletedThread 注释：删了会话就必须把磁盘残留一起带走，否则重启即复活
    if (purgeTarget) await purgeDeletedThread(purgeTarget);
  }
  if (method === "thread/list") {
    mutableState.threadListRequestCount += 1;
    const response = result as any;
    const archiveFilter = typeof (params as any)?.archived === "boolean" ? Boolean((params as any).archived) : null;
    const indexed = Array.isArray(response?.data) ? response.data : [];
    // 零阻塞宿主（09-12）：兜底扫描整体在 **worker 线程**里跑（目录遍历 + 单文件解析都是
    // 同步 I/O，放主进程会阻塞**所有会话**的事件转发）。语义与原实现一致：仍然无条件扫
    // （不要改成「仅 indexed 为空时才扫」——引擎索引瞬时为空会让侧栏整片消失）。
    // worker 不可用时退化为「不发兜底」：宁可列表少一截，也不能让主线程被同步 I/O 堵住。
    mutableState.rolloutFallbackScanCount += 1;
    try {
      const fallback = await listRolloutThreadsAsync(codexHome);
      // ⛔ 合并阶段必须排除「已永久删除」的线程（墓碑集合）：兜底扫描只认磁盘文件，
      //   而删掉的 rollout 可能还在（文件被占用删不掉、或旧版本删过留下的残留）——
      //   不排除就会在下次启动把用户删掉的会话捞回侧栏（09-18 用户实测的「重启又恢复」）。
      const merged = mergeThreadList(indexed, fallback, archiveFilter, Number((params as any)?.limit ?? 100), deletedThreadIds);
      // 「记录已丢失」标记：判据与实测口径见 session-tools.ts 的 markMissingRollouts 注释
      // （白拿兜底扫描结果，不额外做同步磁盘 I/O；本机引擎会隐藏 rollout 丢失的线程，
      //  所以这是防御性标记 —— 用户侧真实症状是会话静默消失，见该函数注释）。
      const present = new Set(fallback.map((entry: any) => String(entry?.id ?? "").toLowerCase()));
      markMissingRollouts(merged, present);
      result = { ...response, data: merged };
    } catch (error: any) {
      console.warn("[thread/list] rollout 兜底扫描（worker）失败，本次仅返回引擎索引：", error?.message);
    }
  }
  // 记忆捕获用：记录 threadId → cwd（新建线程响应 / 线程设置更新都带 cwd）
  try {
    const p = params as any;
    const r = result as any;
    if (method === "thread/start" && r?.thread?.id) {
      threadCwd.set(String(r.thread.id), String(p?.cwd ?? r.thread.cwd ?? ""));
    } else if (method === "thread/resume" && r?.thread?.id) {
      // 零阻塞宿主（09-12）：rollout 增强解析也在 worker 线程里（同步读盘 + 逐行 parse
      // 会阻塞所有会话）。失败就退化为「不增强」——工具调用卡片少几个，但界面不卡。
      const __t0 = performance.now();
      try {
        r.thread = await enrichThreadWithRolloutToolsAsync(r.thread, codexHome);
      } catch (error: any) {
        console.warn("[thread/resume] rollout 增强（worker）失败，本次跳过：", error?.message);
      }
      const __enrich = performance.now() - __t0;
      mutableState.resumeCount += 1;
      mutableState.resumeEnrichMs += __enrich;
      if (__enrich > mutableState.resumeMaxMs) mutableState.resumeMaxMs = __enrich;
      threadCwd.set(String(r.thread.id), String(r.thread.cwd ?? r.cwd ?? p?.cwd ?? ""));
    } else if (method === "thread/settings/update" && p?.threadId && p?.cwd) {
      threadCwd.set(String(p.threadId), String(p.cwd));
    } else if (method === "thread/list" && Array.isArray(r?.data)) {
      // ⛔ 隐私加固（09-19）配套：侧栏列表里的每个会话 cwd 也要记账——可信根集合
      // （fs:read/fs:write/shell:reveal/harness-image 共用）才能覆盖"本轮还没 resume 过
      // 的会话"的文件预览，不至于一点开旧会话的历史文件就被新校验误伤。
      for (const t of r.data) {
        const tid = String(t?.id ?? t?.thread?.id ?? "");
        const tcwd = String(t?.cwd ?? t?.thread?.cwd ?? "");
        if (tid && tcwd) threadCwd.set(tid, tcwd);
      }
    }
  } catch { /* cwd 映射失败不影响请求本身 */ }
  if (method === "thread/resume") {
    const total = performance.now() - __reqT0;
    mutableState.resumeTotalMs += total;
    if (total > mutableState.resumeMaxMs) mutableState.resumeMaxMs = total;
  }
  return result;
});

ipcMain.handle("codex:respond", (_event, id: string | number, result: unknown) => server.respond(id, result));

ipcMain.handle("codex:set-active-thread", (event, threadId: unknown) => {
  const id = threadId == null ? "" : String(threadId);
  rendererActiveThreadId = id;
  try { rendererActiveByWindow.set(event.sender.id, { threadId: id, at: Date.now() }); } catch { /* 窗口已销毁：忽略 */ }
  // 窗口销毁时清掉记录：否则一个已关闭窗口的旧值会在新鲜度窗口内继续放行它的会话事件
  try {
    event.sender.once("destroyed", () => rendererActiveByWindow.delete(event.sender.id));
  } catch { /* ignore */ }
  return { ok: true };
});
