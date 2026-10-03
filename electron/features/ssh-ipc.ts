/**
 * ssh-ipc（10-03 从 `features/settings-app-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：ssh(12)
 * 通道：ssh:list / ssh:save / ssh:delete / ssh:set-enabled / ssh:test / ssh:exec /
 *      ssh:session-open / ssh:session-write / ssh:session-resize / ssh:session-close / ssh:export / ssh:import
 *
 * ⛔ 导出/导入走 `dialog` 存盘框（宿主能力，阶段 2 接缝化后经 `"dialog"` 注入）。
 * ⛔ `sshSessions` 是本域私有的会话池（`../runtime-refs` 活绑定），拆分不新增共享面。
 * ⛔ 待接缝化（阶段 2）：app / dialog / fs 为宿主能力。
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { app, dialog } from "electron";
import { deleteSshServer, execSshCommand, exportSshServers, parseSshImport, readSshServers, saveSshServer, setSshServerEnabled, testSshConnection, writeSshServers } from "../ssh-servers";
import type { SshExecResult, SshServer, SshTestResult } from "../ssh-servers";
import { sendToWindow } from "./window-bus";
import { mainWindow, sshSessions } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

const SSH_CHANNELS = [
  "ssh:list", "ssh:save", "ssh:delete", "ssh:set-enabled", "ssh:test", "ssh:exec",
  "ssh:session-open", "ssh:session-write", "ssh:session-resize", "ssh:session-close", "ssh:export", "ssh:import",
];

export const sshFeature = defineFeature<null>({
  id: "ssh",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("ssh: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("ssh:list", async (): Promise<SshServer[]> => readSshServers(app.getPath("userData")));
    ipcHost.handle("ssh:save", async (_event, input: SshServer): Promise<SshServer[]> => {
      const server: SshServer = {
        ...input,
        id: input.id || crypto.randomUUID(),
        port: Number(input.port) || 22,
        createdAt: input.createdAt || new Date().toISOString(),
      };
      return saveSshServer(app.getPath("userData"), server);
    });
    ipcHost.handle("ssh:delete", async (_event, ids: string[]): Promise<SshServer[]> => {
      const list = Array.isArray(ids) ? ids.map((id) => String(id)) : [String(ids)];
      return deleteSshServer(app.getPath("userData"), list);
    });
    ipcHost.handle("ssh:set-enabled", async (_event, input: { ids: string[]; enabled: boolean }): Promise<SshServer[]> => {
      const ids = Array.isArray(input?.ids) ? input.ids.map(String) : [];
      return setSshServerEnabled(app.getPath("userData"), ids, Boolean(input?.enabled));
    });
    ipcHost.handle("ssh:test", async (_event, input: SshServer): Promise<SshTestResult> => {
      try {
        return await testSshConnection(input, (input.connectTimeout && input.connectTimeout > 0 ? input.connectTimeout : 10) * 1000);
      } catch (error: any) {
        return { ok: false, error: error.message };
      }
    });
    ipcHost.handle("ssh:exec", async (_event, input: { server: SshServer; command: string }): Promise<SshExecResult> => {
      try {
        return await execSshCommand(input?.server, String(input?.command ?? ""));
      } catch (error: any) {
        return { ok: false, error: error.message };
      }
    });
    ipcHost.handle("ssh:session-open", async (_event, input: { server: SshServer; cols: number; rows: number }): Promise<{ sessionId: string } | { error: string }> => {
      try {
        return await sshSessions.open(input.server, {
          cols: Number(input?.cols) || 100,
          rows: Number(input?.rows) || 30,
          onData: (data) => sendToWindow("ssh:data", { data }),
          onExit: (info) => sendToWindow("ssh:exit", info),
        });
      } catch (error: any) {
        return { error: error.message };
      }
    });
    ipcHost.handle("ssh:session-write", (_event, input: { sessionId: string; data: string }) => {
      sshSessions.write(String(input?.sessionId ?? ""), String(input?.data ?? ""));
    });
    ipcHost.handle("ssh:session-resize", (_event, input: { sessionId: string; cols: number; rows: number }) => {
      sshSessions.resize(String(input?.sessionId ?? ""), Number(input?.cols) || 100, Number(input?.rows) || 30);
    });
    ipcHost.handle("ssh:session-close", (_event, sessionId: string) => {
      sshSessions.close(String(sessionId));
    });
    ipcHost.handle("ssh:export", async (_event, input: { servers: SshServer[]; includeSecrets: boolean }): Promise<string | null> => {
      const result = await dialog.showSaveDialog(mainWindow!, {
        title: "导出 SSH 连接配置",
        defaultPath: `ssh-servers-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (result.canceled || !result.filePath) return null;
      await fs.writeFile(result.filePath, exportSshServers(input?.servers ?? [], Boolean(input?.includeSecrets)), "utf8");
      return result.filePath;
    });
    ipcHost.handle("ssh:import", async (): Promise<SshServer[] | null> => {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: "导入 SSH 连接配置",
        properties: ["openFile"],
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (result.canceled || !result.filePaths?.length) return null;
      const imported = parseSshImport(await fs.readFile(result.filePaths[0], "utf8"));
      if (!imported.length) return null;
      const current = await readSshServers(app.getPath("userData"));
      const merged = [...current];
      for (const server of imported) merged.push({ ...server, id: crypto.randomUUID() });
      await writeSshServers(app.getPath("userData"), merged);
      return merged;
    });

    ctx.effect(() => {
      for (const ch of SSH_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
