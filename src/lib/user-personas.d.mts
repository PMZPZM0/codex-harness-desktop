/** user-personas.mjs 的类型面（渲染层 tsc 要求 .mjs 配 .d.mts；与 feishu-card.d.mts 同款）。 */

export type UserPersona = {
  id: string;
  label: string;
  occupation: string;
  userContext: string;
  tools: string[];
  interests?: string;
  habits?: string;
  about?: string;
  replyStyle?: string;
  tone?: string;
  field?: string;
  bio?: string;
};

export declare const USER_PERSONAS: UserPersona[];

/** 应用一个用户人格时写入档案的完整字段集（11-01 起含 field/bio/hobby/habit 等用户中心绑定键）。 */
export declare function userPersonaFields(personaId: string): Record<string, string> | null;

/** 联动套餐（11-01）：用户人格 × 内置 Codex 人格（soulSlug 指向 skillhub-souls 的 BUILT_IN_SOULS）。 */
export type ComboPack = { id: string; label: string; userPersonaId: string; soulSlug: string; desc: string };

export declare const COMBO_PACKS: ComboPack[];

export declare function comboPackById(packId: string): ComboPack | null;
