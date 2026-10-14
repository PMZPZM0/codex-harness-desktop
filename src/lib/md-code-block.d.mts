// 类型声明：md-code-block.mjs 是运行时实现，tsconfig 关着 allowJs，故类型单独声明。
// 改实现时同步这里（预检守卫 12o 会跑真实实现 + react-markdown 真跑，漏改立刻红）。

/** 块级围栏（带语言 / 裸围栏 / 缩进代码块）⇒ true；行内 code ⇒ false。
 *  判据 = 带语言 **或** 文本以 `\n` 结尾（围栏恒以 \n 结尾，行内 code 不会）。 */
export declare function isBlockCode(className: unknown, text: unknown): boolean;
