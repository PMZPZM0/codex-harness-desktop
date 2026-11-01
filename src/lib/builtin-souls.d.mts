/** builtin-souls.mjs 的类型面（渲染层 tsc 要求 .mjs 配 .d.mts；与 feishu-card.d.mts 同款）。 */

export type BuiltInSoul = {
  slug: string;
  displayName: string;
  summary: string;
  version: string;
  content: string;
};

export declare const BUILT_IN_SOULS: BuiltInSoul[];

export declare function getBuiltInSoul(slug: string): BuiltInSoul | undefined;

export declare function isBuiltInSoulSlug(slug: string): boolean;
