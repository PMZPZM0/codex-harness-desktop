/**
 * model-custom-ipc 的「openai-login」部分（09-22 从同目录 model-custom-ipc.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import fs from "node:fs/promises";
import { app, ipcMain, safeStorage } from "electron";
import { spawn } from "node:child_process";
import { codexBinaryPath } from "../../codex-server";
import { existsSync } from "node:fs";
import type { CustomModelFile, ProviderModel } from "../../features/custom-model-types";
import { OPENAI_FALLBACK_MODELS, fetchOpenaiModels, openaiAuthFile, openaiFetch, openaiProxyFile, openaiVaultFile, readOpenaiAuth, resetLiveProxyCache } from "../openai-auth";
import { applyCustomModel, normalizeProvider, normalizeUpstreamProtocol, readCustomModel, readCustomModels, writeCustomModels } from "../../main";
import { codexHome, customModelFile, server, upsertCustomModel } from "../../runtime-refs";
export function withModels(entry: CustomModelFile, extra?: string): CustomModelFile {
  const normalized = normalizeProvider(entry);
  let result = normalized;
  if (extra) {
    const existing = normalized.models ?? [];
    if (!existing.some((m) => m.id === extra)) {
      const cloned = [...existing];
      cloned.unshift({ id: extra, contextWindow: entry.contextWindow });
      result = { ...normalized, models: cloned };
    }
  }
  // ⛔ 单一真相源（09-19 用户实测：「`custom-model.json` 该模型写 1000000、`custom-models.json` 同一供应商
  //   顶层写 128000，这个修一下，怎么又出现这个问题」）：
  //   两个字段表达的是同一件事，却由**两个不同来源**写 —— 模型自己的 `contextWindow` 来自内置规格表
  //   （新建供应商时的真实能力值），顶层那个只是**新建模型时的默认值**（UI 默认 128000，用户多半没动过），
  //   而引擎侧 catalog 读的是**模型自己的**值。两处各写各的 ⇒ 每次新建/保存供应商都会留下一对打架的数字，
  //   界面按大值算（显示 12%），用户按小值理解（以为只剩 4%），谁也不知道哪个是真。
  //   这里在**唯一写入点**收口：顶层恒等于生效模型自己的值（模型没有自己的值时才保留顶层输入）。
  //   ⇒ `custom-model.json` 顶层、`custom-models.json` 里那条记录顶层、catalog、界面显示四处永远一致。
  const effectiveWindow = result.model
    ? (result.models ?? []).find((m) => m.id === result.model)?.contextWindow
    : undefined;
  return effectiveWindow ? { ...result, contextWindow: effectiveWindow } : result;
}

export function isLocalEndpoint(baseUrl: unknown): boolean {
  const raw = String(baseUrl ?? "").trim();
  if (!raw) return false;
  let host = "";
  try { host = new URL(raw).hostname.toLowerCase().replace(/^\[|\]$/g, ""); }
  catch { host = ""; }
  if (!host) {
    // 没写协议时 URL 解析会失败（用户常直接填 127.0.0.1:11434）→ 退化成字符串判断
    host = (raw.replace(/^[a-z]+:\/\//i, "").split("/")[0] ?? "").split(":")[0].toLowerCase();
  }
  if (!host) return false;
  if (host === "localhost" || host === "::1" || host === "0.0.0.0" || host.endsWith(".localhost")) return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}

export function publicCustomModel(value: CustomModelFile | null) {
  if (!value) return null;
  const { encryptedKey, ...config } = value;
  const hasKey = Boolean(encryptedKey);
  // ⛔ 未配置密钥的第三方供应商**不得视为已启用**（09-19 用户：「首次安装启动、没配置供应商时，
  //   默认不要启用任何供应商，要不然会跟新配置的供应商同时启用」）。
  //   没有密钥的供应商启用着，一是语义假（它根本发不出请求），二是会出现「默认那个 + 新配的这个」
  //   同时显示启用，用户分不清当前到底是谁生效。
  //   ⚠️ `openai-official` 例外：官方订阅靠 ChatGPT 登录凭据，本来就没有 API Key。
  //   ⚠️ 两个例外：① `openai-official` 靠 ChatGPT 登录凭据，本来就没有 API Key；
  //   ② 本机/内网自建服务（见 isLocalEndpoint）—— 它们本来就不需要 Key。
  //   ⛔ 两处判定必须同源：这里（显示）与 custom-model:save（落盘）不一致的话，
  //   会出现「存成启用、界面显示停用」这种自相矛盾的状态。
  const keylessThirdParty = !hasKey && value.provider !== "openai-official" && !isLocalEndpoint(value.baseUrl);
  return { ...config, enabled: keylessThirdParty ? false : value.enabled !== false, hasKey };
}

type OpenaiLoginState = { child: { kill: () => void; exitCode: number | null } | null; lines: string[]; url: string; code: string; error: string };

const openaiLogin: OpenaiLoginState = { child: null, lines: [], url: "", code: "", error: "" };

ipcMain.handle("openai:login-start", async (_e, input: { proxy?: string } = {}) => {
  if (openaiLogin.child) { try { openaiLogin.child.kill(); } catch { /* 已退出 */ } }
  openaiLogin.lines = []; openaiLogin.url = ""; openaiLogin.code = ""; openaiLogin.error = "";
  // OpenAI 对部分地区/IP 限制访问（直连 403）：用户手填代理 > 进程环境变量 > 系统代理解析
  const proxyEnv: Record<string, string> = {};
  try {
    const manual = String(input?.proxy ?? "").trim();
    const direct = manual || process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy;
    if (direct) {
      proxyEnv.HTTPS_PROXY = direct; proxyEnv.HTTP_PROXY = direct;
    } else {
      const rule = await (await import("electron")).session.defaultSession.resolveProxy("https://auth.openai.com");
      const match = rule.match(/PROXY\s+([^;\s]+)/i);
      if (match && !/^direct/i.test(rule)) {
        const proxyUrl = match[1].startsWith("http") ? match[1] : `http://${match[1]}`;
        proxyEnv.HTTPS_PROXY = proxyUrl; proxyEnv.HTTP_PROXY = proxyUrl;
      }
    }
  } catch { /* 代理解析失败就直连尝试 */ }
  const child = spawn(codexBinaryPath(), ["login", "--device-auth"], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, ...proxyEnv, CODEX_HOME: codexHome },
  });
  openaiLogin.child = child;
  child.on("exit", (code) => {
    // 进程退出且没拿到授权 URL = 登录请求本身失败（典型：无代理直连 403），把最后错误行透出
    if (!openaiLogin.url) {
      const last = [...openaiLogin.lines].reverse().map((l) => l.trim()).find((l) => l && !/warning/i.test(l));
      openaiLogin.error = last || `登录进程已退出（exit ${code ?? "?"}）`;
    } else if (!existsSync(openaiAuthFile())) {
      // URL 已发出但进程退出且 auth.json 没落地 = 授权没完成/令牌交换失败（如代码过期、代理中断）
      const last = [...openaiLogin.lines].reverse().map((l) => l.trim()).find((l) => l && !/warning/i.test(l));
      openaiLogin.error = last || `登录进程已退出（exit ${code ?? "?"}）但未完成授权，请重新登录获取新的验证码`;
    }
  });
  child.stdout.on("data", (chunk: Buffer) => {
    // Windows 控制台输出带 ANSI 颜色转义码（\x1b[36m 等），会污染 URL 和验证码——先剥掉
    const text = chunk.toString().replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/[\u0000-\u001f](?=\S)/g, (m) => (m === "\n" ? m : ""));
    openaiLogin.lines.push(text);
    if (openaiLogin.lines.length > 40) openaiLogin.lines.shift();
    const urlMatch = text.match(/https:\/\/auth\.openai\.com[^\s"'）\]]+/);
    if (urlMatch && !openaiLogin.url) openaiLogin.url = urlMatch[0];
    const codeMatch = text.match(/\b([A-Z0-9]{4}-[A-Z0-9?]{3,})\b/);
    if (codeMatch && !openaiLogin.code) openaiLogin.code = codeMatch[1];
    else if (!openaiLogin.code && !text.includes("https://")) {
      // 兜底：官方输出格式可能变——含 "code" 的行里抓验证码样式的 token
      const line = text.split(/\r?\n/).find((l) => /one-time|验证码|code/i.test(l) && !/https?:\/\//.test(l));
      const m2 = line?.match(/([A-Z0-9]{4,}-[A-Z0-9?]{3,})/i) ?? line?.match(/code[^A-Za-z0-9]*([A-Za-z0-9][A-Za-z0-9-]{3,})/i);
      if (m2) openaiLogin.code = m2[1];
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    openaiLogin.lines.push(chunk.toString().replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ""));
    if (openaiLogin.lines.length > 40) openaiLogin.lines.shift();
  });
  return { started: true };
});

