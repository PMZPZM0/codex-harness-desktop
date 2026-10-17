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
import { applyCloudProvider, activateCloudProvider, isCloudActive, readCloudProviderRow, type CloudCatalogModel, repairCloudProviderProtocol, refreshEngineProviders } from "../cloud-provider";

/** 域内 IPC 通道。 */
const CHANNELS = [
  "cloud-models:catalog",
  "cloud-models:sync",
  "cloud-models:token",
  "cloud-models:set-enabled",
  "cloud-models:activate",
  "cloud-models:status",
];

/** 轮询间隔（分钟）。⛔ 只是"保持更新"的下限，任何手动动作都会立刻触发一次同步。 */
const DEFAULT_INTERVAL_MINUTES = 10;

/** 服务端 `/models` 回执。 */
type CatalogReply = {
  ok?: boolean;
  provider?: { id?: string; name?: string; baseUrl?: string; ready?: boolean; hasProxyToken?: boolean };
  models?: CloudCatalogModel[];
  error?: string;
};

type SyncReply = { ok: boolean; models: number; changed: boolean; promoted: boolean; error?: string };

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

/** 代理令牌缓存文件（本域专属；明文与密文双轨，能加密就加密）。 */
function proxyTokenFile(): string {
  return path.join(cloudHome(), "proxy-token");
}

function readProxyToken(): string {
  try {
    return decrypt(fs.readFileSync(proxyTokenFile(), "utf8").trim());
  } catch {
    return "";
  }
}

function writeProxyToken(token: string): boolean {
  const encrypted = encrypt(token);
  if (!encrypted) return false;
  fs.mkdirSync(cloudHome(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(proxyTokenFile(), encrypted, { mode: 0o600 });
  return true;
}

async function fetchCatalog(): Promise<{ ok: boolean; data: CatalogReply | null; error?: string }> {
  const res = await cloudFetch<CatalogReply>("/models");
  if (!res.ok || !res.data?.ok) return { ok: false, data: res.data, error: res.error || "catalog-failed" };
  return { ok: true, data: res.data };
}

/**
 * 取代理令牌：优先读缓存；`force` 或缓存缺失时向服务端签一枚新的。
 * ⛔ 明文只在返回值里（本进程内），落盘一律走 `writeProxyToken`（加密）。
 */
async function issueProxyToken(force: boolean): Promise<{ ok: boolean; token: string; reused: boolean; error?: string }> {
  if (!force) {
    const cached = readProxyToken();
    if (cached) return { ok: true, token: cached, reused: true };
  }
  const res = await cloudFetch<{ ok?: boolean; token?: string; error?: string }>("/proxy/token", { method: "POST", body: {} });
  const token = String(res.data?.token || "");
  if (!res.ok || !token) return { ok: false, token: "", reused: false, error: res.error || "token-failed" };
  writeProxyToken(token);
  return { ok: true, token, reused: false };
}

/** 同步一次：拉目录 → 确保有代理令牌 → 写本机供应商行。 */
async function syncModels(force: boolean): Promise<SyncReply> {
  if (!loginState().loggedIn) return { ok: false, models: 0, changed: false, promoted: false, error: "not-logged-in" };
  const catalog = await fetchCatalog();
  if (!catalog.ok || !catalog.data) {
    return { ok: false, models: 0, changed: false, promoted: false, error: catalog.error };
  }
  /* 服务端没有令牌记录时（`hasProxyToken === false`）必须重签 —— 缓存里的旧串对它已无效。 */
  const needToken = force || !catalog.data.provider?.hasProxyToken;
  const token = await issueProxyToken(needToken);
  const applied = await applyCloudProvider(catalog.data.models ?? [], {
    baseUrl: accountsBase(),
    encryptedKey: token.ok ? encrypt(token.token) : "",
  });
  writeLastSyncAt(Date.now());
  return { ok: true, ...applied };
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
        if (await repairCloudProviderProtocol()) {
          console.log("[cloud-models] 已把云模型协议纠正为 responses（上游 chat 交给本地桥）");
          await refreshEngineProviders();
        }
      } catch { /* 静默 */ }
    })();

    /* 目录（面板展示用）：原始回执透传，渲染层按 provider/models 自行渲染。 */
    ipcHost.handle("cloud-models:catalog", async () => {
      const res = await fetchCatalog();
      return res.ok ? res.data : { ok: false, error: res.error || "catalog-failed" };
    });
    /* 同步（手动刷新按钮 / 面板打开 / 登录成功后）。input.force 会重签代理令牌。 */
    ipcHost.handle("cloud-models:sync", async (_event, input?: { force?: boolean }) => syncModels(Boolean(input?.force)));
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
