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
 * ⛔ 只绑 127.0.0.1；页面与接口都挂在**随机令牌前缀** `/t/<TOKEN>/` 下、并校验 Host 头 ——
 *    本机其它网页既猜不中地址也过不了 Host 检查（防本机 CSRF / DNS rebinding）。
 */
import http from "node:http";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { app } from "electron";
import { readCustomModel } from "../../main/01-model-catalog";
import { readBuiltinPlugins } from "../../main/09-agents-plugins";
import { generateImageResilient } from "../builtin-ipc";
import { callModel } from "./ai";

type SecureLike = { isEncryptionAvailable: () => boolean; decryptString: (buf: Buffer) => string };

let secureHost: SecureLike | null = null;
/** 注入密钥接缝（feature setup 调一次；卸载传 null）。 */
export function setMediaDeskSecure(host: SecureLike | null): void {
  secureHost = host;
}

/* ── 生图复用内置生图插件（11-10 用户令：「生图可以调用生图插件，这样更方便」）──
   上游 workbench 本来就有 source:'tool' 一条路（image-tool.js），它向 ctx.get('tools')
   要一个「公共执行接口」。我们在这里把**应用内置生图插件**包装成那个接口：
   不重写上游、不把密钥写进工作台 settings.json，图落到上游约定的订阅生图目录供它校验读取。
   没配内置插件时 executable() 返回 undefined ⇒ 上游 imageTool() 判不可用 ⇒ 成稿自动跳过图（不报错）。 */
type BuiltinImage = { baseUrl: string; apiKey: string; model: string };
let builtinImage: BuiltinImage | null = null;

/** 读内置生图插件配置（启用且有地址/模型才算可用）；启动与每次执行前刷新。 */
async function refreshBuiltinImage(): Promise<void> {
  const cfg = await readBuiltinPlugins().catch(() => ({} as Awaited<ReturnType<typeof readBuiltinPlugins>>));
  const img = cfg?.image;
  builtinImage = img && img.enabled !== false && img.baseUrl && img.model
    ? { baseUrl: img.baseUrl, apiKey: img.apiKey ?? "", model: img.model }
    : null;
}

/** 上游 image-tool.js 只允许读这个目录下的图（realpath 校验），我们把内置插件产物落这里。 */
function subscriptionImagesDir(): string {
  return path.join(process.env.DSH_HOME ?? "", "plugins", "subscriptions", "images");
}

const IMAGE_TOOL_NAMES = ["dsh_subscriptions_image_generate", "image_generate"];

/** 把内置生图插件包装成上游要求的 tools 公共执行接口。 */
function mediaDeskTools() {
  return {
    executable(name: string) {
      if (!builtinImage || !IMAGE_TOOL_NAMES.includes(name)) return undefined;
      return {
        name,
        parameters: { type: "object", properties: { prompt: { type: "string" }, size: { type: "string" }, quality: { type: "string" } } },
        output: { schema: { type: "object", properties: { paths: { type: "array", items: { type: "string" } } } } },
      };
    },
    selectExecutor() {
      return { describe: (defs: Array<{ name: string }>) => ({ schemas: (defs ?? []).map((d) => ({ name: d.name })) }) };
    },
    async execute(batch: { calls: Array<{ id: string; name: string; arguments?: string }>; signal?: AbortSignal }) {
      await refreshBuiltinImage();
      const results = [];
      for (const call of batch?.calls ?? []) {
        try {
          if (!builtinImage) throw new Error("内置生图插件未配置");
          const args = JSON.parse(call.arguments ?? "{}") as { prompt?: string; size?: string };
          const { path: file } = await generateImageResilient({
            baseUrl: builtinImage.baseUrl, apiKey: builtinImage.apiKey, model: builtinImage.model,
            prompt: String(args.prompt ?? ""),
            ...(args.size && args.size !== "auto" ? { size: args.size } : {}),
            outputDir: subscriptionImagesDir(),
          }, 2);
          if (!file) throw new Error("生图没有落盘");
          results.push({ callId: call.id, result: { isError: false, value: { paths: [file] } } });
        } catch (error) {
          results.push({ callId: call.id, result: { isError: true, error: { message: String((error as Error)?.message ?? error) } } });
        }
      }
      return { results };
    },
  };
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

/* 每次进程启动换一次令牌：地址只交给自己的 iframe 与主进程工具。 */
const TOKEN = randomBytes(18).toString("hex");
const PREFIX = `/t/${TOKEN}`;

/* ⛔ tsc（CommonJS）会把 import() 降级成 require()，而 require 既不认 file:// URL 也读不了 ESM；
   用 Function 构造保住原生动态 import，否则随包的 host.js 永远加载失败。 */
const nativeImport = new Function("specifier", "return import(specifier);") as (specifier: string) => Promise<any>;

function vendorDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "media-desk") : path.join(app.getAppPath(), "resources", "media-desk");
}

