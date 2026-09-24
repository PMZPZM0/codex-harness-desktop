/**
 * 自定义模型探测与目录生成（零耦合：不依赖 main 的任何单例）
 *
 * 09-21 架构改造：从 electron/main.ts 搬出，**内容逐字未改**（仅加 export）。
 * main.ts 通过 import 同名符号衔接 ⇒ 全文调用点一行未动。
 */
import fs from "node:fs/promises";
import type { CustomModelFile } from "./custom-model-types";
import path from "node:path";
import { existsSync } from "node:fs";
import { net, safeStorage } from "electron";

// ── 由 main.ts 注入（这些符号散布全文，不随本模块搬迁；同名声明 ⇒ 函数体逐字不变）──
let normalizeProvider!: any;
let readOpenaiAuth!: any;
let readCustomModel!: any;
let fetchOpenaiModels!: any;
let classifyProbeError!: any;
export function bindCustomModelProbe(deps: Record<string, any>) {
  normalizeProvider = deps.normalizeProvider;
  readOpenaiAuth = deps.readOpenaiAuth;
  readCustomModel = deps.readCustomModel;
  fetchOpenaiModels = deps.fetchOpenaiModels;
  classifyProbeError = deps.classifyProbeError;
}


export function buildModelCatalog(entry: CustomModelFile) {
  const models = (normalizeProvider(entry).models ?? []).filter((model: any) => model.enabled !== false);
  const fallbackWindow = entry.contextWindow ?? 128000;
  // 只收「有明确 contextWindow」的模型，其余交给引擎默认；把生效 model 放最前
  const ordered = entry.model && models.some((m: any) => m.id === entry.model)
    ? [models.find((m: any) => m.id === entry.model)!, ...models.filter((m: any) => m.id !== entry.model)]
    : models;
  const seen = new Set<string>();
  const catalogModels = [];
  for (const m of ordered) {
    if (!m?.id || seen.has(m.id)) continue;
    seen.add(m.id);
    const contextWindow = m.contextWindow ?? fallbackWindow;
    if (!contextWindow) continue;
    // 该模型显式声明的思考档位（GPT 系可声明 minimal/max/ultra 等）；未声明（含空数组——
    // 探测合并会写入 efforts: []）默认全档位——复刻 ZCode：思考等级下拉选什么都能用。
    // ⛔ 09-16 修正两处旧认知（修 Bug 11/12）：
    //  ① 旧注释称「引擎会按 catalog 的 supported_reasoning_levels 校验档位，catalog 没声明的档会被拒」
    //     ——**被真实引擎证伪**：自定义模型与**内置模型**的 `effort="minimal"` / `"bogus-level"`
    //     都被照单全收、turn 正常完成。先排除了「catalog 没被读到」这个替代解释（把 catalog 的
    //     context_window 改成哨兵 555000，引擎写进 rollout 的 model_context_window 就是 555000
    //     ⇒ catalog 确实生效），然后才下的结论：**读了 catalog，但不校验档位**。
    //     ⇒ 这个白名单只决定「catalog 声明什么 / UI 能选什么」，不是安全边界。
    //  ② 旧白名单漏了 `max`，而引擎内置 gpt-6-astra 就声明了 max（low/medium/high/xhigh/max/ultra）
    //     ⇒ 声明 max 的模型 UI 里反而没 max；「只声明 max」更糟：过滤后为空会回落成整套默认档，
    //     等于替用户换了一套他没声明的档位。`max` 追加在末尾，不动已定稿的展示顺序。
    // ⛔ 与渲染层 declaredModelEfforts（src/lib/effort.ts）同规则，两处必须同源。
    const EFFORT_WHITELIST = ["minimal", "low", "medium", "high", "xhigh", "ultra", "max"] as const;
    const rawEfforts = m.efforts?.length ? m.efforts : ["minimal", "low", "medium", "high", "ultra", "xhigh", "max"];
    let efforts = rawEfforts.filter((effort: any): effort is typeof EFFORT_WHITELIST[number] => (EFFORT_WHITELIST as readonly string[]).includes(effort));
    // 旧版自动生成的声明（低/中/高 三档或 +最高，且没有极高）补「极高」——与渲染层 declaredModelEfforts 同规则
    const hasBase = ["low", "medium", "high"].every((e) => efforts.includes(e as any));
    const legacyAuto = hasBase && !efforts.includes("xhigh") && efforts.every((e: any) => ["low", "medium", "high", "ultra"].includes(e));
    if (legacyAuto) efforts = [...efforts, "xhigh"] as typeof efforts;
    const effortDescriptions: Record<string, string> = {
      minimal: "Minimal reasoning, fastest responses",
      low: "Fast responses with lighter reasoning",
      medium: "Greater reasoning depth",
      high: "Deep reasoning",
      xhigh: "Very deep reasoning, slower responses",
      ultra: "Maximum reasoning depth",
      max: "Top reasoning tier (engine extension; declared by some built-in models)",
    };
    catalogModels.push({
      slug: m.id,
      display_name: m.id,
      description: `${entry.name} · custom model`,
      default_reasoning_level: efforts.includes("medium") ? "medium" : (efforts.at(-1) ?? "medium"),
      supported_reasoning_levels: efforts.map((effort: any) => ({ effort, description: effortDescriptions[effort] ?? effort })),
      context_window: contextWindow,
      max_context_window: contextWindow,
      effective_context_window_percent: 100,
      supports_parallel_tool_calls: false,
      supports_image_detail_original: (m.inputTypes ?? []).includes("image") || (m.outputTypes ?? []).includes("image"),
      input_modalities: (m.inputTypes ?? ["text"]).includes("image") ? ["text", "image"] : ["text"],
      shell_type: "default",
      visibility: "list",
      supported_in_api: true,
      priority: 1,
      base_instructions: "",
      support_verbosity: false,
      supports_reasoning_summaries: false,
      experimental_supported_tools: [],
      truncation_policy: { mode: "bytes", limit: 10000 },
    });
  }
  return { models: catalogModels };
}

