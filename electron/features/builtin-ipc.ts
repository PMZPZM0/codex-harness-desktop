/**
 * builtin-ipc（10-03 从 `features/builtin-skills-ipc/01-...` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：builtin(4)
 * 通道：builtin:read / save / probe / generate-image
 * ⛔ 10-30 撤识图通道：视觉辅助插件按用户令整体移除（工具/命令行/env 链同轮拆）。
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
// ⛔ 落盘走 09-agents-plugins 的唯一写入点（本域不再自己 JSON.stringify —— 那里负责把密钥加密）
import { writeBuiltinPlugins, builtinPluginEnv } from "../main/09-agents-plugins";
import { server } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { guardedFetch } from "../net-guard";

/* 11-02：出站请求统一走守卫（Electron net 栈 + 自带超时 + 同源串行 + 失败冷却）。
   ⛔ 起因是 Node 的 TLSWrap use-after-free：上游超时后立刻发新 TLS 会踩已释放的流。
   超时取本项目此处的语义值（130s），不要和默认 12s 混用。 */
const outboundFetch = (input: RequestInfo | URL, init?: RequestInit) => guardedFetch(input, init, { timeoutMs: 130000 });

async function probeBuiltinModels(input: { kind: "image"; baseUrl: string; apiKey: string }) {
  const base = input.baseUrl.trim().replace(/\/$/, "");
  const url = base + "/models";
  let response: Response;
  try {
    response = await outboundFetch(url, { headers: { Authorization: "Bearer " + (input.apiKey || ""), "Content-Type": "application/json" } });
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
      const res = await outboundFetch(url, { signal: AbortSignal.timeout(120_000) });
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

/** 生图/图生图的可选生成参数（11-26 按网关文档补齐）。
 *  ⛔ quality / background / output_format 这三项原来**完全没传** —— 网关默认值不一定是
 *     `max / opaque / png`，同一段提示词出来的清晰度与格式会跟文档对不上。 */
export type ImageGenExtras = {
  size?: string;
  negative?: string;
  quality?: string;       // max | high | medium | low | auto
  background?: string;    // opaque | transparent | auto
  outputFormat?: string;  // png | jpeg | webp
  outputDir?: string;
};

/** 从网关报错体里抠一句给人看的说明（`{"error":{"message"}}` 优先，否则截断原文）。
 *  11-26 抽出：生图 / 图生图三处原本各写一遍同样的 try-parse。 */
function hintOf(raw: string): string {
  if (!raw) return "";
  try {
    const message = JSON.parse(raw)?.error?.message ?? "";
    return message ? "：" + String(message).slice(0, 200) : "";
  } catch {
    return "：" + raw.slice(0, 160);
  }
}

/** 调上游生图接口（兼容 base 已带 `/images/generations` 与只有 `/v1` 两种写法），返回图片字节。 */
export async function generateImageWith(input: { baseUrl: string; apiKey: string; model: string; prompt: string } & ImageGenExtras) {
  const base = input.baseUrl.trim().replace(/\/$/, "");
  // 兼容 /images/generations（OpenAI 兼容）与 /v1/images/generations
  const endpoint = /\/images\/generations$/.test(base) ? base : base + "/images/generations";
  /* ⛔ size / negative_prompt 只在**显式给了**才带上：不同网关接受的字段名与取值差异很大。
     11-26 起 quality / background / output_format 默认带上（用户按文档要求），但**老网关可能
     400 unknown field** ⇒ 命中相关报错时去掉这三项再试一次（这才是"不把本来能用的网关弄挂"）。 */
  const bodyOf = (extras: boolean) => JSON.stringify({
    model: input.model, prompt: input.prompt, n: 1,
    ...(input.size ? { size: input.size } : {}),
    ...(input.negative ? { negative_prompt: input.negative } : {}),
    ...(extras ? {
      quality: input.quality || "max",
      background: input.background || "opaque",
      output_format: input.outputFormat || "png",
    } : {}),
  });
  const post = (extras: boolean) => outboundFetch(endpoint, {
    method: "POST",
    headers: { Authorization: "Bearer " + input.apiKey, "Content-Type": "application/json" },
    body: bodyOf(extras),
    signal: AbortSignal.timeout(300_000),
  });
  let response: Response;
  try {
    response = await post(true);
    /* ⛔⛔ 11-26 审查：**任何** 400 都去掉这三项再试一次。
       原来只在报错文案命中 quality/background/output_format/unknown/unexpected/extra 时才降级，
       而多数网关写的是「Unrecognized request argument」「Invalid parameter」「not supported」——
       判据不中 ⇒ 本来能用的老网关在这个版本直接 400 失败（把用户正在用的通道打挂）。
       多打一次的代价远小于打挂；参数真错时第二次也会失败，只是多一个请求。 */
    if (response.status === 400) {
      const first = await response.text().catch(() => "");
      response = await post(false);
      if (!response.ok) {
        const second = await response.text().catch(() => "");
        throw new Error("生图失败 HTTP 400" + hintOf(second || first));
      }
    }
  } catch (error) {
    /* 上面那条已经拼好了给用户看的文案，别再被网络错误包装盖掉。 */
    if (error instanceof Error && error.message.startsWith("生图失败")) throw error;
    throw describeNetworkError(error, "生图请求");
  }
  if (!response.ok) {
    throw new Error("生图失败 HTTP " + response.status + hintOf(await response.text().catch(() => "")));
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

/** 图生图（网关 `/images/edits`，multipart）：给一张源图 + 一句「改成什么样」，返回改完的图。
 *  11-26 按网关文档补的通道。原来「改图」只有本地 jimp 的确定性运算符（裁剪/调色/水印…），
 *  语义级修改（换背景 / 换风格 / 加元素）根本做不到 —— 那是这条通道的活。
 *  ⛔ 字段名与生图对齐（quality / background / output_format），文档要求 opaque + png + b64_json；
 *     老网关不认这几项时同样会 400，交给调用方降级（这里不重复实现重试）。 */
export async function editImageWith(input: {
  baseUrl: string; apiKey: string; model: string; prompt: string; imagePath: string;
} & Omit<ImageGenExtras, "negative">) {
  const base = input.baseUrl.trim().replace(/\/$/, "");
  const endpoint = /\/images\/edits$/.test(base) ? base : base + "/images/edits";
  const bytes = await fs.readFile(input.imagePath).catch(() => null);
  if (!bytes) throw new Error("图生图的源图读不到：" + input.imagePath);
  const ext = path.extname(input.imagePath).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
  /* ⛔ 11-26 审查：文档要求 opaque + png + b64_json，但**老网关不认这三项会 400**。
     与生图同一口径：先按文档带上，400 就去掉这三项重发一次（multipart 要整份重建，
     不能复用 FormData —— body 已被读过）。 */
  const formOf = (extras: boolean) => {
    const form = new FormData();
    form.append("model", input.model);
    form.append("prompt", input.prompt);
    form.append("n", "1");
    if (input.size) form.append("size", input.size);
    if (extras) {
      form.append("quality", input.quality || "max");
      form.append("background", input.background || "opaque");
      form.append("output_format", input.outputFormat || "png");
    }
    form.append("response_format", "b64_json");
    /* ⛔ 不手动设 Content-Type：multipart 的 boundary 必须由 fetch 自己生成。 */
    form.append("image", new Blob([new Uint8Array(bytes)], { type: mime }), path.basename(input.imagePath));
    return form;
  };
  const post = (extras: boolean) => outboundFetch(endpoint, {
    method: "POST",
    headers: { Authorization: "Bearer " + input.apiKey },
    body: formOf(extras),
    signal: AbortSignal.timeout(300_000),
  });
  let response: Response;
  try {
    response = await post(true);
    if (response.status === 400) {
      const first = await response.text().catch(() => "");
      response = await post(false);
      if (!response.ok) {
        const second = await response.text().catch(() => "");
        throw new Error("图生图失败 HTTP 400" + hintOf(second || first));
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("图生图失败")) throw error;
    throw describeNetworkError(error, "图生图请求");
  }
  if (!response.ok) {
    throw new Error("图生图失败 HTTP " + response.status + hintOf(await response.text().catch(() => "")));
  }
  const data = await response.json();
  const item = data?.data?.[0];
  const url = item?.url || (item?.b64_json ? "data:image/png;base64," + item.b64_json : "");
  if (typeof url !== "string" || !url.trim()) throw new Error("图生图服务未返回图片地址或图片数据");
  const saved = await persistGeneratedImage(url, input.outputDir);
  return { path: saved, url: /^https?:/i.test(url) ? url : "" };
}

/** 带重试的生图（09-29）：网络抖动 / 5xx / 429 自动再试一次；4xx 参数错不重试（重试也没用）。 */
export async function generateImageResilient(input: { baseUrl: string; apiKey: string; model: string; prompt: string } & ImageGenExtras, attempts = 2): Promise<{ path: string; url: string }> {
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

const BUILTIN_CHANNELS = ["builtin:read", "builtin:save", "builtin:probe", "builtin:generate-image"];

export const builtinFeature = defineFeature<null>({
  id: "builtin",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("builtin: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("builtin:read", async () => readBuiltinPlugins());
    ipcHost.handle("builtin:save", async (_e, cfg: BuiltinPluginConfig) => {
      await writeBuiltinPlugins(cfg);
      // ⛔ 密钥只走 env（配置文件里已是密文）：命令行兜底 `harness-media.mjs` 拿不到 safeStorage。
      //    必须在 restart 之前 set —— spawn 之后再设对已起的进程无效。
      server.setBuiltinPluginEnv(builtinPluginEnv(await readBuiltinPlugins()));
      // 保存后重写 config.toml 并重启引擎：developer_instructions 的生图/视觉段与
      // dynamicTools 都依赖这份配置，不重启的话引擎和已有会话感知不到配置变化。
      const model = await readCustomModel();
      if (model) await applyCustomModel(model); else await server.restart();
      return readBuiltinPlugins();
    });
    ipcHost.handle("builtin:probe", async (_e, input: { kind: "image"; baseUrl: string; apiKey: string }) => probeBuiltinModels(input));
    ipcHost.handle("builtin:generate-image", async (_e, input: { baseUrl: string; apiKey: string; model: string; prompt: string; size?: string; negative?: string; outputDir?: string }) => generateImageResilient(input));

    ctx.effect(() => {
      for (const ch of BUILTIN_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
