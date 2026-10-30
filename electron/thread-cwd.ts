/**
 * threadId → 该会话的工作目录（记忆捕获 / 文件追踪 / 委派工作区反查的唯一来源）。
 *
 * ⛔ 单独一个叶子模块（零 import）就是为了**让 codex-server 也能写它** —— 它原来住在
 * `runtime-refs.ts`，而 runtime-refs 反过来 import `codex-server`（要 CodexServer 类）：
 * 两边互相 import 就会成环，CJS 下拿到的是半初始化的导出（tsc 不报错、运行时静默错）。
 * 真相源仍然只有这一份；`runtime-refs` 只是把它再导出给既有 import 点（别改那些调用方）。
 */
export const threadCwd = new Map<string, string>();
