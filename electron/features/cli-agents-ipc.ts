/**
 * cli-agents-ipc（10-29 新板块，用户令「开发工具界面新增一个 CLI 智能体模块」）
 *
 * 域：cliagents(4)
 * 通道：cliagents:list / detect / save / remove
 *
 * ⛔ 这一层只做**管理面**（列出 / 检测是否已装 / 增改 / 删除）。
 *   **派活不在这里** —— CLI 作为调度对象走的是唯一那条通道：
 *   `agent_invoke`（kind="cli"）→ `runDelegatedTask`，与专家 / 子智能体 / 专家团同一套闸门与登记。
 *   （09-14 的教训：`subagents:invoke` 当年就是一条绕过全部闸门、不登记 delegateRegistry 的旁路，
 *     已被整体删除；⛔ 别在这里长回第二条派活通道。）
 * ⛔ 检测有子进程（where/which + --version）：只在用户点「检测」时跑，不在 list 里自动跑
 *   （否则每次打开设置页都会 fork 一批进程）。
 */
import { CLI_CATEGORIES, detectCliAgent, readCliAgents, removeCliAgent, saveCliAgent } from "../cli-agents";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

const CLI_AGENTS_CHANNELS = ["cliagents:list", "cliagents:detect", "cliagents:save", "cliagents:remove"];

export const cliAgentsFeature = defineFeature<null>({
  id: "cliagents",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("cliagents: 缺少 ipc 服务（宿主未提供）");

    /* 分类表跟着列表一起下发：渲染层不再复制一份字面量（两处各写一套必然漂移）。 */
    ipcHost.handle("cliagents:list", async () => ({ items: await readCliAgents(), categories: CLI_CATEGORIES }));
    ipcHost.handle("cliagents:detect", async (_event, input?: { id?: string; bin?: string }) => detectCliAgent(input ?? {}));
    ipcHost.handle("cliagents:save", async (_event, input?: { id?: string; name?: string; category?: string; bin?: string; installCmd?: string; docs?: string; description?: string; promptHint?: string; enabled?: boolean }) => saveCliAgent(input ?? {}));
    ipcHost.handle("cliagents:remove", async (_event, id: string) => removeCliAgent(String(id ?? "")));

    ctx.effect(() => {
      for (const ch of CLI_AGENTS_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
