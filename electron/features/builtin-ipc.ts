/**
 * builtin-ipc（10-03 从 `features/builtin-skills-ipc/01-...` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：builtin(5)
 * 通道：builtin:read / save / probe / generate-image / describe-image
 *
 * ⛔⛔ 三条实证口径（本次纯搬迁，一字未改）：
 *   1. **回给渲染层的是本地路径，不是 data URL**：内联 base64 会被拼进工具返回文本 ⇒
 *      3 MB 文本进对话历史且每轮重发。只有网关给的是真托管地址时才把 url 一并带出。
 *   2. **size / negative_prompt 只在显式给了才带上**：不同网关接受的字段名与取值差异很大，
 *      默认不带 = 保持旧行为，不会因为多传一个字段就把本来能用的网关弄挂。
 *   3. **落盘失败不该让生图整体失败**：调用方退回「只给托管 url」，图只是不再持久。
 * ⛔ `generateImageResilient`（带重试的生图）同时被 `./dispatch-rpc` 使用 ⇒ 从本板块导出，
 *    稳定性口径只有一份（MCP 工具与画布卡片共用）。
 * ⛔ 待接缝化（阶段 2）：app / fs 为宿主能力。
 */
import path from "node:path";
import fs from "node:fs/promises";
import { app } from "electron";
import { existsSync } from "node:fs";
import { describeNetworkError, readBuiltinPlugins, readCustomModel, applyCustomModel } from "../main";
import type { BuiltinPluginConfig } from "../main";
import { builtinPluginsFile } from "../main";
import { server } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

async function writeBuiltinPlugins(cfg: BuiltinPluginConfig) {
  await fs.writeFile(builtinPluginsFile, JSON.stringify(cfg, null, 2), "utf8");
}

async function probeBuiltinModels(input: { kind: "image" | "vision"; baseUrl: string; apiKey: string }) {
  const base = input.baseUrl.trim().replace(/\/$/, "");
  const url = base + "/models";
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: "Bearer " + (input.apiKey || ""), "Content-Type": "application/json" } });
  } catch (error) {
    throw describeNetworkError(error, "检测");
  }
  if (!response.ok) throw new Error("模型列表请求失败 HTTP " + response.status + (response.status === 401 ? "（密钥无效）" : response.status === 404 ? "（地址可能缺少 /v1）" : ""));
  const data = await response.json();
  const models = (Array.isArray(data) ? data : data.data ?? data.models ?? []).map((x: any) => typeof x === "string" ? x : x?.id ?? x?.model).filter(Boolean);
  return { models: [...new Set<string>(models)] };
}

async function persistGeneratedImage(url: string, dirOverride?: string): Promise<string> {
  try {
    /* 09-29：产物目录可由画布指定（不传时仍为 <userData>/images —— 会话里的 MCP 工具行为不变）。 */
    const dir = dirOverride ? path.resolve(dirOverride) : path.join(app.getPath("userData"), "images");
    await fs.mkdir(dir, { recursive: true });
    const head = url.slice(0, 64);
    const ext = /jpe?g/i.test(head) ? ".jpg" : /webp/i.test(head) ? ".webp" : /gif/i.test(head) ? ".gif" : ".png";
    const file = path.join(dir, `codex-harness-${Date.now()}${ext}`);
    if (/^data:/i.test(url)) {
      await fs.writeFile(file, Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
    } else if (/^https?:/i.test(url)) {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
    } else {
      return "";
    }
    return existsSync(file) ? file : "";
  } catch (error) {
    // 落盘失败不该让生图整体失败 —— 调用方会退回「只给托管 url」，只是图不再持久
    console.warn(`[generate-image] 图片落盘失败：${(error as Error)?.message ?? error}`);
    return "";
  }
}

export async function generateImageWith(input: { baseUrl: string; apiKey: string; model: string; prompt: string; size?: string; negative?: string; outputDir?: string }) {
  const base = input.baseUrl.trim().replace(/\/$/, "");
  // 兼容 /images/generations（OpenAI 兼容）与 /v1/images/generations
  const endpoint = /\/images\/generations$/.test(base) ? base : base + "/images/generations";
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: "Bearer " + input.apiKey, "Content-Type": "application/json" },
      // ⛔ size / negative_prompt 只在**显式给了**才带上：不同网关接受的字段名与取值差异很大，
      //    默认不带 = 保持旧行为，不会因为多传一个字段就把本来能用的网关弄挂。
      body: JSON.stringify({
        model: input.model, prompt: input.prompt, n: 1,
        ...(input.size ? { size: input.size } : {}),
        ...(input.negative ? { negative_prompt: input.negative } : {}),
      }),
      signal: AbortSignal.timeout(300_000),
    });
  } catch (error) {
    throw describeNetworkError(error, "生图请求");
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    let hint = "";
    try { hint = JSON.parse(detail)?.error?.message ?? ""; } catch { hint = detail.slice(0, 160); }
    throw new Error("生图失败 HTTP " + response.status + (hint ? "：" + hint : ""));
  }
  const data = await response.json();
  const item = data?.data?.[0];
  // 注意优先级：url 存在用 url；否则 b64_json 转 data URL（旧写法运算符优先级有误，
  // 返回 url 时会拼出 "data:image/png;base64,undefined"，已修）
  const url = item?.url || (item?.b64_json ? "data:image/png;base64," + item.b64_json : "");
  if (typeof url !== "string" || !url.trim()) throw new Error("生图服务未返回图片地址或图片数据");
  // ⛔ 回给渲染层的是**本地路径**，不是 data URL（理由见 persistGeneratedImage 注释）。
  // ⛔ 变量名沿用原实现（`path` 在此处之后不再使用 path 模块，故遮蔽无害）——
  //    守卫【84】按 `return { path, url: ... }` 字面量锚这条不变量，别改成 `path: saved`。
  const path = await persistGeneratedImage(url, input.outputDir);
  return { path, url: /^https?:/i.test(url) ? url : "" };
}

