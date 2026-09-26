/**
 * engine-ipc 的「threads-backup」部分（09-22 从同目录 engine-ipc.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { app, dialog, ipcMain, safeStorage, shell } from "electron";
import { safeProviderId } from "../../provider-id";
import { BACKUP_FORMAT, BACKUP_VERSION, applySessionsBackup, backupFromRolloutFile, buildMarkdownExport, buildSessionsBackup, buildThreadPreview, parseMarkdownConversation } from "../../thread-backup";
import { PROVIDER_RETRY_TUNING } from "../../provider-retry";
import { bridgeDial, readCustomModel, responsesBridge, restrictedThreadRole } from "../../main";
import { codexHome, engineActiveTurnIds, mainWindow, server, threadCwd, threadRuntimeStore } from "../../runtime-refs";
import { deletedThreadIds, forgetDeletedThreads, purgeDeletedThread } from "../thread-deletion";
import { ensureProjectAgentsMd } from "../../project-conventions";
ipcMain.handle("threads:export", async (_event, input?: { threadIds?: string[] }): Promise<{ path: string; count: number } | null> => {
  const ids = Array.isArray(input?.threadIds) && input.threadIds.length ? input.threadIds.map((id) => String(id)) : undefined;
  const backup = buildSessionsBackup(codexHome, ids);
  if (!backup.threads.length) return null;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const single = ids && ids.length === 1 ? `codex-thread-${ids[0].slice(0, 8)}-${stamp}` : `codex-sessions-backup-${stamp}`;
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: ids?.length === 1 ? "导出会话备份" : "导出全部会话备份",
    defaultPath: `${single}.json`,
    filters: [{ name: "Codex 会话备份", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, JSON.stringify(backup, null, 1), "utf8");
  return { path: result.filePath, count: backup.threads.length };
});

ipcMain.handle("threads:export-markdown", async (_event, input?: { threadIds?: string[] }): Promise<{ path: string; count: number; totalMessages: number } | null> => {
  const ids = Array.isArray(input?.threadIds) && input.threadIds.length ? input.threadIds.map((id) => String(id)) : undefined;
  const md = buildMarkdownExport(codexHome, ids);
  if (!md.count) return null;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const single = ids && ids.length === 1 ? `codex-thread-${ids[0].slice(0, 8)}-${stamp}` : `codex-sessions-${stamp}`;
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: ids?.length === 1 ? "导出会话记录为 Markdown" : "导出全部会话记录为 Markdown",
    defaultPath: `${single}.md`,
    filters: [{ name: "Markdown 对话记录", extensions: ["md"] }],
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, md.markdown, "utf8");
  return { path: result.filePath, count: md.count, totalMessages: md.totalMessages };
});

ipcMain.handle("threads:preview-conversation", (_event, threadId: string) => buildThreadPreview(codexHome, String(threadId ?? "")));

ipcMain.handle("threads:import", async (): Promise<{ path: string; imported: number; skipped: number; threads: { id: string; name: string; status: string }[] } | null> => {
  // 支持两类文件：本应用导出的会话备份（.json）+ 原生 Codex rollout 会话记录（.jsonl，
  // 用户反馈 #10：原生会话记录都是 .jsonl，此前只认 .json 导不进来）。可多选合并导入。
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: "导入会话备份 / 原生 Codex 会话记录",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "会话备份 / Codex 会话记录（json, jsonl）", extensions: ["json", "jsonl"] },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePaths?.length) return null;
  const merged: any = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: Date.now(), threads: [] };
  for (const filePath of result.filePaths) {
    if (/\.jsonl$/i.test(filePath)) {
      // 原生 Codex rollout：转成本应用备份格式后走同一条写回管线（重导入同会话按 duplicate/conflict 跳过）
      merged.threads.push(...backupFromRolloutFile(filePath).threads);
    } else {
      let parsed: any;
      try {
        parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
      } catch (error: any) {
        throw new Error(`${path.basename(filePath)}：不是有效的 JSON 文件（${error.message}）`);
      }
      if (!parsed || parsed.format !== BACKUP_FORMAT || !Array.isArray(parsed.threads)) {
        // .json 但不是本应用备份格式：常见原因是把 rollout 内容存成了 .json，提示改扩展名
        const looksLikeRollout = typeof parsed === "object" && parsed !== null && (parsed.type === "session_meta" || (Array.isArray(parsed) && parsed[0]?.type === "session_meta"));
        throw new Error(
          looksLikeRollout
            ? `${path.basename(filePath)}：这是单条会话记录内容，请把扩展名改为 .jsonl 后再导入`
            : `${path.basename(filePath)}：不是有效的会话备份文件（缺少 format 标记）`
        );
      }
      merged.threads.push(...parsed.threads);
    }
  }
  if (!merged.threads.length) return { path: result.filePaths[0], imported: 0, skipped: 0, threads: [] };
  const summary = applySessionsBackup(codexHome, merged);
  // ⛔ 导入成功 = 这条会话被重新写回磁盘 → 必须摘掉同名墓碑（见 forgetDeletedThreads 注释）：
  //   不然用户「删掉 → 从备份恢复」后会看不到它，且无从发现原因。
  //   只清 status === "ok"（真正写进去的）：duplicate / conflict 是磁盘上那份还在，保留墓碑更安全。
  await forgetDeletedThreads(summary.threads.filter((entry: { status: string }) => entry.status === "ok").map((entry: { id: string }) => entry.id));
  return { path: result.filePaths[0], ...summary };
});

ipcMain.handle("threads:import-conversation", async (_event, input?: { cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string; personality?: string | null }): Promise<{ thread: any; imported: { title: string; fileName: string; turns: number; text: string; at: string } } | null> => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: "导入外部会话记录（Markdown）",
    properties: ["openFile"],
    filters: [
      { name: "对话记录（Markdown/文本）", extensions: ["md", "markdown", "txt"] },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePaths?.length) return null;
  const filePath = result.filePaths[0];
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = parseMarkdownConversation(raw, path.basename(filePath));
  if (!parsed.text.trim()) throw new Error("文件中没有可导入的对话内容");
  // 超出上下文窗口的记录直接拒绝，提示拆分——避免首条消息过大被引擎截断/超窗
  if (parsed.text.length > 400000) throw new Error("记录过长（超过 40 万字符），请先拆分成更小的文件再导入");
  const customModel = await readCustomModel();
  const provider = customModel?.provider ?? "openai";
  const baseUrl = customModel?.baseUrl;
  const name = customModel?.name ?? provider;
  const apiKey = customModel?.encryptedKey && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(customModel.encryptedKey, "base64")) : "";
  if (apiKey) server.setApiKey(apiKey);
  const effectiveModel = input?.model || customModel?.model;
  if (!effectiveModel) throw new Error("尚未配置自定义模型，无法新建导入会话");
  ensureProjectAgentsMd(input?.cwd || process.cwd());
  const started: any = await server.request("thread/start", {
    model: effectiveModel,
    cwd: input?.cwd || process.cwd(),
    approvalPolicy: input?.approvalPolicy || "never",
    sandbox: input?.sandbox || "workspace-write",
    modelProvider: provider,
    personality: input?.personality || null,
    config: baseUrl ? { model_provider: safeProviderId(provider), model_providers: { [safeProviderId(provider)]: { name, base_url: bridgeDial(provider, baseUrl), env_key: "CODEX_HARNESS_API_KEY", wire_api: "responses", requires_openai_auth: false, ...PROVIDER_RETRY_TUNING } } } : undefined,
  });
  const threadName = `导入：${parsed.title || path.basename(filePath, path.extname(filePath))}`.slice(0, 80);
  try { await server.request("thread/name/set", { threadId: started.thread.id, name: threadName }); } catch { /* 命名失败不阻塞进入会话 */ }
  return {
    thread: { ...started.thread, name: threadName },
    imported: { title: parsed.title, fileName: path.basename(filePath), turns: parsed.turns, text: parsed.text, at: new Date().toISOString() },
  };
});
