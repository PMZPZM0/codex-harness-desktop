/**
 * settings-app-ipc（09-21 架构改造：从 electron/main.ts 按**域**拆出，纯搬迁）
 *
 * 域：ssh(12) / terminal(5) / browser(3) / git(1) / scratch(1) / pasted-text(3) / appSettings(2) / personalization(6)
 * 通道：appSettings:read / appSettings:save / browser:cloak-status / browser:open-cloak / browser:popout / git:diff / pasted-text:read / pasted-text:save / pasted-text:update / personalization:mark-greeted / personalization:read / personalization:save / personalization:save-identity / personalization:setNickname / personalization:verify / scratch:create / ssh:delete / ssh:exec / ssh:export / ssh:import / ssh:list / ssh:save / ssh:session-close / ssh:session-open / ssh:session-resize / ssh:session-write / ssh:set-enabled / ssh:test / terminal:input / terminal:list / terminal:ready / terminal:resize / terminal:restart
 *
 * 代码与原地逐字一致（仅整体缩进 + 顶部 import + 文件头注释）。
 * 跨域**只读**符号经 `import … from "../main"` 取用 —— 活绑定（TS→CJS 编译成 `main_1.X` 属性访问），
 * 因此 main 里被重新赋值的 `let`（窗口句柄等）也能读到最新值。
 * 跨域**可写**符号（cloakProc）经 `mutableState` 访问器对象读写 —— ESM 里 import 的绑定不可赋值。
 * 注册时机不变：main.ts 模块加载期 import 本文件 ⇒ ipcMain.handle 立即执行。
 */
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { BrowserWindow, app, dialog, ipcMain } from "electron";
import { bundledGit, bundledNode, cloakOpenHelper, npmGlobalRoot, toolchainEnv } from "../toolchain";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { applyPersonalizationToAgentsMd, buildAgentsMd, readPersonalization, writePersonalization } from "../personalization";
import { readAppSettings, saveAppSettings } from "../app-settings";
import { deleteSshServer, execSshCommand, exportSshServers, parseSshImport, readSshServers, saveSshServer, setSshServerEnabled, testSshConnection, writeSshServers } from "../ssh-servers";
import { sendToWindow } from "../features/window-bus";
import { TerminalService } from "../terminal";
import type { AppSettings } from "../app-settings";
import type { SshExecResult, SshServer, SshTestResult } from "../ssh-servers";
import { applyCustomModel } from "../features/custom-model-apply";
import { fileStat } from "../features/app-diagnostics";
import { readCustomModel } from "../main/01-model-catalog";
import { refreshSkillDiscipline } from "../main/12-skill-discipline";
import { codexHome, mainWindow, pastedTextDir, server, sshSessions, syncEngineWatchdog, terminals } from "../runtime-refs";
import { filePreviewAllowed } from "../main";
import { mutableState } from "../main";
function terminalFor(id: string) {
  let service = terminals.get(id);
  if (!service) {
    service = new TerminalService();
    service.onData((data) => sendToWindow("terminal:data", { id, data }));
    terminals.set(id, service);
  }
  return service;
}
ipcMain.handle("terminal:list", () => [...terminals.entries()].map(([id, service]) => ({ id, alive: service.alive, cwd: service.dir })));
let cloakStatus: { event?: string; message?: string; url?: string; title?: string } = {};
ipcMain.handle("browser:open-cloak", (_event, url: string) => {
  const modules = npmGlobalRoot();
  if (!modules || !existsSync(path.join(modules, "cloakbrowser", "package.json"))) {
    return { ok: false, detail: "CloakBrowser 未安装（按需下载）：到「设置 → 开发工具」下载「CloakBrowser 指纹浏览器」（约 4 MB）后再用；日常浏览走内置浏览器视图" };
  }
  if (!mutableState.cloakProc || mutableState.cloakProc.exitCode !== null) {
    const helper = cloakOpenHelper();
    if (!helper || !existsSync(helper)) return { ok: false, detail: "缺少 resources/tools/cloak-open.mjs 助手脚本" };
    const node = bundledNode() || "node";
    mutableState.cloakProc = spawn(node, [helper], { windowsHide: true, env: { ...toolchainEnv(), CLOAK_NPM_ROOT: modules } });
    mutableState.cloakProc.stdout?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        if (!line.trim()) continue;
        try { cloakStatus = JSON.parse(line); } catch { /* 非 JSON 行 */ }
      }
    });
    mutableState.cloakProc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) cloakStatus = { event: "error", message: text.slice(0, 300) };
    });
    mutableState.cloakProc.once("error", (error) => { cloakStatus = { event: "error", message: error.message }; mutableState.cloakProc = null; });
    mutableState.cloakProc.once("exit", (code) => {
      if (cloakStatus.event !== "error") cloakStatus = { event: "exit", ...(code ? { message: `浏览器进程退出（${code}）` } : {}) };
      mutableState.cloakProc = null;
    });
    mutableState.cloakProc.stdin?.on("error", () => { /* EPIPE：进程刚退出 */ });
    cloakStatus = { event: "launching" };
  }
  try {
    mutableState.cloakProc.stdin?.write(`${url.trim()}\n`);
    return { ok: true, detail: "已提交给 CloakBrowser" };
  } catch (error: any) {
    return { ok: false, detail: error.message };
  }
});
ipcMain.handle("browser:cloak-status", () => cloakStatus);
ipcMain.handle("terminal:input", (_event, id: string, data: string) => terminalFor(id).input(data));
ipcMain.handle("terminal:resize", (_event, id: string, cols: number, rows: number) => terminalFor(id).resize(cols, rows));
ipcMain.handle("terminal:restart", (_event, id: string, cwd?: string) => {
  // ⛔ 隐私加固（09-19 审计中危）：cwd 由渲染层直传，先验证是真实存在的目录（防怪值/注入面收敛）。
  // 注：终端本身就是用户可交互 shell（可 cd 到任何目录），故这里做存在性校验而非白名单——
  // 白名单挡不住"shell 里 cd 出去"，只会误伤"在任意合法目录开会话"的用法。
  if (cwd) {
    const st = fileStat(cwd);
    if (!st || !st.isDirectory()) throw new Error(`终端目录不存在或不可用：${cwd}`);
  }
  return terminalFor(id).restart(cwd);
});
ipcMain.handle("terminal:ready", () => true);
ipcMain.handle("git:diff", (_event, input: { cwd: string; scope: string }) => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
  const args = input.scope === "staged" ? ["diff", "--cached"] : input.scope === "head" ? ["diff", "HEAD"] : ["diff"];
  const proc = spawn(bundledGit() || "git", args, { cwd: input.cwd, windowsHide: true, env: toolchainEnv() });
  let output = "";
  proc.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  proc.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  proc.on("error", () => resolve({ code: null, output: "" }));
  proc.on("close", (code) => resolve({ code, output }));
}));
ipcMain.handle("personalization:read", async () => readPersonalization());
ipcMain.handle("personalization:save", async (_event, input: { nickname?: unknown; customInstructions?: unknown }) => {
  const config = await writePersonalization(input);
  await applyPersonalizationToAgentsMd(config, codexHome);
  void refreshSkillDiscipline();
  const model = await readCustomModel();
  // 重写 config.toml：把迁移前残留在 developer_instructions 里的旧个性化段清掉，并重启引擎
  if (model) await applyCustomModel(model);
  return config;
});
ipcMain.handle("personalization:save-identity", async (_event, input: Record<string, unknown>) => {
  const config = await writePersonalization(input);
  await applyPersonalizationToAgentsMd(config, codexHome);
  void refreshSkillDiscipline();
  return config;
});
ipcMain.handle("personalization:mark-greeted", async () => {
  const config = await writePersonalization({ greeted: true });
  return config;
});
ipcMain.handle("appSettings:read", async (): Promise<AppSettings> => readAppSettings(app.getPath("userData")));
ipcMain.handle("appSettings:save", async (_event, patch: Partial<AppSettings>): Promise<AppSettings> => {
  const next = await saveAppSettings(app.getPath("userData"), patch);
  const model = await readCustomModel();
  if (model) await applyCustomModel(model);
  // 引擎健康看门狗开关即时生效（不依赖重启后的 ready 事件）
  await syncEngineWatchdog();
  return next;
});
ipcMain.handle("ssh:list", async (): Promise<SshServer[]> => readSshServers(app.getPath("userData")));
ipcMain.handle("ssh:save", async (_event, input: SshServer): Promise<SshServer[]> => {
  const server: SshServer = {
    ...input,
    id: input.id || crypto.randomUUID(),
    port: Number(input.port) || 22,
    createdAt: input.createdAt || new Date().toISOString(),
  };
  return saveSshServer(app.getPath("userData"), server);
});
ipcMain.handle("ssh:delete", async (_event, ids: string[]): Promise<SshServer[]> => {
  const list = Array.isArray(ids) ? ids.map((id) => String(id)) : [String(ids)];
  return deleteSshServer(app.getPath("userData"), list);
});
ipcMain.handle("ssh:set-enabled", async (_event, input: { ids: string[]; enabled: boolean }): Promise<SshServer[]> => {
  const ids = Array.isArray(input?.ids) ? input.ids.map(String) : [];
  return setSshServerEnabled(app.getPath("userData"), ids, Boolean(input?.enabled));
});
ipcMain.handle("ssh:test", async (_event, input: SshServer): Promise<SshTestResult> => {
  try {
    return await testSshConnection(input, (input.connectTimeout && input.connectTimeout > 0 ? input.connectTimeout : 10) * 1000);
  } catch (error: any) {
    return { ok: false, error: error.message };
  }
});
ipcMain.handle("ssh:exec", async (_event, input: { server: SshServer; command: string }): Promise<SshExecResult> => {
  try {
    return await execSshCommand(input?.server, String(input?.command ?? ""));
  } catch (error: any) {
    return { ok: false, error: error.message };
  }
});
ipcMain.handle("ssh:session-open", async (_event, input: { server: SshServer; cols: number; rows: number }): Promise<{ sessionId: string } | { error: string }> => {
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
ipcMain.handle("ssh:session-write", (_event, input: { sessionId: string; data: string }) => {
  sshSessions.write(String(input?.sessionId ?? ""), String(input?.data ?? ""));
});
ipcMain.handle("ssh:session-resize", (_event, input: { sessionId: string; cols: number; rows: number }) => {
  sshSessions.resize(String(input?.sessionId ?? ""), Number(input?.cols) || 100, Number(input?.rows) || 30);
});
ipcMain.handle("ssh:session-close", (_event, sessionId: string) => {
  sshSessions.close(String(sessionId));
});
ipcMain.handle("ssh:export", async (_event, input: { servers: SshServer[]; includeSecrets: boolean }): Promise<string | null> => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: "导出 SSH 连接配置",
    defaultPath: `ssh-servers-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, exportSshServers(input?.servers ?? [], Boolean(input?.includeSecrets)), "utf8");
  return result.filePath;
});
ipcMain.handle("ssh:import", async (): Promise<SshServer[] | null> => {
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
ipcMain.handle("personalization:setNickname", async (_event, nickname: unknown) => {
  const current = await readPersonalization();
  const config = await writePersonalization({ nickname, customInstructions: current.customInstructions });
  await applyPersonalizationToAgentsMd(config, codexHome);
  void refreshSkillDiscipline();
  return config;
});
ipcMain.handle("personalization:verify", async () => {
  const stored = await readPersonalization();
  const expects = Boolean(stored.nickname || stored.customInstructions);
  const agentsPath = path.join(codexHome, "AGENTS.md");
  const expectedText = buildAgentsMd(stored);
  let raw = "";
  try { raw = await fs.readFile(agentsPath, "utf8"); }
  catch (error: any) {
    if (error.code !== "ENOENT") throw error;
    // 缺文件：直接补齐基础段（emoji + 中文语言规范），老实例升级后自动生效
    await fs.writeFile(agentsPath, expectedText, "utf8");
    return { exists: true, expects, applied: true, inSync: true, preview: expectedText.trim().slice(0, 2000), agentsPath };
  }
  const applied = Boolean(raw.trim());
  const inSync = raw === expectedText;
  // 生成逻辑与写入共用 buildAgentsMd，逐字一致才算同步。
  // 不一致（如新增了语言基础段、或用户手改过）时重写补齐——AGENTS.md 是
  // 引擎动态加载（每请求重读），重写后下一条消息即生效，无需重启引擎。
  if (raw !== expectedText) {
    await fs.writeFile(agentsPath, expectedText, "utf8");
    return { exists: true, expects, applied: true, inSync: true, preview: expectedText.trim().slice(0, 2000), agentsPath, replayed: true };
  }
  return {
    exists: true,
    expects,
    applied,
    inSync,
    preview: raw.trim().slice(0, 2000),
    agentsPath,
  };
});
ipcMain.handle("pasted-text:save", async (_event, text: unknown) => {
  const content = typeof text === "string" ? text : "";
  if (!content.trim()) return null;
  await fs.mkdir(pastedTextDir, { recursive: true });
  const hash = crypto.createHash("sha1").update(content, "utf8").digest("hex").slice(0, 8);
  // 名字里带一段"内容提示"（首行去掉不适合做文件名的字符），让 chip 一眼能认出来是什么
  const hint = content.trim().split(/\r?\n/, 1)[0]
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .trim()
    .slice(0, 16) || "文本";
  const file = path.join(pastedTextDir, `粘贴文本-${hint}-${hash}.txt`);
  if (!fileStat(file)) await fs.writeFile(file, content, "utf8");
  return file;
});
function isInsidePastedTextDir(target: string) {
  const resolved = path.resolve(target);
  const relative = path.relative(pastedTextDir, resolved);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}
ipcMain.handle("pasted-text:read", async (_event, target: unknown) => {
  const file = typeof target === "string" ? target : "";
  if (!file || !isInsidePastedTextDir(file)) return { editable: false };
  if (!fileStat(file)) return { editable: true, content: null };
  return { editable: true, content: await fs.readFile(path.resolve(file), "utf8") };
});
ipcMain.handle("pasted-text:update", async (_event, input: { path: string; content: string }) => {
  const file = typeof input?.path === "string" ? input.path : "";
  if (!file || !isInsidePastedTextDir(file)) throw new Error("只允许编辑应用自己保存的粘贴文本");
  await fs.mkdir(pastedTextDir, { recursive: true });
  await fs.writeFile(path.resolve(file), String(input?.content ?? ""), "utf8");
  return { ok: true, size: Buffer.byteLength(String(input?.content ?? ""), "utf8") };
});
ipcMain.handle("browser:popout", async (_event, value: string) => {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:" && !filePreviewAllowed(url)) throw new Error("Unsupported URL");
  const pop = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 480,
    minHeight: 320,
    title: "预览",
    autoHideMenuBar: true,
    backgroundColor: "#1b1b1a",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  pop.setMenuBarVisibility(false);
  void pop.loadURL(url.toString());
  return { ok: true };
});
ipcMain.handle("scratch:create", async () => {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const name = `chat-${stamp}-${Date.now().toString(36)}`;
  /* ⛔ root 一律 userData（09-22 实测教训）：旧实现用 exe 同级目录 —— 开发模式落在
   * dist/（构建即清，记忆全丢），打包后在 Program Files（无写权限）。userData 持久且必有写权限。 */
  const dir = path.join(app.getPath("userData"), "scratch", name);
  await fs.mkdir(dir, { recursive: true });
  return dir;
});
