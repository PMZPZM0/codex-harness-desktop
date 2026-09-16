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
 * 不能证明上游实际采用该强度。GPT 系模型可额外声明 minimal 与扩展高位档。
 *
 * ⛔ 09-16 修正（修 Bug 12）：旧注释写「引擎 catalog 同步缺档会导致选了被拒」——
 * 这个前提**已被真实引擎探针证伪**：引擎**完全不校验** effort（自定义模型与内置模型的
 * `effort="bogus-level"` 都被照单全收，turn 正常完成）。所以本白名单只决定
 * 「UI 给用户看什么 / catalog 声明什么」，不是安全边界、也不会让 turn 被拒。
 * 旧白名单漏了 `max`，而**引擎自己的**内置模型 gpt-6-astra 就声明了 max
 * （low/medium/high/xhigh/max/ultra）⇒ 声明了 max 的模型在 UI 里反而没有 max 可选；
 * 「只声明 max」更糟：过滤后为空会回落成整套默认档，等于替用户换了一套他没声明的档位。
 * `max` 追加在末尾，避免打乱已定稿的「低 中 高 最高 极高」展示顺序。
 */
// 保留该顺序；ultra 是模型相关扩展档，不保证高于 high/xhigh；max 是引擎内置模型的扩展档。
export const ALL_EFFORTS = ["minimal", "low", "medium", "high", "ultra", "xhigh", "max"] as const;
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
 * 声明是旧版 changeEffort 自动落库的，不是用户刻意收窄。其余显式声明（如只剩
 * ["high"]、含 minimal / **max** 的组合）一律原样尊重。
 *
 * ⛔ 09-16：旧注释里的「不补的话老档案升版后菜单里凭空少一档、引擎 catalog 同步缺档会导致
 * 选了被拒」**前提不成立**（引擎不校验 effort，见 ALL_EFFORTS 上方实证说明）；
 * 补 xhigh 仍是合理的产品行为（旧档位不该消失），但**不能**因此把用户显式声明的
 * `max` 过滤掉 —— 含 max 的组合不再被判定成 legacyAuto（修 Bug 12）。
 * UI 与主进程 buildModelCatalog 同用本规则。
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
