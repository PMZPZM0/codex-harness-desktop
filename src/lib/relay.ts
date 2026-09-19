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
  /** 登录账户的邮箱（来自 relayOverview.email），用于区分同一网关下的不同账号 */
  email?: string;
  /** 每次成功切换/激活时写入的时间戳；UI 用它作为刷新与重渲染的强信号，
   *  即便 provider 字符串因同网关复用而不变，也能强制监控与配置跟着切换。 */
  switchedAt?: number;
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
  const displayName = `${hostLabel.toUpperCase()} · ${mode === "plan" ? group!.group_name : "余额"}${overview?.email ? " · " + overview.email : ""}`;
  return {
    overview,
    gateway: `${baseUrl}/v1`,
    apiKey: key.key,
    provider,
    displayName,
    active: { provider, baseUrl, apiKey: key.key, mode, groupId: mode === "plan" ? group!.group_id : null, label: displayName, email: overview?.email },
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
  const displayName = `${hostLabel.toUpperCase()} · ${keyRow.name || (mode === "plan" ? "套餐" : "余额")}${overview?.email ? " · " + overview.email : ""}`;
  await window.codex.relaySelect({ mode, groupId: keyRow.group_id ?? null, keyId: keyRow.id, keyName: keyRow.name });
  return {
    overview,
    gateway: `${baseUrl}/v1`,
    apiKey: keyRow.key,
    provider,
    displayName,
    active: { provider, baseUrl, apiKey: keyRow.key, mode, groupId: keyRow.group_id ?? null, label: displayName, email: overview?.email },
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

/**
 * 中转站账户登录的**完整链路**：登录 → 自动选计费方式（有套餐用套餐，否则余额）→ 生成供应商 → 生效。
 *
 * ⛔ 抽出来是因为它有**两个入口**（登录页 + 模型配置引导弹窗）。分两处各写一份必然漂移 ——
 *   尤其"无分组 key 被网关 403 时改绑第一个订阅分组重试"这段兜底，漏掉任何一处，那边的用户
 *   就会卡在"供应商生成失败"而不知道为什么（09-19 引导弹窗补中转站入口时抽的）。
 *
 * @param onLogin 宿主自己的「保存供应商 + 探测模型 + 生效」链路（App 的 handleLogin）。
 * @returns ok=false 时 message 是可直接展示给用户的原因（不用用户去猜）。
 */
export async function performRelayLogin(input: {
  baseUrl: string;
  email: string;
  password: string;
  username?: string;
  onLogin: (info: { provider: string; name: string; baseUrl: string; apiKey: string; model: string; username?: string }) => Promise<boolean>;
}): Promise<{ ok: boolean; message?: string; active?: RelayActive }> {
  try {
    await window.codex.relayLogin({ baseUrl: input.baseUrl.trim(), email: input.email.trim(), password: input.password });
  } catch (error: any) {
    return { ok: false, message: `中转站登录失败：${error?.message ?? error}` };
  }
  try {
    let target = await resolveRelayAutoTarget();
    let ok = await input.onLogin({
      provider: target.resolved.provider,
      name: target.resolved.displayName,
      baseUrl: target.resolved.gateway,
      apiKey: target.resolved.apiKey,
      model: "",
      username: input.username,
    });
    // 部分站点强制 key 必须绑分组（无分组 key 网关 403）：改绑第一个订阅分组重试
    if (!ok && target.mode === "balance") {
      const ov = await window.codex.relayOverview().catch(() => null);
      const subs: any[] = ov?.subscriptions ?? [];
      if (subs.length) {
        const s0 = subs[0];
        const group = { group_id: Number(s0.group_id), group_name: String(s0.group_name ?? "套餐") };
        target = { mode: "plan", group, resolved: await resolveRelayTarget("plan", group) };
        ok = await input.onLogin({
          provider: target.resolved.provider,
          name: target.resolved.displayName,
          baseUrl: target.resolved.gateway,
          apiKey: target.resolved.apiKey,
          model: "",
          username: input.username,
        });
      }
    }
    if (!ok) {
      return { ok: false, message: "供应商生成失败：该网关没探测到可用模型 —— 可稍后在「设置 → 账户 → 中转站」重试，或换用「粘贴 API Key」。", active: target.resolved.active };
    }
    // 只有供应商真正生成并生效后才落「已生效」标记，避免失败残留锁死按钮/徽标
    writeRelayActive(target.resolved.active);
    return { ok: true, active: target.resolved.active };
  } catch (error: any) {
    return { ok: false, message: `中转站登录后配置失败：${error?.message ?? error}` };
  }
}
