// 类型声明：md-table-text.mjs 是运行时实现，tsconfig 关着 allowJs，故类型单独声明。
// 改实现时同步这里（预检守卫会跑真实实现，漏改会立刻红）。

/** 把表格的行集合拼成 TSV（单元格 Tab、行换行）；无内容返回空串。
 *  入参鸭子类型：行有 `cells`，单元格有 `textContent`（真 DOM 与普通对象都能喂）。 */
export declare function tableToTsv(rows: unknown): string;
