/**
 * openai-ipc（10-03 从 `features/model-custom-ipc/` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：openai(12)
 * 通道：openai:login-start / login-status / login-cancel / usage / set-proxy / models /
 *      capture-login / import-file / accounts / toggle-account / account-remove / account-switch
 *
 * ⛔⛔ 四条实证口径（本次纯搬迁，一字未改）：
 *   1. **登录代理的三层回退**（手填 > 进程环境变量 > 系统代理解析）：OpenAI 对部分地区/IP 直连 403，
 *      少了这层就表现为"点登录没反应"。
 *   2. **ANSI 转义码必须先剥**（Windows 控制台输出 `\x1b[36m`）—— 不剥会污染授权 URL 与验证码。
 *   3. **`openai-official` 绝不带 API Key**：官方订阅只认 ChatGPT 登录凭据，带上会 401
 *      `api_key_not_supported` → 流无限重连（实证）。
 *   4. **停用的账号永不「使用中」**：账号卡生效判据读 auth.json 的 email，只要有一处忘了清
 *      auth.json，卡片就会同时出现「使用中 + 已停用」。
 * ⛔ vault 读写已下沉到基座层 `../openai-vault`（custom-model 域的正反联动也要用）。
 * ⛔ 待接缝化（阶段 2）：spawn / fs 为宿主能力。
 */
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { codexBinaryPath } from "../codex-server";
import { OPENAI_FALLBACK_MODELS, fetchOpenaiModels, openaiAuthFile, openaiFetch, openaiProxyFile, readOpenaiAuth, resetLiveProxyCache } from "./openai-auth";
import { readCustomModels } from "../main";
import { codexHome, customModelFile, server, upsertCustomModel } from "../runtime-refs";
import { openaiJwtClaims, readOpenaiVault, writeOpenaiVault } from "../openai-vault";
import type { OpenaiVaultAccount } from "../openai-vault";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

type OpenaiLoginState = { child: { kill: () => void; exitCode: number | null } | null; lines: string[]; url: string; code: string; error: string };

function openaiImportEntries(content: string): any[] {
  const trimmed = String(content ?? "").trim();
  if (!trimmed) return [];
  const flatten = (v: any): any[] => (Array.isArray(v) ? v.flatMap(flatten) : [v]);
  try {
    return flatten(JSON.parse(trimmed));
  } catch { /* 整体不是合法 JSON → 按行拆（NDJSON / 每行一个裸 token） */ }
  const out: any[] = [];
  for (const line of trimmed.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("{") || t.startsWith("[")) {
      try { out.push(...flatten(JSON.parse(t))); continue; } catch { /* 当作裸 token 处理 */ }
    }
    out.push(t);
  }
  return out;
}

function openaiImportPick(obj: any, paths: string[][]): string {
  for (const path of paths) {
    let cur = obj;
    for (const key of path) {
      if (cur == null || typeof cur !== "object") { cur = undefined; break; }
      cur = cur[key];
    }
    const value = typeof cur === "string" ? cur.trim() : "";
    if (value) return value;
  }
  return "";
}

const OPENAI_CHANNELS = [
  "openai:login-start", "openai:login-status", "openai:login-cancel", "openai:usage", "openai:set-proxy", "openai:models",
  "openai:capture-login", "openai:import-file",
  "openai:accounts", "openai:toggle-account", "openai:account-remove", "openai:account-switch",
];

