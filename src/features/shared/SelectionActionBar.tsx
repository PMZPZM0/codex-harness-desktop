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
 * ⛔ 不用"全屏透明遮罩"来收起（AppSelect 那套在这里不成立）：遮罩盖在正文上会抢走拖选时的
 *   命中目标，选区被反复重置 ⇒ 用户看到的"拖动时一直闪全选"。改成全局 pointerdown +
 *   "按在浮条自己身上就不收"。
 * ⛔ 拖选进行中一律不渲染浮条：选区一路变就一路重置防抖计时，停下 220ms 才弹一次。
 *
 * ⛔ 定位取**最后一个 client rect**（= 拖拽结束那一行），不取整个选区的 union rect：
 *   跨段选区的 union rect 高几百像素、上沿常在视口外，浮条就会离用户刚选的东西很远。
 * ⛔ 滚动/改窗口大小是**重新定位**而不是收起：选区还在，收起等于让人白选一次。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Plus, Rows3 } from "lucide-react";
import { ACTION_FEEDBACK_MS, FeedbackIconButton } from "./FeedbackIconButton";

const GAP = 8;
const BAR_HEIGHT = 30;
/** 选区**停止变化**这么久才弹浮条：一路拖就一路重置计时 ⇒ 过程中一次都不渲染（治"一直闪"）。 */
const DRAG_SETTLE_MS = 220;
/** 半宽估算（三枚按钮 + 文案 ≈ 270px），用来把浮条夹在视口内。 */
const HALF_WIDTH = 138;
const EDGE = 8;

type Placement = { left: number; top: number; above: boolean };

/** 文本节点 → 它所属的元素（拿不到就 null）。 */
function elementOf(node: Node | null): HTMLElement | null {
  if (!node) return null;
  return node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
}

