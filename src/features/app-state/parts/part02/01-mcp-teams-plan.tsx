/**
 * usePart02a —— **组合根**（09-22：原 422 行 / 体内 193 条语句按序切成 2 段）。
 * 域：MCP 覆盖与工具权限 · 子代理状态 — 专家团映射/角色记忆/待导入
 * ⛔ 顺序即契约：子段内含 hook 调用，调用顺序 == 原语句顺序 ⇒ 只能按文件名前缀顺序 import / 调用 / 展开。
 * ⛔ bag 只是跨 part 的旁路，不是段间通道（段间走 `return` + 入参）。
 */
import { usePart02a1 } from "./01-mcp-teams-plan/01-mcp-subagents-state";
import { usePart02a2 } from "./01-mcp-teams-plan/02-team-roles-import";
import type { Bag } from "../bag-types";

import "@xterm/xterm/css/xterm.css";

export function usePart02a(bag: Bag) {
  const a = usePart02a1(bag);
  const b = usePart02a2(bag);

  return { ...a, ...b };
}