/** 把模型 catalog 写进 codex-home/model-catalog.json，返回其 TOML 配置行（无模型则空）。
 * 合并所有已保存供应商的模型（含禁用）：历史线程引用禁用供应商的模型时引擎也要能
 * 认出它——禁用只影响下拉新增可选，不影响旧会话继续使用。当前生效供应商排最前，同名去重保留靠前者。 */

export async function probeCustomModel(input: { provider?: string; baseUrl: string; apiKey?: string; model?: string; wireApi?: "responses" | "chat" | "auto" }) {
  const baseUrl = input.baseUrl.trim().replace(/\/$/, "");
  let parsedUrl: URL;
  try { parsedUrl = new URL(baseUrl); } catch { throw new Error("Base URL 不是合法地址"); }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") throw new Error("Base URL 必须使用 http 或 https");
  const previous = await readCustomModel();
  const canReuseKey = previous?.provider === input.provider?.trim() && previous?.baseUrl === baseUrl;
  const apiKey = input.apiKey?.trim() || (canReuseKey && previous?.encryptedKey && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(previous.encryptedKey, "base64")) : "");
  const model = input.model?.trim();
  const startedAt = Date.now();
  // 官方订阅不走 HTTP 探测（chatgpt 后端无裸 /models，且 Bearer 语义不同）：以 auth.json 登录态为准
  if (input.provider === "openai-official") {
    const auth = await readOpenaiAuth();
    if (!auth?.loggedIn) throw new Error("尚未登录 OpenAI 官方账号——请先在模型设置页完成设备码登录");
    const catalog = await fetchOpenaiModels();
    return { status: 200, latencyMs: Date.now() - startedAt, model: model ?? "", models: catalog.models, ok: true, via: catalog.source === "official" ? "official" : "official-fallback" };
  }
  const authHeaders: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

  // 第一步：GET /models 轻量探测，毫秒级即可判断网络连通与认证
  let models: string[] | null = null;
  let modelsStatus = 0;
  let modelsError: Error | null = null;
  try {
    const response = await probeFetch(`${baseUrl}/models`, { headers: { ...authHeaders, Accept: "application/json" } }, 8_000);
    if (response.ok) {
      const body = await response.text();
      try {
        const data: any = JSON.parse(body);
        models = [...new Set<string>((Array.isArray(data) ? data : data.data ?? data.models ?? []).map((entry: any) => typeof entry === "string" ? entry : entry?.id ?? entry?.name).filter(Boolean))].sort();
        modelsStatus = response.status;
      } catch { /* 返回的不是 JSON，走流式探测兜底 */ }
    } else if (response.status === 401 || response.status === 403) {
      const raw = await response.text().catch(() => "");
      let reason = "";
      try { const parsed = JSON.parse(raw); reason = parsed?.error?.message ?? parsed?.message ?? ""; } catch { reason = raw.slice(0, 160); }
      throw new Error(`认证失败（HTTP ${response.status}）${reason ? `：${reason}` : "：网络是通的，请检查 API Key"}`);
    } else if (response.status !== 404 && response.status !== 405) {
      const body = await response.text();
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 200) || response.statusText}`);
    }
    // 404/405：网关不提供 /models，走流式探测
  } catch (error: any) {
    modelsError = error instanceof Error ? error : new Error(String(error));
  }
  // 网络层/认证已确定失败的场景直接报错，不再浪费时间做第二次请求
  if (modelsError && /域名解析失败|连接被拒绝|认证失败/.test(modelsError.message)) throw modelsError;

  if (models) {
    // /models 可用：没指定模型，或模型在列表里 → 直接连通成功（最快路径）
    if (!model || !models.length || models.includes(model)) {
      return { status: modelsStatus, latencyMs: Date.now() - startedAt, model: model ?? "", models, ok: true, via: "models" };
    }
    // 模型不在列表里：列表可能不全，用流式请求做精确判定
  }

  // 第二步：对指定模型发起流式极简请求，收到首个响应分片即判定连通，避免推理模型思考耗时。
  // wireApi=auto（自动跟随上游）：先试 Responses，端点/参数不被认就自动换 Chat Completions，
  // 并把实际成功的协议通过 wireUsed 返回——前端回写配置，保存时落定具体值。
  // ⛔ 显式 responses 也保留 chat 回落（09-18 用户反馈）：火山 Coding Plan 等网关对**部分模型**
  // 的 /responses 直接回 404「does not support the coding plan feature」，而 Chat 通道是通的——
  // 只试单协议会把"明明能用的模型"误报成连接失败。wireUsed/wireMismatch 让前端如实呈现差异。
  const requestedWire: "responses" | "chat" = input.wireApi === "chat" ? "chat" : "responses";
  const wireOrder: ("responses" | "chat")[] = requestedWire === "chat" ? ["chat"] : ["responses", "chat"];
  if (!model) {
    // Coding Plan 类网关（火山方舟/智谱 Coding/Kimi/MiniMax 等）不提供 /models 列表：
    // 命中已知网关时返回内置推荐清单（可手动增删），并给出该网关实测的协议偏好。
    const known = KNOWN_GATEWAY_MODELS.find((entry) => entry.match.test(baseUrl));
    if (known) {
      const wireHint = /volces\.com\/api\/coding|coding\/v3/.test(baseUrl) ? "chat" : known.wire;
      return { status: 200, latencyMs: Date.now() - startedAt, model: "", models: known.models, ok: true, via: "builtin", wireUsed: wireHint as "responses" | "chat" };
    }
    throw new Error(modelsError ? `该网关不提供 /models 列表接口：${modelsError.message}。可用下方「添加模型」手动输入模型 ID` : "该网关不提供 /models，且未指定要测试的模型。可用下方「添加模型」手动输入模型 ID");
  }
  const headers: Record<string, string> = { "Content-Type": "application/json", ...authHeaders };
  const buildPayload = (wire: "responses" | "chat", tokenParam: string) => wire === "chat"
    ? { model, messages: [{ role: "user", content: "hi" }], [tokenParam]: 16, stream: true }
    : { model, input: "hi", max_output_tokens: 16, stream: true };
  const attempt = async (wire: "responses" | "chat", tokenParam: string) => {
    const endpoint = wire === "chat" ? `${baseUrl}/chat/completions` : `${baseUrl}/responses`;
    const response = await probeFetch(endpoint, { method: "POST", headers, body: JSON.stringify(buildPayload(wire, tokenParam)) }, 20_000);
    const body = response.ok ? "" : await response.text();
    return { response, body };
  };
  // gpt-5 系列要求 max_completion_tokens，旧网关只认 max_tokens：先按新规范发，参数不识别时自动换旧参数重试
  let response!: Response;
  let body = "";
  let wireUsed: "responses" | "chat" = wireOrder[0];
  for (let w = 0; w < wireOrder.length; w++) {
    const wire = wireOrder[w];
    wireUsed = wire;
    ({ response, body } = await attempt(wire, "max_completion_tokens"));
    if (!response.ok && response.status === 400 && /max_completion_tokens|max_tokens/i.test(body)) {
      ({ response, body } = await attempt(wire, "max_tokens"));
    }
    if (response.ok) break;
    // 自动模式：端点不存在/参数不认（非认证、非模型缺失错误）→ 换另一种协议再试
    const canSwitch = w + 1 < wireOrder.length && (response.status === 404 || response.status === 405 || response.status === 400);
    if (!canSwitch) {
      // 认证失败必须把供应商自己的原话带上：不同网关的 401 含义不同——「API key 格式不正确」
      // 说明 Key 与通道/Key 类型不配套（如火山 /api/plan/v3 要套餐专属 Key），
      // 「Invalid API key」才是 Key 值不对。丢掉原文用户只能看到笼统提示，无从下手（实测踩坑）。
      const detail = describeHttpBody(body) || response.statusText;
      if (response.status === 401 || response.status === 403) throw new Error(`认证失败（HTTP ${response.status}）${detail ? `：${detail}` : "：网络是通的，请检查 API Key"}`);
      if (response.status === 400 && /model.*(not.*(found|exist)|不存在)/i.test(body)) throw new Error(`模型不存在（HTTP 400）：${detail}`);
      if (response.status === 404 && /coding plan/i.test(body)) {
        // 火山 Coding Plan 类网关的原话要翻译成白话：用户看到 404 只知道"失败了"，不知道是该换接入点还是换模型
        throw new Error(`HTTP 404: ${detail}\n白话：供应商表示这个模型不在其 Coding Plan 通道的支持范围。请确认 Base URL 与模型是否配套（例如火山引擎通用接入点是 https://ark.cn-beijing.volces.com/api/v3），或换用支持该模型的接入点。`);
      }
      throw new Error(`HTTP ${response.status}: ${detail}`);
    }
  }
  // 200 已证明网络、认证、模型名全部有效；读首个分片后立即断开，不等待生成完成
  const reader = (response.body as any)?.getReader?.();
  if (reader) {
    try { await reader.read(); } finally { try { await reader.cancel(); } catch { /* 已断开 */ } }
  }
  // wireMismatch：实际连通的协议与请求指定的不同（responses 被拒、chat 兜底成功）——前端如实提示
  return { status: response.status, latencyMs: Date.now() - startedAt, model, models: models ?? [model], ok: true, via: "stream", wireUsed, wireMismatch: wireUsed !== requestedWire };
}
// ── 原生右键菜单：为输入框/选中文本提供 Windows 式复制、粘贴、剪切、全选、删除、撤销、重做 ──
// 渲染层跑在 sandbox + contextIsolation 下，且消息气泡的自定义「复制」按钮已存在；
// 这里补的是系统级右键菜单（此前右键无任何响应）。链接会额外提供「复制链接 / 浏览器打开」。

