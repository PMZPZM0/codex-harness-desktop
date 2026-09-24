/**
 * usePart03c —— **组合根**（09-22：原 503 行 / 体内 72 条语句按序切成 2 段）。
 * 域：重启与文件预览编辑 · 并发上限与模型编辑器
 * ⛔ 顺序即契约：子段内含 hook 调用，调用顺序 == 原语句顺序 ⇒ 只能按文件名前缀顺序 import / 调用 / 展开。
 * ⛔ bag 只是跨 part 的旁路，不是段间通道（段间走 `return` + 入参）。
 */
import { usePart03c1 } from "./03-restart-file-model-editor/01-restart-file-preview";
import { usePart03c2 } from "./03-restart-file-model-editor/02-concurrency-model-editor";
import type { Bag } from "../bag-types";

import "@xterm/xterm/css/xterm.css";
import type { usePart03b } from "./02-composer-memory-models";

export function usePart03c(bag: Bag, ibB: ReturnType<typeof usePart03b>) {
  const a = usePart03c1(bag, ibB);
  const b = usePart03c2(bag);

  return { ...a, ...b };
}
