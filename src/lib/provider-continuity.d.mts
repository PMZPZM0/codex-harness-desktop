// 类型声明：provider-continuity.mjs 是运行时实现，tsconfig 关着 allowJs，故类型单独声明。
// 改实现时同步这里（预检的纯逻辑断言会跑真实实现，漏改会立刻红）。

/** 统一内置 provider id：新建会话一律绑它，永远指向当前生效供应商（切供应商零迁移）。 */
export declare const HARNESS_PROVIDER_ID: "harness";

/** 是否需要把会话对齐到当前激活供应商（绑定未知一律 false —— 不猜）。 */
export declare function shouldAlignProvider(boundProvider?: string | null, activeProvider?: string | null): boolean;

/** 「自动接力」统一文案（label 形如 `供应商名 · 模型名`）。 */
export declare const CONTINUITY_TEXT: {
  aligning: (label: string) => string;
  migrated: (label: string) => string;
  relayed: (label: string) => string;
  failed: (label: string) => string;
};

/** 接力结果语义（勿用裸字符串比较）。 */
export declare const ALIGN_RESULT: {
  same: "same";
  migrated: "migrated";
  relayed: "relayed";
  failed: "failed";
};
