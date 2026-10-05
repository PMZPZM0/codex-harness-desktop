/**
 * 界面草图（`ui-sketch` 域，10-05 立）—— 把 m3e-canvas 的原站嵌进应用，用弹窗展示。
 *
 * 为什么是 iframe 而不是把源码搬进来：上游 30,722 行 TS + 自己一套 Tailwind v4 与色板，
 * 并进本仓等于在设计体系里再塞一个体系（守卫【170】的色板对账会当场失焦）。
 * ⇒ 我们**提交它的静态导出产物**（`public/sketch/`，4.2MB，含本地化的 Material Symbols 字体），
 *   由 `sketch://` 只读协议加载（`electron/sketch-protocol.ts`），布局与功能一字不动 ——
 *   用户要的就是「按它原来的样子」。
 *
 * 宿主这一圈做三件事：**读回画布**（`scripts/sketch-bridge.js` + postMessage，跨源拿不到 DOM）、
 * 把画布结构合成任务发给 Codex、以及把草图 JSON 复制到剪贴板。
 * 另有 **Codex 侧的两个工具**（`sketch_get_doc` / `sketch_apply_doc`，见 part05 分发）——
 * 工具的消息与弹窗共用同一条桥会话（`sketch-session.mjs` 是唯一的状态持有者），
 * 写回同样只走上游自己的导入通道（分享哈希 `#docz=` → hashchange → arrive()），
 * 弹窗自己的按钮**不写画布**：10-05 试过"从宿主送组件进去"，用户实测后判了
 * 「跟左边那些不适配，加进来没啥用」⇒ 组件库面板已整块撤掉，别照原样加回来。
 *
 * ⛔ 自包含：本地 state、不碰 bag（只有「开没开」那一位在 bag，与 drama-canvas 同档）。
 * ⛔ 不许 createPortal（画布类浮层的既定立场：弹层留在自己那一层）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Copy, PenTool, RefreshCw, X } from "lucide-react";
import { SKETCH_BRIDGE_SOURCE, SKETCH_ENTRY_URL, buildSketchPrompt, describeDiag, summarizeDoc } from "./sketch-doc.mjs";
import { attachSketchFrame, detachSketchFrame, feedSketchMessage } from "./sketch-session.mjs";
import type { SketchDiag, SketchDoc } from "./sketch-doc.mjs";

/** 桥没应答多久算"没就绪"：8 秒足够本地协议加载 4MB 产物，又不至于让用户干等。 */
const BRIDGE_TIMEOUT_MS = 8000;

