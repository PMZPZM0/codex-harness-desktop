/**
 * 「运行中自动播报正文」的两条硬规则（10-09 第六轮，用户拍板）。
 *
 * 背景：正文朗读本来是**完全由 Codex 自己判断**（`voice_speak_reply` 工具，第五轮）。
 * 但"该播的时候它没播"是肉眼可见的体验问题 ⇒ 用户加了两条**宿主侧、确定性**的兜底：
 *
 *   ① 单个回合的工具调用 **超过 10 次** ⇒ 强制播报（这一轮显然不是一句话能说清的事）；
 *   ② 检测到**同一个问题被返工 ≥2 次** ⇒ 强制播报（反复折腾的回合，用户更该听见结果）。
 *
 * ⛔ 为什么放 `src/lib/`（硬约束）：`build.files` 只收 `src/lib/*.mjs`，放域目录安装版会 require 不到
 *    直接崩；而且纯函数能在这里被守卫**真跑真值表**（本仓对"注释声称有"的警惕见 11z 头注释）。
 * ⛔ 两条都是"只加不减"：命中了就把本回合标记成念正文，**不会**取消用户/模型已有的任何决定。
 * ⛔ 都受**总开关**管（用户关掉播报 ⇒ 自动播报也不生效）—— 判据在调用方，这里只算事实。
 */

/** ① 工具调用次数上限：**超过**这个数就强制播报（用户原话「超过 10 次」）。 */
export const AUTO_TOOL_CALL_LIMIT = 10;

/** ② 返工判定：**同一个签名出现 ≥ 这个次数**就算「同一个问题被返工」（用户原话「≥2 次」）。 */
export const REWORK_REPEAT_LIMIT = 2;

/**
 * 算进「工具调用次数」的项（与 `SessionTurn` 的 workItemTypes 同口径）：
 * 思考 / 正文 / 用户消息**不算**（它们不是"干活"）。
 */
const WORK_ITEM_TYPES = new Set([
  "commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall",
  "webSearch", "collabAgentToolCall", "subAgentActivity", "imageGeneration",
]);

export function isWorkItem(item) {
  return WORK_ITEM_TYPES.has(String(item?.type ?? ""));
}

/** 压掉空白 + 截断：命令/参数用整段原文当签名会因空格差异把"同一条命令"算成两条。 */
function collapse(value, max = 200) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** 工具调用的参数摘要（拿不到就空串）：只看"同一次调用"是否一模一样，不解析语义。 */
function argsOf(item) {
  const raw = item?.arguments ?? item?.args ?? item?.input ?? null;
  if (raw == null) return "";
  try { return collapse(typeof raw === "string" ? raw : JSON.stringify(raw)); } catch { return ""; }
}

/**
 * 「返工签名」：**同一个签名重复出现**就是同一个问题被反复处理。
 * 返回空串 = 这个类型不参与返工判定（它只计入次数）。
 *
 * ⛔ 口径（写清楚，别猜）：
 *   · 命令  —— 同一条命令被重复执行（最典型的返工：同一个测试/构建跑第二遍）；
 *   · 文件  —— 同一个文件被反复改动；
 *   · 工具  —— 同一个 MCP / dynamic 工具带**同样的参数**再调一次（重试用）；
 *   · 联网搜索 —— 不参与（每次查询本来就不同，硬算会误报）。
 */
export function workSignature(item) {
  const type = String(item?.type ?? "");
  if (type === "commandExecution") {
    const cmd = collapse(item?.command);
    return cmd ? `cmd:${cmd}` : "";
  }
  if (type === "fileChange") {
    const path = collapse(item?.path ?? item?.file, 300);
    return path ? `file:${path}` : "";
  }
  if (type === "mcpToolCall") {
    const name = `${String(item?.server ?? "")}/${String(item?.tool ?? "")}`.trim();
    return name === "/" ? "" : `tool:${name}:${argsOf(item)}`;
  }
  if (type === "dynamicToolCall" || type === "collabAgentToolCall") {
    const name = String(item?.tool ?? "").trim();
    return name ? `tool:${name}:${argsOf(item)}` : "";
  }
  return "";
}

/**
 * 累计器：`push()` 喂**工具项**（引擎 `item/started` 的 `params.item`），命中任一条规则就返回原因。
 *
 * ⛔ 返回的是**一次性的**触发原因（命中后只报一次，`fired` 之后不再重复报）——
 *    调用方据此把本回合标记成"念正文"；回合边界必须 `reset()`（判据是**逐回合**的）。
 * ⛔ 纯状态机、零依赖：守卫 11z 直接 import 跑真值表。
 */
export function createAutoSpeakTracker(options = {}) {
  const toolLimit = Number.isFinite(Number(options.toolLimit)) ? Number(options.toolLimit) : AUTO_TOOL_CALL_LIMIT;
  const repeatLimit = Number.isFinite(Number(options.repeatLimit)) ? Number(options.repeatLimit) : REWORK_REPEAT_LIMIT;
  let count = 0;
  let fired = false;
  let reason = "";
  const seen = new Map();
  return {
    reset() { count = 0; fired = false; reason = ""; seen.clear(); },
    /** @returns {string|null} 本次触发的原因（同一个回合只会返回一次） */
    push(item) {
      if (!isWorkItem(item)) return null;
      count += 1;
      const sig = workSignature(item);
      if (sig) seen.set(sig, (seen.get(sig) ?? 0) + 1);
      if (fired) return null;
      if (count > toolLimit) { fired = true; reason = `本轮工具调用 ${count} 次`; return reason; }
      if (sig && (seen.get(sig) ?? 0) >= repeatLimit) { fired = true; reason = `同一处返工（${sig.slice(0, 80)}）`; return reason; }
      return null;
    },
    get state() { return { count, fired, reason }; },
  };
}
