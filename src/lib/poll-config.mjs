/**
 * 轮询板块的**纯函数层**（10-09 建）。
 *
 * ⛔ 这里不许 import 任何东西、不许碰 Date.now()：它要能被守卫与探针用 `node` 直接 import 真跑
 *    （本项目纪律：判据必须可实测，不能靠读代码猜 —— 见记忆「注释声称能力是最危险的假象」）。
 *
 * 掰开讲三件事：
 *   ① **配置**（间隔 / 超时 / 重试上限）：模型与渲染层都能给值，一律先过钳制再用 —— 一块
 *      面板说「每 0 毫秒查一次」然后把厂商接口打挂，比不给配置糟得多。
 *   ② **退避**（失败自动重试的节奏）：一次失败就等 2 倍、再失败 4 倍……封顶在 intervalMax，
 *      免得把「对方在限流」放大成「我们在打人」。
 *   ③ **文案**（状态 / 时长 / 时刻）：卡片与胶囊共用同一套说法，别在两处各写一份中文。
 */

/** 状态机终态集合（⛔ `polling` 是唯一的非终态 —— 判据到处都要用「是不是还在轮」）。 */
export const POLL_STATUSES = ["polling", "success", "failed", "timeout", "aborted"];

/** 默认值：异步生成类任务（视频）普遍要几分钟，5 秒一次、10 分钟封顶是个不烦人也不迟钝的档。 */
export const POLL_DEFAULTS = { intervalMs: 5000, timeoutMs: 600000, maxRetry: 3 };

/** 钳制边界（与 electron/poll-config.ts 同源：改一边必须改另一边，守卫【284】比对）。 */
export const POLL_LIMITS = {
  intervalMs: { min: 500, max: 120000 },
  timeoutMs: { min: 5000, max: 3600000 },
  maxRetry: { min: 0, max: 10 },
};

