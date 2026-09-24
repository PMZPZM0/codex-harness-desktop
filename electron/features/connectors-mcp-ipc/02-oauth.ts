/**
 * connectors-mcp-ipc 的「oauth」部分（09-22 从同目录 connectors-mcp-ipc.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import crypto from "node:crypto";
import http from "node:http";
import { app, ipcMain, safeStorage, session, shell } from "electron";
import { BUILTIN_CONNECTOR_TEMPLATES } from "../../features/connector-templates";
import { sendToWindow } from "../../features/window-bus";
import { spawn } from "node:child_process";
import type { ConnectorOAuthSpec, ConnectorTemplate } from "../../features/connector-templates";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { applyCustomModel, connectorEnv, connectorsFile, mcpOverrideEnabled, oauthSessions, readConnectors, readCustomModel, readMcpOverrides, refreshSkillDiscipline, safeConnectorId, writeMcpOverrides } from "../../main";
import { codexHome, server } from "../../runtime-refs";
import type { ConnectorConfig, ConnectorTransport } from "../../main";
import { writeConnectors } from "./01-prompt-enhance";
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

ipcMain.handle("connectors:oauth-start", async (_event, input: any) => {
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

ipcMain.handle("connectors:oauth-cancel", (_event, templateId: string) => {
  closeOAuthSession(String(templateId));
  return { ok: true };
});
