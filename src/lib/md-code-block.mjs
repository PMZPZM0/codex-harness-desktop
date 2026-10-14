/**
 * md-code-block.mjs —— 「块级围栏 vs 行内 code」的判据（纯函数 ⇒ 预检守卫可跑真值表 + 真跑）。
 *
 * 10-15 用户截图：「三块里就中间的没有[复制按钮]」—— 中间那块是 ``` 后**不写语言**的提交列表。
 * 根因：`MdCode` 里原先用 `if (!className) return <code>` 区分「行内 code」，而**裸围栏的
 * className 同样为空** ⇒ 它跟行内代码一起被提前 return 掉：既不高亮、也没有复制按钮
 * （10-14 那轮只给**带语言**的代码块补了按钮）。
 *
 * 判据实测（react-markdown + remark-gfm，见守卫 12o 的真跑段）：
 *   · 块级围栏（带语言 / 不带语言 / 四空格缩进代码块）的文本**恒以 `\n` 结尾**；
 *   · 行内 code **不会** —— CommonMark 把行内跨行的换行折成空格，末尾也不留 `\n`。
 * ⛔ 空的裸围栏（``` 后立刻闭围栏）文本为空 ⇒ 判成行内（没有按钮，但也没内容可复制）。
 *
 * ⛔ 判据**只此一份**：组件与守卫都从这里取，别在组件里内联同名表达式（改一处漏一处）。
 */
export function isBlockCode(className, text) {
  return Boolean(className) || /\n$/.test(String(text ?? ""));
}
