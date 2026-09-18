/**
 * `react-syntax-highlighter` 内部模块的类型声明。
 *
 * 为什么需要：库只给入口（`react-syntax-highlighter`）提供了 `@types`，而我们要直接用它的
 * `create-element`（把高亮 AST 转成 React 元素树的默认渲染函数）来接一层结果缓存——
 * 见 `src/lib/code-highlight-cache.mjs` 顶部「根因/修法」注释。
 */
declare module "react-syntax-highlighter/dist/esm/create-element" {
  import type { CSSProperties, ReactNode } from "react";
  /** node 是 refractor 产出的 hast 节点；返回该节点的 React 元素（text 节点直接返回字符串） */
  export default function createElement(options: {
    node: unknown;
    stylesheet?: Record<string, CSSProperties>;
    useInlineStyles?: boolean;
    key?: string | number;
    style?: CSSProperties;
  }): ReactNode;
}
