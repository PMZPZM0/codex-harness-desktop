/**
 * 推理强度默认值与选档规则。
 *
 * 实测依据（scripts/diag-engine-slow.py 读引擎 otel 日志）：
 * 一次 turn 里引擎本地开销不到 0.1s（技能影子选择 12 个方法合计 ~70ms），
 * 8.8s 几乎全消耗在上游 /v1/responses。因此「回复慢」的唯一可调杠杆是
 * 让上游少算——ultra/xhigh 档会大幅增加 reasoning token，首字与总时长都成倍上涨。
 * 默认给 high：能力足够，且明显快于顶格档。
 */
export const DEFAULT_EFFORT = "high";

/**
 * 思考档位全集。每个自定义模型实际支持哪些档位由该模型条目自身的 efforts
 * 声明（模型编辑器可配）；未声明时默认三档 low/medium/high。UI 菜单按模型
 * 声明过滤，buildModelCatalog（主进程）写进 catalog 的 supported_reasoning_levels
 * 也从同一 efforts 收口——两处同源，引擎按 catalog 校验 effort。
 * GPT 系模型可声明 minimal/xhigh/ultra 更多档位。
 */
// 显示顺序 = 强度递增：极少 低 中 高 最高 max——「最高」排在 max 之前（2026-09-04 用户要求）。
export const ALL_EFFORTS = ["minimal", "low", "medium", "high", "ultra", "xhigh"] as const;
export const CUSTOM_MODEL_EFFORTS = ["low", "medium", "high"] as const;

/** 非法/历史遗留档位值归一：空值原样返回（表示未设置），不认识的回退默认档。 */
export function normalizeEffort(value: string | null | undefined): string {
  if (!value) return "";
  return (ALL_EFFORTS as readonly string[]).includes(value) ? value : DEFAULT_EFFORT;
}

/** 从模型声明的强度列表里挑默认档：有 high 就用 high，否则退回最高档。 */
export function pickDefaultEffort(
  supported: ({ reasoningEffort: string } | string)[] | undefined,
  fallback?: string,
): string {
  const names = (supported ?? [])
    .map((entry) => (typeof entry === "string" ? entry : entry?.reasoningEffort))
    .filter((name): name is string => Boolean(name));
  if (names.includes(DEFAULT_EFFORT)) return DEFAULT_EFFORT;
  return names.at(-1) ?? fallback ?? DEFAULT_EFFORT;
}
