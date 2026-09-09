import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { Client, type ClientChannel, type ConnectConfig } from "ssh2";

/**
 * SSH 服务器连接管理（harness 自持，不入 config.toml）。
 * 持久化在 userData/ssh-servers.json，跟随 app-settings.json 的既有模式。
 *
 * - 服务器列表 CRUD + 启用开关：enabled=false 只是不参与自动连接/展示为停用，配置保留。
 * - testSshConnection：真实 TCP+SSH 握手 + 采集主机指纹与远端系统信息，返回延迟与错误信息。
 * - execSshCommand：一次性命令执行（设置页「运行命令」）。
 * - SshSessionManager：交互式 shell 会话（跳板机/初始目录/登录后命令/窗口尺寸），供设置页内置终端使用。
 * - 凭据（密码/私钥/口令）明文存本机配置目录——桌面应用本地文件的安全边界与浏览器保存密码一致。
 */

/** 跳板机（ProxyJump）：先连到跳板机，再由它 forwardOut 到目标主机。 */
export type SshJumpHost = {
  host: string;
  port?: number;
  username: string;
  authType?: "password" | "key";
  password?: string;
  privateKey?: string;
  keyPath?: string;
  passphrase?: string;
};

export type SshServer = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: "password" | "key";
  password?: string;
  privateKey?: string;
  keyPath?: string;
  passphrase?: string;
  enabled: boolean;
  createdAt: string;
  /** 分组（如：生产 / 测试 / 客户） */
  group?: string;
  tags?: string[];
  notes?: string;
  favorite?: boolean;
  /** 登录后自动执行的命令（如 tmux a 或 export FOO=1） */
  startupCommand?: string;
  /** 初始工作目录（连接后先 cd 过去） */
  remotePath?: string;
  /** 心跳间隔（秒），0 或留空表示不发送 */
  keepaliveInterval?: number;
  /** 连接超时（秒） */
  connectTimeout?: number;
  /** 终端类型，默认 xterm-256color */
  termType?: string;
  jumpHost?: SshJumpHost | null;
  lastConnectedAt?: string;
  lastTestAt?: string;
  lastTestOk?: boolean;
  lastTestError?: string;
  lastTestLatencyMs?: number;
  lastFingerprint?: string;
  lastServerInfo?: SshServerInfo;
};

export type SshServerInfo = { hostname?: string; uname?: string; user?: string; uptime?: string; os?: string };

export type SshTestResult = {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  /** 主机密钥指纹，形如 SHA256:xxxx（base64） */
  fingerprint?: string;
  serverInfo?: SshServerInfo;
  /** 认证失败时服务端允许的认证方式 */
  authMethods?: string[];
};

export type SshExecResult = { ok: boolean; stdout?: string; stderr?: string; code?: number; latencyMs?: number; error?: string };

function serversFile(userData: string) {
  return path.join(userData, "ssh-servers.json");
}

/** 读盘时归一化，保证老配置（无 tags/group 等字段）也能安全用于新 UI */
function normalize(server: SshServer): SshServer {
  const tags = Array.isArray(server.tags)
    ? server.tags.filter((tag) => typeof tag === "string" && tag.trim()).map((tag) => tag.trim())
    : [];
  return {
    ...server,
    port: Number(server.port) || 22,
    authType: server.authType === "key" ? "key" : "password",
    tags,
    enabled: server.enabled !== false,
    jumpHost: server.jumpHost && server.jumpHost.host ? server.jumpHost : null,
  };
}

export async function readSshServers(userData: string): Promise<SshServer[]> {
  try {
    const raw = await fs.readFile(serversFile(userData), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SshServer[]).map(normalize) : [];
  } catch {
    return [];
  }
}

export async function writeSshServers(userData: string, servers: SshServer[]): Promise<void> {
  await fs.mkdir(userData, { recursive: true });
  await fs.writeFile(serversFile(userData), JSON.stringify(servers, null, 2), "utf8");
}

