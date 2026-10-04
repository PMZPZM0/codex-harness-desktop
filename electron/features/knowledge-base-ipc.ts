// 知识库 IPC 域（knowledge-base，10-01 立项）：项目级本地知识库的导入/管理/检索。
// ⛔ workspace 由渲染层随调用传入（会话工作区），主进程不读全局态——项目级数据随项目走。
// 10-04 迁移到组合系统（defineFeature + ipcHost），与 domains-ipc 同款形态。
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { addDocument, embedDocument, listDocs, readDocument, removeDocument, searchDocs, searchDocsSmart } from "../knowledge-base";
import { kbEmbeddingInstalled, embedWithLocalBackend, installKbEmbedding, kbEmbedStatus, uninstallKbEmbedding } from "./kb-embed-backend";
import { readCustomModel } from "../main/01-model-catalog";
import type { HostCaps } from "../runtime/seams";
import { sendToWindow } from "./window-bus";
import fs from "node:fs";
import path from "node:path";

const KB_CHANNELS = ["kb:list", "kb:add-text", "kb:add-files", "kb:remove", "kb:search", "kb:read", "kb:embed-status", "kb:embed-install", "kb:embed-uninstall"];

/** 语义向量档的 embedding 函数：**本地后端优先**（开发工具页「知识库本地语义检索」装了就用，
 *  完全离线、不依赖供应商）；未装则回落供应商 /embeddings（与「AI 润色」同一条配置）；
 *  两者都不可用时返回 undefined ⇒ searchDocsSmart 自动只用全文档，永不报错。 */
/** ⚠️ `secure` 只在**供应商回落**分支用到（解密 API Key 走 /embeddings）；
 *  **本地后端分支（第 21 行）完全不读它**—— 而本地后端是完全离线的。
 *  ⛔ 故允许传 null：模型侧 `knowledge_add`（dispatch-rpc.ts）拿不到宿主 `secure` 接缝，
 *  但它只在本地后端已装时补向量（那个路径不需要 secure）⇒ 不该为它编造一个假 secure。 */
function buildEmbedFn(secure: HostCaps["secure"] | null): ((texts: string[]) => Promise<number[][]>) | undefined {
  if (process.env.CODEX_HARNESS_KB_EMBED === "0") return undefined;
  return async (texts: string[]) => {
    if (kbEmbeddingInstalled()) return embedWithLocalBackend(texts);
    //⚠️ 走到这里说明本地后端没装 ⇒ 需要供应商回落 ⇒ 必须有 secure。拿不到就早失败、说真话。
    if (!secure) throw new Error("本地嵌入后端未安装，且当前调用方没有 secure 接缝（无法解密供应商 Key）—— 语义索引不可用");
    const cfg = await readCustomModel();
    if (!cfg?.baseUrl || cfg.provider === "openai-official") throw new Error("no custom provider for embeddings");
    const key = cfg.encryptedKey && secure.isEncryptionAvailable() ? secure.decryptString(Buffer.from(cfg.encryptedKey, "base64")) : "";
    if (!key) throw new Error("no api key");
    const base = String(cfg.baseUrl).replace(/\/$/, "");
    const response = await fetch(`${base}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: (cfg as any).embeddingModel || cfg.model, input: texts }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`embeddings HTTP ${response.status}`);
    const payload: any = await response.json().catch(() => null);
    const vectors = (Array.isArray(payload?.data) ? payload.data : []).map((entry: any) => entry?.embedding).filter((vector: any) => Array.isArray(vector));
    if (vectors.length !== texts.length) throw new Error("embeddings shape mismatch");
    return vectors;
  };
}

/** 导入后台补向量（fire-and-forget）：失败只影响语义档，全文检索照常。
 *
 *  ⛔⛔ 2026-10-04导出成公共函数的原因：补向量原来只在**这个文件里**的 UI 两条路径
 *    （kb:add-text / kb:add-files）被调⇒ **模型侧 `knowledge_add`（dispatch-rpc.ts）
 *    直调 addDocument，绕过了这里** ⇒ 模型写进去的知识**只有全文索引、没有向量索引**，
 *    语义检索永远召不回（用户问「读和写还有索引工具都有了吧」时查出来的缺口）。
 *  ⇒ **凡是往知识库写文档的路径，都必须调它**；漏一条就静默退化成半索引。
 *  ⚠️ fire-and-forget 是有意的：本地嵌入后端可能很慢/要下载，不该卡住写入。 */
export function embedInBackground(secure: HostCaps["secure"] | null, workspace: string, docIds: string[]): void {
  const embed = buildEmbedFn(secure);
  if (!embed || !workspace) return;
  for (const docId of docIds) void embedDocument(workspace, docId, embed).catch(() => false);
}

export const knowledgeBaseFeature = defineFeature<null>({
  id: "kb",
  inject: ["ipc", "host"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    const host = ctx.get<HostCaps>("host");
    if (!host) throw new Error("kb: 缺少 host 接缝（宿主未提供）");
    if (!ipcHost) throw new Error("knowledge-base: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("kb:list", (_event, input: { workspace?: string } = {}) => {
      const workspace = String(input?.workspace ?? "").trim();
      if (!workspace) return [];
      return listDocs(workspace);
    });

    ipcHost.handle("kb:add-text", (_event, input: { workspace?: string; title?: string; text?: string; source?: string }) => {
      const workspace = String(input?.workspace ?? "");
      const meta = addDocument(workspace, { title: String(input?.title ?? ""), text: String(input?.text ?? ""), source: input?.source ? String(input.source) : undefined });
      embedInBackground(host.secure, workspace, [meta.id]);
      return meta;
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
      embedInBackground(host.secure, workspace, imported.map((entry) => entry.id));
      return { imported, failures };
    });

    ipcHost.handle("kb:remove", (_event, input: { workspace?: string; docId?: string }) => {
      removeDocument(String(input?.workspace ?? ""), String(input?.docId ?? ""));
      return { ok: true };
    });

    ipcHost.handle("kb:search", (_event, input: { workspace?: string; query?: string; limit?: number }) => {
      return searchDocsSmart(String(input?.workspace ?? ""), String(input?.query ?? ""), Number(input?.limit) || 8, buildEmbedFn(host.secure));
    });

    ipcHost.handle("kb:read", (_event, input: { workspace?: string; docId?: string }) => {
      return readDocument(String(input?.workspace ?? ""), String(input?.docId ?? ""));
    });

    /* ── 本地语义后端（按需下载，10-04 改判：463MB 不随包）——知识库页内直接装 ── */
    ipcHost.handle("kb:embed-status", () => kbEmbedStatus());

    ipcHost.handle("kb:embed-install", async () => {
      await installKbEmbedding((p) => sendToWindow("runtime:progress", { id: "kb-embedding", ...p }));
      sendToWindow("runtime:progress", { id: "kb-embedding", percent: 100, message: "安装完成", done: true });
      return kbEmbedStatus();
    });

    ipcHost.handle("kb:embed-uninstall", async () => {
      await uninstallKbEmbedding();
      return kbEmbedStatus();
    });
  },
});
