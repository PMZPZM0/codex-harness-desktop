/**
 * 推理强度默认值与选档规则。
 *
 * 请求强度不是固定的思考时长或 Token 预算，也不代表供应商必然支持。
 * 引擎可映射扩展档位：0.153.4 对 deepseek-v4-flash 的 ultra 实际发送 high。
 * 请求落点回归测试见 scripts/verify-reasoning-transport.cjs。
 */
export const DEFAULT_EFFORT = "high";

/**
 * 思考档位全集。每个自定义模型实际支持哪些档位由该模型条目自身的 efforts
 * 声明（模型编辑器可配）；未声明时默认三档 low/medium/high。UI 菜单按模型
 * 声明过滤，buildModelCatalog（主进程）写进 catalog 的 supported_reasoning_levels
 * 也从同一 efforts 收口。目录声明只决定选项，不能证明上游实际采用该强度。
 * GPT 系模型可声明 minimal/xhigh/ultra 更多档位。
 */
// 保留历史菜单顺序；ultra 是模型相关扩展档，不保证高于 high/xhigh。
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
