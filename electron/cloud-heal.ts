/**
 * cloud-heal（基座层，10-19）—— 云端访问返回 401/403 时的**自动自愈**（复检清单 1）。
 *
 * 事故：用户订阅云端知识库 / 记忆后，模型探活报「认证失败（HTTP 401）」；
 * 点「重签密钥并同步」也没用（10-19 实测：服务端那几次重签落在**另一个大小写不同的账号**上，
 * 本机行里的 key 从未被替换；且开了云端记忆时，真正上游是 memapi + 记忆 userKey，
 * 只换代理令牌根本不影响它）。
 *
 * 自愈做三件事（顺序有意义）：
 *   ① **强制重签**代理令牌（`POST /proxy/token`）；
 *   ② 把新 key 写进云供应商行（列表 + 生效档案两份）+ 重生成引擎配置；
 *   ③ 若记忆上游开着，**重新拉 `/integrations` 刷新记忆 userKey**（清单 5）。
 *
 * ⛔ 并发去重：探活与定时同步可能同时触发 ⇒ 共用一次在飞的重签（不对服务端连签、避免把
 *   同账号其它设备的令牌挤出令牌环）。
 * ⛔ 本模块是基座（不注册通道）：`features/custom-model-ipc`（探活）与 `features/cloud-models-ipc`
 *   （同步）共用，⛔ 不要让域互相 import。
 */
import { encrypt, loginState } from "./cloud-api";
import { issueProxyToken } from "./cloud-token";
import { readMemoryUpstream, refreshMemoryUpstreamFromIntegrations, updateCloudProviderKey } from "./cloud-provider";

export type HealResult = {
  ok: boolean;
  /** 是否真的向服务端签了新令牌 */
  reissued: boolean;
  /** 记忆 userKey 是否一起刷新成功 */
  memoryRefreshed: boolean;
  /** 供应商行是否因新 key 而改写 */
  changed: boolean;
  error?: string;
};

let inFlight: Promise<HealResult> | null = null;
let lastHealAt = 0;

/** 最近一次自愈完成时刻（排障/界面用）。 */
export function lastCloudHealAt(): number {
  return lastHealAt;
}

/** 401/403 自愈：重签 → 写行 → 刷新记忆上游。失败返回 ok:false（调用方保留原错误）。 */
export async function healCloudAccess(): Promise<HealResult> {
  if (inFlight) return inFlight;
  inFlight = (async (): Promise<HealResult> => {
    try {
      if (!loginState().loggedIn) return { ok: false, reissued: false, memoryRefreshed: false, changed: false, error: "not-logged-in" };
      const issued = await issueProxyToken(true);
      if (!issued.ok) return { ok: false, reissued: false, memoryRefreshed: false, changed: false, error: issued.error || "token-failed" };
      const encrypted = encrypt(issued.token);
      const changed = encrypted ? await updateCloudProviderKey(encrypted) : false;
      let memoryRefreshed = false;
      if (await readMemoryUpstream()) {
        const applied = await refreshMemoryUpstreamFromIntegrations();
        memoryRefreshed = applied.memory;
      }
      lastHealAt = Date.now();
      if (!encrypted) return { ok: false, reissued: true, memoryRefreshed, changed, error: "safe-storage-unavailable" };
      return { ok: true, reissued: true, memoryRefreshed, changed };
    } catch (error) {
      return {
        ok: false,
        reissued: false,
        memoryRefreshed: false,
        changed: false,
        error: String((error as Error)?.message ?? error).slice(0, 160),
      };
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
