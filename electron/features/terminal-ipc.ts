/**
 * terminal-ipc（10-03 从 `features/settings-app-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：terminal(5)
 * 通道：terminal:list / terminal:input / terminal:resize / terminal:restart / terminal:ready
 *
 * ⛔ `terminalFor` 的懒创建语义不能改：同一个 id 复用同一个 TerminalService（重复 new 会让
 *    正在跑的会话被顶掉），且 onData 回调在这里绑定一次。
 * ⛔ `terminal:restart` 的 cwd 校验：只做**存在性**校验而非白名单 —— 终端本身就是用户可交互
 *    shell（能 cd 到任何目录），白名单挡不住"shell 里 cd 出去"，只会误伤合法用法（09-19 审计口径）。
 */
import { TerminalService } from "../terminal";
import { sendToWindow } from "./window-bus";
import { fileStat } from "./app-diagnostics";
import { terminals } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

function terminalFor(id: string) {
  let service = terminals.get(id);
  if (!service) {
    service = new TerminalService();
    service.onData((data) => sendToWindow("terminal:data", { id, data }));
    terminals.set(id, service);
  }
  return service;
}

export const terminalFeature = defineFeature<null>({
  id: "terminal",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("terminal: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("terminal:list", () => [...terminals.entries()].map(([id, service]) => ({ id, alive: service.alive, cwd: service.dir })));
    ipcHost.handle("terminal:input", (_event, id: string, data: string) => terminalFor(id).input(data));
    ipcHost.handle("terminal:resize", (_event, id: string, cols: number, rows: number) => terminalFor(id).resize(cols, rows));
    ipcHost.handle("terminal:restart", (_event, id: string, cwd?: string) => {
      // ⛔ 隐私加固（09-19 审计中危）：cwd 由渲染层直传，先验证是真实存在的目录（防怪值/注入面收敛）。
      // 注：终端本身就是用户可交互 shell（可 cd 到任何目录），故这里做存在性校验而非白名单——
      // 白名单挡不住"shell 里 cd 出去"，只会误伤"在任意合法目录开会话"的用法。
      if (cwd) {
        const st = fileStat(cwd);
        if (!st || !st.isDirectory()) throw new Error(`终端目录不存在或不可用：${cwd}`);
      }
      return terminalFor(id).restart(cwd);
    });
    ipcHost.handle("terminal:ready", () => true);

    ctx.effect(() => {
      for (const ch of ["terminal:list", "terminal:input", "terminal:resize", "terminal:restart", "terminal:ready"]) ipcHost.removeHandler(ch);
    });
  },
});
