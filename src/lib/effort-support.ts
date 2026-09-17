/**
 * 思考档位「供应商不支持」的自动兜底（09-18）。
 *
 * 背景：模型配置里的档位声明（`models[].efforts`）**已删除** —— 档位改成**纯会话级**
 * （菜单一律全集，选哪个落到当前会话）。代价是：某些模型/网关其实不支持某些档位
 * （OpenAI 官方只认 minimal/low/medium/high；部分国模网关不认 ultra/max），
 * 选到不支持的档位时请求会被拒 —— 以前靠"用户先在模型配置里勾掉"来避免，现在没有这个入口了。
 *
 * 应对（自动，不需要用户动手）：
 *   ① 发送失败 → 判定为「档位不支持」→ 记住「该模型不支持这一档」→ **自动降一档重发一次**；
 *   ② 菜单里把记住的档位标灰（带原因），用户仍可强制点选（万一网关后来支持了）。
 *
 * 存放：localStorage（按模型 id 分组）。纯函数 + 零依赖 —— 预检里可以直接跑断言。
 */

/** 已知档位从"最激进"到"最保守"的降级顺序（ALL_EFFORTS 之外的语义排序）。 */
export const EFFORT_LADDER = ["max", "xhigh", "ultra", "high", "medium", "low", "minimal"] as const;

/** 记不住模型（或模型 id 还没定）时用的兜底安全档 */
export const SAFE_EFFORT = "high";

const STORE_KEY = "model-blocked-efforts";

/**
 * 判定错误文本是否为「思考档位不被支持」类错误。
 * 覆盖中英文与常见改写：unsupported value / invalid value / not supported / 不支持 / 无效 / 400。
 * ⛔ 必须同时命中「档位语义」与「否定语义」两层，否则「invalid api key」会被误判成档位问题
 * （那会白白降档重发一次，还把档位记成不支持）。
 */
export function isUnsupportedEffortError(message: unknown): boolean {
  const text = String(message ?? "");
  if (!text) return false;
  const mentionsEffort = /reasoning[_\s-]?effort|reasoning\b|thinking[_\s-]?(level|effort|budget)?|\beffort\b|思考(档位|强度|等级)?/i.test(text);
  if (!mentionsEffort) return false;
  return /unsupported|not\s+supported|invalid\s+(value|enum|option|parameter)|unknown\s+(value|option)|only\s+supports|allowed\s+values|must\s+be\s+one\s+of|不支持|无效|非法|不在支持|可选值|允许的值/i.test(text);
}

/** 读「某模型已知不支持」的档位列表（坏 JSON / 非数组一律空）。 */
export function blockedEffortsOf(modelId: string | undefined | null): string[] {
  const id = String(modelId ?? "").trim();
  if (!id) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Record<string, unknown>;
    const list = raw[id];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** 记下「该模型不支持这一档」，返回更新后的列表（幂等）。 */
export function markEffortUnsupported(modelId: string | undefined | null, effort: string): string[] {
  const id = String(modelId ?? "").trim();
  const level = String(effort ?? "").trim();
  if (!id || !level) return [];
  let map: Record<string, unknown> = {};
  try { map = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Record<string, unknown>; } catch { map = {}; }
  const cur = Array.isArray(map[id]) ? (map[id] as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const next = cur.includes(level) ? cur : [...cur, level];
  map[id] = next;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(map)); } catch { /* 隐私模式：本次会话仍按返回走 */ }
  return next;
}

/** 清掉某模型的全部「不支持」记录（用户在菜单里强制选回时用）。 */
export function clearBlockedEfforts(modelId: string | undefined | null): void {
  const id = String(modelId ?? "").trim();
  if (!id) return;
  let map: Record<string, unknown> = {};
  try { map = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Record<string, unknown>; } catch { map = {}; }
  if (!(id in map)) return;
  delete map[id];
  try { localStorage.setItem(STORE_KEY, JSON.stringify(map)); } catch { /* 同上 */ }
}

/**
 * 降级：从当前档沿 EFFORT_LADDER 往保守方向找**第一个没被该模型标记为不支持**的档位。
 * 全部更低档都被标记（或已在最低档）→ 返回 null（调用方应提示用户手动改）。
 * 当前档不在阶梯里（未知档位）→ 返回 SAFE_EFFORT。
 */
export function pickEffortFallback(current: string, blocked: readonly string[] = []): string | null {
  const idx = (EFFORT_LADDER as readonly string[]).indexOf(String(current ?? "").trim());
  if (idx < 0) return SAFE_EFFORT;
  const set = new Set(blocked);
  for (let i = idx + 1; i < EFFORT_LADDER.length; i += 1) {
    const candidate = EFFORT_LADDER[i];
    if (candidate && !set.has(candidate)) return candidate;
  }
  return null;
}
