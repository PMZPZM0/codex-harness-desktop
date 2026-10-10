/**
 * codex-ipc（10-03 从 `features/engine-ipc/01-...` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：codex(3)
 * 通道：codex:request（引擎 JSON-RPC 的唯一出口）/ codex:respond / codex:set-active-thread
 *
 * ⛔⛔ 五条实证口径（本次纯搬迁，一字未改）：
 *   1. **会话绝对独立**（09-19 用户令）：`turn/start` 会**打断**已有回合。这里用引擎侧记账
 *      （engineActiveTurnIds）兜底拒绝 —— 不依赖渲染层状态是否正确，是最后一道硬闸。
 *      少了它，用户看到的就是「运行莫名停止」。
 *   2. **永久删除用 finally**（09-18）：引擎对"索引里本就不存在"的 id 会直接报错，
 *      而那条会话恰恰最需要清理（磁盘残留被兜底扫描捞回的幽灵会话）。
 *   3. **幽灵会话删除按成功处理**：本地残留已清、墓碑已记，把错误抛回去只会让用户反复再点。
 *      只吞「引擎确认删不掉」这一类，别的错误照旧。
 *   4. **`thread/list` 兜底扫描必须排除墓碑集合**：否则下次启动会把用户删掉的会话捞回侧栏
 *      （09-18 实测「重启又恢复」）。且扫描在 **worker 线程**（同步 I/O 会阻塞所有会话）。
 *   5. **别名 provider 段恒 `wire_api = "responses"`**（09-16 探针实证）：写 chat 会被整份拒载。
 * ⛔ `rendererActiveThreadId` / `bridgeRewriteProviderConfig` 是本域私有（只服务 codex 三通道）。
 * ⛔ 待接缝化（阶段 2）：fs 为宿主能力（safeStorage 已于 10-03 走 host 接缝）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { safeProviderId } from "../provider-id";
import { enrichThreadWithRolloutToolsAsync, listRolloutThreadsAsync, syncToolSurfaceAsync } from "../rollout-pool";
import { markMissingRollouts, mergeThreadList } from "../session-tools";
import { dropStoredReports, storedReportsForThread } from "../turn-file-watch";
import { dropStoredCompactions, storedCompactionsForThread } from "../compaction-watch";
import { rendererActiveByWindow } from "./renderer-fuse";
import { deletedThreadIds, purgeDeletedThread } from "./thread-deletion";
import { bridgeDial, mutableState, readCustomModel } from "../main";
import { codexHome, delegateRegistry, engineActiveTurnIds, server, threadCwd } from "../runtime-refs";
import { broadcastHarnessEvent } from "./window-bus";
import { ensureProjectAgentsMd } from "../project-conventions";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

function bridgeRewriteProviderConfig(params: any) {
  const providers = params?.config?.model_providers;
  if (!providers || typeof providers !== "object") return;
  for (const [id, entry] of Object.entries<any>(providers)) {
    if (entry && typeof entry.base_url === "string" && entry.base_url) {
      entry.base_url = bridgeDial(id, entry.base_url) ?? entry.base_url;
    }
  }
}

export const codexFeature = defineFeature<null>({
  id: "codex",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("codex: 缺少 ipc 服务（宿主未提供）");

    let rendererActiveThreadId = "";

    ipcHost.handle("codex:request", async (_event, method: string, params: unknown) => {
      let result: unknown;
      const __reqT0 = performance.now();
      // 协议桥兜底收口（09-16）：渲染层自带的内联 provider 配置在这里统一换成桥地址，
      // 保证「引擎发出的每个请求都经过桥」，不依赖各下发点自觉（见 bridgeRewriteProviderConfig）。
      bridgeRewriteProviderConfig(params);
      // ⛔ 永久删除的本地收尾（09-18）：不论引擎返回成功还是抛错，都要把磁盘 rollout 与墓碑处理掉。
      const purgeTarget = method === "thread/delete" ? String((params as any)?.threadId ?? "") : "";
      // ⛔ 会话绝对独立（09-19 用户）：引擎侧一个 thread 同时只能有一个活动回合，turn/start 会打断已有回合。
      //   用引擎侧真相兜底：仍有活动回合 ⇒ 拒绝，改走 queue/add 或 turn/steer。
      if (method === "turn/start") {
        const guardThreadId = String((params as any)?.threadId ?? "");
        if (guardThreadId && [...engineActiveTurnIds.values()].includes(guardThreadId)) {
          console.warn(`[turn/start] 拒绝：会话 ${guardThreadId.slice(0, 8)} 仍有活动回合在跑（引擎侧记账），已阻止打断`);
          throw new Error("该会话仍有任务在运行（引擎侧确认），本次发送未执行以免打断它。等它结束，或点停止后再发。");
        }
      }
      // ⛔ 必须赶在引擎处理 thread/start **之前**：引擎那时就读 <cwd>/AGENTS.md
      if (method === "thread/start") {
        const startCwd = String((params as any)?.cwd ?? "");
        if (startCwd) ensureProjectAgentsMd(startCwd);
      }
      /* ⛔⛔ 老会话的工具面升级（10-11 实测定案，与「resume 会重注册工具」的旧认知相反）：
         引擎的工具面**只在 spawn 时定死**，来源 = rollout 首行 `session_meta.dynamic_tools`
         —— thread/resume / thread/fork 里的 dynamicTools 会被**整份忽略**（协议 schema 里
         ThreadResumeParams 根本没这个字段；探针实证上游请求体的 tools 一个不多）。
         后果：创建于旧版本的会话永远拿不到新工具（agent_ask.multiple、新能力…），症状就是
         「明明写着可多选，界面只能选一个」。
         修法：resume 前先把首行改成调用方当前这份工具面（worker 里原子替换 + 备份）。
         ⛔ 必须 await 完再发 resume：引擎就是在这条 resume 上 spawn 会话、读首行。
         失败静默：升级是锦上添花，不许挡住 resume。 */
      if (method === "thread/resume") {
        const resumeThreadId = String((params as any)?.threadId ?? "");
        const resumeTools = (params as any)?.dynamicTools;
        if (resumeThreadId && Array.isArray(resumeTools) && resumeTools.length) {
          try {
            await syncToolSurfaceAsync(codexHome, resumeThreadId, resumeTools);
          } catch (error: any) {
            console.warn("[tool-surface] 工具面同步失败（不影响 resume）：", String(error?.message ?? error).slice(0, 200));
          }
        }
      }
      try {
        result = await server.request(method, params);
      } catch (error: any) {
        const firstMessage = String(error?.message ?? "");
        // ⛔ 僵尸会话根治（10-04 用户：「删不掉的僵尸会话给老子解决掉」）：引擎的 thread/delete
        //   只认 archived_sessions/ 里的 rollout，活会话的 rollout 还在 sessions/ ⇒ 引擎直接拒删
        //   （报 "rollout path … must be in archived sessions directory"），删除永远失败。
        //   修法：先 thread/archive（引擎把 rollout 挪进归档目录），再重试 delete；重试仍失败
        //   且错误形态仍是「引擎不认这条会话」⇒ 按下面的 ghost 分支本地清理成功处理
        //   （finally 的 purge + 墓碑会兜住磁盘与侧栏，绝不反复报错让用户反复点）。
        if (purgeTarget && /must be in archived sessions directory/i.test(firstMessage)) {
          const archived = await server.request("thread/archive", { threadId: purgeTarget }).then(
            () => true,
            (archiveError: any) => { console.warn("[thread/delete] 归档兜底失败：", String(archiveError?.message ?? archiveError).slice(0, 200)); return false; },
          );
          if (archived) {
            try { result = await server.request(method, params); } catch (retryError: any) {
              console.warn("[thread/delete] 归档后重试删除仍失败，按本地清理处理（墓碑 + rollout 清理）：", String(retryError?.message ?? retryError).slice(0, 200));
            }
          }
          if (!result) {
            // 引擎侧始终不认这条会话 ⇒ 本地清理（finally 的 purge + 墓碑）达成用户意图，按成功返回
            return { ok: true, localCleanupOnly: true };
          }
        }
        // ⛔ 幽灵会话的删除按成功处理（09-18）：本地残留已在 finally 清掉、墓碑也记了，
        //   用户点「永久删除」的意图已达成 —— 把这种错误抛回去只会让他以为没删掉、反复再点。
        if (purgeTarget && /failed to delete thread|failed to read session metadata|no rollout found|thread[^.]{0,40}not found/i.test(firstMessage)) {
          console.warn("[thread/delete] 引擎侧删除失败，但本地残留已清理并按成功处理：", firstMessage.slice(0, 200));
          return { ok: true, localCleanupOnly: true };
        }
        // 保存/切换供应商会重启引擎：撞上重启窗口的在途请求被 reject「Codex app-server restarted」。
        // 瞬态错误，等新引擎就绪后自动重试（1.2s / 2.4s），仍失败才抛出。
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
          // 历史线程引用了已删除/换 ID 的供应商 → 引擎 resume 报 "Model provider `X` not found"。
          // 自动补一个指向当前生效端点的同名 provider 段，重启引擎后重试——内容找回。
          const missing = /Model provider `([^`]+)` not found/.exec(firstMessage);
          const active = missing ? await readCustomModel() : null;
          if (!missing || !active?.baseUrl) throw error;
          const alias = safeProviderId(missing[1]);   // 旧 session 记的 id 同样可能是保留名（openai）
          const configText = await fs.readFile(path.join(codexHome, "config.toml"), "utf8").catch(() => "");
          if (configText.includes(`[model_providers.${alias}]`)) throw error;
          // ⛔ 恒 responses（09-16 真实引擎探针实证，见 scripts/probe-wire-api.cjs）：引擎对
          // `wire_api = "chat"` 是**整份配置拒载**，所有请求随之失败。别名段的唯一合法值就是 responses。
          await fs.appendFile(path.join(codexHome, "config.toml"), `\n[model_providers.${alias}]\nname = "${alias}"\nbase_url = "${bridgeDial(alias, active.baseUrl)}"\nenv_key = "CODEX_HARNESS_API_KEY"\nwire_api = "responses"\n`);
          await server.restart();
          result = await server.request(method, params);
        }
      } finally {
        // 见 purgeDeletedThread 注释：删了会话就必须把磁盘残留一起带走，否则重启即复活
        if (purgeTarget) await purgeDeletedThread(purgeTarget);
        /* 10-05：委托登记表里的那条记录也必须跟着走 —— 否则办公室里会留一个点不开的人。
           ⛔ 另一条入口在 features/boot.ts 的 thread/deleted 通知分支（引擎侧发起的删除）——
              两处都清才完整；forget 幂等，重复调用返回 0。 */
        if (purgeTarget) {
          const dropped = await delegateRegistry.forget([purgeTarget]).catch(() => 0);
          if (dropped) broadcastHarnessEvent({ type: "delegates-changed", threadId: purgeTarget } as any);
          dropStoredReports(purgeTarget); // 文件变更报告的落盘同样跟着会话走（另一个入口在 boot 的 thread/deleted）
          dropStoredCompactions(purgeTarget); // 压缩侦测记录同样跟着会话走（另一个入口在 boot 的 thread/deleted）
        }
      }
      if (method === "thread/list") {
        mutableState.threadListRequestCount += 1;
        const response = result as any;
        const archiveFilter = typeof (params as any)?.archived === "boolean" ? Boolean((params as any).archived) : null;
        const indexed = Array.isArray(response?.data) ? response.data : [];
        // 零阻塞宿主（09-12）：兜底扫描整体在 **worker 线程**里跑（同步 I/O 会阻塞**所有会话**）。
        // 语义与原实现一致：仍无条件扫（不要改成「仅 indexed 为空时才扫」——引擎索引瞬时为空
        // 会让侧栏整片消失）。worker 不可用时退化为「不发兜底」。
        mutableState.rolloutFallbackScanCount += 1;
        try {
          const fallback = await listRolloutThreadsAsync(codexHome);
          // ⛔ 合并阶段必须排除「已永久删除」的线程（墓碑集合）：兜底扫描只认磁盘文件，
          //   不排除就会在下次启动把用户删掉的会话捞回侧栏（09-18 用户实测的「重启又恢复」）。
          const merged = mergeThreadList(indexed, fallback, archiveFilter, Number((params as any)?.limit ?? 100), deletedThreadIds);
          // 「记录已丢失」标记：判据与实测口径见 session-tools.ts 的 markMissingRollouts 注释
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
          // ⛔ 结果优先（10-07）：引擎回执里的 cwd 是**解析后的权威值**；请求参数可能是空串
          //   （`?? ` 只挡 null/undefined，空串会赢）⇒ 空串会让快照被静默跳过（文件追踪失明）。
          threadCwd.set(String(r.thread.id), String(r.thread.cwd ?? p?.cwd ?? ""));
        } else if (method === "thread/resume" && r?.thread?.id) {
          // 零阻塞宿主（09-12）：rollout 增强解析也在 worker 线程里，失败就退化为「不增强」。
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
          /* 文件变更报告**重播**（10-06 夜二改）：本线程的存量报告按原事件形态重发 ——
             重启/切回会话后「已更改 N 个文件」卡与收尾冻结的编辑行仍在（渲染层收件零改动）。
             失败静默：重播只是锦上添花，不影响 resume 本身。 */
          try {
            for (const stored of storedReportsForThread(String(r.thread.id))) {
              broadcastHarnessEvent({ type: "turn-file-changes", turnId: stored.turnId, files: stored.files } as any);
            }
          } catch { /* 重播失败不影响 resume */ }
          /* 压缩线**重播**（10-07）：引擎侧压缩 item 不进 turns API（实测）⇒ 宿主侦测记录落盘后
             在这里按原事件形态重发，重启/切回会话后压缩线仍在。 */
          try {
            for (const stored of storedCompactionsForThread(String(r.thread.id))) {
              broadcastHarnessEvent({ type: "thread-compacted-host", threadId: String(r.thread.id), turnId: stored.turnId, at: stored.at } as any);
            }
          } catch { /* 重播失败不影响 resume */ }
        } else if (method === "thread/settings/update" && p?.threadId && p?.cwd) {
          threadCwd.set(String(p.threadId), String(p.cwd));
        } else if (method === "thread/list" && Array.isArray(r?.data)) {
          // ⛔ 隐私加固（09-19）配套：侧栏列表里的每个会话 cwd 也要记账——可信根集合
          // 才能覆盖"本轮还没 resume 过的会话"的文件预览。
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

    ipcHost.handle("codex:respond", (_event, id: string | number, result: unknown) => server.respond(id, result));

    // ⛔ `IpcHost.handle` 的 event 收窄成 `unknown`（容器不暴露 electron 类型面），
    //    而这里需要 `sender.id` 做"哪个窗口在看哪个会话"的记账 ⇒ 就地断言成最小够用的形状。
    type RendererSender = { id: number; once: (event: "destroyed", listener: () => void) => void };
    ipcHost.handle("codex:set-active-thread", (rawEvent, threadId: unknown) => {
      const id = threadId == null ? "" : String(threadId);
      rendererActiveThreadId = id;
      const event = rawEvent as { sender: RendererSender };
      try { rendererActiveByWindow.set(event.sender.id, { threadId: id, at: Date.now() }); } catch { /* 窗口已销毁：忽略 */ }
      // 窗口销毁时清掉记录：否则一个已关闭窗口的旧值会在新鲜度窗口内继续放行它的会话事件
      try {
        event.sender.once("destroyed", () => rendererActiveByWindow.delete(event.sender.id));
      } catch { /* ignore */ }
      return { ok: true };
    });

    ctx.effect(() => {
      for (const ch of ["codex:request", "codex:respond", "codex:set-active-thread"]) ipcHost.removeHandler(ch);
    });
  },
});
