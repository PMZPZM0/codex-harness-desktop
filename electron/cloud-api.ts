/**
 * cloud-api（基座层，10-16）—— 云账号服务接入的**唯一**入口。
 *
 * 定位（判据 `docs/ARCHITECTURE-RULES.md` §1.1）：不注册任何 IPC 通道、只给别的域用的基础设施 ⇒
 * **基座层**，放 `electron/` 根、不进 `features/`。四个云域（`cloud-auth` / `cloud-models` /
 * `cloud-kb` / `cloud-memory`）全部经它取凭据、发请求 —— ⛔ **全仓只有这一份** accountsBase 与令牌读写。
 *
 * ⛔⛔ 为什么必须单源：接入前的现实是**同一件事有两份实现** ——
 *   · `accountsBase()` 在 `limited-benefit-ipc.ts` 与 `headless.ts` 各解析一次（文件里自己标注
 *     「改一处必须改另一处」）；
 *   · `cloudHome()` 有两种口径（`app.getPath("home")/Codex Assistant` vs `os.homedir()/.codex-harness-cloud`）
 *     ⇒ 只有设了 `HARNESS_CLOUD_HOME` 才一致，否则同机两个域读两个目录。
 *   两份判定必然漂移，而漂移的表现是「界面上明明登录了，另一个面板说没登录」。收敛到本文件。
 *
 * ⛔ 令牌一律 safeStorage 加密后落盘；加密能力不可用时**拒绝存储**（宁可让用户重新登录，也不写明文）。
 *   与 `features/connectors-ipc.ts` 的既有口径一致（它同样拒绝明文写密钥）。
 *
 * ⛔ 模块顶层**不求值** `app.getPath`（【91】）：域模块体先于壳的 `app.setPath("userData")` 执行，
 *   顶层求值拿到的是默认目录 ⇒ 路径静默漂移。本文件所有路径一律在函数体内惰性求值。
 */
import os from "node:os";
import { app, net, safeStorage } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** 云账号服务基址默认值。可用 `HARNESS_ACCOUNTS_BASE` 覆盖（自建部署）。 */
export const DEFAULT_ACCOUNTS_BASE = "https://ppz123.asia/cloud-api";

/** 服务端**自报**的对外基址（登录回包里的 server.baseUrl）。
 *  ⛔ 只用于**显示**（cloud-auth:status 的 defaultBaseUrl）—— 让界面别把编译期常量当固定事实。
 *  ⛔⛔ **不参与地址解析**：accountsBase() 仍按「环境变量 → 账号记录 → 常量」，
 *     否则一次自报就能把连接地址悄悄改掉（安全与可排障性都会崩）。换地址请显式重登。 */
let serverReportedBase = "";
export function rememberServerBase(input: unknown): void {
  const v = String((input as { baseUrl?: unknown })?.baseUrl ?? "").trim();
  if (/^https?:\/\//i.test(v)) serverReportedBase = v.replace(/\/+$/, "");
}
export function serverBaseUrl(): string {
  return serverReportedBase;
}

/** 一条已登录的云账号。`encryptedToken` 加密落盘，⛔ 明文只在 login 那一跳的内存里存在。 */
export type CloudAccount = {
  id: string;
  username: string;
  role: string;
  baseUrl: string;
  encryptedToken: string;
  savedAt: number;
};

export type CloudAuthState = { activeId: string; accounts: CloudAccount[] };

/** 对外视图：⛔ 不含任何令牌（只给"有没有"），供渲染层展示账号列表用。 */
export type CloudAccountView = {
  id: string;
  username: string;
  role: string;
  baseUrl: string;
  active: boolean;
  savedAt: number;
};

/** 当前生效凭据：调用云端接口时带它。 */
export type CloudCredential = { account: CloudAccount; token: string; baseUrl: string };

/** 云配置目录。⛔ 惰性求值（见文件头）。 */
export function cloudHome(): string {
  const fromEnv = String(process.env.HARNESS_CLOUD_HOME || "").trim();
  return fromEnv || path.join(app.getPath("userData"), "cloud");
}

/** 账号库文件（多账号 + 当前生效 id 一份文件，避免两个文件互相错位）。 */
export function authFile(): string {
  return path.join(cloudHome(), "auth.json");
}

/** 账号服务基址：env > 账号库里最近一次登录用的 > 默认。⛔ 单源，别在别处再解析一份。 */
export function accountsBase(): string {
  const fromEnv = String(process.env.HARNESS_ACCOUNTS_BASE || "").trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const state = readAuthState();
  const hit = state.accounts.find((a) => a.id === state.activeId) || state.accounts[0];
  if (hit?.baseUrl) return hit.baseUrl.replace(/\/+$/, "");
  return DEFAULT_ACCOUNTS_BASE;
}

function emptyState(): CloudAuthState {
  return { activeId: "", accounts: [] };
}

/** 读账号库。文件缺失/损坏/结构不对一律按空处理（⛔ 不抛：它在每次请求前都会跑）。 */
export function readAuthState(): CloudAuthState {
  try {
    const raw = JSON.parse(fs.readFileSync(authFile(), "utf8")) as CloudAuthState;
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.accounts)) return emptyState();
    return { activeId: String(raw.activeId || ""), accounts: raw.accounts.filter((a) => a && a.id) };
  } catch {
    return emptyState();
  }
}

