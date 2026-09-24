/**
 * openai-auth（09-22 架构改造：从 electron/main.ts 组合根按域拆出，纯搬迁）
 *
 * 域：OpenAI 官方订阅账号（auth.json / JWT 解析）/ 多账号 vault 与代理配置文件路径 /
 *     本地代理端口自动探测（含 60s 缓存）/ 官方模型目录拉取（chatgpt.com backend-api）。
 * 消费方：features/model-custom-ipc.ts（openai:* 12 个通道）、features/custom-model-apply.ts、
 *         features/boot.ts 与 features/custom-model-probe.ts（经 main 的 bindBoot / bindCustomModelProbe 注入）。
 *
 * 代码与原地逐字一致（仅顶部 import + 文件头注释 + 末尾 export 清单与访问器，
 * 以及 openaiVaultFile / openaiProxyFile 改成惰性求值函数 —— 原因见下方 ⛔ 注释）。
 * 跨域符号经 `import … from "../main"` 取用 —— **活绑定**（TS→CJS 编译成 `main_1.X` 属性访问）。
 * ⛔ liveProxyCache 是模块内 `let` 且会被消费方清掉（openai:set-proxy）⇒ 经 resetLiveProxyCache() 暴露；
 *    ESM 里 import 进来的绑定不可赋值（TS2632）。原 main.mutableState 的那对 getter/setter 随本批移除。
 */
