/** boot-intro.mjs 的类型面（实现是未检查的 .mjs，见 src/lib/*.mjs 范式）。 */

export type BootIntroMode = "simple" | "full" | "off";

/** localStorage 的最小结构面（不依赖 DOM lib，node 侧也能声明）。 */
export interface BootIntroStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export declare const BOOT_INTRO_STORAGE_KEY: "boot-intro";
export declare const BOOT_INTRO_MODES: readonly BootIntroMode[];
export declare const BOOT_INTRO_DEFAULT_MODE: BootIntroMode;

export declare function normalizeBootIntroMode(value: unknown): BootIntroMode;
export declare function readBootIntroMode(storage: BootIntroStorage | null | undefined): BootIntroMode;
export declare function writeBootIntroMode(storage: BootIntroStorage | null | undefined, mode: unknown): void;
export declare function bootIntroModeLabel(mode: unknown): string;
export declare function shouldPlayBootIntro(
  mode: unknown,
  ctx?: { reducedMotion?: boolean; petWindow?: boolean }
): boolean;
export declare function bootIntroPlayMode(mode: unknown): "simple" | "full";

export type BootIntroScheme = "amber" | "green" | "cyan" | "white";
export declare const BOOT_INTRO_SCHEME_KEY: "boot-intro-scheme";
export declare const BOOT_INTRO_SCHEMES: readonly BootIntroScheme[];
export declare const BOOT_INTRO_DEFAULT_SCHEME: BootIntroScheme;
export declare function normalizeBootIntroScheme(value: unknown): BootIntroScheme;
export declare function readBootIntroScheme(storage: BootIntroStorage | null | undefined): BootIntroScheme;
export declare function writeBootIntroScheme(storage: BootIntroStorage | null | undefined, scheme: unknown): void;
export declare function bootIntroSchemeLabel(scheme: unknown): string;
/** 琥珀返回空串（= 不设 data-scheme）。 */
export declare function bootIntroSchemeAttr(scheme: unknown): string;
