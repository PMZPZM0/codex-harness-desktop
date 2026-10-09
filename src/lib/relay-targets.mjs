/**
 * 中转站「自动新建密钥用哪个分组 / 先试哪个候选」的**唯一裁决点**（纯函数、零依赖）。
 *
 * 为什么单独抽出来（10-09 用户报障「供应商生成失败：该网关没探测到可用模型」）：
 *   原实现取 `subscriptions[0]` 建密钥，**只试这一个候选** —— 那一个分组建出来的 key 若在
 *   当前网关不可用（额度用满 / 该分组不允许请求的模型 / 已过期），整条链路直接失败，
 *   既不会退到下一个套餐、也不会退到余额；而且真实报错（网关 403 的原话）被一句通用文案
 *   吃掉 ⇒ 用户既不知道为什么，也不知道下一步做什么。
 *
 * 用户令（10-09）：「自动新建密钥，分组选**已生效**的套餐，没有就用余额」。
 *
 * 「已生效」= 状态 active **且** 未过期。上游 `GET /api/v1/subscriptions/summary` 内部调
 * `ListActiveUserSubscriptions`（只返回 active），但这里仍**逐条复核**：站点版本可能不同，
 * 且「status=active 而 expires_at 已过」是真实存在的形态（过期由后台任务异步改写状态）。
 * 状态常量实证：`backend/internal/domain/constants.go` —— 订阅 active/expired/suspended、
 * 密钥 active。`expires_at` 是 ISO 字符串（`field.Time`），缺失一律按「生效」处理
 * （站点语义是"没写到期时间 = 不过期"）。
 */

/** 密钥 / 订阅的「生效」状态值（上游 constants.go：StatusActive = "active"）。 */
export const RELAY_STATUS_ACTIVE = "active";

/** 把各种形态的到期时间归一成毫秒时间戳；取不到返回 null（= 视为不过期）。 */
function expiresAtMs(sub) {
  const raw = sub?.expires_at ?? sub?.expiresAt ?? null;
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // 兼容秒级时间戳（上游给的是 ISO 字符串，但别让一个数字把判定带偏）
    return raw > 1e12 ? raw : raw * 1000;
  }
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? t : null;
}

/** 某个额度窗口是否还有余量：没给限额（<=0 / 缺失）= 不限量，永远有余量。 */
function windowHasLeft(used, limit) {
  const cap = Number(limit ?? 0);
  if (!Number.isFinite(cap) || cap <= 0) return true;
  const spent = Number(used ?? 0);
  if (!Number.isFinite(spent)) return true;
  return spent < cap;
}

/** 订阅是否已生效：状态为 active（或未给状态）且未过期。 */
export function isSubscriptionEffective(sub, nowMs = Date.now()) {
  if (!sub || typeof sub !== "object") return false;
  const status = String(sub.status ?? RELAY_STATUS_ACTIVE).trim().toLowerCase();
  if (status && status !== RELAY_STATUS_ACTIVE) return false;
  const end = expiresAtMs(sub);
  return end === null || end > nowMs;
}

/** 订阅的日/周/月三个额度窗口是否都还有余量（任一用满 ⇒ 这个套餐当前已打不动）。 */
export function hasQuotaLeft(sub) {
  return windowHasLeft(sub?.daily_used_usd ?? sub?.dailyUsedUsd, sub?.daily_limit_usd ?? sub?.dailyLimitUsd)
    && windowHasLeft(sub?.weekly_used_usd ?? sub?.weeklyUsedUsd, sub?.weekly_limit_usd ?? sub?.weeklyLimitUsd)
    && windowHasLeft(sub?.monthly_used_usd ?? sub?.monthlyUsedUsd, sub?.monthly_limit_usd ?? sub?.monthlyLimitUsd);
}

/**
 * 已生效订阅的**尝试顺序**：
 *   ① 还有额度的排前面（用满的仍留在候选里，只是靠后 —— 直接剔除会让「用户套餐用满」
 *      变成整链失败，而它在某些站点上只是暂时的）；
 *   ② 都快到期时，**先到期的优先**（先把要过期的用掉，不要浪费）；
 *   ③ 没写到期时间的排最后（通常是不限量/永久，不急着用）；
 *   ④ 其余保持站点返回顺序（稳定排序，避免同一份数据两次跑出不同结果）。
 */
export function orderEffectiveSubscriptions(subs, nowMs = Date.now()) {
  const list = (Array.isArray(subs) ? subs : [])
    .map((sub, index) => ({ sub, index }))
    .filter((entry) => isSubscriptionEffective(entry.sub, nowMs));
  list.sort((a, b) => {
    const qa = hasQuotaLeft(a.sub) ? 0 : 1;
    const qb = hasQuotaLeft(b.sub) ? 0 : 1;
    if (qa !== qb) return qa - qb;
    const ea = expiresAtMs(a.sub);
    const eb = expiresAtMs(b.sub);
    if (ea !== eb) {
      if (ea === null) return 1;
      if (eb === null) return -1;
      return ea - eb;
    }
    return a.index - b.index;
  });
  return list.map((entry) => entry.sub);
}

