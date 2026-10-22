/**
 * 当前打开会话 → 宠物活动气泡的「跟随」桥（10-22）。
 *
 * 活动列表在主进程，切会话只是一个渲染层状态；这里把 threadId 报上去，
 * 主进程立刻把该会话的活动提到第一位并 publish（不等下一条引擎事件）。
 * ⛔ 只报 id，不传标题/状态（主进程已有归约，别造第二份）。
 */
import { useEffect } from "react";

export function PetFocusBridge({ threadId }: { threadId: string }) {
  useEffect(() => {
    void window.codex.petFocusThread?.(threadId).catch(() => undefined);
  }, [threadId]);
  return null;
}
