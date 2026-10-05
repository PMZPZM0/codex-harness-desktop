/**
 * 消息操作按钮的「两段反馈」（10-05 用户：「所有的图标都要做两段动画，比如复制成功反馈，收藏，收藏成功两段」）
 *
 * 两段：① 按下去 → 图标弹一下并换成"已经生效"的样子（对勾 / 实心星）；
 *      ② 停一会儿 → 颜色和图标淡回原样。动画本体在 CSS（`[data-phase="done"]`），
 *      这里只管状态与计时 —— 视觉归样式、时序归组件。
 *
 * ⛔ 反馈是**乐观的**：这些动作的出口类型是 `() => void`（part03 的 `FoldHandlers` 刻意把 promise 抹平，
 *   就是为了不让一个装饰性动画穿着几层 prop 走）。真失败时另有 toast / notice 报出来，
 *   **不要**把这个对勾当成成败依据。
 *   唯一的例外是「收藏」：`requestFavorite()` 会返回"有没有人接住"，没人接就不演成功。
 * ⛔ 定时器必须在卸载时清掉（消息行会被虚拟列表反复挂卸），也别挂在某个渲染分支上重置。
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/** 成功态停留时长：短于一次"看清图标变了"的时间，长到不会被当成没反应。 */
const DONE_MS = 1100;

export function FeedbackIconButton({ className, title, doneTitle, icon, doneIcon, label, doneLabel, onFire }: {
  className?: string;
  title: string;
  doneTitle: string;
  icon: ReactNode;
  doneIcon: ReactNode;
  label?: string;
  doneLabel?: string;
  /** 返回 `false` = 明确没做成（不演成功）；其余（含 undefined）一律演成功。 */
  onFire: () => void | boolean;
}) {
  const [done, setDone] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const fire = () => {
    if (onFire() === false) return;
    setDone(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(false), DONE_MS);
  };

  const text = done ? (doneLabel ?? label) : label;
  return (
    <button type="button" className={className} data-phase={done ? "done" : "idle"} title={done ? doneTitle : title} onClick={fire}>
      {done ? doneIcon : icon}
      {text ? <span>{text}</span> : null}
    </button>
  );
}