/** 当前有效模型（工作台没单独配时就是应用当前供应商）。 */
async function activeModel(): Promise<{ baseUrl: string; model: string; apiKey: string; wireApi: "chat" | "responses" }> {
  const active = await readCustomModel().catch(() => null);
  if (!active) return { baseUrl: "", model: "", apiKey: "", wireApi: "chat" };
  /* ⛔ 解不开就按「无 Key」继续：密钥库换过 / 档案从别的机器拷来都会在这里抛，
     不接住的话整个工作台起不来（e2e 持久档案实测报 decryptString 失败）。 */
  let key = "";
  if (active.encryptedKey && secureHost?.isEncryptionAvailable()) {
    try {
      key = secureHost.decryptString(Buffer.from(active.encryptedKey, "base64"));
    } catch {
      key = "";
    }
  }
  return {
    baseUrl: String(active.baseUrl ?? ""),
    model: String(active.model ?? ""),
    apiKey: key,
    wireApi: active.wireApi === "responses" ? "responses" : "chat",
  };
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
let boundPort = 0;

/** 静态页只放行随包顶层的几个文件（⛔ 防路径穿越：目录分隔符一律拒绝）。 */
function serveStatic(rel: string, res: http.ServerResponse): boolean {
  const file = rel === "" || rel === "/" ? "index.html" : rel.replace(/^\/+/, "");
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
    await refreshBuiltinImage();
    if (builtinImage) await mkdir(subscriptionImagesDir(), { recursive: true }).catch(() => undefined);
    const hostModule: any = await nativeImport(pathToFileURL(path.join(vendorDir(), "host", "host.js")).href);
    const plugin = hostModule?.default ?? hostModule;
    const model = await activeModel();
    const ctx: any = {
      get(name: string) {
        if (name === "llm") return llmAdapter();
        if (name === "agentDefaultModel") return { currentSelection: () => (model.model ? { provider: "harness", model: model.model } : null) };
        if (name === "connection") return { requestRejection: () => undefined };
        if (name === "tools") return mediaDeskTools();
        if (name === "webServer") return { register: (route: any) => { routeHandler = route.handler; return () => { routeHandler = null; }; } };
        return undefined;
      },
      effect(fn: () => unknown) { try { const d = fn(); return typeof d === "function" ? d : () => {}; } catch { return () => {}; } },
      webServer: { register: (route: any) => { routeHandler = route.handler; return () => { routeHandler = null; }; } },
    };
    await plugin.apply(ctx);

    /*  convenience：内置生图插件可用、且用户还没在工作台单独配 HTTP 生图时，
        默认把生图来源切到 'tool'（= 调内置插件）。已配过 HTTP 的不动（不静默覆盖用户配置）。 */
    if (builtinImage) {
      try {
        const settingsModule: any = await nativeImport(pathToFileURL(path.join(vendorDir(), "host", "settings.js")).href);
        const settings = new settingsModule.Settings(path.join(process.env.DSH_HOME, "media-desk"));
        const saved = await settings.read();
        if (saved.image.source === "http" && !saved.image.baseUrl && !saved.image.apiKey) {
          await settings.update({ image: { source: "tool" } });
        }
      } catch { /* 默认值设置失败不影响主流程，用户仍可手动选 */ }
    }

    const server = http.createServer((req, res) => {
      /* Host 头必须是本机这一跳：别的网页把 localhost 解析到本端口也进不来。 */
      if (String(req.headers.host ?? "") !== `127.0.0.1:${boundPort}`) {
        res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
        res.end("forbidden");
        return;
      }
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (url.pathname !== PREFIX && !url.pathname.startsWith(PREFIX + "/")) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("not found");
        return;
      }
      const rest = url.pathname.slice(PREFIX.length) || "/";
      if (rest === "/media-desk" || rest.startsWith("/media-desk/")) {
        if (!routeHandler) { res.writeHead(503); res.end("media desk not ready"); return; }
        /* 上游 handler 自己按 /media-desk/ 前缀解析路径：去掉令牌段再交给它。 */
        req.url = rest + url.search;
        void routeHandler(req, res).catch((error) => { try { res.writeHead(500); res.end(String(error?.message ?? error)); } catch { /* 已响应 */ } });
        return;
      }
      if (serveStatic(rest, res)) return;
      res.writeHead(404);
      res.end("not found");
    });
    const port = await new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        boundPort = typeof address === "object" && address ? address.port : 0;
        resolve(boundPort);
      });
    });
    return `http://127.0.0.1:${port}${PREFIX}/`;
  })().catch((error) => {
    /* 起不来就允许下次重试（否则整个进程生命周期内永远是同一个失败的 Promise）。 */
    serverPromise = null;
    throw error;
  });
  return serverPromise;
}

/** Codex 工具走的内部请求：直接打本地服务（与界面同一份数据/流程）。 */
export async function mediaDeskRequest(pathname: string, body?: unknown): Promise<any> {
  const endpoint = await ensureMediaDeskServer();
  /* 上游路由全在 /media-desk/ 下；endpoint 已带令牌前缀，这里只拼业务路径。 */
  const url = new URL(`media-desk/${pathname.replace(/^\/+/, "")}`, endpoint);
  const headers: Record<string, string> = { "x-media-desk-lang": "zh" };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(url, {
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(data?.error ?? `工作台接口返回 HTTP ${res.status}`));
  return data;
}
