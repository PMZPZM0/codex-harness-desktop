/**
 * 选中文字后浮出的操作条（10-05 用户：「对话框加一个选择文字，自动弹出来 复制和添加到对话两个选项，
 * 记得做好反馈效果」，参照 WorkBuddy 的同款交互）
 *
 * 只在**消息时间线内**生效，两个动作都复用现成通道，不另造实现：
 *   复制 → `onCopy`（= `bag.copyMessage`，写剪贴板 + 那条「消息已复制」提示）
 *   添加到对话 → `onAppend`（= `quoteMessage`，输入框上方那条可取消的引用条）
 * 反馈沿用 `FeedbackIconButton` 的两段动画，与消息脚部同一套。
 *
 * ⛔ 必须 `createPortal` 到 `document.body`（10-05 用户实测：浮条跑到窗口顶上、点不动）。
 *   挂在时间线里 = 吃祖先元素的坑：主舞台上有动画/`transform`/`filter` 的祖先会让
 *   `position: fixed` **不再相对视口**（规范如此：变换会创建包含块），坐标就全错了。
 *   同仓的轻浮层 `components/AppSelect.tsx` 早就是 portal + 全屏透明遮罩这套做法，照它办。
 *
 * ⛔ 定位取**最后一个 client rect**（= 拖拽结束那一行），不取整个选区的 union rect：
 *   跨段选区的 union rect 高几百像素、上沿常在视口外，浮条就会离用户刚选的东西很远。
 * ⛔ 滚动/改窗口大小是**重新定位**而不是收起：选区还在，收起等于让人白选一次。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Plus } from "lucide-react";
import { ACTION_FEEDBACK_MS, FeedbackIconButton } from "./FeedbackIconButton";

const GAP = 8;
const BAR_HEIGHT = 30;
/** 半宽估算（两枚按钮 + 文案 ≈ 200px），用来把浮条夹在视口内。 */
const HALF_WIDTH = 100;
const EDGE = 8;

type Placement = { left: number; top: number; above: boolean };

/** 读一次"够格"的选区：两头都在时间线内、不在输入框里、有实际文字。 */
function readQualifiedSelection(host: HTMLElement | null) {
  const selection = window.getSelection();
  if (!host || !selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!host.contains(range.commonAncestorContainer) || !host.contains(selection.anchorNode)) return null;
  // 输入框 / textarea 里的选区交给浏览器原生菜单（⛔ 别抢）
  const focusNode = selection.focusNode;
  const focusElement = focusNode?.nodeType === 1 ? (focusNode as HTMLElement) : (focusNode?.parentElement ?? null);
  if (focusElement?.closest("input, textarea, [contenteditable]")) return null;
  const value = selection.toString();
  if (!value.trim()) return null;
  const rects = range.getClientRects();
  const box = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
  if (!box.width && !box.height) return null;
  return {
    value,
    box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
    // 同一次选择的判定：连点/失焦时 selectionchange 会反复触发，别把它当成新选择
    signature: `${selection.anchorOffset}/${selection.focusOffset}/${value.length}`,
  };
}

function placementFor(box: { left: number; top: number; right: number; bottom: number }): Placement {
  const center = (box.left + box.right) / 2;
  const above = box.top - GAP - BAR_HEIGHT >= EDGE;
  return {
    left: Math.min(Math.max(center, HALF_WIDTH + EDGE), window.innerWidth - HALF_WIDTH - EDGE),
    // 上方放不下就翻到下面（translate 只负责对齐，锚点必须自己算对）
    top: above ? box.top - GAP : box.bottom + GAP,
    above,
  };
}

export function SelectionActionBar({ containerRef, onCopy, onAppend }: {
  containerRef: { current: HTMLElement | null };
  onCopy: (text: string) => void;
  onAppend: (text: string) => void;
}) {
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [text, setText] = useState("");
  /** 动作已触发 ⇒ 这段时间内不因"选区空了"而收（Chromium 点非编辑区会顺手清选区、
   *  引用还会让输入框抢焦点），但**新的选择照旧立刻响应**。 */
  const holdUntilRef = useRef(0);
  const holdTimer = useRef(0);
  const signatureRef = useRef("");

  const measure = useCallback(() => {
    const found = readQualifiedSelection(containerRef.current);
    if (!found) {
      if (Date.now() < holdUntilRef.current) return;
      setPlacement(null);
      return;
    }
    if (Date.now() < holdUntilRef.current && found.signature === signatureRef.current) return;
    signatureRef.current = found.signature;
    setText(found.value);
    setPlacement(placementFor(found.box));
  }, [containerRef]);

  useEffect(() => {
    document.addEventListener("selectionchange", measure);
    // 滚动/缩放 ⇒ 重新贴着选区（选区还在，收起等于让人白选一次）。
    // ⛔ 监听挂在 window 上用捕获阶段：时间线的滚动元素会被 React 换掉，
    //    绑在某个具体节点上就会静默失效（上一版就栽在这里）。
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setPlacement(null); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("selectionchange", measure);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      window.removeEventListener("keydown", onKey);
    };
  }, [measure]);

  useEffect(() => () => window.clearTimeout(holdTimer.current), []);

  if (!placement) return null;

  const act = (run: () => void, clearSelection: boolean) => {
    run();
    /* ⛔ 不能立刻卸载浮条：两段反馈就挂在浮条里的按钮上，先卸载等于"点了没反应"。 */
    holdUntilRef.current = Date.now() + ACTION_FEEDBACK_MS + 200;
    window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => {
      holdUntilRef.current = 0;
      signatureRef.current = "";
      setPlacement(null);
      if (clearSelection) window.getSelection()?.removeAllRanges();
    }, ACTION_FEEDBACK_MS);
  };

  return createPortal(
    <>
      {/* 全屏透明遮罩：点外面就收（与 AppSelect 同款 —— 比 document 监听可靠，
          也不会赶在按钮响应之前把浮条卸掉）。 */}
      <div className="selection-action-scrim" onPointerDown={() => setPlacement(null)} />
      <div
        className="selection-action-bar"
        role="toolbar"
        aria-label="所选文字操作"
        style={{
          left: placement.left,
          top: placement.top,
          transform: placement.above ? "translate(-50%, -100%)" : "translate(-50%, 0)",
        }}
      >
        <FeedbackIconButton className="selection-action" title="复制所选文字" doneTitle="已复制"
          icon={<Copy size={12} />} doneIcon={<Check size={12} />} label="复制"
          onFire={() => act(() => onCopy(text), false)} />
        <FeedbackIconButton className="selection-action" title="添加到对话（在输入框上方形成可取消的引用）" doneTitle="已添加到对话"
          icon={<Plus size={12} />} doneIcon={<Check size={12} />} label="添加到对话"
          onFire={() => act(() => onAppend(text), true)} />
      </div>
    </>,
    document.body
  );
}
