import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleHelp, ArrowRight } from "lucide-react";
import type { HelpKey } from "./HelpDialog";

/** 打开某页「完整帮助」弹窗的统一入口（由 App 注入 setHelpKey）。
 *
 *  走 context 而不是逐页传 props：设置里有二十多个头部，每处都传一遍回调
 *  既啰嗦、也容易漏传——漏掉的那个 ? 点开会没反应，而这种静默失效最难发现。
 */
export const HelpOpenContext = createContext<((key: HelpKey) => void) | null>(null);

/** 设置页标题旁的「?」：hover 展示这一页的说明，点一下打开完整使用帮助。
 *
 *  为什么要有它（09-17 用户：「文字赘述过多，都改成 ? 号，鼠标放上去展示」）：
 *  原先每页标题下单独起一段说明文字，长的一页占 5 行（MCP / 技能中心 / SSH 服务器…），
 *  把动作按钮挤到右边、整页首屏全是字。收进 ? 后头部恒为一行：标题 + ? + 动作按钮。
 *
 *  ⛔ 气泡必须 portal + fixed 定位：设置内容是滚动容器（overflow:auto），
 *    绝对定位的浮层会被容器裁掉下半截——这是这类气泡最常见的实现坑。
 *  ⛔ ? 与气泡共用一组 show/hide：鼠标从 ? 移向气泡时要保持显示（否则点不到
 *    「查看完整帮助」）。用延时隐藏（160ms）过渡，不做成纯 CSS :hover。
 *  ⛔ 气泡左右要钳制在窗口内：头部靠右的 ? 展开宽气泡会溢出屏幕右侧。
 */
export function PageInfo({ text, helpKey, label }: { text: ReactNode; helpKey?: HelpKey; label?: string }) {
  const openHelp = useContext(HelpOpenContext);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const [anchor, setAnchor] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);

  useEffect(() => () => { if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current); }, []);

  const BUBBLE_WIDTH = 380;

  const show = () => {
    if (hideTimerRef.current != null) { window.clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // 窄窗口（<400px）下气泡宽度要跟着缩：写死 380px 会溢出屏幕右侧
    const width = Math.min(BUBBLE_WIDTH, window.innerWidth - 28);
    // 左边界对齐 ? 的左缘；右侧越界时向左回推；再越界（极窄窗口）就贴左边距
    const left = Math.max(14, Math.min(r.left - 8, window.innerWidth - width - 14));
    // ⛔ 默认**向下**展开：设置页头部就在弹窗顶部，向上展开会盖住弹窗标题栏与关闭按钮
    //    （截图实测：气泡整块压在「设置 ESC / 设置总览」那一行上）。
    //    只有下方确实放不下（离窗口底 <140px）且上方有空间时才翻上去。
    const placeAbove = window.innerHeight - r.bottom - 10 < 140 && r.top > 200;
    setAnchor(placeAbove
      ? { left, width, bottom: window.innerHeight - r.top + 8 }
      : { left, width, top: r.bottom + 8 });
  };
  const hideLater = () => {
    if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => { setAnchor(null); hideTimerRef.current = null; }, 160);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="page-info"
        aria-label={label ? `${label}：查看说明与使用帮助` : "查看说明与使用帮助"}
        onMouseEnter={show}
        onMouseLeave={hideLater}
        onFocus={show}
        onBlur={hideLater}
        onClick={() => { setAnchor(null); if (helpKey && openHelp) openHelp(helpKey); }}
      >
        <CircleHelp size={14} />
      </button>
      {anchor
        ? createPortal(
            <div
              className="page-info-pop"
              /* ⛔ 不写 role="tooltip"：里面含可点的「查看完整帮助」按钮，而 tooltip 语义
                 不允许有交互控件（屏幕阅读器不会把它暴露出来）。去掉 role 后按普通容器读，可读可点。 */
              style={{ left: anchor.left, top: anchor.top, bottom: anchor.bottom, width: anchor.width }}
              onMouseEnter={show}
              onMouseLeave={hideLater}
            >
              <div className="page-info-text">{text}</div>
              {helpKey && openHelp
                ? <button type="button" className="page-info-more" onClick={() => { setAnchor(null); openHelp(helpKey); }}>
                    查看完整帮助<ArrowRight size={12} />
                  </button>
                : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
