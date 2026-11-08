/**
 * 上下文压缩兜底（11-03 立）。**宿主自己压，不再指望引擎自动压。**
 *
 * ⛔⛔ 为什么要有这个文件（全部实测，不是推断）：
 *   引擎 0.166 在**自定义 provider**（自定 base_url + env_key）下**不再自动压缩**。
 *   隔离实测（独立 CODEX_HOME + 自建 Responses 假服务）扫过多组参数：
 *     阈值 100 / 3000 × 窗口 200000 / 10000 × usage 12 / 50000（累计冲到 150000）
 *     × 模型 mock-model / gpt-5 × 模式 exec / app-server（本仓真实链路），
 *     并补了 `model_auto_compact_token_limit_scope="total"` 与
 *     `model_post_turn_compact_threshold_percent=1`（配置全部被接受、无告警）
 *   ⇒ **三轮全是「一轮一次请求」，一次摘要请求都没有**。
 *   而 10-07 的记录（引擎 0.153/0.157）实测过「命中阈值会内联压缩」⇒ 属**升级回归**。
 *   后果正是终端用户那条报错：历史只涨不压 ⇒ 某轮单发就超窗（3,326,093 > 1,048,576）。
 *
 * ✅ 同一实验里测过兜底可行：手动 `thread/compact/start` **有效** —— 引擎发出
 *   `You are performing a CONTEXT CHECKPOINT COMPACTION…` 摘要请求，
 *   并回推 `item/started` / `item/completed` 的 `contextCompaction` item（UI 会自动显示压缩中）。
 *
 * 设计取舍：
 *   · 只在 `turn/start` **之前**判断 —— 此刻回合未开始，调 compact 不会打断任何东西
 *     （⛔ 回合运行中调会打断当前回合，见 main.ts 的同条注释）；
 *   · 阈值直接读**引擎自己读的那份 config.toml**（单一真相源，⛔ 不在这里重算一遍）；
 *   · 用量取该线程 rollout 里**最后一次** `token_count.last_token_usage.input_tokens`
 *     （引擎自己写的真实值，⛔ 不自己数字符估 token）；
 *   · **宁可漏压也不能卡住发送**：任何一步失败只记日志、照常发；失败后同线程冷却 10 分钟。
 */

import fs from "node:fs";
import path from "node:path";

/** 同一线程两次压缩尝试的最小间隔：压缩要调模型做摘要，失败时不许每轮都重锤。 */
const RETRY_COOLDOWN_MS = 10 * 60 * 1000;
/**
 * 判定用的 rollout 尾部窗口。
 * ⛔ 审查修正：原为 256KB —— 但**单条工具输出可达 400KB+**（实测有 417KB 的行），
 *   一次大输出就能把最后一次 token_count 挤出窗口，读到的是更早的用量 ⇒ **漏压**。
 *   1MB 足够盖住常见的单条大输出，仍是常数级读取。
 */
const TAIL_BYTES = 1024 * 1024;
/** 触发线 = 阈值 × 该系数：本轮还会再涨，压早一点比压晚了好。 */
const TRIGGER_RATIO = 0.9;

const lastAttempt = new Map<string, number>();

