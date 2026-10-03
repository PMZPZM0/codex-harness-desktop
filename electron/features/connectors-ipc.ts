/**
 * connectors-ipc（10-03 从 `features/connectors-mcp-ipc/` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：connectors(7)
 * 通道：connectors:list / templates / save / remove / set-enabled / oauth-start / oauth-cancel
 *
 * ⛔⛔ 三条实证口径（本次纯搬迁，一字未改）：
 *   1. **密钥一律加密落盘**（safeStorage），`publicConnector` 只回 hasSecrets 与键名 —— 明文不下发渲染层。
 *   2. **OAuth 会话必须可取消且带超时**（240s / 210s 两档）：`closeOAuthSession` 要连 timer、子进程、
 *      本地回调 server 一起收掉，漏一个就会留下占端口的僵尸进程。
 *   3. **改完必须 `applyCustomModel(model)`**；没配模型时退化为 `setExternalEnv + restart`
 *      —— 少了这步表现就是"连接器改了但引擎没生效"。
 * ⛔ `writeConnectors` / `publicConnector` 已下沉到基座层 `../connector-store`（两个域共用，
 *    不能留在任一域的内部文件里）。
 * ⛔ 待接缝化（阶段 2）：safeStorage / shell / spawn 为宿主能力。
 */
import crypto from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { safeStorage, shell } from "electron";
import { BUILTIN_CONNECTOR_TEMPLATES } from "./connector-templates";
import type { ConnectorOAuthSpec, ConnectorTemplate } from "./connector-templates";
import { sendToWindow } from "./window-bus";
import { applyCustomModel, connectorEnv, oauthSessions, readConnectors, readCustomModel, refreshSkillDiscipline, safeConnectorId } from "../main";
import type { ConnectorConfig, ConnectorTransport } from "../main";
import { codexHome, server } from "../runtime-refs";
import { publicConnector, writeConnectors } from "../connector-store";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

function sendOAuthEvent(payload: { templateId: string; phase: "waiting" | "authorized" | "failed"; message: string; authorizeUrl?: string }) {
  sendToWindow("connectors:oauth-event", payload);
}

function closeOAuthSession(templateId: string) {
  const session = oauthSessions.get(templateId);
  if (!session) return;
  clearTimeout(session.timer);
  if (session.child) try { session.child.kill(); } catch { /* ignore */ }
  if (session.server) try { session.server.close(); } catch { /* ignore */ }
  oauthSessions.delete(templateId);
}

function startCallbackServer(port: number): Promise<{ server: http.Server; waitCode: (state: string, timeoutMs: number) => Promise<{ code: string; state: string; error: string }> }> {
  return new Promise((resolve, reject) => {
    const pending = new Map<string, { resolve: (value: { code: string; state: string; error: string }) => void; timer: NodeJS.Timeout }>();
    const server = http.createServer((req, res) => {
      const parsed = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      const code = parsed.searchParams.get("code") ?? "";
      const state = parsed.searchParams.get("state") ?? "";
      const error = parsed.searchParams.get("error") ?? "";
      const waiter = pending.get(state);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      if (waiter) {
        clearTimeout(waiter.timer);
        pending.delete(state);
        if (error) {
          res.writeHead(400);
          res.end(`<h3>授权失败：${error}</h3><p>可以关闭此窗口并回到 Codex Harness。</p>`);
        } else {
          res.writeHead(200);
          res.end("<h3>✅ 授权成功</h3><p>令牌已保存，可以关闭此窗口并回到 Codex Harness。</p>");
        }
        waiter.resolve({ code, state, error });
      } else {
        res.writeHead(404);
        res.end("not found");
      }
    });
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve({
        server,
        waitCode: (waitState, timeoutMs) => new Promise((resolveWait, rejectWait) => {
          const timer = setTimeout(() => { pending.delete(waitState); rejectWait(new Error("等待授权回调超时，请重试")); }, timeoutMs);
          pending.set(waitState, { resolve: resolveWait, timer });
        }),
      });
    });
  });
}

function spawnNpx(args: string[], options: Parameters<typeof spawn>[2] = {}): ChildProcessWithoutNullStreams {
  return spawn(process.platform === "win32" ? "npx.cmd" : "npx", args, { shell: false, windowsHide: true, stdio: "pipe", ...options }) as ChildProcessWithoutNullStreams;
}

