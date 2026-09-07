/** 中转站账户（sub2api 兼容网关）公共逻辑：登录后的密钥解析与供应商生成参数。
 *  协议实证见 Wei-Shaw/sub2api：套餐绑定分组（group_id），key 绑分组走套餐额度。
 *  注意：部分站点（如 pptoken）强制要求 key 必须绑分组，无分组 key 网关直接 403——
 *  遇到时由 App.relayActivate 自动改绑第一个订阅分组重试。 */

export type RelayActive = {
  provider: string;
  baseUrl: string;
  apiKey: string;
  mode: "balance" | "plan";
  groupId: number | null;
  label: string;
};

export type RelayGroup = { group_id: number; group_name: string };

export function readRelayActive(): RelayActive | null {
  try { return JSON.parse(localStorage.getItem("relay-active-v1") ?? "null"); } catch { return null; }
}

export function writeRelayActive(active: RelayActive | null) {
  if (active) localStorage.setItem("relay-active-v1", JSON.stringify(active));
  else localStorage.removeItem("relay-active-v1");
}

/** 解析目标计费方式对应的密钥：优先复用同分组/无分组的生效 key，没有则新建。
 *  返回网关地址、明文密钥与生成供应商所需的全部参数（供保存链路使用）。 */
export async function resolveRelayTarget(mode: "balance" | "plan", group?: RelayGroup): Promise<{
  overview: any;
  gateway: string;
  apiKey: string;
  provider: string;
  displayName: string;
  active: RelayActive;
}> {
  const overview = await window.codex.relayOverview();
  const activeKeys = (overview.keys ?? []).filter((k: any) => k.status === "active");
  const match = activeKeys.find((k: any) => mode === "plan" ? k.group_id === group!.group_id : k.group_id == null);
  const key = match ?? await window.codex.relayCreateKey({ name: mode === "plan" ? `Harness-${group!.group_name}` : "Harness-余额", groupId: mode === "plan" ? group!.group_id : null });
  if (!key?.key) throw new Error("中转站未返回密钥明文");
  await window.codex.relaySelect({ mode, groupId: mode === "plan" ? group!.group_id : null, keyId: key.id, keyName: key.name });
  const baseUrl: string = overview.baseUrl;
  let hostLabel = "中转站";
  try { hostLabel = new URL(baseUrl).host.replace(/^api\./i, "").split(".")[0] || hostLabel; } catch { /* 保底 */ }
  const provider = `relay-${hostLabel.toLowerCase()}`;
  const displayName = `${hostLabel.toUpperCase()} · ${mode === "plan" ? group!.group_name : "余额"}`;
  return {
    overview,
    gateway: `${baseUrl}/v1`,
    apiKey: key.key,
    provider,
    displayName,
    active: { provider, baseUrl, apiKey: key.key, mode, groupId: mode === "plan" ? group!.group_id : null, label: displayName },
  };
}

/** 按用户显式选择的密钥解析目标（自选密钥模式）：不再匹配/新建，直接用选中的 key。 */
export async function resolveRelayKeyTarget(keyRow: { id: any; name: any; key: string; group_id: number | null }): Promise<{
  overview: any;
  gateway: string;
  apiKey: string;
  provider: string;
  displayName: string;
  active: RelayActive;
}> {
  const overview = await window.codex.relayOverview();
  const baseUrl: string = overview.baseUrl;
  let hostLabel = "中转站";
  try { hostLabel = new URL(baseUrl).host.replace(/^api\./i, "").split(".")[0] || hostLabel; } catch { /* 保底 */ }
  const provider = `relay-${hostLabel.toLowerCase()}`;
  const mode: "balance" | "plan" = keyRow.group_id != null ? "plan" : "balance";
  const displayName = `${hostLabel.toUpperCase()} · ${keyRow.name || (mode === "plan" ? "套餐" : "余额")}`;
  await window.codex.relaySelect({ mode, groupId: keyRow.group_id ?? null, keyId: keyRow.id, keyName: keyRow.name });
  return {
    overview,
    gateway: `${baseUrl}/v1`,
    apiKey: keyRow.key,
    provider,
    displayName,
    active: { provider, baseUrl, apiKey: keyRow.key, mode, groupId: keyRow.group_id ?? null, label: displayName },
  };
}

/** 登录后自动选择计费方式：有生效套餐优先用第一个套餐，否则走余额。 */
export async function resolveRelayAutoTarget(): Promise<{ mode: "balance" | "plan"; group?: RelayGroup; resolved: Awaited<ReturnType<typeof resolveRelayTarget>> }> {
  const overview = await window.codex.relayOverview();
  const subs: any[] = overview.subscriptions ?? [];
  if (subs.length) {
    const first = subs[0];
    const group = { group_id: Number(first.group_id), group_name: String(first.group_name ?? "套餐") };
    return { mode: "plan", group, resolved: await resolveRelayTarget("plan", group) };
  }
  return { mode: "balance", resolved: await resolveRelayTarget("balance") };
}