export function UiSketchModal({ onClose, onAskAgent }: { onClose: () => void; onAskAgent: (text: string) => void }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);
  const [doc, setDoc] = useState<SketchDoc | null>(null);
  const [bridgeError, setBridgeError] = useState("");
  /** 桥是否应答过（验收项靠这个状态位判断整条链路通没通，见 data-bridge）。 */
  const [bridgeReady, setBridgeReady] = useState(false);
  const [status, setStatus] = useState("草图已就绪 · 在里面摆界面，摆完点「交给 Codex 实现」");

  const summary = useMemo(() => summarizeDoc(doc), [doc]);

  /* ESC 关窗自己接（仓里没有"顶层浮层统一 ESC"的机制，别假设有）。
     ⛔ 焦点在 iframe 里时按键不会冒泡到宿主文档 —— 所以 ESC 只在光标不在草图内时生效，
     这是跨源 iframe 的固有行为，不是这里的 bug；标题栏的关闭键始终可用。 */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* 桥的会话：本弹窗是 iframe 的持有者 —— 挂载时把 frame 交给会话单例，卸载时交还；
     桥的每条消息先过 feed（工具调用在等的那条回执就靠它派发），弹窗再走自己的展示逻辑。 */
  useEffect(() => {
    attachSketchFrame(iframeRef.current ? iframeRef.current.contentWindow : null);
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; type?: string; doc?: SketchDoc; diag?: SketchDiag };
      if (!data || data.source !== SKETCH_BRIDGE_SOURCE) return;
      feedSketchMessage(data);
      if (data.type !== "ready" && data.type !== "doc") return;
      readyRef.current = true;
      setBridgeReady(true);
      setBridgeError("");
      setDoc(data.doc ?? null);
      /* 跨源看不见里面：没有画布内容时把桥带出来的诊断写进状态条，别让用户对着白屏猜。 */
      if (!data.doc) setStatus(`画布还没有内容 · ${describeDiag(data.diag)}`);
    };
    window.addEventListener("message", onMessage);
    const probe = setTimeout(() => {
      if (readyRef.current) return;
      setBridgeError("草图组件没有应答。多半是 dist/sketch 还没生成 —— 跑一次 npm run build（public/sketch 会被 Vite 拷进 dist）。");
    }, BRIDGE_TIMEOUT_MS);
    return () => {
      detachSketchFrame();
      window.removeEventListener("message", onMessage);
      clearTimeout(probe);
    };
  }, []);

  /** ⛔ targetOrigin 用 "*"：出站的只有"用户自己画的界面 JSON"，无凭据、无路径；
   *  换精确 origin 要处理打包版 file:// 的 "null" origin（Chromium 语义），复杂度全花在
   *  一个本来就不是秘密的载荷上。入站按 source 标记过滤。 */
  const post = (message: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage({ ...message, source: SKETCH_BRIDGE_SOURCE }, "*");
  };

  const syncDoc = () => {
    post({ type: "get-doc" });
    setStatus("已取回当前画布");
  };

  const copyDoc = async () => {
    if (!doc) {
      setStatus("还没有可复制的画布内容");
      return;
    }
    await window.codex.writeClipboard(JSON.stringify(doc, null, 2));
    setStatus("草图 JSON 已复制（可存档 / 发给别的工具）");
  };

  const handToAgent = () => {
    const built = buildSketchPrompt(doc);
    /* 画布上什么都没有 ⇒ 不该发任务：那样送出去的是一句没有内容的空指令，白跑一个回合
       （用户点这个按钮时未必已经在画布上摆过东西）。 */
    if (!built.text) {
      setStatus("画布还是空的 —— 先在草图上摆几个部件");
      return;
    }
    onAskAgent(built.text);
  };

  return (
    <div className="ui-sketch-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="ui-sketch-shell" role="dialog" aria-modal="true" aria-label="界面草图" data-bridge={bridgeError ? "timeout" : bridgeReady ? "ready" : "pending"}>
        {/* 标题与动作**同一行**（10-05 用户反馈「上面按键遮住了」）：两行会把高度吃掉 ~80px，
            草图站自己的浮动工具栏就顶到可视区上沿、和它右上角的控件挤在一起。 */}
        <header className="ui-sketch-head">
          <PenTool size={15} className="ui-sketch-head-icon" />
          <strong>界面草图</strong>
          <button type="button" onClick={syncDoc}><RefreshCw size={13} />取回画布</button>
          <button type="button" onClick={() => void copyDoc()}><Copy size={13} />复制 JSON</button>
          <button type="button" className="primary" onClick={handToAgent}><ArrowUp size={13} />交给 Codex 实现</button>
          <span className="ui-sketch-meta">
            {bridgeError ? <em className="ui-sketch-warn">{bridgeError}</em> : <>{summary.valid ? `${summary.title || "未命名"} · ${summary.frames} 屏 / ${summary.items} 部件` : "画布内容未取回"}</>}
          </span>
          <span className="esc-hint" title="按 ESC 关闭弹窗">ESC</span>
          <button type="button" title="关闭" onClick={onClose}><X size={15} /></button>
        </header>
        {/* iframe 恒占满整块主体：草图是"与聊天并列的另一种工作台"，任何并排面板都会把它挤窄，
            它自己的工具栏就摆不下（10-05 实测 910px 时右上角控件互相遮挡）。 */}
        {/* ⛔ 不加 sandbox：桥要在草图源里读 localStorage（m3e 的持久化就靠它），
            而 sandbox 不放 allow-same-origin 时 localStorage 直接不可用。
            这份产物是我们自己随包的只读文件，站点根恒在 dist/sketch 内（协议白名单），
            加 sandbox 只会把功能阉掉，不会增加任何安全边界。 */}
        <iframe
          ref={iframeRef}
          className="ui-sketch-frame"
          title="界面草图（m3e-canvas）"
          src={SKETCH_ENTRY_URL}
          onLoad={() => post({ type: "ping" })}
        />
        <div className="ui-sketch-status">{status}</div>
      </section>
    </div>
  );
}
