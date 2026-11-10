/**
 * 自媒体工作台 · 原样嵌入（11-09 用户令：「开源啥样就复刻啥样」）。
 *
 * 做法：把开源 dsh-media-desk 2.6.2（MIT）的 **客户端 bundle 与宿主源码原样随包**，
 * 主进程起一个只监听 127.0.0.1 的本地服务：
 *   · `/media-desk/*` 交给它自己的 host.js（store/produce/images/… 全是上游原码）；
 *   · `/` 与静态资源 = 一个最小页面（module loader + React + glue），把它的 main 组件画出来。
 * 我们只提供**宿主适配**（模型/密钥/静态目录），不重写它的界面与流程。
 *
 * 数据落在 `<userData>/media-desk-host/media-desk/state.json`（通过 DSH_HOME 重定向）。
 * ⛔ 只绑 127.0.0.1；连接鉴权用本地放行（不暴露到局域网）。
 */
import http from "node:http";
import path from "node:path";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { app } from "electron";
import { readCustomModel } from "../../main/01-model-catalog";
import { callModel } from "./ai";

type SecureLike = { isEncryptionAvailable: () => boolean; decryptString: (buf: Buffer) => string };

let secureHost: SecureLike | null = null;
/** 注入密钥接缝（feature setup 调一次；卸载传 null）。 */
export function setMediaDeskSecure(host: SecureLike | null): void {
  secureHost = host;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

function vendorDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "media-desk") : path.join(app.getAppPath(), "resources", "media-desk");
}

/** 当前有效模型（工作台没单独配时就是应用当前供应商）。 */
async function activeModel(): Promise<{ baseUrl: string; model: string; apiKey: string }> {
  const active = await readCustomModel().catch(() => null);
  if (!active) return { baseUrl: "", model: "", apiKey: "" };
  const key = active.encryptedKey && secureHost?.isEncryptionAvailable()
    ? secureHost.decryptString(Buffer.from(active.encryptedKey, "base64"))
    : "";
  return { baseUrl: String(active.baseUrl ?? ""), model: String(active.model ?? ""), apiKey: key };
}

/** 从 host.js 的 stream 载荷里取纯文本（它的 content 是 [{type:'text',text}]）。 */
function payloadText(payload: any): string {
  const messages: any[] = Array.isArray(payload?.messages) ? payload.messages : [];
  const parts: string[] = [];
  for (const message of messages) {
    const content = message?.content;
    if (typeof content === "string") parts.push(content);
    else if (Array.isArray(content)) for (const part of content) if (typeof part?.text === "string") parts.push(part.text);
  }
  return parts.join("\n");
}

/** 宿主 llm 适配：prepareCall().stream() 接口 → 用应用当前供应商跑一轮。 */
function llmAdapter() {
  return {
    async listProviders() {
      return [{ id: "harness", name: "当前供应商" }];
    },
    async listModels() {
      const current = await activeModel();
      return current.model ? [{ id: current.model, name: current.model }] : [];
    },
    async prepareCall(_route: any, signal?: AbortSignal) {
      return {
        config: {},
        async *stream(payload: any) {
          const target = await activeModel();
          const system = String(payload?.system ?? "");
          const user = payloadText(payload);
          const text = await callModel(
            { baseUrl: target.baseUrl, model: target.model, apiKey: target.apiKey },
            [{ role: "system", content: system }, { role: "user", content: user }],
          );
          if (signal?.aborted) throw new Error("已取消");
          if (text) yield { type: "text-delta", text };
          yield { type: "finish", reason: { kind: "stop" } };
        },
      };
    },
  };
}

let serverPromise: Promise<string> | null = null;
let routeHandler: ((req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>) | null = null;

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const url = new URL(req.url || "/", "http://local");
  const pathname = decodeURIComponent(url.pathname);
  const file = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (!/^[\w.-]+$/.test(file)) return false;
  const full = path.join(vendorDir(), file);
  try {
    const body = readFileSync(full);
    res.writeHead(200, { "content-type": MIME[path.extname(full).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

/** 起本地服务（幂等）：返回首个页面地址；宿主代码原样加载，只注入宿主适配。 */
export function ensureMediaDeskServer(): Promise<string> {
  if (serverPromise) return serverPromise;
  serverPromise = (async () => {
    /* DSH_HOME 决定上游 Store 的数据目录 —— 在加载 host.js 之前设好。 */
    process.env.DSH_HOME = path.join(app.getPath("userData"), "media-desk-host");
    const hostModule: any = await import(pathToFileURL(path.join(vendorDir(), "host", "host.js")).href);
    const plugin = hostModule?.default ?? hostModule;
    const model = await activeModel();
    const ctx: any = {
      get(name: string) {
        if (name === "llm") return llmAdapter();
        if (name === "agentDefaultModel") return { currentSelection: () => (model.model ? { provider: "harness", model: model.model } : null) };
        if (name === "connection") return { requestRejection: () => undefined };
        if (name === "webServer") return { register: (route: any) => { routeHandler = route.handler; return () => { routeHandler = null; }; } };
        return undefined;
      },
      effect(fn: () => unknown) { try { const d = fn(); return typeof d === "function" ? d : () => {}; } catch { return () => {}; } },
      webServer: { register: (route: any) => { routeHandler = route.handler; return () => { routeHandler = null; }; } },
    };
    await plugin.apply(ctx);

    const server = http.createServer((req, res) => {
      const url = req.url || "/";
      if (url.startsWith("/media-desk")) {
        if (!routeHandler) { res.writeHead(503); res.end("media desk not ready"); return; }
        void routeHandler(req, res).catch((error) => { try { res.writeHead(500); res.end(String(error?.message ?? error)); } catch { /* 已响应 */ } });
        return;
      }
      if (serveStatic(req, res)) return;
      res.writeHead(404);
      res.end("not found");
    });
    const port = await new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        resolve(typeof address === "object" && address ? address.port : 0);
      });
    });
    return `http://127.0.0.1:${port}/`;
  })();
  return serverPromise;
}

/** Codex 工具走的内部请求：直接打本地服务（与界面同一份数据/流程）。 */
export async function mediaDeskRequest(pathname: string, body?: unknown): Promise<any> {
  const endpoint = await ensureMediaDeskServer();
  const url = new URL(pathname.replace(/^\/+/, ""), endpoint);
  const res = await fetch(url, body === undefined
    ? { headers: { "x-media-desk-lang": "zh" } }
    : { method: "POST", headers: { "content-type": "application/json", "x-media-desk-lang": "zh" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(data?.error ?? `HTTP ${res.status}`));
  return data;
}
