/**
 * 云端「限时福利」的**积分口径**（纯函数、可被预检直接跑）。
 *
 * ⛔⛔ 这里算的是**展示用的估算值**，不参与任何计费 —— 真正扣分的是云助手 `server.js`
 *      的代理响应采集处。两边必须**同一套公式**，否则会出现"页脚说 0.4、账本扣 0.8"这种
 *      最难解释的不一致。公式（服务端原文）：
 *
 *          积分 = (prompt_tokens + completion_tokens) / 1000 × 模型倍率 × 闲时系数
 *          保留 2 位小数；倍率为 0 或缺失 ⇒ 免费（记 0 分）
 *
 * ⛔ 注意**缓存命中在云助手口径里不免单**：它直接用 `prompt_tokens`（含命中部分），
 *    与 WBM 侧那个"命中免费"的兜底估算器**不是一回事** —— 别把两边公式看串了。
 *
 * ⛔ 闲时倍率 = **折扣系数，乘在模型倍率之上**（服务端 `db.offPeak`）；它不改模型倍率本身。
 * ⛔ 时段按**服务器本地时间**判断，所以这里用服务端下发的 `tzOffsetMinutes` 把客户端的
 *    "现在"换算成服务器的小时数 —— 直接用本机时区会在跨时区/整点边界处差一格。
 */

/** 模型倍率（服务端目录里的 `credits`，形如 `"x0.29"` / `"0.29"` / 数字 / 空串）→ 数字。
 *  空串 / 0 / 非法 ⇒ 0（= 免费），与服务端 `POST /admin/models/credits` 的归一化同一口径。 */
export function creditRate(credits) {
  const raw = credits === null || credits === undefined ? "" : String(credits).trim().replace(/^x/i, "");
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 客户端的"现在" → **服务器本地**小时数（含小数）。服务端没给时区偏移时返回 null（不猜）。 */
export function serverHourAt(offPeak, now) {
  /* ⛔⛔ `Number(null)` 与 `Number("")` 都是 **0**（= 假 UTC）而不是 NaN —— 必须显式挡掉，
     否则"服务端没给时区"会被静默当成 tz=0，跨时区时整点边界处差一格（`undefined` 恰好是 NaN，
     所以只用 `Number.isFinite` 兜底时这个坑只在 null/空串上显形）。 */
  const raw = offPeak ? offPeak.tzOffsetMinutes : undefined;
  if (raw === undefined || raw === null || raw === "") return null;
  const tz = Number(raw);
  if (!Number.isFinite(tz)) return null;
  const at = Number(now);
  const ms = Number.isFinite(at) ? at : Date.now();
  /* getTimezoneOffset() = UTC − 本地（分钟）⇒ 本地 = UTC − 偏移。服务端也用同一个 API。 */
  const utcMinutes = (ms / 60000) % 1440;
  const localMinutes = (((utcMinutes - tz) % 1440) + 1440) % 1440;
  return localMinutes / 60;
}

/** 命中哪个闲时窗口（未启用 / 没命中 / 服务端没给时区 ⇒ null）。
 *  语义与服务端 `offPeakWindow()` 逐条对齐：起点含、终点不含；`start > end` = 跨零点；
 *  命中多段取**数组序在前**的那段；零长度窗口不生效。 */
export function offPeakWindowAt(offPeak, now) {
  if (!offPeak || offPeak.enabled !== true) return null;
  const windows = Array.isArray(offPeak.windows) ? offPeak.windows : [];
  const hour = serverHourAt(offPeak, now);
  if (hour === null) return null;
  for (const w of windows) {
    const start = Number(w && w.start);
    const end = Number(w && w.end);
    const rate = Number(w && w.rate);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(rate)) continue;
    if (!(rate >= 0)) continue;
    if (start === end) continue;
    const hit = start < end ? hour >= start && hour < end : hour >= start || hour < end;
    if (hit) return { label: String((w && w.label) || ""), start, end, rate };
  }
  return null;
}

/** 计费系数：命中闲时 ⇒ 窗口系数，否则 1（= 不折扣）。 */
export function offPeakFactorAt(offPeak, now) {
  const win = offPeakWindowAt(offPeak, now);
  return win ? win.rate : 1;
}

/**
 * 本轮积分估算。
 * @param {{ credits?: unknown, offPeak?: unknown, input?: unknown, output?: unknown, now?: number }} args
 * @returns {{ credit:number, rate:number, factor:number, tokens:number, free:boolean, window:object|null } | null}
 *          ⛔ 没有任何 token ⇒ null（调用方据此**不显示**，而不是显示 "0 积分" 骗人）。
 */
export function estimateTurnCredit(args) {
  const a = args || {};
  const tokens = Math.max(0, Math.round(Number(a.input) || 0)) + Math.max(0, Math.round(Number(a.output) || 0));
  if (tokens <= 0) return null;
  const rate = creditRate(a.credits);
  const window = offPeakWindowAt(a.offPeak, a.now);
  const factor = window ? window.rate : 1;
  if (rate <= 0) return { credit: 0, rate: 0, factor, tokens, free: true, window };
  return { credit: Math.round((tokens / 1000) * rate * factor * 100) / 100, rate, factor, tokens, free: false, window };
}