/** 读引擎真正在用的阈值。⛔ 单一真相源 = 引擎自己读的那份文件。 */
export function readAutoCompactLimit(codexHome: string): number | null {
  try {
    const text = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
    const m = text.match(/^\s*model_auto_compact_token_limit\s*=\s*(\d+)\s*$/m);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * 找该线程的 rollout 文件。
 * ⛔ 只在最近 3 天的日目录里找 —— `sessions/**` 递归全扫在几千个会话时要几秒，
 *   而 turn/start 是热路径，不能为了兜底把发送拖慢。
 */
export function findRollout(codexHome: string, threadId: string, now = Date.now()): string | null {
  const root = path.join(codexHome, "sessions");
  /* ⛔ 审查修正：原来只查 3 天 —— 用户隔 4 天回来继续用同一个长会话时找不到 rollout，
     就直接不压了（正是最需要压的场景）。7 天覆盖绝大多数"回来接着聊"的间隔，且仍只读 7 个目录。 */
  for (let back = 0; back < 7; back += 1) {
    const d = new Date(now - back * 86_400_000);
    const dir = path.join(
      root,
      String(d.getFullYear()),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0"),
    );
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    const hit = names.filter((n) => n.startsWith("rollout-") && n.includes(threadId)).sort().pop();
    if (hit) return path.join(dir, hit);
  }
  return null;
}

/** 读 rollout 尾部，取**最后一次** token_count 的 last.input_tokens。 */
export function lastInputTokens(file: string): number | null {
  let fd: number | undefined;
  try {
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fd = fs.openSync(file, "r");
    fs.readSync(fd, buf, 0, buf.length, start);
    let best: number | null = null;
    /* 尾部第一行很可能被截断（JSON 不完整）⇒ 解析失败就跳过，不是错误。 */
    for (const line of buf.toString("utf8").split("\n")) {
      if (!line.includes('"token_count"')) continue;
      try {
        const v = JSON.parse(line)?.payload?.info?.last_token_usage?.input_tokens;
        if (typeof v === "number" && v > 0) best = v;
      } catch {
        /* 忽略截断行 */
      }
    }
    return best;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* 关不掉不影响结果 */
      }
    }
  }
}

/* ⛔ 11-08 用户反馈「内容超出模型上限」：供应商实际限额常常**小于**模型标称窗口
   （中转站常见）。超限报错里通常带「N tokens > M」，M 就是真实上限 ⇒ 记下来，
   下一轮按 min(配置阈值, M) 触发压缩，别再等标称阈值。 */
const realLimit = new Map<string, { limit: number; at: number }>();
const REAL_LIMIT_TTL = 2 * 60 * 60 * 1000;

/** 记下供应商实际限额（超限报错解析出来的 M）；有界 + 2 小时过期。 */
export function noteRealLimit(threadId: string, limitTokens: number, now = Date.now()): void {
  const id = String(threadId ?? "");
  const limit = Number(limitTokens);
  if (!id || !Number.isFinite(limit) || limit <= 0) return;
  for (const [key, value] of realLimit) if (now - value.at > REAL_LIMIT_TTL) realLimit.delete(key);
  if (realLimit.size > 300) realLimit.delete(realLimit.keys().next().value as string);
  realLimit.set(id, { limit: Math.floor(limit), at: now });
}

export type CompactDecision =
  | { compact: true; used: number; limit: number }
  | { compact: false; reason: "no-thread" | "cooldown" | "no-limit" | "no-rollout" | "no-usage" | "below"; used?: number; limit?: number };

/** 判断该不该自动压缩：无会话 / 冷却中 / 没到阈值都返回 false 并给出原因。 */
export function shouldCompact(codexHome: string, threadId: string, now = Date.now()): CompactDecision {
  if (!threadId) return { compact: false, reason: "no-thread" };
  if (now - (lastAttempt.get(threadId) ?? 0) < RETRY_COOLDOWN_MS) return { compact: false, reason: "cooldown" };
  const limit = readAutoCompactLimit(codexHome);
  if (!limit) return { compact: false, reason: "no-limit" };
  /* 供应商实际限额比标称窗口小时，按更小的那个触发（见 noteRealLimit）。 */
  const real = realLimit.get(threadId);
  const effective = real && now - real.at <= REAL_LIMIT_TTL ? Math.min(limit, real.limit) : limit;
  const file = findRollout(codexHome, threadId, now);
  if (!file) return { compact: false, reason: "no-rollout" };
  const used = lastInputTokens(file);
  if (!used) return { compact: false, reason: "no-usage" };
  if (used < effective * TRIGGER_RATIO) return { compact: false, reason: "below", used, limit: effective };
  return { compact: true, used, limit: effective };
}

/** 记一次尝试（成功失败都记）：失败时靠它把重试压到 10 分钟一次，别每轮都卡。 */
export function markAttempt(threadId: string, now = Date.now()): void {
  if (threadId) lastAttempt.set(threadId, now);
}

/** 测试用：清空内部状态。 */
export function __resetCompactGuardState(): void {
  lastAttempt.clear();
  realLimit.clear();
}
