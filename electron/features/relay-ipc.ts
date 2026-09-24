/**
 * 中转站账户域 IPC 面（14 个 handler：登录 / 多账户 / 余额套餐密钥 / 订阅支付 / keys-all）
 *
 * 09-21 架构改造：从 electron/main.ts 按域拆出。**纯搬迁，零行为改动** —— 内容与原地逐字一致
 * （仅整体缩进 2 空格；跨域符号经 deps 注入：模型域 readCustomModels/upsertCustomModel/
 * readCustomModel/customModelFile、describeNetworkError、CodexServer 单例 server）。
 * 注册时机不变：main.ts 仍在原来那一行调用 registerRelayIpc()。
 */
import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeRelayStore, pickRelayActiveId, relayProviderIdOf } from "../relay-accounts";

export interface RelayIpcDeps {
  readCustomModels: () => Promise<{ provider: string; enabled?: boolean }[]>;
  readCustomModel: () => Promise<{ provider?: string } | null>;
  // ⛔ 用 any 而非 { provider: string; enabled?: boolean }：main.ts 的实际实现是 (value: CustomModelFile) => Promise<void>，
  //    参数类型逆变 ⇒ 过窄的形参会报 TS2322。relay 域本就不该依赖模型域的内部类型（域解耦）。
  upsertCustomModel: (m: any) => Promise<unknown>;
  customModelFile: string;
  describeNetworkError: (error: unknown, what: string) => Error;
  server: { restart: () => Promise<unknown> };
}

/**
 * 模块级出口（09-21）：main.ts 的「启用/停用 relay 供应商」联动需要 account store 的读写，
 * 而 store 的文件路径与实现都在 registerRelayIpc 内部（保持与搬迁前一致的求值时机：仍是模块级调用时求值）。
 * ⇒ 这里做一对**薄包装**，registerRelayIpc 调用后即可用；未注册就调用会**明确报错**（而不是静默 undefined）。
 * ⚠️ 函数体内仍有同名的局部实现（函数声明会遮蔽模块级同名函数），内部调用走的仍是局部实现 —— 语义与搬迁前一致。
 */
let relayStoreApi: {
  read: () => Promise<any>;
  write: (store: any) => Promise<void>;
} | null = null;

export async function readRelayStore(): Promise<any> {
  if (!relayStoreApi) throw new Error("relay 域尚未注册：readRelayStore() 必须在 main.ts 的 registerRelayIpc(...) 之后调用");
  return relayStoreApi.read();
}
export async function writeRelayStore(store: any): Promise<void> {
  if (!relayStoreApi) throw new Error("relay 域尚未注册：writeRelayStore() 必须在 main.ts 的 registerRelayIpc(...) 之后调用");
  return relayStoreApi.write(store);
}