function clampInt(value, min, max, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * 任意输入 → 合法配置。
 *
 * ⛔ **超时必须 ≥ 间隔**：否则第一轮还没发出去就被判超时（面板会显示「超时」而其实一次都没查），
 *    这是"自洽地错"的典型 —— 两个数字各自合法、放一起不成立。这里把它兜住。
 */
export function normalizePollConfig(patch, base = POLL_DEFAULTS) {
  const src = patch && typeof patch === "object" ? patch : {};
  const intervalMs = clampInt(src.intervalMs ?? base.intervalMs, POLL_LIMITS.intervalMs.min, POLL_LIMITS.intervalMs.max, POLL_DEFAULTS.intervalMs);
  const timeoutMs = clampInt(src.timeoutMs ?? base.timeoutMs, POLL_LIMITS.timeoutMs.min, POLL_LIMITS.timeoutMs.max, POLL_DEFAULTS.timeoutMs);
  const maxRetry = clampInt(src.maxRetry ?? base.maxRetry, POLL_LIMITS.maxRetry.min, POLL_LIMITS.maxRetry.max, POLL_DEFAULTS.maxRetry);
  return { intervalMs, timeoutMs: Math.max(timeoutMs, intervalMs * 2), maxRetry };
}

/**
 * 第 N 次连续失败后该等多久（指数退避 + 封顶）。
 * ⛔ 封顶用 `POLL_LIMITS.intervalMs.max`，不再乘下去 —— 8 次失败后等 21 分钟等于放弃。
 */
export function backoffMs(intervalMs, failures) {
  const base = clampInt(intervalMs, POLL_LIMITS.intervalMs.min, POLL_LIMITS.intervalMs.max, POLL_DEFAULTS.intervalMs);
  const times = Math.pow(2, Math.max(0, Math.floor(Number(failures) || 0)));
  return Math.min(POLL_LIMITS.intervalMs.max, base * times);
}

const STATUS_LABEL = {
  polling: "轮询中",
  success: "成功",
  failed: "失败",
  timeout: "超时",
  aborted: "已中止",
};

export function pollStatusLabel(status) {
  return STATUS_LABEL[String(status ?? "")] ?? "轮询中";
}

/** 语气（CSS 类名后缀，配色与 thinking 板块同带：running 橙 / ok 绿 / err 红 / warn 黄 / mute 灰）。 */
export function pollStatusTone(status) {
  const key = String(status ?? "");
  if (key === "polling") return "running";
  if (key === "success") return "ok";
  if (key === "failed") return "err";
  if (key === "timeout") return "warn";
  return "mute";
}

/** 时长：12.4 秒 / 3 分 07 秒 / 1 小时 05 分（⛔ 不给「0 秒」——刚开的卡显示 0 秒像卡住了）。 */
export function formatPollDuration(ms) {
  const n = Math.max(0, Math.floor(Number(ms) || 0));
  if (n < 1000) return "不到 1 秒";
  if (n < 60000) return `${(n / 1000).toFixed(1)} 秒`;
  if (n < 3600000) {
    const m = Math.floor(n / 60000);
    const s = Math.floor((n % 60000) / 1000);
    return `${m} 分 ${String(s).padStart(2, "0")} 秒`;
  }
  const h = Math.floor(n / 3600000);
  const m = Math.floor((n % 3600000) / 60000);
  return `${h} 小时 ${String(m).padStart(2, "0")} 分`;
}

/** 间隔：5000 → `5 秒`；≥60 秒 → `1.5 分`（一行里放得下）。 */
export function formatPollInterval(ms) {
  const n = clampInt(ms, POLL_LIMITS.intervalMs.min, POLL_LIMITS.intervalMs.max, POLL_DEFAULTS.intervalMs);
  if (n < 60000) return `${Math.round(n / 100) / 10} 秒`;
  return `${Math.round((n / 60000) * 10) / 10} 分`;
}

/** 时刻（每轮记录的行首）：HH:MM:SS。 */
export function formatPollClock(at) {
  const d = new Date(Number(at) || Date.now());
  const p = (v) => String(v).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 实测平均间隔（round 时间戳的相邻差取均值）。
 *
 * ⛔ 为什么要它：模型自己循环调用 `video_status` 时（不带 wait），主进程**不知道**间隔 ——
 *    卡上写死"按配置 5 秒"就是在撒谎。只有托管轮询（managed）才用配置值，其余一律报实测。
 */
export function measuredIntervalMs(rounds) {
  const list = Array.isArray(rounds) ? rounds : [];
  if (list.length < 2) return null;
  let sum = 0;
  let count = 0;
  for (let i = 1; i < list.length; i += 1) {
    const gap = Number(list[i]?.at ?? 0) - Number(list[i - 1]?.at ?? 0);
    if (gap > 0) { sum += gap; count += 1; }
  }
  return count ? Math.round(sum / count) : null;
}

/** 卡头那句「已轮询 N 次 · 每 X · 已耗时 Y」—— 一处拼装，卡片与胶囊共用。 */
export function pollMetricText(task, nowMs) {
  const rounds = Array.isArray(task?.rounds) ? task.rounds : [];
  const measured = measuredIntervalMs(rounds);
  const planned = Number(task?.intervalMs ?? POLL_DEFAULTS.intervalMs);
  // managed = 主进程按配置在等 ⇒ 报配置值；否则报实测（≥2 轮才有实测，否则只报次数）
  const interval = task?.managed || measured == null ? planned : measured;
  const end = task?.status === "polling" ? (Number(nowMs) || Date.now()) : Number(task?.endedAt ?? task?.startedAt ?? 0);
  const elapsed = Math.max(0, end - Number(task?.startedAt ?? 0));
  const parts = [`已轮询 ${rounds.length} 次`];
  if (interval) parts.push(`每 ${formatPollInterval(interval)}`);
  parts.push(`已耗时 ${formatPollDuration(elapsed)}`);
  return parts.join(" · ");
}

/** 单轮记录的摘要（结果或错误），截断到一行放得下。 */
export function roundSummaryText(round) {
  if (!round) return "";
  const raw = String(round.ok ? (round.summary ?? round.progress ?? "已查询") : (round.error ?? round.summary ?? "失败"));
  const oneLine = raw.replace(/\s+/g, " ").trim();
  return oneLine.length > 120 ? `${oneLine.slice(0, 120)}…` : oneLine;
}
