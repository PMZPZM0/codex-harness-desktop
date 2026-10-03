/**
 * commands-ipc（10-03 从 `features/teams-agents-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：commands(5)
 * 通道：commands:list / read / save / delete / expand（自定义斜杠命令）
 *
 * ⛔⛔ 安全边界（`commands:delete`，09-13 审计 S5，**本次改造不放宽**）：
 *    `deleteCustomCommand` 内部是裸 `fs.rm` 且**没有任何包含性校验**，而这条链由渲染层任意字符串
 *    直达 ⇒ 必须在这里收敛到自定义命令目录内。两个来源目录都要放行（全局 `<codexHome>/commands`
 *    与项目级 `<cwd>/.codex/commands`），否则删项目命令会误报。
 */
import path from "node:path";
import { deleteCustomCommand, expandCommandTemplate, listCustomCommands, readCustomCommand, saveCustomCommand } from "../commands";
import { codexHome, threadCwd } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const commandsFeature = defineFeature<null>({
  id: "commands",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("commands: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("commands:list", async (_event, input: { cwd?: unknown } = {}) => {
      return listCustomCommands(codexHome, input?.cwd ? String(input.cwd) : undefined);
    });
    ipcHost.handle("commands:read", async (_event, input: { filePath?: unknown; cwd?: unknown } = {}) => {
      const filePath = String(input?.filePath ?? "");
      if (!filePath) return null;
      return readCustomCommand(filePath, codexHome, input?.cwd ? String(input.cwd) : undefined);
    });
    ipcHost.handle("commands:save", async (_event, input: any) => saveCustomCommand({ ...input, codexHome }));
    ipcHost.handle("commands:delete", async (_event, filePath: string) => {
      // ⛔ 收敛到「自定义命令目录内」（09-13 审计 S5）：`deleteCustomCommand` 内部就是裸 `fs.rm`
      // 且**没有任何包含性校验**，而这条链由渲染层任意字符串直达 —— 一个 `fs.rm` 原语。
      {
        const target = path.resolve(String(filePath ?? ""));
        // 自定义命令有两个来源目录（见 commands.ts）：全局 `<codexHome>/commands` 与
        // 项目级 `<cwd>/.codex/commands` —— 两个都要放行，否则删项目命令会误报。
        const bases = [path.join(codexHome, "commands"), ...[...threadCwd.values()].filter(Boolean).map((cwd) => path.join(String(cwd), ".codex", "commands"))]
          .map((base) => path.resolve(base));
        const inside = Boolean(target) && bases.some((base) => {
          const relative = path.relative(base, target);
          return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
        });
        if (!inside) throw new Error("只能删除自定义命令目录内的文件");
      }
      await deleteCustomCommand(String(filePath ?? ""));
      return { ok: true };
    });
    ipcHost.handle("commands:expand", async (_event, input: { filePath?: unknown; argument?: unknown; cwd?: unknown }) => {
      const filePath = String(input?.filePath ?? "");
      if (!filePath) throw new Error("缺少命令文件路径");
      const entry = await readCustomCommand(filePath, codexHome, input?.cwd ? String(input.cwd) : undefined);
      if (!entry) throw new Error("命令不存在或已被删除。");
      return { text: await expandCommandTemplate(entry, String(input?.argument ?? ""), input?.cwd ? String(input.cwd) : undefined) };
    });

    ctx.effect(() => {
      for (const ch of ["commands:list", "commands:read", "commands:save", "commands:delete", "commands:expand"]) ipcHost.removeHandler(ch);
    });
  },
});
