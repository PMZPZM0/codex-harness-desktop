// 知识库 IPC 域（knowledge-base，10-01 立项）：项目级本地知识库的导入/管理/检索。
// ⛔ workspace 由渲染层随调用传入（会话工作区），主进程不读全局态——项目级数据随项目走。
// 10-04 迁移到组合系统（defineFeature + ipcHost），与 domains-ipc 同款形态。
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { addDocument, listDocs, readDocument, removeDocument, searchDocs } from "../knowledge-base";
import fs from "node:fs";
import path from "node:path";

const KB_CHANNELS = ["kb:list", "kb:add-text", "kb:add-files", "kb:remove", "kb:search", "kb:read"];

export const knowledgeBaseFeature = defineFeature<null>({
  id: "kb",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("knowledge-base: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("kb:list", (_event, input: { workspace?: string } = {}) => {
      const workspace = String(input?.workspace ?? "").trim();
      if (!workspace) return [];
      return listDocs(workspace);
    });

    ipcHost.handle("kb:add-text", (_event, input: { workspace?: string; title?: string; text?: string; source?: string }) => {
      return addDocument(String(input?.workspace ?? ""), { title: String(input?.title ?? ""), text: String(input?.text ?? ""), source: input?.source ? String(input.source) : undefined });
    });

    ipcHost.handle("kb:add-files", async (_event, input: { workspace?: string; paths?: string[] }) => {
      const fsp = await import("node:fs/promises");
      const workspace = String(input?.workspace ?? "").trim();
      const paths = Array.isArray(input?.paths) ? input.paths : [];
      if (!workspace) throw new Error("先为会话选择工作目录——知识库是项目级的");
      const imported: { title: string; id: string }[] = [];
      const failures: string[] = [];
      for (const p of paths) {
        try {
          const text = await fsp.readFile(String(p), "utf8");
          const title = path.basename(String(p)).replace(/\.[^.]+$/, "");
          const meta = addDocument(workspace, { title, text, source: String(p) });
          imported.push({ title: meta.title, id: meta.id });
        } catch (error: any) {
          failures.push(`${path.basename(String(p))}：${error?.message ?? error}`);
        }
      }
      if (failures.length && !imported.length) throw new Error(`导入失败：${failures.join("；")}`);
      return { imported, failures };
    });

    ipcHost.handle("kb:remove", (_event, input: { workspace?: string; docId?: string }) => {
      removeDocument(String(input?.workspace ?? ""), String(input?.docId ?? ""));
      return { ok: true };
    });

    ipcHost.handle("kb:search", (_event, input: { workspace?: string; query?: string; limit?: number }) => {
      return searchDocs(String(input?.workspace ?? ""), String(input?.query ?? ""), Number(input?.limit) || 8);
    });

    ipcHost.handle("kb:read", (_event, input: { workspace?: string; docId?: string }) => {
      return readDocument(String(input?.workspace ?? ""), String(input?.docId ?? ""));
    });

    for (const ch of KB_CHANNELS) ipcHost.removeHandler(ch);
  },
});
