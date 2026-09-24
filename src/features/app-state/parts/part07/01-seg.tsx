/**
 * usePart07a —— **组合根**（09-22：原 471 行 / 体内 33 条语句按序切成 2 段）。
 * 域：斜杠命令/评审/工作区 — 图片与文件选择 · 市场技能与插件 · 连接器与 MCP
 * ⛔ 顺序即契约：子段内含 hook 调用，调用顺序 == 原语句顺序 ⇒ 只能按文件名前缀顺序 import / 调用 / 展开。
 * ⛔ bag 只是跨 part 的旁路，不是段间通道（段间走 `return` + 入参）。
 */
import { usePart07a1 } from "./01-seg/01-command-review-workspace";
import { usePart07a2 } from "./01-seg/02-files-market-connectors";
import type { Bag } from "../bag-types";

import "@xterm/xterm/css/xterm.css";

export function usePart07a(bag: Bag) {
  const a = usePart07a1(bag);
  const b = usePart07a2(bag);

  return { ...a, ...b };
}