ipcMain.handle("openai:login-status", async () => {
  const auth = await readOpenaiAuth();
  const childAlive = Boolean(openaiLogin.child && openaiLogin.child.exitCode === null);
  if (auth?.loggedIn && openaiLogin.child) { try { openaiLogin.child.kill(); } catch { /* 已退出 */ } }
  return { loggedIn: Boolean(auth?.loggedIn), email: auth?.email ?? "", url: openaiLogin.url, code: openaiLogin.code, childAlive, error: openaiLogin.error, lines: openaiLogin.lines.slice(-6).join("") };
});

ipcMain.handle("openai:login-cancel", async () => {
  if (openaiLogin.child) { try { openaiLogin.child.kill(); } catch { /* 已退出 */ } }
  return { ok: true };
});

ipcMain.handle("openai:usage", async (_e, input: { email?: string } = {}) => {
  // 额度：ChatGPT 后端 wham/usage（与 dsh-codex-subscription 同源）。可指定 vault 中的账号，缺省用当前 auth.json
  let tokens: any = null;
  let accountId = "";
  if (input?.email) {
    const account = (await readOpenaiVault()).find((a) => a.email === input.email);
    if (!account?.tokens?.access_token) throw new Error("未找到该账号的登录凭据");
    tokens = account.tokens; accountId = account.tokens.account_id ?? "";
  } else {
    const auth = await readOpenaiAuth();
    if (!auth?.loggedIn) throw new Error("尚未登录 OpenAI 官方账号");
    tokens = JSON.parse(await fs.readFile(openaiAuthFile(), "utf8")).tokens;
    accountId = auth.accountId;
  }
  const response = await openaiFetch("https://chatgpt.com/backend-api/wham/usage", accountId, tokens.access_token);
  if (!response.ok) throw new Error(`额度查询失败 HTTP ${response.status}`);
  return await response.json();
});

export type OpenaiVaultAccount = { id: string; email: string; tokens: { id_token?: string; access_token?: string; refresh_token?: string; account_id?: string }; savedAt: number };

ipcMain.handle("openai:set-proxy", async (_e, proxy: string) => {
  await fs.writeFile(openaiProxyFile(), JSON.stringify({ proxy: String(proxy ?? "").trim() }, null, 2), "utf8");
  resetLiveProxyCache();
  return { ok: true };
});

ipcMain.handle("openai:models", async () => {
  try { return (await fetchOpenaiModels()).models; } catch { return OPENAI_FALLBACK_MODELS; }
});

export async function readOpenaiVault(): Promise<OpenaiVaultAccount[]> {
  try {
    const vault = JSON.parse(await fs.readFile(openaiVaultFile(), "utf8"));
    return Array.isArray(vault?.accounts) ? vault.accounts : [];
  } catch { return []; }
}

export async function writeOpenaiVault(accounts: OpenaiVaultAccount[]) {
  await fs.writeFile(openaiVaultFile(), JSON.stringify({ accounts }, null, 2), "utf8");
}
