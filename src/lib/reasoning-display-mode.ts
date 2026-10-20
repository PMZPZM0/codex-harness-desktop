/**
 * 思考板块展示方式（10-20 用户需求）：
 *   · "auto"  = 现在的自适应浮窗（默认）——与输入框同宽同列，按空间向上/向下展开；
 *   · "strip" = 消息流内的长条，按行展示思考正文，点击展开全文。
 * 只影响渲染层，不碰引擎/会话数据；localStorage 持久化并在同窗/跨窗即时同步。
 */
import { useEffect, useState } from "react";

export type ReasoningDisplayMode = "auto" | "strip";

const KEY = "reasoning-display-mode";
const EVENT = "codex:reasoning-display-mode";

export function getReasoningDisplayMode(): ReasoningDisplayMode {
  try {
    return localStorage.getItem(KEY) === "strip" ? "strip" : "auto";
  } catch {
    return "auto";
  }
}

export function setReasoningDisplayMode(mode: ReasoningDisplayMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch { /* 隐私模式/配额满：本次仍靠事件即时生效 */ }
  try {
    window.dispatchEvent(new CustomEvent<ReasoningDisplayMode>(EVENT, { detail: mode }));
  } catch { /* 非浏览器环境（测试）忽略 */ }
}

export function useReasoningDisplayMode(): ReasoningDisplayMode {
  const [mode, setMode] = useState<ReasoningDisplayMode>(getReasoningDisplayMode);
  useEffect(() => {
    const onLocal = (event: Event) => {
      setMode((event as CustomEvent<ReasoningDisplayMode>).detail === "strip" ? "strip" : "auto");
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === KEY) setMode(getReasoningDisplayMode());
    };
    window.addEventListener(EVENT, onLocal);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onLocal);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return mode;
}