/** 保存（新增或按 id 覆盖）并返回落盘后的完整列表 */
export async function saveSshServer(userData: string, input: SshServer): Promise<SshServer[]> {
  const servers = await readSshServers(userData);
  const index = servers.findIndex((server) => server.id === input.id);
  if (index >= 0) servers[index] = normalize({ ...servers[index], ...input });
  else servers.push(normalize(input));
  await writeSshServers(userData, servers);
  return servers;
}

export async function deleteSshServer(userData: string, ids: string[]): Promise<SshServer[]> {
  const set = new Set(ids);
  const servers = (await readSshServers(userData)).filter((server) => !set.has(server.id));
  await writeSshServers(userData, servers);
  return servers;
}

export async function setSshServerEnabled(userData: string, ids: string[], enabled: boolean): Promise<SshServer[]> {
  const set = new Set(ids);
  const servers = await readSshServers(userData);
  for (const server of servers) if (set.has(server.id)) server.enabled = enabled;
  await writeSshServers(userData, servers);
  return servers;
}

/** 导出连接配置。includeSecrets=false 时剔除密码/私钥/口令，便于安全分享。 */
export function exportSshServers(servers: SshServer[], includeSecrets: boolean): string {
  const payload = servers.map((server) => {
    if (includeSecrets) return server;
    const { password, privateKey, passphrase, jumpHost, ...rest } = server;
    return {
      ...rest,
      jumpHost: jumpHost ? { host: jumpHost.host, port: jumpHost.port, username: jumpHost.username, authType: jumpHost.authType } : null,
    };
  });
  return JSON.stringify({ kind: "codex-harness-ssh", version: 1, exportedAt: new Date().toISOString(), servers: payload }, null, 2);
}

/** 导入：兼容「裸数组」与 {servers:[]} 两种形态；不信任外部 id，导入时一律新建 */
export function parseSshImport(raw: string): SshServer[] {
  const parsed = JSON.parse(raw);
  const list: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.servers) ? parsed.servers : [];
  const now = new Date().toISOString();
  return list
    .map((entry) => {
      const server = entry as Partial<SshServer>;
      return normalize({
        id: "",
        name: String(server.name ?? "").trim(),
        host: String(server.host ?? "").trim(),
        port: Number(server.port) || 22,
        username: String(server.username ?? "").trim(),
        authType: server.authType === "key" ? "key" : "password",
        password: server.password ?? "",
        privateKey: server.privateKey ?? "",
        keyPath: server.keyPath ?? "",
        passphrase: server.passphrase ?? "",
        enabled: server.enabled !== false,
        createdAt: server.createdAt || now,
        group: server.group ?? "",
        tags: server.tags ?? [],
        notes: server.notes ?? "",
        favorite: server.favorite === true,
        startupCommand: server.startupCommand ?? "",
        remotePath: server.remotePath ?? "",
        keepaliveInterval: server.keepaliveInterval,
        connectTimeout: server.connectTimeout,
        termType: server.termType ?? "",
        jumpHost: server.jumpHost ?? null,
      });
    })
    .filter((server) => server.name && server.host && server.username);
}

async function readKeyText(keyPath: string, label: string): Promise<string> {
  try {
    return await fs.readFile(keyPath, "utf8");
  } catch (error: any) {
    throw new Error(`${label}无法读取 ${keyPath}：${error.message}`);
  }
}

/** 构造认证配置；粘贴的私钥内容优先于 keyPath */
async function authConfig(input: {
  username: string;
  authType: "password" | "key";
  password?: string;
  privateKey?: string;
  keyPath?: string;
  passphrase?: string;
}) {
  if (input.authType === "password") return { username: input.username, password: input.password ?? "" };
  let key = (input.privateKey ?? "").trim();
  if (!key && input.keyPath?.trim()) key = (await readKeyText(input.keyPath.trim(), "私钥文件")).trim();
  if (!key) throw new Error("未配置私钥：请粘贴私钥内容或填写私钥文件路径");
  return { username: input.username, privateKey: key, passphrase: input.passphrase || undefined };
}