function readQualifiedSelection(host: HTMLElement | null) {
  const selection = window.getSelection();
  if (!host || !selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const rects = range.getClientRects();
  const box = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
  if (!box.width && !box.height) return null;
  /* ⛔ "在不在消息区"用**几何**判，不靠 `host.contains(节点)`：松手时消息区会因点击/状态更新重渲染，
     选区指向的那批文本节点随即脱离文档（10-05 实测：真拖选松手后 startContainer 的 contains 变成 false，
     只看 contains 就永远不弹）。侧栏 / 右栏 / 输入框都在时间线矩形之外，按矩形套矩形不会误弹。
     节点还连着的时候再补一道 contains —— 两层都过才算数，任一失效也不至于把功能做没。 */
  const hostBox = host.getBoundingClientRect();
  if (box.left < hostBox.left - 1 || box.right > hostBox.right + 1 || box.top < hostBox.top - 1 || box.bottom > hostBox.bottom + 1) return null;
  const startElement = elementOf(range.startContainer);
  const endElement = elementOf(range.endContainer);
  if (startElement?.isConnected && endElement?.isConnected && (!host.contains(startElement) || !host.contains(endElement))) return null;
  // 输入框 / textarea 里的选区交给浏览器原生菜单（⛔ 别抢）
  const focusElement = elementOf(selection.focusNode);
  if (focusElement?.isConnected && focusElement.closest("input, textarea, [contenteditable]")) return null;
  const value = selection.toString();
  if (!value.trim()) return null;
  return {
    value,
    box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
    // 同一次选择的判定：连点/失焦时 selectionchange 会反复触发，别把它当成新选择
    signature: `${range.startContainer.nodeName}:${range.startOffset}/${range.endContainer.nodeName}:${range.endOffset}/${value.length}`,
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

/**
 * 把选区扩到**整条消息**（10-05 用户：浮条要能「选整条消息」，不用手动拖选）。
 * 从选区所在的那条 `.message` 的正文里收集文本节点，⛔ 排除掉操作条与按钮 ——
 * agent 消息的 `MessageFooter` 就渲染在 `.message-body` 里面，整块 selectNodeContents
 * 会把「复制 / 分支 / 15:16」一起选进去（ItemView.tsx:184）；文件卡片与导入记录是附件，
 * 也不是"这条消息说的话"。
 */
function wholeMessageRange(host: HTMLElement | null): Range | null {
  const selection = window.getSelection();
  if (!host || !selection || selection.rangeCount === 0) return null;
  const anchor = selection.anchorNode;
  const element = anchor?.nodeType === 1 ? (anchor as HTMLElement) : (anchor?.parentElement ?? null);
  const message = element?.closest(".message") ?? null;
  if (!message || !host.contains(message)) return null;
  const body = (message.querySelector(".message-body") ?? message) as HTMLElement;
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = (node as Text).parentElement;
      if (!parent || !parent.textContent?.trim()) return NodeFilter.FILTER_REJECT;
      return parent.closest("button, .message-footer, .user-message-footer, .inline-file-card, .import-record-card, style, script")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (!first || !last) return null;
  const range = document.createRange();
  range.setStart(first, 0);
  range.setEnd(last, last.data.length);
  return range;
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
  const barRef = useRef<HTMLDivElement | null>(null);
  /** 选区**停止变化**这么久才弹浮条（防抖）。
   *  ⛔ 不用"是否按下鼠标"的标记：10-05 实测 CDP 的 mousePressed 在这台机器上**不产生 pointerdown**，
   *     标记会永远停在 true ⇒ 松手也不弹（用户看到的"点了没反应"就是这么来的）。
   *     防抖不依赖任何按下事件：一路拖就一路重置计时器 ⇒ 过程中一次都不渲染（治"一直闪"），
   *     停下来 220ms 后弹一次。 */
  const showTimer = useRef(0);

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

  const scheduleMeasure = useCallback(() => {
    window.clearTimeout(showTimer.current);
    showTimer.current = window.setTimeout(measure, DRAG_SETTLE_MS);
  }, [measure]);

  /** 稳定引用：放进 effect 的 deps 里才不会反复重挂监听。 */
  const onEscapeKey = useCallback((event: KeyboardEvent) => { if (event.key === "Escape") setPlacement(null); }, []);

  useEffect(() => {
    const dismiss = () => { window.clearTimeout(showTimer.current); setPlacement(null); };
    const onPointerDown = (event: PointerEvent) => {
      const bar = barRef.current;
      // 按在浮条自己身上 = 要点里面的按钮，⛔ 不能收（收了按钮就点不动）
      if (bar && event.target instanceof Node && bar.contains(event.target)) return;
      dismiss();
    };
    document.addEventListener("selectionchange", scheduleMeasure);
    // 松手立刻补一次（防抖已经快到察觉不出，但鼠标在选区外松手时 selectionchange 不再来）
    window.addEventListener("pointerup", scheduleMeasure, true);
    window.addEventListener("pointercancel", scheduleMeasure, true);
    // 滚动/缩放 ⇒ 重新贴着选区（选区还在，收起等于让人白选一次）。
    // ⛔ 监听挂在 window 上用捕获阶段：时间线的滚动元素会被 React 换掉，绑具体节点会静默失效。
    window.addEventListener("scroll", scheduleMeasure, true);
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onEscapeKey);
    return () => {
      document.removeEventListener("selectionchange", scheduleMeasure);
      window.removeEventListener("pointerup", scheduleMeasure, true);
      window.removeEventListener("pointercancel", scheduleMeasure, true);
      window.removeEventListener("scroll", scheduleMeasure, true);
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onEscapeKey);
      window.clearTimeout(showTimer.current);
    };
  }, [scheduleMeasure, onEscapeKey]);

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

  /** 把选区扩到整条消息；扩不动（选区不在某条消息里）就返回 false ⇒ 不演成功。 */
  const selectWhole = () => {
    const range = wholeMessageRange(containerRef.current);
    if (!range) return false;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    measure();   // 立刻按新选区重定位，浮条跟着走（不等浏览器那一次 selectionchange）
    return true;
  };

  return createPortal(
    <div
      ref={barRef}
      className="selection-action-bar"
      role="toolbar"
      aria-label="所选文字操作"
      style={{
        left: placement.left,
        top: placement.top,
        transform: placement.above ? "translate(-50%, -100%)" : "translate(-50%, 0)",
      }}
    >
        {/* 先"范围"后"动作"：这一枚决定后面两枚拿到的是选中的那几个字还是整条消息 */}
        <FeedbackIconButton className="selection-action" title="选整条消息（不用手动拖选）" doneTitle="已选中整条消息"
          icon={<Rows3 size={12} />} doneIcon={<Check size={12} />} label="选整条"
          onFire={selectWhole} />
        <FeedbackIconButton className="selection-action" title="复制所选文字" doneTitle="已复制"
          icon={<Copy size={12} />} doneIcon={<Check size={12} />} label="复制"
          onFire={() => act(() => onCopy(text), false)} />
        <FeedbackIconButton className="selection-action" title="添加到对话（在输入框上方形成可取消的引用）" doneTitle="已添加到对话"
          icon={<Plus size={12} />} doneIcon={<Check size={12} />} label="添加到对话"
          onFire={() => act(() => onAppend(text), true)} />
    </div>,
    document.body
  );
}
