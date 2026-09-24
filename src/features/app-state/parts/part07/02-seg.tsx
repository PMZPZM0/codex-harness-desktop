/**
 * usePart07b —— **组合根**（09-22：原 424 行 / 体内 61 条语句按序切成 2 段）。
 * 域：连接器与 MCP 开关 · 子代理 · 专家团 — 团队会话 · 技能导入 · 粘贴图片
 * ⛔ 顺序即契约：子段内含 hook 调用，调用顺序 == 原语句顺序 ⇒ 只能按文件名前缀顺序 import / 调用 / 展开。
 * ⛔ bag 只是跨 part 的旁路，不是段间通道（段间走 `return` + 入参）。
 */
import { usePart07b1 } from "./02-seg/01-connectors-subagents-teams";
import { usePart07b2 } from "./02-seg/02-team-sessions-skills";
import type { Bag } from "../bag-types";

import "@xterm/xterm/css/xterm.css";

export function usePart07b(bag: Bag) {
  const a = usePart07b1(bag);
  const b = usePart07b2(bag);

  return { ...a, ...b };
}
