/**
 * CLI 智能体「跟随主会话供应商/模型」的配置生成（11-07 用户令：
 *   「用户安装 cli 就全部自动配置，跟着供应模型来；用户切换供应商也自动配置更新」）。
 *
 * 纯函数：只负责把「供应商信息」翻译成各家 CLI 认的配置文件文本 / 环境变量。
 * ⛔ 落盘由主进程 `electron/cli-agent-provider-sync.ts` 做（这里不碰 fs，便于单测）。
 * ⛔ 只有**本机中转**才写含 Key 的配置（中转不校验 Key，用占位符即可）——
 *    外部供应商的真实 Key 绝不落到任何 CLI 的配置文件里，只在派活子进程环境里出现。
 */

/** 本机 / 内网端点：应用自己的中转支持 OpenAI + Responses + Anthropic + Gemini 四种协议。 */
export function isLocalBaseUrl(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return false;
  let host = "";
  try { host = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, ""); }
  catch { host = (value.replace(/^[a-z]+:\/\//i, "").split("/")[0] ?? "").split(":")[0].toLowerCase(); }
  if (!host) return false;
  if (host === "localhost" || host === "::1" || host === "0.0.0.0" || host.endsWith(".localhost")) return true;
  /* ⛔ 先验 IPv4 形态再判网段 —— 不然 `10.evil.com` 这种公网域会被前缀误判成本机中转。 */
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
}

/** Anthropic / Gemini 的 SDK 会自己拼 `/v1/messages`、`/v1beta/...` ⇒ base 要剥掉尾部的 /v1。 */
export function stripV1Suffix(baseUrl) {
  return String(baseUrl ?? "").trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
}

/**
 * Kimi Code 读 key 的环境变量名（11-10：外部供应商的真实 Key 绝不落进配置文件）。
 * kimi 的 provider 支持 `api_key_env = "<变量名>"`（2.5.2 dist/main.mjs 实证：
 * 「declares api_key_env in config.toml, but the environment variable is not set」），
 * 所以配置里只写变量名，Key 由派活子进程环境给出。
 */
export const CLI_KEY_ENV = "HARNESS_CLI_API_KEY";

/** Kimi Code 的 config.toml（`[providers.*]` + `[models.*]`，default_model 在顶层）。
 *  ⛔ 二选一：本机中转不校验 Key ⇒ 写占位符 api_key；外部供应商 ⇒ 只写 api_key_env。
 *     两者同时出现 kimi 会直接报 mutually exclusive。 */
export function kimiConfigToml(input) {
  const baseUrl = String(input?.baseUrl ?? "").trim().replace(/\/+$/, "");
  const model = String(input?.model ?? "").trim();
  const apiKey = String(input?.apiKey ?? "").trim();
  const apiKeyEnv = String(input?.apiKeyEnv ?? "").trim();
  if (!baseUrl || !model) return "";
  const credential = apiKey
    ? `api_key = ${JSON.stringify(apiKey)}`
    : apiKeyEnv
      ? `api_key_env = ${JSON.stringify(apiKeyEnv)}`
      : "";
  if (!credential) return "";
  const modelKey = `harness/${model}`;
  return [
    `default_model = ${JSON.stringify(modelKey)}`,
    "",
    "[providers.harness]",
    'type = "openai"',
    `base_url = ${JSON.stringify(baseUrl)}`,
    credential,
    "",
    `[models.${JSON.stringify(modelKey)}]`,
    'provider = "harness"',
    `model = ${JSON.stringify(model)}`,
    "max_context_size = 131072",
    'capabilities = ["tool_use"]',
    "",
  ].join("\n");
}

/**
 * CLI 的「模型协议族」（11-10 用户令：「把我们的配置的供应商自动配置给 CLI…全部自动化」）。
 *
 * 为什么必须按协议分：同一个供应商端点，各家 CLI 认的变量名完全不同 ——
 *   · Claude Code 只认 ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN（⛔ 给它 OPENAI_* 等于没配，
 *     实测症状就是 `Not logged in · Please run /login`）；
 *   · Qwen Code 默认按 **gemini 协议**拼 `/v1beta/...`，中转只讲 OpenAI ⇒ 回
 *     `{"detail":"Method Not Allowed"}`；必须 `--auth-type openai` + OPENAI_*（实测 exit=0）；
 *   · Gemini 认 GOOGLE_GEMINI_BASE_URL + GEMINI_API_KEY；
 *   · OpenAI 兼容系（aider / openclaw / qwenpaw / codebuddy…）认 OPENAI_*；
 *   · Kimi / Codex / iFlow 走自己的配置文件（环境变量不生效或不足）。
 * ⛔ 判定只认可执行名，不猜供应商名字（`custom964` 这种自建 id 里不可能含 anthropic）。
 */
export function cliProtocolOf(bin) {
  const key = String(bin ?? "").trim().toLowerCase().replace(/\.(exe|cmd|bat|ps1|sh)$/, "");
  if (key === "claude") return "anthropic";
  if (key === "gemini") return "gemini";
  /* ⛔ qwen 曾经归 gemini（Gemini CLI 同源），0.26.9 实测必须归 openai：
     否则它拼 /v1beta/... 被中转 405（`Method Not Allowed`）。 */
  if (key === "qwen") return "openai";
  /* ⛔ iflow 0.5.19 实测：环境变量只认 IFLOW_API_KEY（且不够配 base/model），
     跟随供应商只能写 ~/.iflow/settings.json ⇒ 归 native，由同步模块落盘。 */
  if (key === "kimi" || key === "codex" || key === "iflow") return "native";
  return "openai";
}

/**
 * iFlow CLI 的 `~/.iflow/settings.json`（0.5.19 实测）。
 *
 * 它把 auth 写在 settings 顶层（bundle 里字段白名单：selectedAuthType / apiKey / baseUrl /
 * modelName / …）；`selectedAuthType` 缺省时只认 `IFLOW_API_KEY`，而那个变量不包含
 * baseUrl/model ⇒ 想跟随当前供应商必须落这四项。
 * ⛔ Key 是明文（该 CLI 没有 api_key_env 之类的间接机制）—— 由用户显式点同步触发。
 */
export function iflowSettingsJson(raw, input) {
  const baseUrl = String(input?.baseUrl ?? "").trim().replace(/\/+$/, "");
  const model = String(input?.model ?? "").trim();
  const apiKey = String(input?.apiKey ?? "").trim();
  if (!baseUrl || !model || !apiKey) return "";
  const current = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return `${JSON.stringify({
    ...current,
    selectedAuthType: "openai-compatible",
    apiKey,
    baseUrl,
    modelName: model,
  }, null, 2)}\n`;
}

/** Codex CLI 的独立 home（⛔ 不碰用户自己的 ~/.codex）：provider 指向当前供应商，Key 走环境变量名。 */
export function codexConfigToml(input) {
  const baseUrl = String(input?.baseUrl ?? "").trim().replace(/\/+$/, "");
  const model = String(input?.model ?? "").trim();
  if (!baseUrl || !model) return "";
  return [
    'model_provider = "harness"',
    `model = ${JSON.stringify(model)}`,
    "",
    "[model_providers.harness]",
    'name = "harness"',
    `base_url = ${JSON.stringify(baseUrl)}`,
    'wire_api = "responses"',
    'env_key = "OPENAI_API_KEY"',
    "",
  ].join("\n");
}

/**
 * Gemini CLI 的 settings.json：只补「用 API Key 认证」这一项（否则非交互会报 Invalid auth method）。
 * ⛔ 合并而不是覆盖：用户自己的其它设置原样保留。
 */
export function mergeGeminiSettings(raw, input) {
  const current = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const security = current.security && typeof current.security === "object" ? current.security : {};
  const auth = security.auth && typeof security.auth === "object" ? security.auth : {};
  const model = String(input?.model ?? "").trim();
  const modelBlock = current.model && typeof current.model === "object" ? current.model : {};
  return {
    ...current,
    security: { ...security, auth: { ...auth, selectedType: "gemini-api-key" } },
    ...(model ? { model: { ...modelBlock, name: model } } : {}),
  };
}
