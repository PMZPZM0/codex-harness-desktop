/**
 * electron/relay-accounts.ts —— 中转站多账号库的**纯判定**（预检可直接加载跑真断言）。
 *
 * 为什么单独成文件：账号「生效」有三处入口（卡片开关 / 删除·退出 / 401 自动重登）
 * 和两条联动（账号 ↔ 供应商）。判定散在主进程里最容易出现「界面说生效、库里是停用」。
 *
 * ⛔ 09-21 真机事故（用户实测）：`relay-store.json` 的 `activeId` 指向一个 `disabled: true`
 *    的账号 ⇒ 卡片同屏出现「使用中 + 已停用 + 当前生效」三个互相矛盾的标记。
 *    根因：`writeRelayAccount()` 无条件把被写账号设为 `activeId`，而 `relayAuthedFetch()`
 *    的 401 自动重登会调它 —— 中转站页一打开就会 `relay:keys-all` **对每个账号**发请求，
 *    于是「只是打开页面」就可能把停用账号顶成生效账号（连引擎的模型配置一起被改）。
 *
 * 不变量（本文件是唯一权威）：**停用 / 没有凭据 / 不存在的账号，永远不是 activeId**。
 */

export type RelayAccountLike = {
  id: string;
  baseUrl?: string;
  email?: string;
  accessToken?: string;
  disabled?: boolean;
};

export type RelayStoreLike<T extends RelayAccountLike = RelayAccountLike> = {
  activeId: string | null;
  accounts: T[];
};

/** 「可用」＝有登录凭据且未被停用。生效候选只能从可用账号里挑。 */
export function isRelayAccountLive(account: RelayAccountLike | null | undefined): boolean {
  if (!account) return false;
  if (account.disabled) return false;
  return Boolean(account.accessToken);
}

/** 从账号列表里挑一个可生效的账号（保持既有「列表里第一个」的语义）；一个都没有 → null。 */
export function pickRelayActiveId(accounts: RelayAccountLike[] | null | undefined): string | null {
  const list = Array.isArray(accounts) ? accounts : [];
  return list.find((account) => isRelayAccountLive(account))?.id ?? null;
}

/** 账号对应的 relay 供应商 id：`relay-<host 首段>`（去掉 `api.` 前缀，全小写）。
 *  ⛔ 单一来源：账号开关、正向联动、反向联动、删除收尾原先各自抄了一遍 —— 改规则必漏一处。 */
export function relayProviderIdOf(baseUrl: string | undefined): string {
  try {
    const host = new URL(String(baseUrl ?? "").trim()).host.replace(/^api\./i, "").split(".")[0];
    return host ? `relay-${host.toLowerCase()}` : "";
  } catch {
    return "";
  }
}

/**
 * 自愈：`activeId` 必须指向一个**存在且可用**的账号，否则置空。
 * 返回 `changed` 交给调用方落盘（读取函数不替调用方决定要不要写文件）。
 * ⛔ 只置空、**不替用户挑一个**：偷偷把别的账号变成生效（还连带改引擎模型配置）比
 *    「当前没有生效账号」糟得多 —— 用户看到的是「我明明没动，模型被换了」。
 */
export function normalizeRelayStore<T extends RelayAccountLike>(raw: unknown): { store: RelayStoreLike<T>; changed: boolean } {
  const src = (raw && typeof raw === "object" ? raw : {}) as Partial<RelayStoreLike<T>>;
  // ⛔ 不剔条目：坏形状（缺 id）的条目也**原样保留**，只影响它自己能不能当生效账号。
  //    自愈只允许改 `activeId` 这一件事 —— 读取路径顺手删用户数据是不可接受的。
  const accounts = Array.isArray(src.accounts) ? (src.accounts.filter(Boolean) as T[]) : [];
  const activeId = typeof src.activeId === "string" && src.activeId ? src.activeId : null;
  const active = activeId ? accounts.find((account) => (account as RelayAccountLike)?.id === activeId) : undefined;
  const keep = activeId && isRelayAccountLive(active) ? activeId : null;
  return { store: { activeId: keep, accounts }, changed: keep !== activeId };
}
