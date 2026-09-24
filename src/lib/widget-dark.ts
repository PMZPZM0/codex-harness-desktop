/**
 * 独立窗口（widget）的深色模式标记（09-21 从 App.tsx 收敛而来）。
 *
 * 原先是 `let widgetDark = false` + App 里直接赋值，模块级组件用 `isWidgetDark()` 读。
 * 和 UI 通道同一类问题：模块级可变变量，搬进独立模块后 ESM 不允许对 import 的绑定赋值（TS2632）。
 * 收敛为「setter + getter」，外部只准通过 setWidgetDark 改。
 */
let dark = false;
export function setWidgetDark(value: boolean): void { dark = value; }
export function isWidgetDark(): boolean { return dark; }
