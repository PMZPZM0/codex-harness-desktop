/**
 * 群聊 · 右侧栏（11-09 用户令：「不要那么大的浮动弹窗，放右边；在展开折叠右边加一个侧栏浮窗按键」）。
 *
 * · 11-09 用户纠正：「拖动是**整个右侧边栏浮动展示**，所以上下左右拖动」——
 *   不做贴边抽屉、也不做"只拉宽度"：**整块面板可上下左右拖动的浮动窗**，
 *   按住标题栏拖到任意位置（钳在群容器内，位置按窗口记住），双击标题栏回到默认右侧位置。
 *
 * ⛔ 不复制一套侧栏：直接渲染主对话的 `AppViewReviewPanel`（变更 / 审阅 / 浏览器 / 文件 + 监控）。
 * ⛔ 用**克隆的 app** 只覆盖 `rightOpen / rightTab / workspace`，不改本窗全局状态。
 * ⛔ 文件树按**群工作目录**加载；文件卡/正文文件引用的点击都切到「文件」页并选中该文件。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { PanelRight, X } from "lucide-react";
import { useEscapeLayer } from "../../hooks/useEscapeLayer";
import type { HarnessAppApi } from "../app-state";
import { AppViewReviewPanel } from "../app-view/components";

export type TeamSideTab = "monitor" | "review" | "turn-review" | "browser" | "tree" | "terminal";

/** 浮动位置按窗口记住（相对群容器左上角，px） */
const POS_KEY = "team-side-panel-pos";
/** 面板与群容器边缘至少留这么多（⛔ 贴边就抓不到标题栏了） */
const MARGIN = 10;
/** 默认尺寸：宽取群宽的 ~48%，高度撑到离底 96px；都夹在可用范围里。 */
const defaultSize = (parentW: number, parentH: number) => ({
  w: Math.min(560, Math.max(340, Math.round(parentW * 0.48))),
  h: Math.min(640, Math.max(280, parentH - 96)),
});
const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), Math.max(min, max));

/** 读回上次拖动位置（读不到 / 坏数据 ⇒ null，走默认右侧位置）。 */
function readPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
    const x = Number(parsed?.x);
    const y = Number(parsed?.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  } catch { return null; }
}

type Box = { x: number; y: number; w: number; h: number };

/** 群右侧栏：整块可上下左右拖动的浮动面板，复用主对话的右侧面板。 */
export function TeamSidePanel({ app, workspace, tab, onTab, onClose }: {
  app: HarnessAppApi;
  workspace: string;
  tab: TeamSideTab;
  onTab: (tab: TeamSideTab) => void;
  onClose: () => void;
}) {
  useEscapeLayer(true, onClose);
  const rootRef = useRef<HTMLElement | null>(null);
  const [box, setBox] = useState<Box | null>(null);

  /** 量父容器（`.team-group`）并钳住位置；父容器尺寸变化时重算尺寸、位置就地收敛。 */
  const measure = useCallback(() => {
    const parent = rootRef.current?.parentElement;
    if (!parent) return;
    const pw = parent.clientWidth || window.innerWidth;
    const ph = parent.clientHeight || window.innerHeight;
    const { w, h } = defaultSize(pw, ph);
    setBox((prev) => {
      const saved = prev ?? readPos() ?? { x: pw - w - 14, y: 56 };
      return {
        x: clamp(saved.x, MARGIN, pw - w - MARGIN),
        y: clamp(saved.y, MARGIN, ph - h - MARGIN),
        w,
        h,
      };
    });
  }, []);

  useLayoutEffect(() => {
    measure();
    const parent = rootRef.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(parent);
    return () => observer.disconnect();
  }, [measure]);

  /** 标题栏按住 = 整块面板平移（上下左右都行）；松手记住位置。 */
  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !box) return;
    const el = rootRef.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    event.preventDefault();
    event.stopPropagation();
    /* 指针捕获：拖出窗口再松手也能收到 pointerup/pointercancel（否则 body 的 move 光标会卡住）。 */
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 合成事件可能不支持 */ }
    const pw = parent.clientWidth;
    const ph = parent.clientHeight;
    const startX = event.clientX;
    const startY = event.clientY;
    const fromX = box.x;
    const fromY = box.y;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "move";
    const move = (moveEvent: PointerEvent) => {
      const x = clamp(fromX + (moveEvent.clientX - startX), MARGIN, pw - box.w - MARGIN);
      const y = clamp(fromY + (moveEvent.clientY - startY), MARGIN, ph - box.h - MARGIN);
      setBox((prev) => (prev ? { ...prev, x, y } : prev));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      const host = rootRef.current;
      const hostParent = host?.parentElement;
      if (host && hostParent) {
        const er = host.getBoundingClientRect();
        const pr = hostParent.getBoundingClientRect();
        try {
          localStorage.setItem(POS_KEY, JSON.stringify({ x: Math.round(er.left - pr.left), y: Math.round(er.top - pr.top) }));
        } catch { /* 隐私模式 */ }
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  /** 双击标题栏回到默认的右侧位置（拖丢了不用去找设置）。 */
  const resetPos = () => {
    const parent = rootRef.current?.parentElement;
    if (!parent) return;
    const pw = parent.clientWidth;
    const ph = parent.clientHeight;
    const { w, h } = box ?? defaultSize(pw, ph);
    try { localStorage.removeItem(POS_KEY); } catch { /* 隐私模式 */ }
    setBox({ x: pw - w - 14, y: 56, w, h });
  };

  const resolvedWorkspace = String(workspace ?? "").trim() || String(app.workspace ?? "");
  /* 打开即按**群的**工作目录读一层树（右栏的文件页原本靠主界面 effect 触发，这里不跑主界面）。 */
  useEffect(() => {
    if (!resolvedWorkspace) return;
    void app.loadTree(resolvedWorkspace);
  }, [resolvedWorkspace]);
  const panelApp = useMemo(
    () => ({
      ...app,
      rightOpen: true,
      rightTab: tab,
      setRightTab: onTab as typeof app.setRightTab,
      workspace: resolvedWorkspace,
    }),
    [app, tab, onTab, resolvedWorkspace],
  );
  return (
    <aside
      ref={rootRef}
      className="team-side-panel"
      style={box ? { left: box.x, top: box.y, width: box.w, height: box.h } : { visibility: "hidden" }}
      role="complementary"
      aria-label="右侧栏"
    >
      <header
        className="team-side-panel__head"
        title="按住拖动到任意位置 · 双击回到右侧"
        onPointerDown={startDrag}
        onDoubleClick={resetPos}
      >
        <PanelRight size={14} className="ic-blue" />
        <strong>右侧栏</strong>
        <small title={resolvedWorkspace}>{resolvedWorkspace || "未设置群工作目录"}</small>
        <button
          type="button"
          className="team-side-panel__close"
          title="收起侧栏（Esc）"
          aria-label="收起侧栏"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </header>
      <div className="team-side-panel__body">
        <AppViewReviewPanel app={panelApp} />
      </div>
    </aside>
  );
}