/**
 * 换算成 ssh2 connect 配置。
 * - 支持跳板机：先连跳板机再 forwardOut 到目标主机，拿到的 socket 作为 sock 传入。
 * - hostHash + hostVerifier 用于采集主机指纹（不阻断连接，等同「首次信任并记录」）。
 */
async function buildConnectConfig(
  server: SshServer,
  options: { timeoutMs: number; keepaliveMs?: number; onFingerprint?: (fingerprint: string) => void },
): Promise<{ config: ConnectConfig & Record<string, unknown>; jumpConn?: Client }> {
  const auth = await authConfig(server);
  const config: ConnectConfig & Record<string, unknown> = {
    host: server.host,
    port: Number(server.port) || 22,
    readyTimeout: options.timeoutMs,
    ...(options.keepaliveMs ? { keepaliveInterval: options.keepaliveMs, keepaliveCountMax: 3 } : {}),
    hostHash: "sha256",
    hostVerifier: (hashedKey: Buffer) => {
      const key = typeof hashedKey === "string" ? Buffer.from(hashedKey, "hex") : hashedKey;
      options.onFingerprint?.(`SHA256:${key.toString("base64").replace(/=+$/, "")}`);
      return true;
    },
  };

  let jumpConn: Client | undefined;
  const jump = server.jumpHost;
  if (jump?.host?.trim()) {
    const jumpAuth = await authConfig({
      username: jump.username,
      authType: jump.authType ?? "password",
      password: jump.password,
      privateKey: jump.privateKey,
      keyPath: jump.keyPath,
      passphrase: jump.passphrase,
    });
    jumpConn = new Client();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`跳板机 ${jump.host} 连接超时`)), options.timeoutMs + 2000);
      const done = (error?: Error) => { clearTimeout(timer); if (error) reject(error); else resolve(); };
      jumpConn!.on("ready", () => done());
      jumpConn!.on("error", (error: Error) => done(error));
      try {
        jumpConn!.connect({ host: jump.host.trim(), port: Number(jump.port) || 22, readyTimeout: options.timeoutMs, ...jumpAuth } as ConnectConfig);
      } catch (error: any) { done(error); }
    });
    const sock = await new Promise<net.Socket>((resolve, reject) => {
      jumpConn!.forwardOut("127.0.0.1", 0, server.host, Number(server.port) || 22, (error, stream) => (error ? reject(error) : resolve(stream as unknown as net.Socket)));
    });
    config.sock = sock;
  }
  return { config: { ...config, ...auth } as ConnectConfig & Record<string, unknown>, jumpConn };
}

function closeQuietly(target?: { end?: () => void } | null) {
  try { target?.end?.(); } catch { /* ignore */ }
}

function parseServerInfo(raw: string): SshServerInfo {
  const info: SshServerInfo = {};
  for (const line of raw.split("\n")) {
    const [key, ...rest] = line.split("=");
    const value = rest.join("=").trim();
    if (!value) continue;
    if (key === "hostname") info.hostname = value;
    else if (key === "uname") info.uname = value;
    else if (key === "user") info.user = value;
    else if (key === "os") info.os = value;
    else if (key === "uptime") info.uptime = value.replace(/^up\s+/, "");
  }
  return info;
}

const PROBE_COMMAND = "echo hostname=$(hostname 2>/dev/null);echo uname=$(uname -srm 2>/dev/null);echo user=$(whoami 2>/dev/null);echo os=$(cat /etc/os-release 2>/dev/null | grep '^PRETTY_NAME=' | cut -d= -f2 | tr -d '\"');echo uptime=$(uptime -p 2>/dev/null)";

