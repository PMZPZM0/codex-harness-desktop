/**
 * agents-ipc（10-03 从 `features/teams-agents-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：agents(11)
 * 通道：agents:thread-role / catalog / tool-description / notice / off-notice / delegated / delegated-of /
 *       invoke / archive / dispatch-call
 *       （`dispatch-call` 是 10-05 的**能力网关**：内置 MCP 的工具面在引擎 0.157 后对模型不可见，
 *        渲染层用一个 dynamicTool `harness_tools` 把它们接回来 —— 执行端仍是 dispatchRpcCall。
 *        ⛔ 图像四件套**不在**这里：它们有自己的 IPC（image-lab:generate / :edit / :info / :view），
 *           10-09 用户要求「生成和编辑的 IPC 彻底分开」。）
 *
 * ⛔⛔ `agents:archive` 的**失败必须计数**（09-24 修，评估报告 §4.2）：原写法 `.catch(() => undefined)`
 *    吞掉引擎侧失败后**无条件** `archived += 1` ⇒ 弹「已归档 N 个」而会话其实还在列表里
 *    —— 正是本项目记录过的"开关点了没生效"类假象。对照：MCP 孪生实现 dispatch-rpc.ts 本来就是对的。
 * ⛔ `agents:invoke` 走 `runDelegatedTask`（`./delegation`），被委派会话的记忆注入在那里补（守卫【125】）。
 */
import { dispatchToolDescription, dispatchSelectionChangeNotice, dispatchAllowOf } from "../dispatch";
import { broadcastHarnessEvent } from "./window-bus";
import { buildDispatchCatalog, restrictedThreadRole } from "./dispatch-core";
import { dispatchGatewayCatalogText, dispatchRpcCall } from "./dispatch-rpc";
import { runDelegatedTask } from "./delegation";
import { delegateRegistry, server, threadRuntimeStore } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

const AGENTS_CHANNELS = [
  "agents:thread-role", "agents:catalog", "agents:tool-description", "agents:notice",
  "agents:delegated", "agents:delegated-of", "agents:invoke", "agents:archive", "agents:dispatch-call",
];