/** 带重试的生图（09-29）：网络抖动 / 5xx / 429 自动再试一次；4xx 参数错不重试（重试也没用）。 */
export async function generateImageResilient(input: { baseUrl: string; apiKey: string; model: string; prompt: string; size?: string; negative?: string; outputDir?: string }, attempts = 2): Promise<{ path: string; url: string }> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await generateImageWith(input);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      // 参数类错误（除限流）重试无意义
      if (/HTTP 4\d\d/.test(message) && !/HTTP 429/.test(message)) break;
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function toImageSource(ref: string): Promise<string> {
  const source = String(ref ?? "").trim();
  if (/^(https?:|data:)/i.test(source)) return source;
  const candidate = path.isAbsolute(source) ? source : path.resolve(source);
  if (!existsSync(candidate)) throw new Error("图片本地文件不存在：" + candidate);
  const mime = /\.jpe?g$/i.test(candidate) ? "image/jpeg" : /\.gif$/i.test(candidate) ? "image/gif" : /\.webp$/i.test(candidate) ? "image/webp" : "image/png";
  return `data:${mime};base64,` + (await fs.readFile(candidate)).toString("base64");
}

async function describeImageWith(input: { baseUrl: string; apiKey: string; model: string; imageUrl: string; prompt?: string }) {
  const base = input.baseUrl.trim().replace(/\/$/, "");
  const endpoint = /\/chat\/completions$/.test(base) ? base : base + "/chat/completions";
  const content = [
    { type: "text", text: input.prompt || "请详细描述这张图片的内容，包括画面主体、场景、文字、布局等，用中文回答。" },
    { type: "image_url", image_url: { url: await toImageSource(input.imageUrl) } },
  ];
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: "Bearer " + input.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ model: input.model, messages: [{ role: "user", content }] }),
    });
  } catch (error) {
    throw describeNetworkError(error, "识图请求");
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    let hint = "";
    try { hint = JSON.parse(detail)?.error?.message ?? ""; } catch { hint = detail.slice(0, 160); }
    throw new Error("识图失败 HTTP " + response.status + (hint ? "：" + hint : ""));
  }
  const data = await response.json();
  return { text: data?.choices?.[0]?.message?.content ?? "" };
}

const BUILTIN_CHANNELS = ["builtin:read", "builtin:save", "builtin:probe", "builtin:generate-image", "builtin:describe-image"];

export const builtinFeature = defineFeature<null>({
  id: "builtin",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("builtin: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("builtin:read", async () => readBuiltinPlugins());
    ipcHost.handle("builtin:save", async (_e, cfg: BuiltinPluginConfig) => {
      await writeBuiltinPlugins(cfg);
      // 保存后重写 config.toml 并重启引擎：developer_instructions 的生图/视觉段与
      // dynamicTools 都依赖这份配置，不重启的话引擎和已有会话感知不到配置变化。
      const model = await readCustomModel();
      if (model) await applyCustomModel(model); else await server.restart();
      return readBuiltinPlugins();
    });
    ipcHost.handle("builtin:probe", async (_e, input: { kind: "image" | "vision"; baseUrl: string; apiKey: string }) => probeBuiltinModels(input));
    ipcHost.handle("builtin:generate-image", async (_e, input: { baseUrl: string; apiKey: string; model: string; prompt: string; size?: string; negative?: string; outputDir?: string }) => generateImageResilient(input));
    ipcHost.handle("builtin:describe-image", async (_e, input: { baseUrl: string; apiKey: string; model: string; imageUrl: string; prompt?: string }) => describeImageWith(input));

    ctx.effect(() => {
      for (const ch of BUILTIN_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