export function registerRelayIpc(deps: RelayIpcDeps) {
  const { readCustomModels, readCustomModel, upsertCustomModel, customModelFile, describeNetworkError, server } = deps;
  // —— 中转站账户（sub2api 兼容网关：登录 / 余额 / 订阅套餐 / 密钥） ——
  // 协议实证（Wei-Shaw/sub2api）：POST /api/v1/auth/login{email,password}→{access_token,refresh_token,user}；
  // GET /api/v1/user/profile→data.balance(USD)；GET /api/v1/subscriptions/summary→[{group_id,group_name,monthly_used_usd,monthly_limit_usd,expires_at}]；
  // GET /api/v1/keys→[{id,key(明文),name,group_id,quota,quota_used,status}]；POST /api/v1/keys{name,group_id?}；
  // GET /api/v1/groups/available；网关 OpenAI 兼容 = {baseUrl}/v1。
  const relayAccountFile = path.join(app.getPath("userData"), "relay-account.json");
  const relayStoreFile = path.join(app.getPath("userData"), "relay-store.json");
  type RelayAccount = {
    baseUrl: string;
    email: string;
    passwordEnc?: string; // safeStorage 加密，401 时自动重登
    accessToken?: string;
    refreshToken?: string;
    tokenExpiresAt?: number;
    selectedMode?: "balance" | "plan";
    selectedGroupId?: number | null;
    selectedKeyId?: number;
    selectedKeyName?: string;
    disabled?: boolean; // 停用 = 退出切换候选（数据保留）；当前生效账号不允许停用
  };
  type RelayStore = { activeId: string | null; accounts: (RelayAccount & { id: string })[] };
  // 多账户库：id = base|email；老的单账户 relay-account.json 首次读取时自动迁移
  async function readRelayStore(): Promise<RelayStore> {
    try {
      const parsed = JSON.parse(await fs.readFile(relayStoreFile, "utf8"));
      if (parsed && Array.isArray(parsed.accounts)) {
        // ⛔ 自愈（09-21）：activeId 指向不存在/已停用的账号 → 置空并落盘。
        // 真机事故：库里 activeId 指着一个 disabled 账号，卡片同屏显示「使用中 + 已停用 + 当前生效」，
        // 而 readRelayAccount()（余额/套餐/密钥全走它）会拿这个停用账号当生效账号用。
        const { store, changed } = normalizeRelayStore<RelayAccount & { id: string }>(parsed);
        if (changed) {
          console.warn(`[relay] 账号库自愈：activeId=${JSON.stringify((parsed as any).activeId)} 指向不存在或已停用的账号 → 置空`);
          try { await fs.writeFile(relayStoreFile, JSON.stringify(store, null, 2), "utf8"); } catch { /* 落盘失败不阻断读取 */ }
        }
        return store;
      }
    } catch { /* 首次/损坏：走迁移 */ }
    try {
      const legacy = JSON.parse(await fs.readFile(relayAccountFile, "utf8"));
      if (legacy?.baseUrl && legacy?.email) {
        const store: RelayStore = { activeId: `${relayBase(legacy.baseUrl)}|${legacy.email}`, accounts: [{ ...legacy, id: `${relayBase(legacy.baseUrl)}|${legacy.email}` }] };
        await fs.writeFile(relayStoreFile, JSON.stringify(store, null, 2), "utf8");
        return store;
      }
    } catch { /* 无旧数据 */ }
    return { activeId: null, accounts: [] };
  }
  async function writeRelayStore(store: RelayStore) {
    await fs.writeFile(relayStoreFile, JSON.stringify(store, null, 2), "utf8");
  }
  /** 当前生效账号。自愈后 activeId 必然指向可用账号，所以这里不再需要额外过滤。 */
  async function readRelayAccount(): Promise<RelayAccount | null> {
    const store = await readRelayStore();
    return store.accounts.find((a) => a.id === store.activeId) ?? null;
  }
  /** 落盘账号（含新增/更新）。`activate:false` ＝**只更新凭据，不许改 activeId**。
   *  ⛔ 401 自动重登必须传 `activate:false`：否则「打开中转站页 → relay:keys-all 给每个账号补 token」
   *    会把停用账号顶成生效账号（09-21 真机事故），顺带把引擎的模型配置也换掉。 */
  async function writeRelayAccount(account: RelayAccount & { id?: string }, options: { activate?: boolean } = {}) {
    const store = await readRelayStore();
    const id = account.id ?? `${relayBase(account.baseUrl)}|${account.email}`;
    const next = { ...account, id };
    const idx = store.accounts.findIndex((a) => a.id === id);
    if (idx >= 0) store.accounts[idx] = next; else store.accounts.push(next);
    if (options.activate !== false) store.activeId = id;
    await writeRelayStore(store);
  }
  /** 账号退出「生效」时的统一收尾（停用 / 删除 / 退出登录共用）：禁用同网关 relay 供应商；
   *  若它正是当前生效模型 → 清空并重启引擎。
   *  ⛔ 只清 store.activeId 会留下「模型配置里挂着一个用不上的供应商」，用户下一次切模型时
   *    会看到一个找不到账号对应的条目（正向/反向联动都失配）。 */
  async function deactivateRelayProvider(account: { baseUrl?: string }): Promise<void> {
    const providerId = relayProviderIdOf(account.baseUrl);
    if (!providerId) return;
    const models = await readCustomModels();
    const target = models.find((m) => m.provider === providerId);
    if (!target) return;
    if (target.enabled !== false) await upsertCustomModel({ ...target, enabled: false });
    const current = await readCustomModel();
    if (current?.provider === providerId) {
      await fs.writeFile(customModelFile, "null", "utf8");
      await server.restart();
    }
  }
  function relayBase(input: string | undefined): string {
    return String(input ?? "").trim().replace(/\/$/, "") || "https://api.pptoken.cc";
  }
  async function relayRequest(url: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: any; message?: string }> {
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(20_000), ...init });
    } catch (error) {
      throw describeNetworkError(error, "中转站请求");
    }
    const payload = await response.json().catch(() => null);
    const code = payload?.code;
    const ok = response.ok && (code === undefined || code === 0 || code === 200);
    return { ok, status: response.status, data: payload?.data ?? payload, message: payload?.message };
  }
  async function relayLoginRaw(baseUrl: string, email: string, password: string) {
    const { ok, data, message } = await relayRequest(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!ok || !data?.access_token) throw new Error("中转站登录失败：" + (message || "账号或密码不正确"));
    return data as { access_token: string; refresh_token?: string; expires_in?: number; user?: { balance?: number } };
  }
  // 认证请求：401 且本地存有加密密码时自动重登一次再重试
  async function relayAuthedFetch(account: RelayAccount, urlPath: string, body?: unknown): Promise<any> {
    const base = relayBase(account.baseUrl);
    const call = (token: string) => relayRequest(`${base}${urlPath}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let result = await call(account.accessToken ?? "");
    if (result.status === 401 && account.passwordEnc && safeStorage.isEncryptionAvailable()) {
      const password = safeStorage.decryptString(Buffer.from(account.passwordEnc, "base64"));
      const login = await relayLoginRaw(base, account.email, password);
      account.accessToken = login.access_token;
      account.refreshToken = login.refresh_token;
      account.tokenExpiresAt = login.expires_in ? Date.now() + login.expires_in * 1000 : undefined;
      // ⛔ activate:false —— 补 token 不等于「把该账号设为生效」（09-21 真机事故的根因）
      await writeRelayAccount(account, { activate: false });
      result = await call(login.access_token);
    }
    if (!result.ok) throw new Error("中转站请求失败：" + (result.message || `HTTP ${result.status}`));
    return result.data;
  }
  async function relayAsArray(data: any): Promise<any[]> {
    return Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.items) ? data.items : [];
  }
  // 登记模块级出口（供 main.ts 的「启用/停用 relay 供应商」联动使用）
  relayStoreApi = { read: readRelayStore, write: writeRelayStore };

  ipcMain.handle("relay:login", async (_e, input: { baseUrl: string; email: string; password: string }) => {
    const baseUrl = relayBase(input.baseUrl);
    const email = String(input.email ?? "").trim();
    const login = await relayLoginRaw(baseUrl, email, String(input.password ?? ""));
    const account: RelayAccount = {
      baseUrl,
      email,
      accessToken: login.access_token,
      refreshToken: login.refresh_token,
      tokenExpiresAt: login.expires_in ? Date.now() + login.expires_in * 1000 : undefined,
    };
    if (safeStorage.isEncryptionAvailable()) {
      try { account.passwordEnc = safeStorage.encryptString(String(input.password ?? "")).toString("base64"); } catch { /* 加密不可用就不存密码，401 时需重新登录 */ }
    }
    await writeRelayAccount(account);
    return { email, baseUrl, balance: Number(login.user?.balance ?? 0) };
  });
  ipcMain.handle("relay:load-account", async () => {
    const account = await readRelayAccount();
    if (!account) return null;
    return { baseUrl: account.baseUrl, email: account.email, loggedIn: Boolean(account.accessToken), selectedMode: account.selectedMode ?? null, selectedGroupId: account.selectedGroupId ?? null, selectedKeyName: account.selectedKeyName ?? null };
  });
  // ⛔ 原 `relay:logout`（无参、按 activeId 删账号）已删（09-21 账号管理优化）：它删的是**当前生效**
  //    账号，而弹窗是给**某一个**账号打开的 ⇒ 用户可能看着 A 的面板删掉 B；它也是「删除」的第二条
  //    隐藏入口（卡片上那个小图标之外没人知道）。现在语义拆清楚：删除走 `relay:remove-account(id)`
  //    （无歧义、有二次确认），「退出生效」走卡片开关（停用，数据保留）。
  ipcMain.handle("relay:accounts", async () => {
    const store = await readRelayStore();
    return store.accounts.map((a) => ({ id: a.id, baseUrl: a.baseUrl, email: a.email, loggedIn: Boolean(a.accessToken), selectedMode: a.selectedMode ?? null, selectedGroupId: a.selectedGroupId ?? null, selectedKeyName: a.selectedKeyName ?? null, active: a.id === store.activeId, disabled: Boolean(a.disabled) }));
  });
  // 账号启用/停用：停用 = 退出切换候选（数据保留，随时可重新启用）。
  // 停用**当前生效**账号时同步退出生效状态：清 activeId + 禁用其 relay 供应商（引擎侧不再可用）。
  ipcMain.handle("relay:toggle-account", async (_e, input: { id: string; disabled: boolean }) => {
    const store = await readRelayStore();
    const account = store.accounts.find((a) => a.id === input.id);
    if (!account) throw new Error("账户不存在");
    account.disabled = input.disabled || undefined;
    if (input.disabled && store.activeId === input.id) {
      // 先落盘再收尾供应商：收尾可能重启引擎，进程若在那一步出问题，账号状态也已经是「已停用」了
      store.activeId = null;
      await writeRelayStore(store);
      await deactivateRelayProvider(account);
      return { ok: true, disabled: true, deactivated: true };
    }
    await writeRelayStore(store);
    return { ok: true, disabled: Boolean(account.disabled), deactivated: false };
  });
  ipcMain.handle("relay:switch-account", async (_e, id: string) => {
    const store = await readRelayStore();
    const target = store.accounts.find((a) => a.id === id);
    if (!target) throw new Error("账户不存在");
    if (target.disabled) throw new Error("该账号已停用，请先在卡片上重新启用");
    if (!target.accessToken) throw new Error("该账号的登录凭据已失效，请重新登录后再设为当前");
    store.activeId = id;
    await writeRelayStore(store);
    return { ok: true, baseUrl: target.baseUrl, email: target.email };
  });
  ipcMain.handle("relay:remove-account", async (_e, id: string) => {
    const store = await readRelayStore();
    const target = store.accounts.find((a) => a.id === id) ?? null;
    // 没这个账号就当无事发生：**不要**顺手重挑 activeId（否则一次误调用会把别的账号悄悄变成生效）
    if (!target) return { ok: true, activeId: store.activeId, removed: false, deactivated: false };
    const wasActive = store.activeId === id;
    store.accounts = store.accounts.filter((a) => a.id !== id);
    // ⛔ 只有「删的正好是生效账号」才重挑接手者；接手者必须**可用**（停用/无凭据的账号不能当生效
    //    账号 —— 09-21 事故的第二个入口就是这里取 `accounts[0]`，正好可能取到停用账号）。
    if (wasActive) store.activeId = pickRelayActiveId(store.accounts);
    await writeRelayStore(store);
    // 删掉的是生效账号 → 同步收尾它的供应商（否则模型配置里会留一个没有账号对应的条目）
    if (wasActive) await deactivateRelayProvider(target);
    return { ok: true, activeId: store.activeId, removed: true, deactivated: wasActive };
  });
  // ⛔ `id` 可选（09-21）：管理面板要能看**被点开的那个账号**的余额/套餐/密钥。
  //    从前一律读「当前生效账号」，于是「点卡片看一眼」要么显示别人的数据、要么靠 openManage
  //    偷偷切换生效账号来对齐（用户实测报的副作用：点击管理直接生效了）。
  ipcMain.handle("relay:overview", async (_e, id?: string) => {
    const account = id ? (await readRelayStore()).accounts.find((a) => a.id === String(id)) ?? null : await readRelayAccount();
    if (!account?.accessToken) throw new Error("尚未登录中转站");
    const profile = await relayAuthedFetch(account, "/api/v1/user/profile").catch(() => null);
    // subscriptions/summary 的 data 是 {active_count,total_used_usd,subscriptions:[...]}——数组嵌在 subscriptions 字段
    const summaryRaw = await relayAuthedFetch(account, "/api/v1/subscriptions/summary").catch(() => null);
    const subscriptions = Array.isArray(summaryRaw) ? summaryRaw : Array.isArray(summaryRaw?.subscriptions) ? summaryRaw.subscriptions : relayAsArray(summaryRaw);
    const keys = await relayAuthedFetch(account, "/api/v1/keys").then(relayAsArray).catch(() => [] as any[]);
    const groups = await relayAuthedFetch(account, "/api/v1/groups/available").then(relayAsArray).catch(() => [] as any[]);
    return {
      baseUrl: account.baseUrl,
      email: account.email,
      balance: Number(profile?.balance ?? 0),
      subscriptions,
      keys,
      groups,
      selectedMode: account.selectedMode ?? null,
      selectedGroupId: account.selectedGroupId ?? null,
      selectedKeyId: account.selectedKeyId ?? null,
      selectedKeyName: account.selectedKeyName ?? null,
    };
  });
  ipcMain.handle("relay:create-key", async (_e, input: { name: string; groupId?: number | null; accountId?: string }) => {
    // accountId 可选：面板看哪个账号就把密钥建在哪个账号上（原先只能建在当前生效账号上）
    const account = input.accountId ? (await readRelayStore()).accounts.find((a) => a.id === String(input.accountId)) ?? null : await readRelayAccount();
    if (!account?.accessToken) throw new Error("尚未登录中转站");
    const body: Record<string, unknown> = { name: input.name };
    if (input.groupId != null) body.group_id = input.groupId;
    return relayAuthedFetch(account, "/api/v1/keys", body);
  });
  ipcMain.handle("relay:select", async (_e, input: { mode: "balance" | "plan"; groupId: number | null; keyId?: number; keyName?: string }) => {
    const account = await readRelayAccount();
    if (!account) throw new Error("尚未登录中转站");
    account.selectedMode = input.mode;
    account.selectedGroupId = input.groupId;
    account.selectedKeyId = input.keyId;
    account.selectedKeyName = input.keyName;
    await writeRelayAccount(account);
    return { ok: true };
  });
  // 主界面余额徽标：用 API key 直接查网关账单（无需面板 token）
  ipcMain.handle("relay:key-billing", async (_e, input: { baseUrl: string; apiKey: string }) => {
    const base = relayBase(input.baseUrl);
    const { ok, data, message } = await relayRequest(`${base}/v1/sub2api/billing`, { headers: { Authorization: `Bearer ${input.apiKey}` } });
    if (!ok) throw new Error("账单查询失败：" + (message || ""));
    return data;
  });

  // ── 付费订阅：应用内注册 → 自动登录 → 套餐目录 → 站内付款弹窗 ──
  // 协议实证（Wei-Shaw/sub2api + pptoken 实测 09-12）：
  //   POST /api/v1/auth/register {email,password,aff_code?}（站点可选用 verify_code/turnstile，
  //   未开启时三字段即可；开启时报错原文透传，渲染层降级为外部注册页）
  ipcMain.handle("relay:register", async (_e, input: { baseUrl: string; email: string; password: string; affCode?: string }) => {
    const baseUrl = relayBase(input.baseUrl);
    const email = String(input.email ?? "").trim();
    const password = String(input.password ?? "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("邮箱格式不正确");
    if (password.length < 6) throw new Error("密码至少 6 位");
    const { ok, data, message } = await relayRequest(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, ...(input.affCode ? { aff_code: input.affCode } : {}) }),
    });
    if (!ok) throw new Error("注册失败：" + (message || `HTTP ${data?.status ?? ""}`));
    // 注册成功 = 立即登录（同一套凭据），落多账号库并设为当前 —— 真正的「注册完自动登录」
    const login = await relayLoginRaw(baseUrl, email, password);
    const account: RelayAccount = {
      baseUrl,
      email,
      accessToken: login.access_token,
      refreshToken: login.refresh_token,
      tokenExpiresAt: login.expires_in ? Date.now() + login.expires_in * 1000 : undefined,
    };
    if (safeStorage.isEncryptionAvailable()) {
      try { account.passwordEnc = safeStorage.encryptString(password).toString("base64"); } catch { /* 加密不可用就不存密码 */ }
    }
    await writeRelayAccount(account);
    return { email, baseUrl, balance: Number(login.user?.balance ?? 0) };
  });
  // 套餐市场目录（站方定价/有效期/划线价/features），登录后可拉
  ipcMain.handle("relay:payment-plans", async () => {
    const account = await readRelayAccount();
    if (!account?.accessToken) throw new Error("尚未登录中转站");
    const plans = await relayAuthedFetch(account, "/api/v1/payment/plans");
    const arr = Array.isArray(plans) ? plans : Array.isArray(plans?.data) ? plans.data : [];
    return arr.filter((p: any) => p?.for_sale !== false);
  });
  // 付款页弹窗：独立窗口打开 {站点}/purchase，首帧加载后把面板 token 注入站点 localStorage
  // （sub2api 前端键名实证：auth_token / refresh_token / token_expires_at）再刷新一次 —— 打开即登录态，
  // 用户在站内完成选套餐+支付；应用侧同时轮询 subscriptions/summary 等待新订阅出现。
  let purchaseWindow: Electron.BrowserWindow | null = null;
  ipcMain.handle("relay:open-purchase", async () => {
    const account = await readRelayAccount();
    if (!account?.accessToken) throw new Error("尚未登录中转站");
    const base = relayBase(account.baseUrl);
    if (purchaseWindow && !purchaseWindow.isDestroyed()) {
      purchaseWindow.focus();
      return { ok: true, url: `${base}/purchase` };
    }
    const win = new BrowserWindow({
      width: 1120,
      height: 840,
      minWidth: 760,
      minHeight: 560,
      title: "订阅支付 · 中转站",
      autoHideMenuBar: true,
      backgroundColor: "#0d0f12",
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    purchaseWindow = win;
    let injected = false;
    win.webContents.on("did-finish-load", async () => {
      if (injected || win.isDestroyed()) return;
      injected = true;
      try {
        const script = [
          `localStorage.setItem("auth_token", ${JSON.stringify(account.accessToken ?? "")});`,
          account.refreshToken ? `localStorage.setItem("refresh_token", ${JSON.stringify(account.refreshToken)});` : "",
          `localStorage.setItem("token_expires_at", String(${account.tokenExpiresAt ?? Date.now() + 3600_000}));`,
          "true;",
        ].join(" ");
        await win.webContents.executeJavaScript(script, true);
        win.webContents.reload();
      } catch { /* 注入失败 = 用户在站内手动登录，不堵流程 */ }
    });
    win.on("closed", () => { if (purchaseWindow === win) purchaseWindow = null; });
    // loadURL 不阻塞 IPC 返回：收银台页加载慢/失败（代理、断网）不应卡死订阅流程——
    // 渲染层拿到返回值就开始轮询 summary（用户也可以在站点官网手动付款后点「我已完成支付」）
    void win.loadURL(`${base}/purchase`).catch((error: unknown) => {
      console.log("[relay-purchase] 支付页加载失败:", error instanceof Error ? error.message : String(error));
    });
    return { ok: true, url: `${base}/purchase` };
  });

  // ── 中转站多账号：全部账号的密钥（按账户分组返回，渲染层折叠展示）──
  ipcMain.handle("relay:keys-all", async () => {
    const store = await readRelayStore();
    const groups: any[] = [];
    for (const account of store.accounts) {
      try {
        const keys = await relayAuthedFetch(account, "/api/v1/keys").then(relayAsArray);
        groups.push({ id: account.id, email: account.email, baseUrl: account.baseUrl, active: account.id === store.activeId, selectedKeyId: account.selectedKeyId ?? null, keys });
      } catch (error: any) {
        groups.push({ id: account.id, email: account.email, baseUrl: account.baseUrl, active: account.id === store.activeId, selectedKeyId: account.selectedKeyId ?? null, keys: [], error: String(error.message ?? error) });
      }
    }
    return groups;
  });

}