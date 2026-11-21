/** GitHub 加速前缀与候选序（实现在 github-mirror.mjs，主进程与渲染层共用同一份）。 */

export declare const GH_MIRROR_PREFIXES: readonly string[];
export declare const GH_API_MIRROR_PREFIXES: readonly string[];
export declare const GH_MIRRORABLE_HOSTS: ReadonlySet<string>;

/** 一个 URL 的全部候选（非 GitHub host 恒返回单元素；API 与资产不同序）。 */
export declare function mirrorCandidates(url: string): string[];
