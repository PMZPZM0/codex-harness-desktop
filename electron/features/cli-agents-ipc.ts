/**
 * cli-agents-ipc（10-29 新板块，用户令「开发工具界面新增一个 CLI 智能体模块」）
 *
 * 域：cliagents(6)
 * 通道：cliagents:list / detect / save / remove / install / uninstall
 *
 * ⛔ 这一层只做**管理面**（列出 / 检测是否已装 / 增改 / 删除 / 一键装卸）。
 *   **派活不在这里** —— CLI 作为调度对象走的是唯一那条通道：
 *   `agent_invoke`（kind="cli"）→ `runDelegatedTask`，与专家 / 子智能体 / 专家团同一套闸门与登记。
 *   （09-14 的教训：`subagents:invoke` 当年就是一条绕过全部闸门、不登记 delegateRegistry 的旁路，
 *     已被整体删除；⛔ 别在这里长回第二条派活通道。）
 * ⛔ 检测有子进程（where/which + --version）：list 不自动跑；一键装卸的子进程在 `cli-install.ts`
 *   （唯一实现，面板只调 IPC 不自己 spawn）。装卸 / 增删完成后广播 `cli-agents-changed`
 *   —— @ 列表与面板靠它刷新，同时主进程的检测缓存一并失效。
 */
import { broadcastHarnessEvent } from "./window-bus";
import { CLI_CATEGORIES, detectCliAgent, invalidateCliInstalledCache, readCliAgents, removeCliAgent, saveCliAgent } from "../cli-agents";
import { installCliAgent, uninstallCliAgent } from "../cli-install";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

const CLI_AGENTS_CHANNELS = ["cliagents:list", "cliagents:detect", "cliagents:save", "cliagents:remove", "cliagents:install", "cliagents:uninstall"];

export const cliAgentsFeature = defineFeature<null>({
  id: "cliagents",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("cliagents: 缺少 ipc 服务（宿主未提供）");

    /* 分类表跟着列表一起下发：渲染层不再复制一份字面量（两处各写一套必然漂移）。 */
    ipcHost.handle("cliagents:list", async () => ({ items: await readCliAgents(), categories: CLI_CATEGORIES }));
    ipcHost.handle("cliagents:detect", async (_event, input?: { id?: string; bin?: string }) => detectCliAgent(input ?? {}));
    ipcHost.handle("cliagents:save", async (_event, input?: { id?: string; name?: string; category?: string; bin?: string; installCmd?: string; docs?: string; description?: string; promptHint?: string; enabled?: boolean }) => {
      const result = await saveCliAgent(input ?? {});
      if (result.ok) { invalidateCliInstalledCache(); broadcastHarnessEvent({ type: "cli-agents-changed" } as any); }
      return result;
    });
    ipcHost.handle("cliagents:remove", async (_event, id: string) => {
      const result = await removeCliAgent(String(id ?? ""));
      if (result.ok) { invalidateCliInstalledCache(); broadcastHarnessEvent({ type: "cli-agents-changed" } as any); }
      return result;
    });
    ipcHost.handle("cliagents:install", async (_event, id: string) => installCliAgent(String(id ?? "")));
    ipcHost.handle("cliagents:uninstall", async (_event, id: string) => uninstallCliAgent(String(id ?? "")));

    ctx.effect(() => {
      for (const ch of CLI_AGENTS_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