export const agentsFeature = defineFeature<null>({
  id: "agents",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("agents: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("agents:thread-role", async (_event, threadId: string) => await restrictedThreadRole(String(threadId ?? "")));
    ipcHost.handle("agents:catalog", async () => ({ targets: await buildDispatchCatalog() }));
    ipcHost.handle("agents:tool-description", async (_event, threadId: string) => {
      /*⛔⛔ 2026-10-04 用户报「我勾了子智能体，提示词还让我派专家」——
         原来**无参**调用，只能把三类全列上⇒ 模型自己挑、挑错。
         ✅ 现在按该会话**实际许可**的类别生成（10-29 起专家/子智能体默认可用、专家团默认关闭），
            未开启的类别明确写「本会话未开启，不要派」（不是隐藏，是明确否定 ——
            隐藏会让模型以为不存在而报错，明确否定才不会乱试）。
         取不到 threadId 或线程运行时未就绪时退回出厂默认（专家+子智能体可用、专家团关闭）。*/
      const id = String(threadId ?? "");
      /* ⛔ threadRuntimeStore 是惰性赋值（`export let ...!`），应用启动早期可能还没 set
         ⇒ 直接 .get() 会抛 "Cannot read properties of undefined" ⇒ 连带把整个
         tool-description 拖垮。这里捕获后按出厂默认降级（dispatchAllowOf(null)）。 */
      let cfg: any = null;
      if (id) {
        try { cfg = (await threadRuntimeStore.get(id))?.dispatch ?? null; }
        catch { cfg = null; }
      }
      const allow = dispatchAllowOf(cfg);
      const targets = await buildDispatchCatalog();
      return { description: dispatchToolDescription(targets, allow) };
    });
    /* ⛔ 10-29：三个通知入口（开启 / 关闭 / 逐类变化）收敛成**一个**——总开关删除后只剩
       「逐类许可变化」一种事件。映射规则不变（10-04 用户拍板）：渲染层传 before/next，
       主进程算**差集**生成一条按类分段的通知（不遗漏、不重复发送），并给新开启的类附名单。 */
    ipcHost.handle("agents:notice", async (_event, before?: { expert?: boolean; team?: boolean; subagent?: boolean }, next?: { expert?: boolean; team?: boolean; subagent?: boolean }) => {
      const targets = await buildDispatchCatalog();
      const b = { expert: before?.expert === true, team: before?.team === true, subagent: before?.subagent === true };
      const n = { expert: next?.expert === true, team: next?.team === true, subagent: next?.subagent === true };
      const kinds = ["expert", "team", "subagent"] as const;
      const turnedOn = kinds.filter((k) => n[k] && !b[k]);
      const turnedOff = kinds.filter((k) => !n[k] && b[k]);
      return { text: dispatchSelectionChangeNotice([...turnedOn], [...turnedOff], n, targets) };
    });
    ipcHost.handle("agents:delegated", async () => ({ records: await delegateRegistry.listAll() }));
    ipcHost.handle("agents:delegated-of", async (_event, originThreadId: string) => ({
      records: await delegateRegistry.listByOrigin(String(originThreadId ?? "")),
    }));
    ipcHost.handle("agents:invoke", async (_event, input: any) => runDelegatedTask(input ?? ({} as any)));
    ipcHost.handle("agents:archive", async (_event, input: { threadIds?: string[]; originThreadId?: string }) => {
      /* ⛔ 10-05 归属校验：`threadIds` 是**模型可控参数**，原来只要「登记表里有这条」就归档
         ⇒ 可以归档**别的会话**派出的委托（越权）。这里收口到「**本会话派出的**委托」：
           · 给了 originThreadId（= 引擎发给渲染层的真实 threadId，模型伪造不了）⇒ 记录必须属于它，
             不匹配的计入 failed（让模型/用户看得见，而不是静默成功）；
           · 没给（历史调用方）⇒ 保持原行为。
         与 MCP 孪生实现同口径：features/dispatch-rpc.ts 的 agent_archive_sessions。 */
      const origin = String(input?.originThreadId ?? "");
      const ids = Array.isArray(input?.threadIds) && input.threadIds.length
        ? input.threadIds.map(String)
        : (await delegateRegistry.listByOrigin(origin)).map((record) => record.threadId);
      let archived = 0;
      const failed: string[] = [];
      for (const id of ids) {
        try {
          const record = await delegateRegistry.infoOf(id);
          if (!record || record.archived) continue;
          if (origin && record.originThreadId !== origin) { failed.push(id); continue; }
          /* ⛔ 09-24 修（评估报告 §4.2）：原写法 `.catch(() => undefined)` 吞掉引擎侧失败后**无条件**
             `archived += 1` + markArchived ⇒ 弹「已归档 N 个」而会话其实还在列表里
             （正是项目记录过的"开关点了没生效"类）。归档失败必须计入 failed，不能只报喜。
             对照：MCP 孪生实现 dispatch-rpc.ts 本来就是对的。 */
          const archivedOk = await server.request("thread/archive", { threadId: id }).then(() => true).catch(() => false);
          if (!archivedOk) { failed.push(id); continue; }
          await delegateRegistry.markArchived([id]);
          archived += 1;
        } catch { failed.push(id); }
      }
      broadcastHarnessEvent({ type: "delegates-changed" } as any);
      return { archived, failed };
    });
    /* 10-05 能力网关（详见 dispatch-rpc.ts 的 dispatchGatewayTools 注释）：
       内置 MCP 的工具面在引擎 0.157 后对模型不可见，渲染层用一个 dynamicTool `harness_tools`
       把它们接回来，执行端仍是 `dispatchRpcCall`（同一套实现与闸）。
       ⛔ `callerThreadId` **必须由渲染层从引擎事件里取**（`item/tool/call` 的 `params.threadId`），
          不接受模型自报 —— 这批能力里有写操作（保存专家 / 定时任务 / 连接器），身份错了就是越权。
       `name === "list"` 不是工具，是"要清单"：返回名字 + 说明 + 参数 schema。 */
    ipcHost.handle("agents:dispatch-call", async (_event, input: { name?: string; args?: Record<string, unknown>; callerThreadId?: string }) => {
      const tool = String(input?.name ?? "");
      if (!tool) return { ok: false, output: "", error: "缺少工具名（先传 name=\"list\" 拿清单）" };
      if (tool === "list") return { ok: true, output: dispatchGatewayCatalogText() };
      const caller = String(input?.callerThreadId ?? "");
      if (!caller) return { ok: false, output: "", error: "缺少 callerThreadId（宿主内部错误：渲染层必须从引擎事件取，不许用模型自报的值）" };
      const args = input?.args && typeof input.args === "object" && !Array.isArray(input.args) ? input.args : {};
      return dispatchRpcCall(tool, args as Record<string, unknown>, caller);
    });

    ctx.effect(() => {
      for (const ch of AGENTS_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
