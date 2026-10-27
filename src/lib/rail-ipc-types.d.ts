/**
 * 输入框竖条 + 两个本地库的**唯一类型来源**（10-27 审查后收口）。
 *
 * 为什么要单独一个文件：这些形状**跨进程**用 —— 主进程 `electron/features/{vault,journal,extensions}-ipc.ts`
 * 按它落盘/返回，渲染层 `vite-env.d.ts` 的生成段按它声明返回值。以前两边各写一份，
 * 改一处忘另一处就会悄悄漂移（本仓有过同类前车之鉴）。
 *
 * ⛔ 本文件必须**零 import**：主进程 tsconfig 不含 `src/`、渲染层 tsconfig 不含 `electron/`，
 *    只有"无依赖的纯类型文件"才能被两边同时安全引用（带 node: 依赖会让另一边编不过）。
 */
export type VaultItem = {
  id: string;
  title: string;
  username?: string;
  url?: string;
  note?: string;
  /** 有密码 = true。⛔ 明文永远不返回渲染层（复制走 vaultCopy，由主进程写剪贴板） */
  hasSecret: boolean;
  updatedAt: string;
};

export type JournalDay = { date: string; title: string; bytes: number; updatedAt: string };

export type ExtAction =
  | { type: "url"; target: string }
  | { type: "settings"; target: string }
  | { type: "text"; body: string };

export type RailPanelSpec = {
  id: string;
  label: string;
  icon?: string;
  kind: "builtin" | "external";
  action?: ExtAction;
  order?: number;
};

export type MenuEntrySpec = { id: string; label: string; icon?: string; action: ExtAction; order?: number };

/* 渲染层是 global .d.ts：把上面这份"模块里的类型"挂回全局，生成段才认得到这些名字。 */
declare global {
  type VaultItem = import("./rail-ipc-types").VaultItem;
  type JournalDay = import("./rail-ipc-types").JournalDay;
  type ExtAction = import("./rail-ipc-types").ExtAction;
  type RailPanelSpec = import("./rail-ipc-types").RailPanelSpec;
  type MenuEntrySpec = import("./rail-ipc-types").MenuEntrySpec;
}