export const openaiFeature = defineFeature<null>({
  id: "openai",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("openai: 缺少 ipc 服务（宿主未提供）");

    const openaiLogin: OpenaiLoginState = { child: null, lines: [], url: "", code: "", error: "" };

    ipcHost.handle("openai:login-start", async (_e, input: { proxy?: string } = {}) => {
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

    ipcHost.handle("openai:login-status", async () => {
      const auth = await readOpenaiAuth();
      const childAlive = Boolean(openaiLogin.child && openaiLogin.child.exitCode === null);
      if (auth?.loggedIn && openaiLogin.child) { try { openaiLogin.child.kill(); } catch { /* 已退出 */ } }
      return { loggedIn: Boolean(auth?.loggedIn), email: auth?.email ?? "", url: openaiLogin.url, code: openaiLogin.code, childAlive, error: openaiLogin.error, lines: openaiLogin.lines.slice(-6).join("") };
    });

    ipcHost.handle("openai:login-cancel", async () => {
      if (openaiLogin.child) { try { openaiLogin.child.kill(); } catch { /* 已退出 */ } }
      return { ok: true };
    });

    ipcHost.handle("openai:usage", async (_e, input: { email?: string } = {}) => {
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

    ipcHost.handle("openai:set-proxy", async (_e, proxy: string) => {
      await fs.writeFile(openaiProxyFile(), JSON.stringify({ proxy: String(proxy ?? "").trim() }, null, 2), "utf8");
      resetLiveProxyCache();
      return { ok: true };
    });

    ipcHost.handle("openai:models", async () => {
      try { return (await fetchOpenaiModels()).models; } catch { return OPENAI_FALLBACK_MODELS; }
    });

    ipcHost.handle("openai:capture-login", async () => {
      // 登录检测到成功后调用：把 CODEX_HOME/auth.json 的 tokens 收进 vault（按 email 去重）
      const auth = await readOpenaiAuth();
      if (!auth?.loggedIn) throw new Error("尚未检测到登录成功的账号");
      const raw = JSON.parse(await fs.readFile(openaiAuthFile(), "utf8"));
      const accounts = await readOpenaiVault();
      const id = auth.email || auth.accountId || "account";
      const entry: OpenaiVaultAccount = { id, email: auth.email, tokens: raw.tokens, savedAt: Date.now() };
      const idx = accounts.findIndex((a) => a.id === id);
      if (idx >= 0) accounts[idx] = entry; else accounts.push(entry);
      await writeOpenaiVault(accounts);
      return { id, email: auth.email, total: accounts.length };
    });

    ipcHost.handle("openai:import-file", async (_e, input: { contents: string[] }) => {
      const contents = Array.isArray(input?.contents) ? input.contents : [];
      if (!contents.length) throw new Error("没有可导入的文件内容");
      const accounts = await readOpenaiVault();
      const items: { index: number; name: string; id?: string; email?: string; loginable?: boolean; action: "imported" | "updated" | "failed"; message?: string }[] = [];
      let index = 0;
      for (const content of contents) {
        for (const entry of openaiImportEntries(content)) {
          index += 1;
          const name = `#${index}`;
          try {
            const raw = typeof entry === "string" ? { access_token: entry } : entry;
            if (raw == null || typeof raw !== "object") throw new Error("无法识别的条目格式");
            const tokens = {
              access_token: openaiImportPick(raw, [["tokens", "access_token"], ["tokens", "accessToken"], ["access_token"], ["accessToken"], ["token"]]),
              refresh_token: openaiImportPick(raw, [["tokens", "refresh_token"], ["tokens", "refreshToken"], ["refresh_token"], ["refreshToken"]]),
              id_token: openaiImportPick(raw, [["tokens", "id_token"], ["tokens", "idToken"], ["id_token"], ["idToken"]]),
            };
            if (!tokens.access_token) throw new Error("缺少 accessToken（无法登录）");
            const claims = openaiJwtClaims(tokens.id_token || tokens.access_token);
            const auth = claims["https://api.openai.com/auth"] ?? {};
            const email = openaiImportPick(raw, [["email"], ["user", "email"]]) || String(claims.email ?? "");
            const accountId = openaiImportPick(raw, [["chatgpt_account_id"], ["chatgptAccountId"], ["account_id"], ["accountId"], ["account", "id"], ["account", "account_id"], ["account", "chatgpt_account_id"]]) || String(auth.chatgpt_account_id ?? "");
            // JWT exp 已过期只警告不阻断：refresh_token 仍在时引擎激活后会自行刷新
            let message: string | undefined;
            if (claims.exp && Number(claims.exp) * 1000 < Date.now()) message = "token 已过期（凭 refresh_token 激活后会自动刷新）";
            const id = email || accountId || String(claims.sub ?? "") || `import-${Date.now()}-${index}`;
            const entryOut: OpenaiVaultAccount = { id, email, tokens: { ...tokens, account_id: accountId || undefined }, savedAt: Date.now() };
            const idx = accounts.findIndex((a) => a.id === id);
            if (idx >= 0) accounts[idx] = entryOut; else accounts.push(entryOut);
            // loginable = 带 id_token（写 auth.json 后引擎才认作登录态）；裸 token 只入 vault 不作为切换目标
            items.push({ index, name: email || id, id, email, loginable: Boolean(tokens.id_token), action: idx >= 0 ? "updated" : "imported", message });
          } catch (error: any) {
            items.push({ index, name, action: "failed", message: String(error.message ?? error) });
          }
        }
      }
      await writeOpenaiVault(accounts);
      return {
        total: items.length,
        imported: items.filter((i) => i.action === "imported").length,
        updated: items.filter((i) => i.action === "updated").length,
        failed: items.filter((i) => i.action === "failed").length,
        items,
      };
    });

    ipcHost.handle("openai:accounts", async () => {
      const [accounts, current] = await Promise.all([readOpenaiVault(), readOpenaiAuth()]);
      return accounts.map((a) => {
        const authClaims = openaiJwtClaims(a.tokens?.id_token)?.["https://api.openai.com/auth"] ?? {};
        const disabled = Boolean((a as any).disabled);
        // ⛔ 停用的账号**永不**「使用中」（09-21 与中转站侧同一不变量）：账号卡的生效判据读 auth.json
        //    的 email，只要有一处忘了清 auth.json，卡片就会同时出现「使用中 + 已停用」。
        const active = Boolean(!disabled && current?.loggedIn && current.email && current.email === a.email);
        return {
          id: a.id,
          email: a.email,
          savedAt: a.savedAt,
          active,
          disabled,
          planType: String(authClaims.chatgpt_plan_type ?? ""),
          subscriptionUntil: String(authClaims.chatgpt_subscription_active_until ?? ""),
        };
      });
    });

    ipcHost.handle("openai:toggle-account", async (_e, input: { id: string; disabled: boolean }) => {
      const accounts = await readOpenaiVault();
      const account = accounts.find((a) => a.id === input.id);
      if (!account) throw new Error("账号不存在");
      (account as any).disabled = input.disabled || undefined;
      await writeOpenaiVault(accounts);
      if (input.disabled) {
        const current = await readOpenaiAuth();
        if (current?.loggedIn && current.email && current.email === account.email) {
          const list = await readCustomModels();
          const entry = list.find((e) => e.provider === "openai-official");
          if (entry && entry.enabled !== false) await upsertCustomModel({ ...entry, enabled: false });
          await fs.writeFile(openaiAuthFile(), "null", "utf8");
          await fs.writeFile(customModelFile, "null", "utf8");
          await server.restart();
          return { ok: true, disabled: true, deactivated: true };
        }
      }
      return { ok: true, disabled: Boolean((account as any).disabled) };
    });

    ipcHost.handle("openai:account-remove", async (_e, id: string) => {
      const accounts = (await readOpenaiVault()).filter((a) => a.id !== id);
      await writeOpenaiVault(accounts);
      return { ok: true, total: accounts.length };
    });

    ipcHost.handle("openai:account-switch", async (_e, id: string) => {
      // 切换 = 把该账号 tokens 写回 CODEX_HOME/auth.json 并重启引擎
      const account = (await readOpenaiVault()).find((a) => a.id === id);
      if (!account) throw new Error("账号不存在");
      if ((account as any).disabled) throw new Error("该账号已停用，请先在卡片上重新启用");
      await fs.writeFile(openaiAuthFile(), JSON.stringify({ OPENAI_API_KEY: null, tokens: account.tokens, last_refresh: new Date().toISOString() }, null, 2), "utf8");
      await server.restart();
      return { ok: true, email: account.email };
    });

    ctx.effect(() => {
      if (openaiLogin.child) { try { openaiLogin.child.kill(); } catch { /* 已退出 */ } }
      for (const ch of OPENAI_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