/** 真实连接测试：握手 → 采集主机指纹与远端系统信息。任何一步失败都返回结构化错误，不抛异常。 */
export async function testSshConnection(server: SshServer, timeoutMs = 10000): Promise<SshTestResult> {
  if (!server.host?.trim()) return { ok: false, error: "主机地址不能为空" };
  if (!server.username?.trim()) return { ok: false, error: "用户名不能为空" };
  const started = Date.now();
  let fingerprint: string | undefined;
  let authMethods: string[] | undefined;
  let jumpConn: Client | undefined;
  let config: ConnectConfig & Record<string, unknown>;
  try {
    const built = await buildConnectConfig(server, {
      timeoutMs,
      keepaliveMs: (server.keepaliveInterval ?? 0) > 0 ? (server.keepaliveInterval as number) * 1000 : undefined,
      onFingerprint: (value) => { fingerprint = value; },
    });
    config = built.config;
    jumpConn = built.jumpConn;
  } catch (error: any) {
    return { ok: false, error: error.message };
  }
  const conn = new Client();
  // 用 authHandler 记录服务端允许的认证方式，认证失败时给出可读提示
  (config as Record<string, unknown>).authHandler = (methodsLeft: string[] | null, _partial: boolean, callback: (next: unknown) => void) => {
    if (methodsLeft) authMethods = [...methodsLeft];
    if (server.authType === "password") {
      if (!methodsLeft || methodsLeft.includes("password")) return callback({ type: "password", username: server.username, password: server.password ?? "" });
      return callback({ type: "none", username: server.username });
    }
    if (!methodsLeft || methodsLeft.includes("publickey")) callback(null); // 交给私钥自动尝试
    else callback({ type: "none", username: server.username });
  };
  return new Promise<SshTestResult>((resolve) => {
    let settled = false;
    const finish = (result: SshTestResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      closeQuietly(conn);
      closeQuietly(jumpConn);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, error: `连接超时（${Math.round(timeoutMs / 1000)} 秒无响应）`, fingerprint }), timeoutMs + 3000);
    conn.on("ready", () => {
      conn.exec(PROBE_COMMAND, (error, stream) => {
        if (error) { finish({ ok: false, error: `通道建立失败：${error.message}`, fingerprint }); return; }
        let output = "";
        stream.on("data", (chunk: Buffer) => { output += chunk.toString(); });
        stream.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
        stream.on("close", () => finish({ ok: true, latencyMs: Date.now() - started, fingerprint, serverInfo: parseServerInfo(output) }));
      });
    });
    conn.on("error", (error: Error) => {
      const message = /authentication methods failed/i.test(error.message)
        ? `认证失败${authMethods?.length ? `（服务端允许：${authMethods.join(", ")}）` : ""}`
        : error.message;
      finish({ ok: false, error: message, fingerprint, authMethods });
    });
    try { conn.connect(config as ConnectConfig); } catch (error: any) { finish({ ok: false, error: error.message }); }
  });
}

/** 一次性命令执行：设置页「运行命令」，带超时，聚合 stdout/stderr 与退出码 */
export async function execSshCommand(server: SshServer, command: string, timeoutMs = 30000): Promise<SshExecResult> {
  if (!command.trim()) return { ok: false, error: "命令不能为空" };
  const started = Date.now();
  let jumpConn: Client | undefined;
  let config: ConnectConfig & Record<string, unknown>;
  try {
    const built = await buildConnectConfig(server, { timeoutMs: Math.min(timeoutMs, 15000) });
    config = built.config;
    jumpConn = built.jumpConn;
  } catch (error: any) {
    return { ok: false, error: error.message };
  }
  const conn = new Client();
  return new Promise<SshExecResult>((resolve) => {
    let settled = false;
    const finish = (result: SshExecResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      closeQuietly(conn);
      closeQuietly(jumpConn);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, error: `执行超时（${Math.round(timeoutMs / 1000)} 秒）` }), timeoutMs + 2000);
    conn.on("ready", () => {
      conn.exec(command, (error, stream) => {
        if (error) { finish({ ok: false, error: error.message }); return; }
        let stdout = "";
        let stderr = "";
        stream.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
        stream.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
        stream.on("close", (code: number) => finish({ ok: (code ?? 0) === 0, code: code ?? 0, stdout, stderr, latencyMs: Date.now() - started }));
      });
    });
    conn.on("error", (error: Error) => finish({ ok: false, error: error.message }));
    try { conn.connect(config as ConnectConfig); } catch (error: any) { finish({ ok: false, error: error.message }); }
  });
}

