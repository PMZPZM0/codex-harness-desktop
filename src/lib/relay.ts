/** 中转站账户（sub2api 兼容网关）公共逻辑：登录后的密钥解析与供应商生成参数。
 *  协议实证见 Wei-Shaw/sub2api：套餐绑定分组（group_id），key 绑分组走套餐额度。
 *  注意：部分站点（如 pptoken）强制要求 key 必须绑分组，无分组 key 网关直接 403——
 *  遇到时由 App.relayActivate 自动改绑第一个订阅分组重试。
 *
 *  ⛔ 候选链（10-09 用户令「自动新建密钥，分组选已生效的套餐，没有就用余额」）：
 *    「用哪个分组建密钥 / 先试哪个候选」的裁决**全部**在 `lib/relay-targets.mjs`（纯函数、
 *    可真跑），本文件只负责把它接到网络与宿主回调上。⛔ 别在这里再写一份分组挑选逻辑 ——
 *    两处判定必然漂移，而这条链的失败形态是「用户登录后卡在供应商生成失败」。 */

import { buildRelayCandidates, pickReusableKey, keyNameForCandidate, type RelayCandidate } from "./relay-targets.mjs";
import { credentialRejectedHint, normalizeCredential } from "./relay-input.mjs";

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

/** 按**候选**落地：复用/新建该候选的密钥 → 选计费 → 拼出供应商参数与「已生效」标记。
 *  ⛔ 所有入口（登录链 / 中转站面板 / 引导弹窗 / 模型页一键切换）最终都汇到这里，
 *    这样「用哪个分组建 key」只可能有一份实现。 */
export async function resolveRelayCandidate(candidate: RelayCandidate, overview?: any): Promise<{
  overview: any;
  gateway: string;
  apiKey: string;
  provider: string;
  displayName: string;
  active: RelayActive;
}> {
  const ov = overview ?? await window.codex.relayOverview();
  const key = pickReusableKey(ov.keys, candidate)
    ?? await window.codex.relayCreateKey({ name: keyNameForCandidate(candidate), groupId: candidate.groupId });
  if (!key?.key) throw new Error("中转站未返回密钥明文");
  await window.codex.relaySelect({ mode: candidate.mode, groupId: candidate.groupId, keyId: key.id, keyName: key.name });
  const baseUrl: string = ov.baseUrl;
  let hostLabel = "中转站";
  try { hostLabel = new URL(baseUrl).host.replace(/^api\./i, "").split(".")[0] || hostLabel; } catch { /* 保底 */ }
  const provider = `relay-${hostLabel.toLowerCase()}`;
  const what = candidate.groupName || "余额";
  const displayName = `${hostLabel.toUpperCase()} · ${what}${ov?.email ? " · " + ov.email : ""}`;
  return {
    overview: ov,
    gateway: `${baseUrl}/v1`,
    apiKey: key.key,
    provider,
    displayName,
    active: { provider, baseUrl, apiKey: key.key, mode: candidate.mode, groupId: candidate.groupId, label: displayName, email: ov?.email },
  };
}

/** 解析目标计费方式对应的密钥（面板 / 引导弹窗 / 模型页一键切换的入口）。
 *  ⛔ **`mode="balance"` 且没指定分组时，自动落到「余额分组」**（`subscription_type=standard`）：
 *    pptoken 这类站点对「无分组 key」是**站点级硬拒**（`API Key is not assigned to any group`），
 *    只发无分组 key 等于把面板上的「余额」做成一个必然失败的按钮；而上游对「绑了非订阅分组」的
 *    key 是**从账户余额扣费** ⇒ 绑 standard 分组才是真正可用的「用余额」姿势。
 *    站点没配任何分组时才退回不绑分组（上游默认允许，`validateAPIKeyGroupAvailable` 直接放行）。
 *  ⛔ 别在这里再写一份分组挑选 —— 候选链在 lib/relay-targets（单一真相源）。 */
