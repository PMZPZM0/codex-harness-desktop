/**
 * agents-ipc（10-03 从 `features/teams-agents-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：agents(11)
 * 通道：agents:thread-role / catalog / tool-description / notice / off-notice / delegated / delegated-of /
 *       invoke / archive / dispatch-call
 *       （`dispatch-call` 是 10-05 的**能力网关**：内置 MCP 的工具面在引擎 0.157 后对模型不可见，
 *        渲染层用一个 dynamicTool `harness_tools` 把它们接回来 —— 执行端仍是 dispatchRpcCall）
 *
 * ⛔⛔ `agents:archive` 的**失败必须计数**（09-24 修，评估报告 §4.2）：原写法 `.catch(() => undefined)`
 *    吞掉引擎侧失败后**无条件** `archived += 1` ⇒ 弹「已归档 N 个」而会话其实还在列表里
 *    —— 正是本项目记录过的"开关点了没生效"类假象。对照：MCP 孪生实现 dispatch-rpc.ts 本来就是对的。
 * ⛔ `agents:invoke` 走 `runDelegatedTask`（`./delegation`），被委派会话的记忆注入在那里补（守卫【125】）。
 */
import { dispatchNoticeText, dispatchOffNoticeText, dispatchToolDescription, dispatchEnabledNotice, dispatchSelectionChangeNotice } from "../dispatch";
import { broadcastHarnessEvent } from "./window-bus";
import { buildDispatchCatalog, restrictedThreadRole } from "./dispatch-core";
import { dispatchGatewayCatalogText, dispatchRpcCall } from "./dispatch-rpc";
import { runDelegatedTask } from "./delegation";
import { delegateRegistry, server, threadRuntimeStore } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

const AGENTS_CHANNELS = [
  "agents:thread-role", "agents:catalog", "agents:tool-description", "agents:notice", "agents:enabled-notice", "agents:off-notice",
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
         ✅ 现在按该会话**实际勾选**的类别生成：用户开了哪类才列哪类，
            未勾选的明确写"本会话未开启，不要派"（不是隐藏，是明确否定 ——
            隐藏会让模型以为不存在而报错，明确否定才不会乱试）。
         取不到 threadId 或开关全 false 时退化为"全列"（保持旧行为，不让描述变空）。*/
      const id = String(threadId ?? "");
      /* ⛔ threadRuntimeStore 是惰性赋值（`export let ...!`），应用启动早期可能还没 set
         ⇒ 直接 .get() 会抛 "Cannot read properties of undefined" ⇒ 连带把整个
         tool-description 拖垮。这里按"取不到开关 = 未开启"降级（返回 allow=null 全列，
         不让描述通道挂）。 */
      let cfg: any = null;
      if (id) {
        try { cfg = (await threadRuntimeStore.get(id))?.dispatch ?? null; }
        catch { cfg = null; }
      }
      const allow = cfg
        ? { expert: cfg.expert === true, team: cfg.team === true, subagent: cfg.subagent === true }
        : null;
      const targets = await buildDispatchCatalog();
      const anyOn = allow ? allow.expert || allow.team || allow.subagent : true;
      return { description: dispatchToolDescription(anyOn ? targets : [], allow) };
    });
    /* ⛔⛔ 2026-10-04 用户拍板的逐类通知映射（覆盖勾 1/2/3 个 + 取消某项其余仍开）：
       渲染层把「确认前的勾选 before」「确认后的勾选 next」传上来，主进程算**差集**
       生成一条通知（一条消息按类分段 —— 不遗漏、不重复发送）。
       · 总开关 关→开：用 dispatchEnabledNotice（按 next 勾选逐段列）
       · 总开关 开→关：用 dispatchOffNoticeText
       · 总开关不变、勾选变化：用 dispatchSelectionChangeNotice（差集驱动）
       before/next 缺省（旧调用方）时退化为旧行为：全开通知 / 关闭通知。 */
    ipcHost.handle("agents:notice", async (_event, before?: { expert?: boolean; team?: boolean; subagent?: boolean }, next?: { expert?: boolean; team?: boolean; subagent?: boolean }) => {
      const targets = await buildDispatchCatalog();
      if (before || next) {
        const b = { expert: before?.expert === true, team: before?.team === true, subagent: before?.subagent === true };
        const n = { expert: next?.expert === true, team: next?.team === true, subagent: next?.subagent === true };
        const kinds = ["expert", "team", "subagent"] as const;
        const turnedOn = kinds.filter((k) => n[k] && !b[k]);
        const turnedOff = kinds.filter((k) => !n[k] && b[k]);
        return { text: dispatchSelectionChangeNotice([...turnedOn], [...turnedOff], n) };
      }
      return { text: dispatchEnabledNotice(targets, null) };
    });
    ipcHost.handle("agents:enabled-notice", async (_event, next?: { expert?: boolean; team?: boolean; subagent?: boolean }) => {
      const allow = next ? { expert: next.expert === true, team: next.team === true, subagent: next.subagent === true } : null;
      return { text: dispatchEnabledNotice(await buildDispatchCatalog(), allow) };
    });
    ipcHost.handle("agents:off-notice", async () => ({ text: dispatchOffNoticeText() }));
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