function startFeishuLogin(appId: string, appSecret: string, port: number, scopes?: string): Promise<{ authorizeUrl: string; child: ReturnType<typeof spawn> }> {
  return new Promise((resolve, reject) => {
    const args = ["-y", "@larksuiteoapi/lark-mcp", "login", "-a", appId, "-s", appSecret, "--host", "127.0.0.1", "--port", String(port)];
    if (scopes) args.push("--scope", scopes);
    const child = spawnNpx(args);
    let settled = false;
    let buffer = "";
    const timer = setTimeout(() => {
      if (!settled) { settled = true; try { child.kill(); } catch { /* ignore */ } reject(new Error("等待飞书授权地址超时，请确认 App ID/Secret 正确")); }
    }, 60000);
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const match = buffer.match(/https?:\/\/[^\s"'<>，。]+/);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ authorizeUrl: match[0], child });
      }
    });
    child.on("error", (error: Error) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`启动飞书授权进程失败：${error.message}`)); }
    });
    child.on("exit", (code) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`飞书授权进程提前退出（code=${code}），请检查 App ID/Secret 与网络`)); }
    });
  });
}

async function exchangeOAuthToken(spec: ConnectorOAuthSpec, params: Record<string, string>): Promise<any> {
  const url = spec.tokenUrl ?? "";
  const body = { ...(spec.tokenParams ?? {}), ...params };
  let response: Response;
  if (spec.tokenMethod === "POST") {
    response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } else {
    response = await fetch(`${url}?${new URLSearchParams(body)}`);
  }
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`令牌接口返回 ${response.status}：${JSON.stringify(data)}`);
  return data;
}

async function applyOAuthResult(template: ConnectorTemplate, values: Record<string, string>, secrets: Record<string, string>, accountHint?: string, argsPatch?: { remove: string[]; add: string[] }) {
  const list = await readConnectors();
  const previous = list.find((entry) => entry.id === template.id);
  const fill = (text: string) => text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? "").trim() || `{${key}}`);
  const config: ConnectorConfig = previous ?? {
    id: template.id, name: template.name, transport: template.transport,
    command: template.transport === "stdio" ? template.command : undefined,
    args: template.transport === "stdio" ? (template.args ?? []).map(fill) : undefined,
    url: template.transport === "streamable_http" ? fill(template.url ?? "") : undefined,
    env: { ...template.env },
    envHttpHeaders: template.envHttpHeaders,
    encryptedSecrets: {},
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  if (argsPatch && config.args) {
    const args = [...config.args];
    for (const token of argsPatch.remove) { const index = args.indexOf(token); if (index >= 0) args.splice(index, 1); }
    config.args = [...new Set([...args, ...argsPatch.add])];
  }
  config.encryptedSecrets = { ...(previous?.encryptedSecrets ?? {}), ...Object.fromEntries(Object.entries(secrets).map(([key, value]) => [key, safeStorage.encryptString(value).toString("base64")])) };
  config.oauth = { status: "connected", provider: template.id, authorizedAt: Date.now(), accountHint };
  config.updatedAt = new Date().toISOString();
  await writeConnectors([...list.filter((entry) => entry.id !== template.id), config]);
  const model = await readCustomModel();
  if (model) await applyCustomModel(model); else { server.setExternalEnv(connectorEnv(await readConnectors())); await server.restart(); }
}

const CONNECTORS_CHANNELS = [
  "connectors:list", "connectors:templates", "connectors:save", "connectors:remove",
  "connectors:set-enabled", "connectors:oauth-start", "connectors:oauth-cancel",
];

