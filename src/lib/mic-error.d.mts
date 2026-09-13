// 类型声明：mic-error.mjs 是运行时实现，tsconfig 关着 allowJs，故类型单独声明。
// 改实现时同步这里（预检的纯逻辑断言跑真实实现，漏改会立刻红）。

/** getUserMedia 的 DOMException（或任意错误）→ 人话 + 排查提示 */
export declare function describeMicError(error: unknown): string;
