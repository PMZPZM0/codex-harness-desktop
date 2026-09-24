/**
 * useHarnessApp —— App 的**状态与动作**总入口（09-21 从 App.tsx 组件体整块抽来）。
 * 本文件现在只是**组合根**：建 ctx → 按序调用各 part → return。
 * ⛔ 顺序即契约：part 内含 hook 调用，顺序变化会让 state 归属错位。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { usePart01 } from "./parts/part01";
import { usePart02 } from "./parts/part02";
import { usePart03 } from "./parts/part03";
import { usePart04 } from "./parts/part04";
import { usePart05 } from "./parts/part05";
import { usePart06 } from "./parts/part06";
import { usePart07 } from "./parts/part07";
import { usePart08 } from "./parts/part08";
import { usePart09 } from "./parts/part09";
import type { Bag } from "./parts/bag-types";

/* 本 hook 的对外返回类型（供视图层标注 props；type-only）*/
export type HarnessAppApi = ReturnType<typeof useHarnessApp>;

export function useHarnessApp() {
  // ctx 跨 part 共享：新声明写进去，延迟求值的引用（含前向引用）读出来。
  const ctxRef = useRef<any>(null);
  if (!ctxRef.current) ctxRef.current = {};
  // bag 标注为 Bag（自动生成的接口）：跨段引用保留具体类型 ⇒ 消掉隐式 any 级联
  const bag: Bag = ctxRef.current;
  const p01 = usePart01(bag);
  const p02 = usePart02(bag);
  const p03 = usePart03(bag);
  const p04 = usePart04(bag);
  const p05 = usePart05(bag);
  const p06 = usePart06(bag);
  const p07 = usePart07(bag);
  const p08 = usePart08(bag);
  const p09 = usePart09(bag);

  return { ...p01, ...p02, ...p03, ...p04, ...p05, ...p06, ...p07, ...p08, ...p09 };
}