/**
 * 建密钥 / 选计费的**候选链**（按顺序尝试，第一个成功即生效）：
 *   ① 每个「已生效」套餐的分组 —— 用户令：分组选已生效的套餐；
 *   ② **余额分组**（`subscription_type = "standard"` 的可用分组，按倍率从低到高）——
 *      用户令：没有套餐就用余额。⛔ 这一步**必须绑分组**：pptoken 这类站点对
 *      「无分组 key」是**站点级硬拒**（`API Key is not assigned to any group and cannot be
 *      used`，该文案不在上游 main 里，是站点自己加的），只发无分组 key 必 403；
 *      而上游 `api_key_auth.go` 对「绑了非订阅分组」的 key 是**从账户余额扣费**
 *      （`isSubscriptionType=false` ⇒ 不查订阅，只查余额）⇒ 绑 standard 分组才是真正的
 *      「用余额」姿势。分组清单来自 `GET /api/v1/groups/available`（= 该用户有权绑的活跃分组）。
 *   ③ 无分组余额（**最后的兜底**）：站点没配任何分组时只有这条路；上游默认实现允许
 *      （`validateAPIKeyGroupAvailable` 对 `GroupID == nil` 直接放行），老版本站点靠它。
 *
 * ⛔ 顺序刻意把「余额分组」放在「无分组」之前：前者在"要求绑分组"和"不要求"两类站点上都能用，
 *    后者只在后一类能用。反过来排会让每个 pptoken 用户白建一把用不上的 Harness-余额。
 *
 * @param groups `/groups/available` 的返回，用于挑余额分组（可选）
 * @returns {{ mode: "plan" | "balance", groupId: number | null, groupName: string, label: string }[]}
 */
export function buildRelayCandidates(subs, nowMs = Date.now(), groups = []) {
  const out = [];
  const seen = new Set();
  for (const sub of orderEffectiveSubscriptions(subs, nowMs)) {
    const groupId = Number(sub?.group_id ?? sub?.groupId);
    if (!Number.isInteger(groupId) || groupId <= 0 || seen.has(groupId)) continue;
    seen.add(groupId);
    const groupName = String(sub?.group_name ?? sub?.groupName ?? `分组 ${groupId}`);
    out.push({ mode: "plan", groupId, groupName, label: `${groupName}（套餐）` });
  }
  for (const group of orderBalanceGroups(groups)) {
    if (seen.has(group.id)) continue;
    seen.add(group.id);
    out.push({ mode: "balance", groupId: group.id, groupName: group.name, label: `${group.name}（余额）` });
  }
  out.push({ mode: "balance", groupId: null, groupName: "", label: "余额（不绑分组）" });
  return out;
}

/** 可用的**余额分组**：`subscription_type = "standard"`（按余额扣费）且状态正常。
 *  排序：倍率低的在前（新手默认挑最便宜的那条），同倍率按 id 升序（稳定）。
 *  ⛔ 上限 3 个：一次失败不该把站点里所有公开分组都建一遍密钥（每个候选都会建 key）。 */
export function orderBalanceGroups(groups, limit = 3) {
  const list = (Array.isArray(groups) ? groups : [])
    .map((group, index) => ({ group, index }))
    .filter(({ group }) => {
      if (!group || typeof group !== "object") return false;
      const id = Number(group.id ?? group.group_id);
      if (!Number.isInteger(id) || id <= 0) return false;
      const status = String(group.status ?? RELAY_STATUS_ACTIVE).trim().toLowerCase();
      if (status && status !== RELAY_STATUS_ACTIVE) return false;
      // 缺字段按 standard 处理：上游 `SubscriptionType` 缺省即标准计费，不写就等于按余额扣
      const type = String(group.subscription_type ?? group.subscriptionType ?? "standard").trim().toLowerCase();
      return type !== "subscription";
    })
    .sort((a, b) => {
      const ra = Number(a.group.rate_multiplier ?? a.group.rateMultiplier ?? 1);
      const rb = Number(b.group.rate_multiplier ?? b.group.rateMultiplier ?? 1);
      const va = Number.isFinite(ra) ? ra : 1;
      const vb = Number.isFinite(rb) ? rb : 1;
      if (va !== vb) return va - vb;
      return a.index - b.index;
    })
    .slice(0, Math.max(0, Number(limit) || 0));
  return list.map(({ group }) => ({
    id: Number(group.id ?? group.group_id),
    name: String(group.name ?? `分组 ${group.id}`),
    rate: Number(group.rate_multiplier ?? group.rateMultiplier ?? 1),
  }));
}

/**
 * 该候选能复用哪把已有密钥：必须是 active，且分组与该候选**完全对上**
 * （候选绑了分组 ⇒ 同 group_id；候选不绑分组 ⇒ 无分组）。复用优先于新建 —— 重跑一次登录
 * 不该在站点里堆出一串同名密钥。
 *
 * @returns 命中的密钥行，或 null（调用方据此去新建）
 */
export function pickReusableKey(keys, candidate) {
  const raw = candidate?.groupId;
  const want = raw === null || raw === undefined ? null : Number(raw);
  return (Array.isArray(keys) ? keys : []).find((key) => {
    if (!key || typeof key !== "object") return false;
    const status = String(key.status ?? RELAY_STATUS_ACTIVE).trim().toLowerCase();
    if (status && status !== RELAY_STATUS_ACTIVE) return false;
    const group = key.group_id ?? key.groupId ?? null;
    if (want === null) return group === null || group === undefined;
    return group !== null && group !== undefined && Number(group) === want;
  }) ?? null;
}

/** 自动新建密钥时用的名字（沿用既有命名，用户在中转站里一眼能认出是应用建的）。
 *  绑了分组 ⇒ `Harness-<组名>`；不绑分组（老站点兜底）⇒ `Harness-余额`。 */
export function keyNameForCandidate(candidate) {
  if (candidate?.groupId === null || candidate?.groupId === undefined) return "Harness-余额";
  const name = String(candidate?.groupName ?? "").trim();
  return `Harness-${name || candidate.groupId}`;
}