export async function resolveRelayTarget(mode: "balance" | "plan", group?: RelayGroup): Promise<{
  overview: any;
  gateway: string;
  apiKey: string;
  provider: string;
  displayName: string;
  active: RelayActive;
}> {
  const overview = await window.codex.relayOverview();
  const candidates = buildRelayCandidates(overview.subscriptions ?? [], Date.now(), overview.groups ?? []) as RelayCandidate[];
  const wantedId = group ? Number(group.group_id) : null;
  const candidate = wantedId !== null
    ? candidates.find((c) => c.groupId === wantedId)
      ?? { mode: "plan" as const, groupId: wantedId, groupName: String(group!.group_name ?? ""), label: String(group!.group_name ?? "") }
    : candidates.find((c) => c.mode === mode) ?? candidates[candidates.length - 1];
  return resolveRelayCandidate(candidate, overview);
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

/** 候选链（已生效套餐 → 余额分组 → 无分组余额）：挑出「按顺序该试哪些目标」。
 *  **只管挑**，不发请求、不建密钥 —— 落地在 resolveRelayCandidate(候选)。 */
export async function resolveRelayCandidates(): Promise<{ overview: any; candidates: RelayCandidate[] }> {
  const overview = await window.codex.relayOverview();
  const candidates = buildRelayCandidates(overview.subscriptions ?? [], Date.now(), overview.groups ?? []) as RelayCandidate[];
  return { overview, candidates };
}

/** 登录后自动选择计费方式的**单个**目标（兼容既有调用方：中转站面板 / 引导弹窗的「重试」）。
 *  ⛔ 只取候选链首位。要「依次尝试直到成功」请走 performRelayLogin —— 它才带兜底。 */
export async function resolveRelayAutoTarget(): Promise<{ mode: "balance" | "plan"; group?: RelayGroup; resolved: Awaited<ReturnType<typeof resolveRelayCandidate>> }> {
  const { overview, candidates } = await resolveRelayCandidates();
  const first = candidates[0];
  const resolved = await resolveRelayCandidate(first, overview);
  return {
    mode: first.mode,
    group: first.groupId !== null ? { group_id: first.groupId, group_name: first.groupName } : undefined,
    resolved,
  };
}

/** 把包装过的报错还原成人话（`Error invoking remote method 'x': …` 前缀一律剥掉）。 */
function relayReason(error: unknown, fallback = "未知错误"): string {
  const raw = String((error as any)?.message ?? error ?? "").trim();
  const cleaned = raw.replace(/^Error invoking remote method '[^']+':\s*/i, "").trim();
  return cleaned || fallback;
}

/** 网关主机名（诊断用：报错里必须说清"打到了哪个站点"，否则用户无法判断是账号问题还是打错了站）。 */
function hostOf(baseUrl: string): string {
  try { return new URL(String(baseUrl ?? "")).host; } catch { return String(baseUrl ?? "").trim() || "中转站"; }
}

/** 网络层失败（连不上 / 超时 / DNS）与「这个分组不行」是两码事：
 *  前者换下一个候选一样连不上，只会白建一串密钥 —— 命中就直接收尾报错。
 *  ⛔ 关键词对齐主进程 `describeNetworkError` / `classifyProbeError` 的中文措辞。 */
function isNetworkFailure(reason: string): boolean {
  return /网络|超时|域名解析|连接被拒|连接失败|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed/i.test(reason);
}

/** 某候选失败后做一次**只读**探测，把网关的原话带出来。
 *  ⛔ 为什么必须做：`onLogin` 只回 true/false，真实原因（403 原话 / `/models` 空列表 /
 *    模型名不被认）全被吃掉 ⇒ 用户只看到「没探测到可用模型」，既不知道为什么、也不知道
 *    下一步做什么（10-09 用户报障时的实际体验）。
 *  ⛔ 必须只读：`probeCustomModel` 不落盘、不改配置（只读一份已有配置用于 key 复用判断）。 */
async function diagnoseRelayGateway(baseUrl: string, apiKey: string): Promise<string> {
  try {
    const probe: any = await window.codex.probeCustomModel({ provider: "relay-diagnose", baseUrl, apiKey, wireApi: "responses" });
    const models: string[] = probe?.models ?? [];
    return models.length
      ? `探测到 ${models.length} 个模型但未生效（多为瞬时网络问题，可重试）`
      : "网关返回的模型列表为空（该密钥所属分组当前没有可用模型）";
  } catch (error) {
    return relayReason(error, "探测失败");
  }
}

/**
 * 中转站账户登录的**完整链路**：登录 → 自动选计费方式（有套餐用套餐，否则余额）→ 生成供应商 → 生效。
 *
 * ⛔ 抽出来是因为它有**两个入口**（登录页 + 模型配置引导弹窗）。分两处各写一份必然漂移 ——
 *   尤其「候选链依次真试 + 失败原因上浮」这段，漏掉任何一处，那边的用户就会卡在
 *   「供应商生成失败」而不知道是哪个分组、什么原因（09-19 引导弹窗补中转站入口时抽的）。
 *
 * @param onLogin 宿主自己的「保存供应商 + 探测模型 + 生效」链路（App 的 handleLogin）。
 * @returns ok=false 时 message 是可直接展示给用户的原因（不用用户去猜）。
 */
export async function performRelayLogin(input: {
  baseUrl: string;
  email: string;
  password: string;
  username?: string;
  /** 跳过「重新登录」这一步，直接用本机已保存的中转站会话继续收尾。
   *  用途：本机已有有效 token（24h）时，用户不必为了一次配置再赌一遍密码 ——
   *  ⛔ 只在**同一网关 + 同一邮箱**且会话未过期时才允许（由调用方判），否则会串账号。 */
  skipLogin?: boolean;
  onLogin: (info: { provider: string; name: string; baseUrl: string; apiKey: string; model: string; username?: string }) => Promise<boolean>;
}): Promise<{ ok: boolean; message?: string; active?: RelayActive }> {
  if (!input.skipLogin) {
    /* ⛔ 提交前净化一次（全角 `＠`、尾随空格、零宽字符 ⇒ 站点按字节比对必判 invalid，
       而页面上看不出来）。UI 也会净化并提示，这里再做一次是**兜底**：凡是调用方漏做的
       入口（面板、引导弹窗）同样受保护。 */
    const email = normalizeCredential(input.email);
    const password = normalizeCredential(input.password);
    try {
      await window.codex.relayLogin({ baseUrl: normalizeCredential(input.baseUrl), email, password });
    } catch (error: any) {
      const reason = relayReason(error, "账号或密码不正确");
      // 「邮箱或密码不对」是站点最不可自证的一句话：带上网关主机名 + 可操作提示（10-09 实测）
      const message = /invalid email or password|INVALID_CREDENTIALS|账号或密码/i.test(reason)
        ? credentialRejectedHint(reason, hostOf(input.baseUrl))
        : `中转站登录失败（${hostOf(input.baseUrl)}）：${reason}`;
      return { ok: false, message };
    }
  }
  try {
    /* 候选链：已生效套餐（还有额度的、快到期的优先）→ 余额。
       ⛔ 必须**依次真试**。10-09 用户报障的根因就是「只试了一个候选」：`subscriptions[0]`
         那一个分组建出来的 key 只要在当前网关不可用（额度用满 / 该分组不允许请求的模型 /
         已过期），整条链直接失败，既不退下一个套餐也不退余额，用户还只看到一句
         「没探测到可用模型」——不知道是认证被拒、分组没模型，还是网络问题。 */
    const { overview, candidates } = await resolveRelayCandidates();
    const failures: { label: string; reason: string }[] = [];
    /** 记一次失败；返回 true = 网络层挂了 ⇒ 换候选也一样连不上，直接收尾（别白建密钥）。 */
    const note = (label: string, reason: string) => {
      failures.push({ label, reason });
      return isNetworkFailure(reason);
    };
    let lastActive: RelayActive | undefined;
    for (const cand of candidates) {
      let resolved: Awaited<ReturnType<typeof resolveRelayCandidate>>;
      try {
        resolved = await resolveRelayCandidate(cand, overview);
      } catch (error) {
        if (note(cand.label, relayReason(error))) break;
        continue;
      }
      lastActive = resolved.active;
      let ok = false;
      try {
        ok = await input.onLogin({
          provider: resolved.provider,
          name: resolved.displayName,
          baseUrl: resolved.gateway,
          apiKey: resolved.apiKey,
          model: "",
          username: input.username,
        });
      } catch (error) {
        if (note(cand.label, relayReason(error))) break;
        continue;
      }
      if (ok) {
        // 只有供应商真正生成并生效后才落「已生效」标记，避免失败残留锁死按钮/徽标
        writeRelayActive(resolved.active);
        return { ok: true, active: resolved.active };
      }
      if (note(cand.label, await diagnoseRelayGateway(resolved.gateway, resolved.apiKey))) break;
    }
    const head = failures[0]?.reason ?? "未知原因";
    const tried = failures.length > 1 ? `（已依次尝试：${failures.map((f) => f.label).join("、")}）` : "";
    /* 站点硬要求「密钥必须绑分组」、而我们一个余额分组都没读到（`/groups/available` 失败或站点
       没给这个用户任何可绑分组）——这时再重试也是白搭，必须给一句能指路的话（10-09 实际报障）。 */
    const groupHint = /not assigned to any group/i.test(head) && !candidates.some((c) => c.mode === "balance" && c.groupId !== null)
      ? " 该站点要求密钥必须绑定分组，但没读到可用分组：请在中转站官网确认分组，或到「设置 → 账户 → 中转站」手动选一把已绑分组的密钥。"
      : "";
    return {
      ok: false,
      message: `供应商生成失败${tried}：${head}。${groupHint}可在「设置 → 账户 → 中转站」重试，或换用「粘贴 API Key」。`,
      active: lastActive,
    };
  } catch (error: any) {
    return { ok: false, message: `中转站登录后配置失败：${error?.message ?? error}` };
  }
}