type ShellOptions = {
  cols: number;
  rows: number;
  onData: (data: string) => void;
  onExit: (info: { code?: number; signal?: string; error?: string }) => void;
};

class SshSession {
  private jump?: Client;
  private stream?: ClientChannel;
  alive = false;

  constructor(private conn: Client, jump?: Client) {
    this.jump = jump;
  }

  attach(stream: ClientChannel) {
    this.stream = stream;
    this.alive = true;
  }

  write(data: string) {
    try { this.stream?.write(data); } catch { /* 已断开 */ }
  }

  resize(cols: number, rows: number) {
    // 像素尺寸传 0：ssh2 只用它做窗口变更通知，字符行列才是终端真正关心的
    try { this.stream?.setWindow(rows, cols, 0, 0); } catch { /* 已断开 */ }
  }

  close() {
    this.alive = false;
    closeQuietly(this.stream as unknown as { end?: () => void } | undefined);
    closeQuietly(this.conn as unknown as { end?: () => void });
    closeQuietly(this.jump as unknown as { end?: () => void } | undefined);
  }
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * 交互式 shell 会话管理。每个会话一个 id，数据通过回调推送（main.ts 里转 sendToWindow）。
 * 会话生命周期由调用方控制：关闭终端或退出应用时必须 closeAll()，否则 ssh2 连接会挂住进程。
 */
export class SshSessionManager {
  private sessions = new Map<string, SshSession>();

  async open(server: SshServer, options: ShellOptions): Promise<{ sessionId: string }> {
    const sessionId = `ssh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timeoutMs = (server.connectTimeout && server.connectTimeout > 0 ? server.connectTimeout : 15) * 1000;
    const { config, jumpConn } = await buildConnectConfig(server, {
      timeoutMs,
      keepaliveMs: (server.keepaliveInterval ?? 0) > 0 ? (server.keepaliveInterval as number) * 1000 : 30000,
    });
    const conn = new Client();
    const session = new SshSession(conn, jumpConn);
    this.sessions.set(sessionId, session);

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`连接超时（${Math.round(timeoutMs / 1000)} 秒无响应）`)), timeoutMs + 3000);
        conn.on("ready", () => { clearTimeout(timer); resolve(); });
        conn.on("error", (error: Error) => { clearTimeout(timer); reject(error); });
        try { conn.connect(config as ConnectConfig); } catch (error: any) { clearTimeout(timer); reject(error); }
      });
      const shellCommand = [server.remotePath?.trim() ? `cd ${shellQuote(server.remotePath.trim())}` : "", server.startupCommand?.trim() || ""]
        .filter(Boolean)
        .join(" && ");
      await new Promise<void>((resolve, reject) => {
        conn.shell({ term: server.termType?.trim() || "xterm-256color", cols: options.cols, rows: options.rows }, (error, stream) => {
          if (error) { reject(error); return; }
          session.attach(stream);
          stream.on("data", (chunk: Buffer) => options.onData(chunk.toString()));
          stream.stderr?.on("data", (chunk: Buffer) => options.onData(chunk.toString()));
          stream.on("close", () => {
            session.alive = false;
            this.sessions.delete(sessionId);
            options.onExit({ code: 0 });
          });
          if (shellCommand) setTimeout(() => session.write(`${shellCommand}\n`), 120);
          resolve();
        });
      });
    } catch (error) {
      session.close();
      this.sessions.delete(sessionId);
      throw error;
    }
    return { sessionId };
  }

  write(sessionId: string, data: string) {
    this.sessions.get(sessionId)?.write(data);
  }

  resize(sessionId: string, cols: number, rows: number) {
    this.sessions.get(sessionId)?.resize(cols, rows);
  }

  close(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.close();
    this.sessions.delete(sessionId);
  }

  closeAll() {
    for (const session of this.sessions.values()) session.close();
    this.sessions.clear();
  }

  get size() {
    return this.sessions.size;
  }
}
