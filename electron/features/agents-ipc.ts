/**
 * agents-ipc（10-03 从 `features/teams-agents-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：agents(9)
 * 通道：agents:thread-role / catalog / tool-description / notice / off-notice / delegated / delegated-of / invoke / archive
 *
 * ⛔⛔ `agents:archive` 的**失败必须计数**（09-24 修，评估报告 §4.2）：原写法 `.catch(() => undefined)`
 *    吞掉引擎侧失败后**无条件** `archived += 1` ⇒ 弹「已归档 N 个」而会话其实还在列表里
 *    —— 正是本项目记录过的"开关点了没生效"类假象。对照：MCP 孪生实现 dispatch-rpc.ts 本来就是对的。
 * ⛔ `agents:invoke` 走 `runDelegatedTask`（`./delegation`），被委派会话的记忆注入在那里补（守卫【125】）。
 */
import { dispatchNoticeText, dispatchOffNoticeText, dispatchToolDescription } from "../dispatch";
import { broadcastHarnessEvent } from "./window-bus";
import { buildDispatchCatalog, restrictedThreadRole } from "./dispatch-core";
import { runDelegatedTask } from "./delegation";
import { delegateRegistry, server, threadRuntimeStore } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

const AGENTS_CHANNELS = [
  "agents:thread-role", "agents:catalog", "agents:tool-description", "agents:notice", "agents:off-notice",
  "agents:delegated", "agents:delegated-of", "agents:invoke", "agents:archive",
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
      const cfg = id ? ((await threadRuntimeStore.get(id))?.dispatch ?? null) : null;
      const allow = cfg
        ? { expert: cfg.expert === true, team: cfg.team === true, subagent: cfg.subagent === true }
        : null;
      const targets = await buildDispatchCatalog();
      const anyOn = allow ? allow.expert || allow.team || allow.subagent : true;
      return { description: dispatchToolDescription(anyOn ? targets : [], allow) };
    });
    ipcHost.handle("agents:notice", async () => ({ text: dispatchNoticeText(await buildDispatchCatalog()) }));
    ipcHost.handle("agents:off-notice", async () => ({ text: dispatchOffNoticeText() }));
    ipcHost.handle("agents:delegated", async () => ({ records: await delegateRegistry.listAll() }));
    ipcHost.handle("agents:delegated-of", async (_event, originThreadId: string) => ({
      records: await delegateRegistry.listByOrigin(String(originThreadId ?? "")),
    }));
    ipcHost.handle("agents:invoke", async (_event, input: any) => runDelegatedTask(input ?? ({} as any)));
    ipcHost.handle("agents:archive", async (_event, input: { threadIds?: string[]; originThreadId?: string }) => {
      const ids = Array.isArray(input?.threadIds) && input.threadIds.length
        ? input.threadIds.map(String)
        : (await delegateRegistry.listByOrigin(String(input?.originThreadId ?? ""))).map((record) => record.threadId);
      let archived = 0;
      const failed: string[] = [];
      for (const id of ids) {
        try {
          const record = await delegateRegistry.infoOf(id);
          if (!record || record.archived) continue;
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

    ctx.effect(() => {
      for (const ch of AGENTS_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