// ── 09-21 同域补充搬迁（内容逐字未改）──
export function probeFetch(url: string, init: RequestInit, timeoutMs: number) {
  return net.fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }).catch((error: any) => {
    throw new Error(classifyProbeError(error));
  });
}

/** 把探测失败时的 HTTP 响应体整理成一句可读的话：优先取 JSON 里的 error.message / message，
 *  拿不到再退回原始文本（截断）。网关原话必须原样保留——它是判断「Key 错」还是「通道不配套」
 *  的唯一依据，直接丢给用户看整坨 JSON 也不友好。 */

export const KNOWN_GATEWAY_MODELS: { match: RegExp; wire: "responses" | "chat"; models: string[] }[] = [
  // 火山方舟 Coding Plan：https://ark.cn-beijing.volces.com/api/coding/v3（仅 Chat 协议）
  { match: /volces\.com\/api\/coding/, wire: "chat", models: ["doubao-seed-2.0-code", "doubao-seed-code", "glm-4.7", "deepseek-v3.2", "kimi-k2.5"] },
  // 火山方舟标准端点
  { match: /volces\.com/, wire: "chat", models: ["doubao-seed-1.8", "doubao-seed-1.6", "doubao-1.5-pro-32k", "deepseek-v3"] },
  // 智谱 Coding Plan：https://open.bigmodel.cn/api/coding/paas/v4
  { match: /bigmodel\.cn\/api\/coding/, wire: "responses", models: ["glm-5.3", "glm-5.2", "glm-5.1", "glm-5"] },
  { match: /bigmodel\.cn/, wire: "responses", models: ["glm-5.3", "glm-5.2", "glm-5.1", "glm-5", "glm-4.6"] },
  // Kimi For Coding：https://api.kimi.com/coding/v1
  { match: /api\.kimi\.com|kimi\.com/, wire: "chat", models: ["kimi-k3", "kimi-k2-0905-preview", "kimi-k2-turbo-preview"] },
  // MiniMax
  { match: /minimaxi\.com|minimax\.io|minimax/, wire: "responses", models: ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2"] },
];

export function describeHttpBody(body: string): string {
  const raw = String(body ?? "").trim();
  if (!raw) return "";
  try {
    const data: any = JSON.parse(raw);
    const message = data?.error?.message ?? data?.error?.msg ?? data?.message ?? data?.msg ?? data?.error;
    if (typeof message === "string" && message.trim()) return message.trim().slice(0, 300);
    if (message && typeof message === "object") return JSON.stringify(message).slice(0, 300);
  } catch { /* 非 JSON：走原文 */ }
  return raw.slice(0, 300);
}

/** 把 net.fetch 的底层错误翻译成能看懂的中文提示 */