import fs from "node:fs/promises";
import path from "node:path";
import nodeNet from "node:net";
import { app, net, session } from "electron";
import { codexHome } from "../runtime-refs";
// ── OpenAI 官方订阅（ChatGPT 登录）：走引擎原生 codex login --device-auth 设备码流程 ──
// 登录成功后引擎在 CODEX_HOME/auth.json 拿到 ChatGPT tokens，config 由 applyCustomModel
// 对 provider="openai-official" 特判（不写 model_provider，写 preferred_auth_method="chatgpt"）。
function openaiAuthFile() {
  return path.join(codexHome, "auth.json");
}
async function readOpenaiAuth(): Promise<{ loggedIn: boolean; email: string; accountId: string } | null> {
  try {
    const auth = JSON.parse(await fs.readFile(openaiAuthFile(), "utf8"));
    const tokens = auth?.tokens;
    if (!tokens?.id_token) return { loggedIn: false, email: "", accountId: "" };
    // id_token 是 JWT：payload 里带 email / chatgpt_account_id
    let email = "";
    try {
      const payload = JSON.parse(Buffer.from(String(tokens.id_token).split(".")[1], "base64").toString("utf8"));
      email = String(payload?.email ?? "");
    } catch { /* JWT 解析失败不影响登录态判定 */ }
    return { loggedIn: true, email, accountId: String(tokens.account_id ?? "") };
  } catch { return null; }
}
// ── OpenAI 多账号 vault：每账号保存 tokens（本机明文仅 userData，引擎激活时写入 auth.json）──
// ⛔ 不能写成模块顶层 `const … = path.join(app.getPath("userData"), …)`（09-22 code review 抓出）：
//    本模块在 main.ts 的 **import 期**就被求值，而 `app.setPath("userData", …)` 是 main.ts 的
//    **模块体语句**（编译产物里 require 在前、setPath 在后）⇒ 顶层求值拿到的是**默认** userData
//    `%APPDATA%\<package.json name>`，而应用真正使用的是 setPath 之后的 `%APPDATA%\Codex Harness Desktop`
//    （实测两个目录都在磁盘上）⇒ 路径会静默指到另一个目录（账号 vault / 代理配置的落点漂移）。
//    与 electron/personalization.ts 的既有约定一致：**惰性求值**，读写时才取路径。
function openaiVaultFile(): string {
  return path.join(app.getPath("userData"), "openai-accounts.json");
}
function openaiProxyFile(): string {
  return path.join(app.getPath("userData"), "openai-proxy.json");
}
const OPENAI_FALLBACK_MODELS = ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"];
async function readOpenaiProxy(): Promise<string> {
  try { return String(JSON.parse(await fs.readFile(openaiProxyFile(), "utf8")).proxy ?? "").trim(); } catch { return ""; }
}
// 本地代理端口自动探测：配置端口连不通时扫描常见端口（用户常把 7890/7897 记混，实证）
let liveProxyCache: { value: string; at: number } | null = null;
function proxyAlive(proxy: string): Promise<boolean> {
  const match = proxy.match(/^(?:https?:\/\/)?([^:]+):(\d+)/);
  if (!match) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = nodeNet.connect(Number(match[2]), match[1], () => { socket.destroy(); resolve(true); });
    socket.on("error", () => { socket.destroy(); resolve(false); });
    socket.setTimeout(1200, () => { socket.destroy(); resolve(false); });
  });
}
async function resolveLiveProxy(): Promise<string> {
  if (liveProxyCache && Date.now() - liveProxyCache.at < 60_000) return liveProxyCache.value;
  const configured = await readOpenaiProxy();
  const candidates = [...new Set([configured, "http://127.0.0.1:7897", "http://127.0.0.1:7890", "http://127.0.0.1:7899", "http://127.0.0.1:10808", "http://127.0.0.1:10809", "http://127.0.0.1:2080"])].filter(Boolean);
  for (const candidate of candidates) {
    if (await proxyAlive(candidate)) { liveProxyCache = { value: candidate, at: Date.now() }; return candidate; }
  }
  liveProxyCache = { value: configured, at: Date.now() };
  return configured;
}
// OpenAI 接口（chatgpt.com 后端）在部分区域被 Cloudflare 拦截：有代理设置时走独立 session 注入代理
async function openaiFetch(url: string, accountId: string, accessToken: string): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    // 官方后端按 client_version/originator/UA 识别客户端（缺 client_version 会 400，实证）
    originator: "codex-harness",
    "User-Agent": `codex-harness/${app.getVersion()}`,
  };
  if (accountId) headers["chatgpt-account-id"] = accountId;
  const init: Record<string, unknown> = { headers, signal: AbortSignal.timeout(20_000) };
  const proxy = await resolveLiveProxy();
  if (proxy) {
    const ses = session.fromPartition("persist:openai-api");
    await ses.setProxy({ proxyRules: proxy, proxyBypassRules: "<local>" });
    init.session = ses;
  }
  return net.fetch(url, init as RequestInit);
}
async function fetchOpenaiModels(): Promise<{ models: string[]; source: "official" | "fallback" }> {
  const auth = await readOpenaiAuth();
  if (!auth?.loggedIn) throw new Error("尚未登录 OpenAI 官方账号");
  const tokens = JSON.parse(await fs.readFile(openaiAuthFile(), "utf8")).tokens;
  // 官方目录按 client_version 门控：不认识的版本返回 {"models":[]}（实证 1.14.3 可用、app 自身版本为空）
  const candidates = ["1.14.3", app.getVersion()];
  for (const cv of candidates) {
    try {
      const url = `https://chatgpt.com/backend-api/codex/models?client_version=${encodeURIComponent(cv)}`;
      const response = await openaiFetch(url, auth.accountId, tokens.access_token);
      if (!response.ok) continue;
      const payload: any = await response.json().catch(() => null);
      // 官方目录结构：{ models: [{ slug, visibility, display_name, priority, ... }] }（dsh 插件实证）
      const arr = Array.isArray(payload?.models) ? payload.models : [];
      const ids = arr
        .filter((m: any) => m && typeof m === "object" && typeof m.slug === "string" && m.slug && m.visibility === "list")
        .sort((a: any, b: any) => (Number(b?.priority) || 0) - (Number(a?.priority) || 0))
        .map((m: any) => String(m.slug));
      if (ids.length) return { models: [...new Set<string>(ids)], source: "official" };
    } catch { /* 尝试下一个 client_version */ }
  }
  return { models: OPENAI_FALLBACK_MODELS, source: "fallback" };
}

export { OPENAI_FALLBACK_MODELS, fetchOpenaiModels, openaiAuthFile, openaiFetch, openaiProxyFile, openaiVaultFile, proxyAlive, readOpenaiAuth, readOpenaiProxy, resolveLiveProxy };

/** ⛔ liveProxyCache 是模块内的 `let`：消费方（openai:set-proxy 改代理设置）要把它清掉，
 *  而 import 进来的绑定不可赋值（TS2632）⇒ 只能经访问器写。 */
export function resetLiveProxyCache(): void { liveProxyCache = null; }