/** 账号库目录权限 0700、文件 0600（内有加密凭据）。 */
function writeAuthState(state: CloudAuthState): void {
  const dir = cloudHome();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(authFile(), JSON.stringify(state, null, 2), { mode: 0o600 });
}

function encryptSecret(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) return "";
  return safeStorage.encryptString(value).toString("base64");
}

function decryptSecret(value: string | undefined): string {
  if (!value || !safeStorage.isEncryptionAvailable()) return "";
  try {
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  } catch {
    return "";
  }
}

export function encrypt(value: string): string {
  return encryptSecret(value);
}

export function decrypt(value: string | undefined): string {
  return decryptSecret(value);
}

/** 当前生效凭据；未登录 / 令牌读不出（换过机器密钥、加密不可用）时返回 null。 */
export function activeCredential(): CloudCredential | null {
  const state = readAuthState();
  const account = state.accounts.find((a) => a.id === state.activeId);
  if (!account) return null;
  const token = decryptSecret(account.encryptedToken);
  if (!token) return null;
  return { account, token, baseUrl: account.baseUrl };
}

export function accountViews(): CloudAccountView[] {
  const state = readAuthState();
  return state.accounts.map((a) => ({
    id: a.id,
    username: a.username,
    role: a.role,
    baseUrl: a.baseUrl,
    active: a.id === state.activeId,
    savedAt: a.savedAt,
  }));
}

export function loginState(): { loggedIn: boolean; baseUrl: string; active: CloudAccountView | null } {
  const views = accountViews();
  const active = views.find((v) => v.active) || null;
  return { loggedIn: Boolean(active), baseUrl: accountsBase(), active };
}

/** 退出：删指定账号（缺省 = 当前生效那个）。返回是否真的删了。 */
export function forgetAccount(id?: string): boolean {
  const state = readAuthState();
  const target = String(id || state.activeId || "");
  if (!target) return false;
  const next = state.accounts.filter((a) => a.id !== target);
  if (next.length === state.accounts.length) return false;
  const activeId = target === state.activeId ? (next[0]?.id ?? "") : state.activeId;
  writeAuthState({ activeId, accounts: next });
  return true;
}

/** 切换生效账号。返回是否切成功（不存在 / 已是它 都算失败）。 */
export function switchAccount(id: string): boolean {
  const state = readAuthState();
  if (!state.accounts.some((a) => a.id === id)) return false;
  if (state.activeId === id) return false;
  writeAuthState({ ...state, activeId: id });
  return true;
}

export type LoginResult = { ok: boolean; account?: CloudAccountView; error?: string };

/** 服务端 `POST /login` 的回执。
 *  ⛔ `server.baseUrl` = 服务端**自报**的对外基址（由反代头推出来）—— 界面上"服务地址"显示它，
 *     而不是把编译期常量当固定事实。⛔ 它只用于显示，不参与地址解析（见 rememberServerBase）。 */
type LoginReply = { ok?: boolean; token?: string; account?: { username?: string; role?: string }; server?: { baseUrl?: string }; error?: string };

/**
 * 账号密码登录云账号服务。
 *
 * ⛔ 走的是 `/login`（账号密码），**不是**配对流程：服务端 `accountWho()` 同时认「网页会话令牌」
 *   与「设备令牌」，两者都从 `Authorization: Bearer` 进 ⇒ 登录拿到的 token 可直接当 Bearer 用。
 *   配对（`/pair-ticket`）是给"没有登录会话的壳"准备的，桌面版不需要。
 *
 * ⛔ 同用户名重复登录 = **原地更新**那条记录（不新增），避免账号列表越登越长。
 */
