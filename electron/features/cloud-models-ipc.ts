/**
 * cloud-models（域，10-16）—— 登录后把**云端模型目录**同步成本机供应商，并保持更新。
 *
 * 三段职责，都在这一处：
 *   ① catalog：带凭据拉服务端 `/models`（含逐模型勾选状态 `enabled` 与积分倍率 `credits`）
 *   ② token：取本用户的**代理令牌**（`/proxy/token`，明文仅此一次）→ safeStorage 加密后缓存
 *   ③ sync：把目录写成本机供应商行（委托基座 `../cloud-provider`，⛔ 本域不自己碰档案）
 *
 * 「保持更新」的触发（**全部收敛到 syncModels 一个入口**，别在多处各写一份）：
 *   · 定时轮询（默认 10 分钟，`HARNESS_CLOUD_SYNC_MINUTES` 可调）
 *   · `cloud-models:sync` 手动刷新（`force` 会重签代理令牌）
 *   · `cloud-models:set-enabled` 勾选落盘之后立即拉一次
 *   ⛔ 幂等：没变化不写盘（判据在 `../cloud-provider` 的 shapeOf）。
 *
 * ⛔ 令牌会轮换（重签 / 换绑 / 服务端清记录）。判"要不要重写 Key"必须比**令牌串**，
 *   不能只看"行里有没有 key" —— 否则本机静默 401、界面还显示"已安全保存"（10-14 实测）。
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { accountsBase, cloudFetch, cloudHome, decrypt, encrypt, loginState } from "../cloud-api";
import { issueProxyToken, readProxyToken, verifyProxyToken } from "../cloud-token";
import { healCloudAccess } from "../cloud-heal";
import { probeCustomModel } from "./custom-model-probe";
import { applyCloudProvider, activateCloudProvider, isCloudActive, readCloudProviderRow, readMemoryUpstream, refreshMemoryUpstreamFromIntegrations, type CloudCatalogModel, CLOUD_PROVIDER_ID, repairCloudProviderProtocol, refreshEngineProviders } from "../cloud-provider";

/** 域内 IPC 通道。 */
const CHANNELS = [
  "cloud-models:catalog",
  "cloud-models:sync",
  "cloud-models:token",
  "cloud-models:set-enabled",
  "cloud-models:activate",
  "cloud-models:status",
  "cloud-models:test",
];

/** 轮询间隔（分钟）。⛔ 只是"保持更新"的下限，任何手动动作都会立刻触发一次同步。 */
const DEFAULT_INTERVAL_MINUTES = 10;

/** 服务端 `/models` 回执。 */
type CatalogReply = {
  ok?: boolean;
  provider?: { id?: string; name?: string; baseUrl?: string; ready?: boolean; hasProxyToken?: boolean; proxyTokenPrefix?: string; proxyTokenAt?: number };
  models?: CloudCatalogModel[];
  error?: string;
};

type SyncReply = { ok: boolean; models: number; changed: boolean; promoted: boolean; error?: string };

/** `cloud-models:test` 的结构化回执（渲染层据此决定「保存重启」还是「重签」）。 */
export type CloudTestReply = {
  ok: boolean;
  code?: "not-logged-in" | "no-provider" | "no-model" | "no-token" | "unreachable" | "heal-failed" | "still-failing";
  error?: string;
  /** 自愈前的原始错误（诊断用）。 */
  originalError?: string;
  /** 本次是否真的重签过（true ⇒ 必须重启引擎/应用才生效）。 */
  healed?: boolean;
  model?: string;
  status?: number;
  latencyMs?: number;
  models?: number;
};

let lastSyncAt = 0;

/** 上次同步时刻的落盘（`cloudHome()/sync-state.json`）。
 *  ⛔ 必须落盘：这个值只在进程内存里的话，重启后界面会显示「上次同步 从未」——
 *    而供应商行明明写着「已注册」，两处对不上（用户会以为从没同步成功过）。 */
function syncStateFile(): string {
  return path.join(cloudHome(), "sync-state.json");
}

function readLastSyncAt(): number {
  if (lastSyncAt) return lastSyncAt;
  try {
    const raw = JSON.parse(fs.readFileSync(syncStateFile(), "utf8")) as { lastSyncAt?: number };
    lastSyncAt = Number(raw?.lastSyncAt || 0);
  } catch { /* 首次运行 */ }
  return lastSyncAt;
}