export const connectorsFeature = defineFeature<null>({
  id: "connectors",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("connectors: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("connectors:list", async () => (await readConnectors()).map(publicConnector));
    ipcHost.handle("connectors:templates", () => BUILTIN_CONNECTOR_TEMPLATES);
    ipcHost.handle("connectors:save", async (_event, input: any) => {
      const id = safeConnectorId(String(input.id ?? input.name ?? ""));
      const name = String(input.name ?? "").trim();
      const transport: ConnectorTransport = input.transport === "streamable_http" ? "streamable_http" : "stdio";
      if (!id || !name) throw new Error("连接器名称不能为空");
      const command = String(input.command ?? "").trim();
      const url = String(input.url ?? "").trim();
      if (transport === "stdio" && !command) throw new Error("stdio 连接器必须填写启动命令");
      if (transport === "streamable_http") {
        let parsed: URL;
        try { parsed = new URL(url); } catch { throw new Error("HTTP MCP 地址不是合法 URL"); }
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("HTTP MCP 地址必须使用 http 或 https");
      }
      const list = await readConnectors();
      const previous = list.find((entry) => entry.id === id);
      const secrets: Record<string, string> = Object.fromEntries(Object.entries(input.secrets ?? {}).map(([key, value]) => [String(key).trim(), String(value ?? "").trim()]).filter(([key, value]) => Boolean(key && value)) as [string, string][]);
      if (Object.keys(secrets).length && !safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法安全保存连接器密钥");
      const encryptedSecrets = { ...(previous?.encryptedSecrets ?? {}), ...Object.fromEntries(Object.entries(secrets).map(([key, value]) => [key, safeStorage.encryptString(value).toString("base64")])) };
      const config: ConnectorConfig = {
        id, name, transport, command: transport === "stdio" ? command : undefined,
        args: transport === "stdio" ? (Array.isArray(input.args) ? input.args.map((value: unknown) => String(value).trim()).filter(Boolean) : []) : undefined,
        url: transport === "streamable_http" ? url : undefined,
        headers: transport === "streamable_http" && input.headers && typeof input.headers === "object" ? Object.fromEntries(Object.entries(input.headers).map(([key, value]) => [String(key).trim(), String(value ?? "").trim()]).filter(([key, value]) => key && value)) : undefined,
        envHttpHeaders: transport === "streamable_http" && input.envHttpHeaders && typeof input.envHttpHeaders === "object" ? Object.fromEntries(Object.entries(input.envHttpHeaders).map(([key, value]) => [String(key).trim(), String(value ?? "").trim()]).filter(([key, value]) => key && value)) : undefined,
        env: transport === "stdio" && input.env && typeof input.env === "object" ? Object.fromEntries(Object.entries(input.env).map(([key, value]) => [String(key).trim(), String(value ?? "").trim()]).filter(([key, value]) => key && value)) : undefined,
        encryptedSecrets, enabled: input.enabled === undefined ? previous?.enabled ?? true : Boolean(input.enabled), createdAt: previous?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      await writeConnectors([...list.filter((entry) => entry.id !== id), config]);
      const model = await readCustomModel();
      if (model) await applyCustomModel(model); else { server.setExternalEnv(connectorEnv(await readConnectors())); await server.restart(); }
      void refreshSkillDiscipline();
      return publicConnector(config);
    });
    ipcHost.handle("connectors:remove", async (_event, id: string) => {
      const list = await readConnectors();
      const next = list.filter((entry) => entry.id !== id);
      if (next.length === list.length) throw new Error("未找到连接器");
      await writeConnectors(next);
      const model = await readCustomModel();
      if (model) await applyCustomModel(model); else { server.setExternalEnv(connectorEnv(next)); await server.restart(); }
      void refreshSkillDiscipline();
      return { ok: true };
    });
    ipcHost.handle("connectors:set-enabled", async (_event, input: { ids?: unknown; enabled?: unknown }) => {
      const ids = Array.isArray(input.ids)
        ? input.ids.map((value) => String(value ?? "").trim()).filter(Boolean)
        : [];
      if (!ids.length) throw new Error("未指定要更新状态的连接器");
      const enabled = input.enabled !== false;
      const list = await readConnectors();
      let updated = 0;
      const next = list.map((entry) => {
        if (!ids.includes(entry.id) || entry.enabled === enabled) return entry;
        updated += 1;
        return { ...entry, enabled, updatedAt: new Date().toISOString() };
      });
      if (!updated) return { ok: true, updated: 0 };
      await writeConnectors(next);
      const model = await readCustomModel();
      if (model) await applyCustomModel(model); else { server.setExternalEnv(connectorEnv(next)); await server.restart(); }
      void refreshSkillDiscipline();
      return { ok: true, updated };
    });
    ipcHost.handle("connectors:oauth-start", async (_event, input: any) => {
      const templateId = String(input?.templateId ?? "");
      const template = BUILTIN_CONNECTOR_TEMPLATES.find((entry) => entry.id === templateId);
      if (!template?.oauth) throw new Error("该模板不支持 OAuth 授权");
      const values: Record<string, string> = input?.values ?? {};
      const spec = template.oauth;
      const missing = spec.credentialKeys.filter((key) => !String(values[key] ?? "").trim());
      if (missing.length) {
        const labels = missing.map((key) => template.fields.find((field) => field.key === key)?.label ?? key).join("、");
        throw new Error(`请先填写：${labels}`);
      }
      closeOAuthSession(templateId);
      try {
        if (spec.kind === "lark-login") {
          const port = spec.port;
          const { authorizeUrl, child } = await startFeishuLogin(String(values[spec.credentialKeys[0]]).trim(), String(values[spec.credentialKeys[1]]).trim(), port, spec.scopes);
          oauthSessions.set(templateId, { kind: "lark-login", child, timer: setTimeout(() => { closeOAuthSession(templateId); sendOAuthEvent({ templateId, phase: "failed", message: "授权超时，已取消" }); }, 240000), state: "" });
          sendOAuthEvent({ templateId, phase: "waiting", message: "已在浏览器打开飞书授权页，请登录并点击授权", authorizeUrl });
          void shell.openExternal(authorizeUrl);
          child.once("exit", (code) => {
            closeOAuthSession(templateId);
            if (code === 0) {
              void applyOAuthResult(template, values, {}, undefined, { remove: ["--token-mode", "tenant_access_token"], add: ["--oauth", "--token-mode", "user_access_token"] })
                .then(() => sendOAuthEvent({ templateId, phase: "authorized", message: "飞书授权成功，已保存用户令牌并重启引擎" }))
                .catch((error: Error) => sendOAuthEvent({ templateId, phase: "failed", message: `授权成功但保存失败：${error.message}` }));
            } else {
              sendOAuthEvent({ templateId, phase: "failed", message: `飞书授权未完成（进程退出码 ${code}），请重试` });
            }
          });
          return { ok: true, authorizeUrl };
        }
        // http-code：钉钉 / 腾讯文档 —— 本地回调收 code，再换 token
        const port = spec.port;
        const redirectUri = String(values.redirect_uri ?? "").trim() || spec.redirectUri || `http://127.0.0.1:${port}/callback`;
        const state = crypto.randomBytes(8).toString("hex");
        const { server, waitCode } = await startCallbackServer(port);
        oauthSessions.set(templateId, { kind: "http-code", server, timer: setTimeout(() => { closeOAuthSession(templateId); sendOAuthEvent({ templateId, phase: "failed", message: "等待授权超时，已取消" }); }, 240000), state });
        const clientId = String(values[spec.credentialKeys[0]]).trim();
        const clientSecret = String(values[spec.credentialKeys[1]]).trim();
        const authorizeUrl = (spec.authorizeUrl ?? "")
          .replace("{client_id}", encodeURIComponent(clientId))
          .replace("{redirect_uri}", encodeURIComponent(redirectUri))
          .replace("{state}", state);
        sendOAuthEvent({ templateId, phase: "waiting", message: `${template.name}：请在浏览器完成授权`, authorizeUrl });
        void shell.openExternal(authorizeUrl);
        const { code, error } = await waitCode(state, 210000);
        if (error) throw new Error(`${template.name}授权失败：${error}`);
        const tokenData = await exchangeOAuthToken(spec, { client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code });
        const map = spec.tokenResult ?? { accessToken: "access_token" };
        const accessToken = tokenData[map.accessToken] ?? "";
        if (!accessToken) throw new Error(`令牌接口未返回访问令牌：${JSON.stringify(tokenData)}`);
        const refreshToken = map.refreshToken ? tokenData[map.refreshToken] ?? "" : "";
        const userId = map.userId ? tokenData[map.userId] ?? "" : "";
        const prefix = template.id.toUpperCase().replace("-", "_");
        const secrets: Record<string, string> = { [`${prefix}_OAUTH_TOKEN`]: accessToken };
        if (refreshToken) secrets[`${prefix}_OAUTH_REFRESH`] = refreshToken;
        const accountHint = userId
          ? (template.id === "tencent-docs" ? `OpenID ${userId.slice(0, 8)}…` : `用户 ${userId.slice(0, 8)}…`)
          : template.id === "dingtalk" ? (tokenData.nick ?? tokenData.nickName ?? "") : "";
        await applyOAuthResult(template, values, secrets, accountHint || undefined);
        closeOAuthSession(templateId);
        sendOAuthEvent({ templateId, phase: "authorized", message: `${template.name}授权成功，用户令牌已加密保存` });
        return { ok: true, authorizeUrl };
      } catch (error: any) {
        closeOAuthSession(templateId);
        sendOAuthEvent({ templateId, phase: "failed", message: error.message });
        return { ok: false, message: error.message };
      }
    });
    ipcHost.handle("connectors:oauth-cancel", (_event, templateId: string) => {
      closeOAuthSession(String(templateId));
      return { ok: true };
    });

    ctx.effect(() => {
      for (const ch of CONNECTORS_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
