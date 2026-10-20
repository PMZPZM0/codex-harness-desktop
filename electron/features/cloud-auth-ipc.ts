/**
 * cloud-auth（域，10-16）—— 云账号的登录 / 登出 / 切换 / 状态。
 *
 * 域边界：**只管身份**。凭据存储与请求都委托给基座 `../cloud-api`（⛔ 令牌只有那一份实现），
 * 模型落盘归 `cloud-models` 域、MCP 连接器归 `cloud-kb` / `cloud-memory` 域。
 *
 * ⛔ 登录走账号密码（`/login`），**不做配对**：服务端 `accountWho()` 同时认网页会话令牌与设备令牌，
 *   两者都从 `Authorization: Bearer` 进 ⇒ 登录拿到的 token 可直接当 Bearer 用（用户定案
 *   「做成类似中转站那种登录方式」）。配对流程是给"没有登录会话的壳"准备的。
 *
 * ⛔ 登出的"收摊"只在**一个账号都不剩**时做：多账号下删掉其中一个不该把仍在用的云供应商也切断。
 */
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { DEFAULT_ACCOUNTS_BASE, accountViews, cloudFetch, forgetAccount, login, loginState, switchAccount, serverBaseUrl } from "../cloud-api";
import { disableCloudProvider } from "../cloud-provider";
import { CLOUD_KB_CONNECTOR_ID, CLOUD_MEMORY_CONNECTOR_ID, syncCloudMcpConnector } from "../cloud-mcp";
import { clearCloudMemoryActivation } from "../cloud-memory-activation";
import { notifyMemoryBackendChanged } from "./memory-backend-events";

/** 域内 IPC 通道（三前缀同源：域 id = ipc-registry prefix = manifest 前缀）。 */
const CHANNELS = ["cloud-auth:login", "cloud-auth:logout", "cloud-auth:switch", "cloud-auth:status", "cloud-auth:points"];

/** 服务端 `/points/me` 的一条积分变动。`kind`：grant / consume / entitlement / signup … */
export type CloudPointTxn = {
  id?: string;
  at?: number;
  delta?: number;
  kind?: string;
  note?: string;
  after?: number;
};

export const cloudAuthFeature = defineFeature<null>({
  id: "cloud-auth",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("cloud-auth: 缺少 ipc 服务（宿主未提供）");
    void CHANNELS; // 通道清单在 manifest 登记；保留常量便于守卫比对（同 free-gateway 做法）

    ipcHost.handle(
      "cloud-auth:login",
      async (_event, input?: { baseUrl?: string; username?: string; password?: string }) => {
        const result = await login(String(input?.baseUrl || ""), String(input?.username || ""), String(input?.password || ""));
        /* ⛔ 换了身份 ⇒ 云端记忆的开通结论作废（新账号未必有权益）。⛔ 不猜：标成「待确认」，
           等用户在记忆页点「确认开通状态」或云账号页点「获取记忆凭据」再定。 */
        if (result.ok) {
          clearCloudMemoryActivation("account-changed");
          notifyMemoryBackendChanged();
        }
        return result;
      },
    );

    ipcHost.handle("cloud-auth:logout", async (_event, id?: string) => {
      const removed = forgetAccount(id ? String(id) : undefined);
      const state = loginState();
      if (removed && !state.loggedIn) {
        await disconnectCloud();
        clearCloudMemoryActivation("not-logged-in");
      } else if (removed) {
        /* 删的不是生效账号：生效身份没变，但账号库变了 ⇒ 让界面重新读一次（可能条目少了）。 */
        notifyMemoryBackendChanged();
      }
      return { ok: removed, ...loginState() };
    });

    ipcHost.handle("cloud-auth:switch", async (_event, id?: string) => {
      const ok = switchAccount(String(id || ""));
      if (ok) {
        clearCloudMemoryActivation("account-changed");
        notifyMemoryBackendChanged();
      }
      return { ok, ...loginState() };
    });

    ipcHost.handle("cloud-auth:status", async () => ({
      ...loginState(),
      accounts: accountViews(),
      /* ⛔ 登录过就用服务端**自报**的地址（用户令：别把编译期常量固定展示）；没登录过才回落到常量。 */
      defaultBaseUrl: serverBaseUrl() || DEFAULT_ACCOUNTS_BASE,
    }));

    /* 积分（服务端 /points/me）：余额 + 最近变动明细。
       ⛔ 这是「账户级」数据（余额挂在账号上，不是挂在某个供应商上）⇒ 属于本域，不另开板块。
       ⛔ 回执里的 `verify` 只是服务端自洽性校验，界面不需要，不透传（少一份口径）。 */
    ipcHost.handle("cloud-auth:points", async () => {
      const res = await cloudFetch<{ ok?: boolean; balance?: number; signupGrant?: number; txns?: CloudPointTxn[] }>("/points/me");
      if (!res.ok || !res.data?.ok) return { ok: false, error: res.error || "points-failed" };
      return {
        ok: true,
        balance: Number(res.data.balance ?? 0),
        signupGrant: Number(res.data.signupGrant ?? 0),
        txns: Array.isArray(res.data.txns) ? res.data.txns.slice(0, 30) : [],
      };
    });
  },
});

/**
 * 登出收摊：停用云供应商行 + 停用两个云 MCP 连接器。
 * ⛔ 都只**停用**不删除：模型列表与连接器配置留着，用户重新登录后勾选与配置原地复用。
 */
async function disconnectCloud(): Promise<void> {
  try {
    await disableCloudProvider();
  } catch (error) {
    console.warn("[cloud-auth] 停用云供应商失败：", error instanceof Error ? error.message : String(error));
  }
  for (const id of [CLOUD_KB_CONNECTOR_ID, CLOUD_MEMORY_CONNECTOR_ID]) {
    try {
      await syncCloudMcpConnector(null, id);
    } catch (error) {
      console.warn(`[cloud-auth] 停用连接器 ${id} 失败：`, error instanceof Error ? error.message : String(error));
    }
  }
}
