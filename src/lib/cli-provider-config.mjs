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

/** Kimi Code 的 config.toml（`[providers.*]` + `[models.*]`，default_model 在顶层）。 */
export function kimiConfigToml(input) {
  const baseUrl = String(input?.baseUrl ?? "").trim().replace(/\/+$/, "");
  const model = String(input?.model ?? "").trim();
  const apiKey = String(input?.apiKey ?? "").trim();
  if (!baseUrl || !model) return "";
  const modelKey = `harness/${model}`;
  return [
    `default_model = ${JSON.stringify(modelKey)}`,
    "",
    "[providers.harness]",
    'type = "openai"',
    `base_url = ${JSON.stringify(baseUrl)}`,
    `api_key = ${JSON.stringify(apiKey)}`,
    "",
    `[models.${JSON.stringify(modelKey)}]`,
    'provider = "harness"',
    `model = ${JSON.stringify(model)}`,
    "max_context_size = 131072",
    'capabilities = ["tool_use"]',
    "",
  ].join("\n");
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
