/** 推荐专家配置的类型声明（与 recommended-experts.mjs 同源，只声明形状）。 */
export type RecommendedExpert = {
  /** 用于判断"是不是已经建过"（按主理人名匹配）。 */
  leadName: string;
  team: Record<string, unknown>;
};

export const RECOMMENDED_EXPERTS: RecommendedExpert[];