function writeLastSyncAt(at: number): void {
  lastSyncAt = at;
  try {
    fs.mkdirSync(cloudHome(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(syncStateFile(), JSON.stringify({ lastSyncAt: at }), { mode: 0o600 });
  } catch { /* 落盘失败不影响本次同步 */ }
}

async function fetchCatalog(): Promise<{ ok: boolean; data: CatalogReply | null; error?: string }> {
  const res = await cloudFetch<CatalogReply>("/models");
  if (!res.ok || !res.data?.ok) return { ok: false, data: res.data, error: res.error || "catalog-failed" };
  return { ok: true, data: res.data };
}

/** 同步一次：拉目录 → 确保有代理令牌 → 写本机供应商行。 */
async function syncModels(force: boolean): Promise<SyncReply> {
  if (!loginState().loggedIn) return { ok: false, models: 0, changed: false, promoted: false, error: "not-logged-in" };
  const catalog = await fetchCatalog();
  if (!catalog.ok || !catalog.data) {
    return { ok: false, models: 0, changed: false, promoted: false, error: catalog.error };
  }
  /* ⛔⛔ 10-19（清单 2/4）：非强制路径**不再盲信** `hasProxyToken` ——
     ① 服务端回了令牌前缀且与本机缓存对不上 ⇒ 已被轮换（多设备重签），直接重签；
     ② 否则做一次轻量校验（`GET /proxy/models`）：401/403 ⇒ 本机这把已经失效，重签；
        网络异常按有效处理（临时断网不该把用户的 key 换掉）。
     令牌环只保留 3 枚（服务端 `PROXY_TOKEN_RING`）⇒ 多设备各签几次就会把旧串挤出去。 */
  const cachedToken = readProxyToken();
  let needToken = force || !catalog.data.provider?.hasProxyToken;
  if (!needToken) {
    const prefix = String(catalog.data.provider?.proxyTokenPrefix || "");
    if (!cachedToken) needToken = true;
    else if (prefix && cachedToken.slice(0, 12) !== prefix) needToken = true;
    else if (!(await verifyProxyToken(cachedToken))) needToken = true;
  }
  const token = await issueProxyToken(needToken);
  const applied = await applyCloudProvider(catalog.data.models ?? [], {
    baseUrl: accountsBase(),
    encryptedKey: token.ok ? encrypt(token.token) : "",
  });
  /* ⛔ 清单 5（10-19）：「重签」必须**同时刷新记忆上游的 userKey** —— 只换代理令牌不会更新它，
     用户开了云端记忆时表现就是「点了重签还是 401」。记忆未开启/已停用时这里是无操作。 */
  if (needToken && !token.reused && (await readMemoryUpstream())) {
    await refreshMemoryUpstreamFromIntegrations();
  }
  writeLastSyncAt(Date.now());
  return { ok: true, ...applied };
}

/** 选一个可测的模型：行里当前选中的优先，否则取第一个仍启用的。 */
function pickTestModel(row: { model?: string; models?: Array<{ id: string; enabled?: boolean }> }): string {
  const current = String(row.model || "").trim();
  if (current && (row.models ?? []).some((m) => m.id === current && m.enabled !== false)) return current;
  return String((row.models ?? []).find((m) => m.enabled !== false)?.id || current || "");
}

/**
 * 云端模型连通测试（10-19）—— 与「模型供应商 → 测试当前供应商」同一套探活核心，
 * 但探的是**引擎实际会用的那条路**（本地桥 + 云供应商行当前的 baseUrl/key）。
 *
 * 闭环：
 *   ① 直接探活；成功 ⇒ ok（渲染层提示保存并重启）。
 *   ② 401/403 ⇒ `healCloudAccess()`（强制重签 + 写回行 + 刷新记忆 userKey）→ **重探一次**。
 *   ③ 仍失败 / 网络异常 ⇒ 如实回执，不再连环重签（避免把同账号其它设备挤出令牌环）。
 * `forceHeal=true` 是界面上的「重签密钥并重试」按钮：先重签再探，一次一条路径。
 *
 * ⛔ 探测对象必须是**行里的合成上游**：记忆开启时它是 memapi + 记忆 userKey，
 *   不是代理令牌 —— 只测纯模型通道会得出「测试通过、对话 401」的假绿。
 */
async function testCloudModels(forceHeal: boolean): Promise<CloudTestReply> {
  if (!loginState().loggedIn) return { ok: false, code: "not-logged-in", error: "未登录云账号" };
  let row = await readCloudProviderRow();
  if (!row) return { ok: false, code: "no-provider", error: "云端模型尚未注册 —— 先点「立即同步模型」" };
  if (!pickTestModel(row)) return { ok: false, code: "no-model", error: "云端没有可用模型 —— 先在云端勾选并同步" };

  let healed = false;
  if (forceHeal) {
    const heal = await healCloudAccess();
    if (!heal.ok) return { ok: false, code: "heal-failed", error: heal.error || "token-failed", healed: false };
    healed = true;
    row = (await readCloudProviderRow()) ?? row;
  }

  const attempt = async (): Promise<{ model: string; result: Awaited<ReturnType<typeof probeCustomModel>> }> => {
    const current = (await readCloudProviderRow()) ?? row!;
    const model = pickTestModel(current);
    if (!model) throw Object.assign(new Error("云端没有可用模型"), { code: "no-model" });
    const key = decrypt(current.encryptedKey);
    if (!key) throw Object.assign(new Error("本机云密钥不可用（安全存储解码失败）—— 请重启应用后重试"), { code: "no-token" });
    const result = await probeCustomModel({ provider: CLOUD_PROVIDER_ID, baseUrl: current.baseUrl, apiKey: key, model, wireApi: "responses" });
    return { model, result };
  };

  try {
    const { model, result } = await attempt();
    return { ok: true, healed, model, status: result.status, latencyMs: result.latencyMs, models: result.models?.length ?? 0 };
  } catch (error: any) {
    const code = String(error?.code || "");
    const message = String(error?.message ?? error);
    if (code === "no-token" || code === "no-model") return { ok: false, code: code as CloudTestReply["code"], error: message, healed };
    /* 非认证类失败（域名解析 / 连接拒绝 / 模型不存在 / 上游 5xx）：重签没有意义，如实回报。 */
    if (!/认证失败（HTTP (401|403)）/.test(message)) return { ok: false, code: "unreachable", error: message, healed };
    if (healed) return { ok: false, code: "still-failing", error: message, healed: true };

    const heal = await healCloudAccess();
    if (!heal.ok) {
      return { ok: false, code: "heal-failed", error: `认证失败，自动重签未成功：${heal.error || "unknown"}`, originalError: message, healed: false };
    }
    try {
      const { model, result } = await attempt();
      return { ok: true, healed: true, model, status: result.status, latencyMs: result.latencyMs, models: result.models?.length ?? 0 };
    } catch (retryError: any) {
      return { ok: false, code: "still-failing", error: String(retryError?.message ?? retryError), originalError: message, healed: true };
    }
  }
}

async function localStatus() {
  const state = loginState();
  const row = await readCloudProviderRow();
  return {
    loggedIn: state.loggedIn,
    baseUrl: state.baseUrl,
    registered: Boolean(row),
    enabled: row?.enabled !== false && Boolean(row),
    /* 是否**当前生效**：不是的话界面要给一个「设为当前供应商」的按钮 ——
       ⛔ 自动同步**绝不**抢生效位（用户可能正用着别的供应商），所以需要用户显式点一下。 */
    active: await isCloudActive(),
    models: row?.models?.length ?? 0,
    hasToken: Boolean(row?.encryptedKey),
    /* 清单 6（10-19）：让界面能显示「key 属于哪个账号 + 令牌前缀」——
       「订阅了但 key 掉了」的现场，第一眼就能看出是不是账号/令牌错位。 */
    account: state.active?.username ?? "",
    tokenPrefix: readProxyToken().slice(0, 12),
    lastSyncAt: readLastSyncAt(),
  };
}

export const cloudModelsFeature = defineFeature<null>({
  id: "cloud-models",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("cloud-models: 缺少 ipc 服务（宿主未提供）");
    void CHANNELS;

    /* ⛔⛔ 启动即纠偏（10-17）：旧版本把云模型的 `wireApi` 写成 `chat`，而**引擎只会发 Responses**
       ⇒ 整份配置拒载，用户看到「测试连接成功、发送却报错」。改成 responses + 让本地桥按 chat 翻。
       ⛔ 改完必须 `refreshEngineProviders()` 重写 config.toml —— 只改 json 引擎读不到。
       ⛔ 静默：纠偏失败不影响启动（下次同步还会再试）。 */
    void (async () => {
      try {
        const repaired = await repairCloudProviderProtocol();
        /* ⛔⛔ **无条件**把 config.toml 对齐到模型档案（10-17 实测事故）：
           它们是**两份状态** —— 界面/档案是 `cloud` + `space-bunny`，而 config.toml 还停在
           `model_provider = "custom"` / `model = "gpt-6.1-sol"` / `cn.pptoken.cc`。
           引擎按 config.toml 发请求 ⇒ **拿旧供应商发** ⇒ 全部失败（而"测试连接"是渲染层按档案
           探的，所以显示成功，极具误导性）。
           ⛔ 只在协议不对时才对齐是不够的 —— 这次协议是对的、只有"档案例外"漂了。
           `applyCustomModel` 是幂等的；启动时对齐一次，代价是一次小文件写。 */
        const refreshed = await refreshEngineProviders();
        if (repaired || refreshed) console.log(`[cloud-models] 启动对齐：协议纠偏=${repaired} · config.toml 重写=${refreshed}`);
      } catch { /* 静默：对齐失败不影响启动 */ }
    })();

    /* 目录（面板展示用）：原始回执透传，渲染层按 provider/models 自行渲染。 */
    ipcHost.handle("cloud-models:catalog", async () => {
      const res = await fetchCatalog();
      return res.ok ? res.data : { ok: false, error: res.error || "catalog-failed" };
    });
    /* 同步（手动刷新按钮 / 面板打开 / 登录成功后）。input.force 会重签代理令牌。 */
    ipcHost.handle("cloud-models:sync", async (_event, input?: { force?: boolean }) => syncModels(Boolean(input?.force)));
    /* 云端模型连通测试（10-19）：与供应商页「测试当前供应商」同口径；401/403 自动重签并重试，
       forceHeal=true 对应界面上的「重签密钥并重试」（先重签再探）。 */
    ipcHost.handle("cloud-models:test", async (_event, input?: { forceHeal?: boolean }) => testCloudModels(Boolean(input?.forceHeal)));
    /* 单独取令牌（供应商 Key 掉了的"修复"入口）。⛔ 明文只在这一条通道返回。 */
    ipcHost.handle("cloud-models:token", async (_event, input?: { force?: boolean }) =>
      issueProxyToken(input?.force !== false));
    /* 勾选：写**服务端**（权威在云端，换台机器登录也一致）→ 立刻同步到本机下拉框。 */
    ipcHost.handle("cloud-models:set-enabled", async (_event, input?: { ids?: string[] }) => {
      const ids = Array.isArray(input?.ids) ? input!.ids!.map(String) : [];
      const res = await cloudFetch<{ ok?: boolean; enabled?: string[]; enabledCount?: number; error?: string }>("/models/enabled", {
        method: "POST",
        body: { ids },
      });
      if (!res.ok || !res.data?.ok) return { ok: false, error: res.error || "save-failed" };
      const synced = await syncModels(false);
      return { ok: true, enabledCount: Number(res.data.enabledCount ?? ids.length), sync: synced };
    });
    ipcHost.handle("cloud-models:status", async () => localStatus());
    /* 把「云端模型」设为**当前生效**供应商（用户显式点击；会自动重启引擎以新 Key/地址生效）。
       ⛔ 自动同步绝不抢生效位，只有这条通道会 —— 见 cloud-provider 的 activateCloudProvider。 */
    ipcHost.handle("cloud-models:activate", async () => activateCloudProvider());

    /* ── 保持更新：定时轮询 ──────────────────────────────────────────────
       ⛔ 只在已登录时打网络；未登录直接跳过（否则每次轮询都白打一次请求，还会刷 401 日志）。
       ⛔ 失败**静默**（不弹错、不阻断）—— 轮询是"让它自己追上"，不是用户动作；
         真需要用户知道的失败由手动刷新 / 面板状态显示。 */
    let timer: NodeJS.Timeout | null = null;
    const minutes = Math.max(1, Number(process.env.HARNESS_CLOUD_SYNC_MINUTES || DEFAULT_INTERVAL_MINUTES));
    app.whenReady().then(() => {
      /* 启动先同步一次：云行的 source/积分倍率依赖这次拉取；否则要等到 10 分钟轮询后
         下拉才会出现倍率（用户 10-25「我没看见倍率」）。失败静默，不阻断启动。 */
      if (loginState().loggedIn) void syncModels(false).catch(() => undefined);
      timer = setInterval(() => {
        if (!loginState().loggedIn) return;
        void syncModels(false).catch(() => undefined);
      }, minutes * 60_000);
      if (typeof timer.unref === "function") timer.unref();
    });

    ctx.effect(() => {
      if (timer) clearInterval(timer);
    });
  },
});
