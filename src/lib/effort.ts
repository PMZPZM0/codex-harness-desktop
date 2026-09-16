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
 * 声明（模型编辑器可配）；未声明时默认四档 低/中/高/极高（09-16 用户定稿）。
 * UI 菜单按模型声明过滤，buildModelCatalog（主进程）写进 catalog 的
 * supported_reasoning_levels 也从同一 efforts 收口。目录声明只决定选项，
 * 不能证明上游实际采用该强度。GPT 系模型可额外声明 minimal/最高(ultra)。
 *
 * 菜单展示顺序 = 数组顺序（去掉 minimal 后正好是用户要的「低 中 高 最高 极高」）：
 *   low=低 · medium=中 · high=高 · ultra=最高（引擎扩展档，按模型映射） · xhigh=极高
 */
// 保留该顺序；ultra 是模型相关扩展档，不保证高于 high/xhigh。
export const ALL_EFFORTS = ["minimal", "low", "medium", "high", "ultra", "xhigh"] as const;
export const CUSTOM_MODEL_EFFORTS = ["low", "medium", "high", "xhigh"] as const;

/** 非法/历史遗留档位值归一：空值原样返回（表示未设置），不认识的回退默认档。 */
export function normalizeEffort(value: string | null | undefined): string {
  if (!value) return "";
  return (ALL_EFFORTS as readonly string[]).includes(value) ? value : DEFAULT_EFFORT;
}

/**
 * 模型声明的档位列表 → UI 菜单/catalog 实际可选项。
 * ① 未声明（undefined / 空数组）→ 新默认四档；② 旧版自动生成的声明（精确等于
 * 低/中/高 三档，或三档+最高 的组合，且没有极高）→ 自动补「极高」(xhigh)——这些
 * 声明是旧版 changeEffort 自动落库的，不是用户刻意收窄；不补的话老档案升版后
 * 菜单里凭空少一档、引擎 catalog 同步缺档会导致选了被拒。其余显式声明（如只剩
 * ["high"]、含 minimal 的组合）一律原样尊重。UI 与主进程 buildModelCatalog 同用本规则。
 */
export function declaredModelEfforts(declared: readonly string[] | undefined | null): string[] {
  const allowed = ALL_EFFORTS as readonly string[];
  const cleaned = (declared ?? []).filter((effort): effort is string => allowed.includes(effort));
  if (!cleaned.length) return [...CUSTOM_MODEL_EFFORTS];
  const hasBase = ["low", "medium", "high"].every((e) => cleaned.includes(e));
  const legacyAuto = hasBase && !cleaned.includes("xhigh") && cleaned.every((e) => ["low", "medium", "high", "ultra"].includes(e));
  return legacyAuto ? [...cleaned, "xhigh"] : cleaned;
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
