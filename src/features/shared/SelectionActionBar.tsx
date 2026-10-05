/**
 * 选中文字后浮出的操作条（10-05 用户：「对话框加一个选择文字，自动弹出来 复制和添加到对话两个选项，
 * 记得做好反馈效果」，参照 WorkBuddy 的同款交互）
 *
 * 只在**消息时间线内**生效，两个动作都复用现成的通道，不另造实现：
 *   复制 → `messageHandlers.onCopy`（= `bag.copyMessage`，写剪贴板 + 那条「消息已复制」提示）
 *   添加到对话 → `quoteMessage`（输入框上方那条可取消的引用条，发送时才拼成块引用）
 * 反馈沿用 `FeedbackIconButton` 的两段动画（对勾 / 弹一下 / 1.1 秒回位），与消息脚部同一套。
 *
 * ⛔ 三个必须让开的场景（都实测过会误弹）：
 *   ① 输入框 / textarea 里的选区 —— 那是浏览器原生菜单的地盘，抢过来只会更难用；
 *   ② 选区锚点或终点有一头在时间线外（跨着选到侧栏/输入框）；
 *   ③ 时间线一滚动就收起 —— 浮条是按视口坐标定位的，跟着滚必然错位。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Check, Copy, Plus } from "lucide-react";
import { ACTION_FEEDBACK_MS, FeedbackIconButton } from "./FeedbackIconButton";

/** 浮条与选区的间距，以及它自身的高度（定位用，与 CSS 里的值一致）。 */
const GAP = 8;
const BAR_HEIGHT = 30;
/** 半宽估算：两枚按钮 + 文案 ≈ 210px，用来把浮条夹在视口内。 */
const HALF_WIDTH = 108;

type Placement = { left: number; top: number; above: boolean };

export function SelectionActionBar({ containerRef, onCopy, onAppend }: {
  containerRef: { current: HTMLElement | null };
  onCopy: (text: string) => void;
  onAppend: (text: string) => void;
}) {
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [text, setText] = useState("");
  /** 动作已触发 ⇒ 这段时间内**不许**因为选区被清/失焦而收起浮条，否则两段反馈没人看得见。 */
  const holdUntilRef = useRef(0);
  const holdTimer = useRef(0);
  const close = useCallback(() => setPlacement(null), []);

  const measure = useCallback(() => {
    if (Date.now() < holdUntilRef.current) return;
    const host = containerRef.current;
    const selection = window.getSelection();
    if (!host || !selection || selection.isCollapsed || selection.rangeCount === 0) { setPlacement(null); return; }
    const range = selection.getRangeAt(0);
    if (!host.contains(range.commonAncestorContainer) || !host.contains(selection.anchorNode)) { setPlacement(null); return; }
    // 输入框里的选区交给浏览器原生菜单（⛔ 别在这里抢）
    const focusNode = selection.focusNode;
    const focusElement = focusNode?.nodeType === 1 ? (focusNode as HTMLElement) : (focusNode?.parentElement ?? null);
    if (focusElement?.closest("input, textarea, [contenteditable]")) { setPlacement(null); return; }
    const value = selection.toString();
    if (!value.trim()) { setPlacement(null); return; }
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) { setPlacement(null); return; }
    const above = rect.top - GAP - BAR_HEIGHT > 4;
    setPlacement({
      left: Math.min(Math.max(rect.left + rect.width / 2, HALF_WIDTH + 8), window.innerWidth - HALF_WIDTH - 8),
      top: above ? rect.top - GAP : rect.bottom + GAP,
      above,
    });
    setText(value);
  }, [containerRef]);

  useEffect(() => {
    document.addEventListener("selectionchange", measure);
    const host = containerRef.current;
    // 一滚就收：浮条按视口坐标定位，跟着滚必然错位（宁可让用户重新选一次）
    host?.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("selectionchange", measure);
      host?.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [measure, close, containerRef]);

  useEffect(() => () => window.clearTimeout(holdTimer.current), []);

  if (!placement) return null;

  const act = (run: () => void, clearSelection: boolean) => {
    run();
    /* ⛔ 不能立刻卸载浮条：两段反馈就挂在浮条里的按钮上，先卸载等于"点了没反应"。
       而且 Chromium 里点非编辑区会顺手清掉选区 ⇒ selectionchange 也会来收一次，
       所以 holdUntilRef 同时挡住那条路径，等反馈播完再收。 */
    holdUntilRef.current = Date.now() + ACTION_FEEDBACK_MS + 200;
    window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => {
      holdUntilRef.current = 0;
      setPlacement(null);
      if (clearSelection) window.getSelection()?.removeAllRanges();
    }, ACTION_FEEDBACK_MS);
  };

  const buttons: ReactNode[] = [
    <FeedbackIconButton key="copy" className="selection-action" title="复制所选文字" doneTitle="已复制"
      icon={<Copy size={12} />} doneIcon={<Check size={12} />} label="复制"
      onFire={() => act(() => onCopy(text), false)} />,
    <FeedbackIconButton key="append" className="selection-action" title="添加到对话（在输入框上方形成可取消的引用）" doneTitle="已添加到对话"
      icon={<Plus size={12} />} doneIcon={<Check size={12} />} label="添加到对话"
      onFire={() => act(() => onAppend(text), true)} />,
  ];

  return (
    <>
      {/* 透明垫层：点别处就收起。⛔ 不用 document 上的 mousedown —— 那会在按钮真正响应之前
          把浮条卸掉，表现就是"点了没反应"。 */}
      <div className="selection-action-scrim" onPointerDown={close} />
      <div className="selection-action-bar" role="toolbar" aria-label="所选文字操作"
        style={{ left: placement.left, top: placement.top, transform: placement.above ? "translate(-50%, -100%)" : "translate(-50%, 0)" }}>
        {buttons}
      </div>
    </>
  );
}