export async function login(baseUrlRaw: string, usernameRaw: string, password: string): Promise<LoginResult> {
  const baseUrl = (String(baseUrlRaw || "").trim() || DEFAULT_ACCOUNTS_BASE).replace(/\/+$/, "");
  const username = String(usernameRaw || "").trim();
  if (!username || !password) return { ok: false, error: "请填写账号与密码" };

  let payload: LoginReply | null = null;
  let status = 0;
  try {
    const res = await net.fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      /* ⛔ 10-18 设备管理：登录必须上报本机标识 —— 否则云端「已配对设备」永远是 0
         （服务端 registerLoginDevice 靠 machineId 去重，缺了就记不上）。
         machineId 取 hostname + userData 路径的哈希：同机稳定、不同机不撞。 */
      body: JSON.stringify({
        username,
        password,
        machineId: (() => { try { return crypto.createHash("sha256").update(os.hostname() + "|" + app.getPath("userData")).digest("hex").slice(0, 32); } catch { return ""; } })(),
        machineName: (() => { try { return os.hostname().slice(0, 32); } catch { return ""; } })(),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    status = res.status;
    payload = (await res.json().catch(() => null)) as LoginReply | null;
  } catch (error) {
    return { ok: false, error: `连不上账号服务：${(error as Error).message.slice(0, 80)}` };
  }
  rememberServerBase(payload?.server);
  const token = String(payload?.token || "");
  if (!payload?.ok || !token) {
    return { ok: false, error: payload?.error || `登录失败（HTTP ${status}）` };
  }
  const encryptedToken = encryptSecret(token);
  if (!encryptedToken) return { ok: false, error: "系统安全存储不可用，无法保存登录凭据" };

  const state = readAuthState();
  const existing = state.accounts.find((a) => a.username === username && a.baseUrl === baseUrl);
  const row: CloudAccount = {
    id: existing?.id || crypto.randomUUID(),
    username: payload.account?.username || username,
    role: String(payload.account?.role || "user"),
    baseUrl,
    encryptedToken,
    savedAt: Date.now(),
  };
  const accounts = existing
    ? state.accounts.map((a) => (a.id === existing.id ? row : a))
    : [...state.accounts, row];
  writeAuthState({ activeId: row.id, accounts });
  return {
    ok: true,
    account: { id: row.id, username: row.username, role: row.role, baseUrl: row.baseUrl, active: true, savedAt: row.savedAt },
  };
}

export type CloudResponse<T> = { ok: boolean; status: number; data: T | null; error?: string };

/**
 * 账号服务 `GET /integrations` 的回执形状（知识库 / 记忆两个域共用，故放基座单源）。
 *
 * 语义（服务端实证）：**权益未开通时不建库、不发钥匙**，直接把对应字段填成
 * `{ ok: false, error: "not-activated" }`；开通后才回真凭据。
 *   · knowledge → WeKnora：`mcpUrl`（`https://kb.ppz123.asia/mcp/<endpointId>`）+ `mcpToken` ⇒ **可直接当 MCP 连**
 *   · memory    → 记忆中枢：只有 REST（`baseUrl` + `userKey` + `apiKeyHeader`），**没有 MCP 端点**
 */
export type CloudIntegration = {
  ok?: boolean;
  entitlements?: { knowledge?: { enabled?: boolean }; memory?: { enabled?: boolean } };
  knowledge?: { ok?: boolean; kbId?: string; kbName?: string; mcpUrl?: string; mcpToken?: string; error?: string };
  memory?: { ok?: boolean; baseUrl?: string; userKey?: string; instanceId?: string; apiKeyHeader?: string; error?: string };
};

export async function fetchIntegrations(): Promise<CloudResponse<CloudIntegration>> {
  return cloudFetch<CloudIntegration>("/integrations");
}

/**
 * 带凭据请求云账号服务。`pathname` 以 `/` 开头（如 `/models`）。
 *
 * ⛔ 401 一律归一成 `unauthorized`：调用方据此提示"登录已过期"，**不要**把状态码原样抛给界面
 *   （用户看不懂 401，而"登录已过期"是可行动的）。
 * ⛔ 未登录时**不发请求**，直接返回 `not-logged-in` —— 否则每次轮询都会白打一次网络。
 */
export async function cloudFetch<T>(
  pathname: string,
  init: { method?: string; body?: unknown; token?: string; baseUrl?: string; timeoutMs?: number } = {},
): Promise<CloudResponse<T>> {
  const cred = activeCredential();
  const token = init.token ?? cred?.token ?? "";
  const baseUrl = (init.baseUrl ?? cred?.baseUrl ?? accountsBase()).replace(/\/+$/, "");
  if (!token) return { ok: false, status: 0, data: null, error: "not-logged-in" };
  try {
    const res = await net.fetch(`${baseUrl}${pathname}`, {
      method: init.method || "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
    });
    const data = (await res.json().catch(() => null)) as T | null;
    if (!res.ok) {
      const reason = (data as { error?: string } | null)?.error;
      return { ok: false, status: res.status, data, error: res.status === 401 ? "unauthorized" : reason || `http-${res.status}` };
    }
    return { ok: true, status: res.status, data };
  } catch (error) {
    return { ok: false, status: 0, data: null, error: `unreachable: ${(error as Error).message.slice(0, 80)}` };
  }
}
