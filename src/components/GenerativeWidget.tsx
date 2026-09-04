import { memo, useEffect, useRef, useState } from "react";
import { AlertTriangle, Code2, Maximize2, X } from "lucide-react";
import { type ShowWidgetData } from "../lib/generative-widget";

/**
 * 复刻 WorkBuddy 的 visualizer 卡片渲染：
 * widget_code（SVG/HTML）在 sandboxed iframe 里通过 srcdoc 渲染，与主文档隔离。
 * 支持：
 *  - loading 占位（iframe bootstrap 未 ready / 流式中未闭合）
 *  - 出错降级（显示源码，不白屏）
 *  - 展开/收起、全屏预览
 */
function buildDoc(widgetCode: string, dark: boolean): string {
  const bg = dark ? "#17181c" : "#ffffff";
  const color = dark ? "#e8e8e5" : "#1a1a1a";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  html, body { margin: 0; padding: 0; background: ${bg}; color: ${color}; }
  body { min-height: 100%; }
  * { box-sizing: border-box; }
</style>
</head>
<body>${widgetCode}</body>
</html>`;
}

export const WidgetRenderer = memo(function WidgetRenderer({ data, dark, onReady }: {
  data: ShowWidgetData;
  dark: boolean;
  onReady?: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  const code = data.widget_code ?? "";
  const doc = useRef(buildDoc(code, dark));

  // widget_code 变化时重建文档（流式最终态替换占位）
  useEffect(() => {
    doc.current = buildDoc(code, dark);
    setReady(false);
    setFailed(false);
    const frame = frameRef.current;
    if (frame && !showCode) {
      frame.srcdoc = doc.current;
    }
  }, [code, dark, showCode]);

  // 监听 iframe load：bootstrap 完成
  const handleLoad = () => {
    setReady(true);
    onReady?.();
    // 尝试测量内容高度，适配卡片高度（不固定死）
    try {
      const inner = frameRef.current?.contentDocument;
      if (inner?.body) {
        const h = Math.max(120, Math.min(520, inner.body.scrollHeight + 16));
        setHeight(h);
      }
    } catch { /* 跨域/沙箱不可读，保持默认 */ }
  };

  if (showCode) {
    return (
      <div className="widget-frame widget-frame--code">
        <div className="widget-frame-head">
          <span className="widget-frame-title"><Code2 size={12} />源码</span>
          <button title="回到预览" onClick={() => setShowCode(false)}><X size={13} /></button>
        </div>
        <pre>{code}</pre>
      </div>
    );
  }

  return (
    <div className={`widget-frame ${ready ? "ready" : ""} ${zoom ? "zoomed" : ""}`} style={height ? { height } : undefined}>
      <iframe
        ref={frameRef}
        title={data.title ?? "可视化卡片"}
        sandbox="allow-scripts allow-same-origin allow-popups"
        srcDoc={doc.current}
        onLoad={handleLoad}
        onError={() => setFailed(true)}
      />
      {!ready && !failed && <div className="widget-frame-loading"><span className="spinner" /><span>卡片渲染中…</span></div>}
      {failed && (
        <div className="widget-frame-error">
          <AlertTriangle size={15} />
          <span>卡片渲染失败</span>
          <button onClick={() => setShowCode(true)}>查看源码</button>
        </div>
      )}
      <div className="widget-frame-actions">
        <button title={zoom ? "退出放大" : "放大查看"} onClick={() => setZoom(!zoom)}><Maximize2 size={12} /></button>
        <button title="查看源码" onClick={() => setShowCode(true)}><Code2 size={12} /></button>
      </div>
    </div>
  );
});

/** widget 卡片的壳：标题头 + 渲染区；streaming 时显示 loading 占位 */
export const WidgetCard = memo(function WidgetCard({ data, dark, streaming }: {
  data: ShowWidgetData;
  dark: boolean;
  streaming?: boolean;
}) {
  return (
    <div className={`widget-card ${streaming ? "streaming" : ""}`}>
      {(data.title || streaming) && (
        <div className="widget-card-head">
          <span className="widget-card-dot" aria-hidden />
          <span className="widget-card-title">{streaming ? (data.title ?? "生成可视化卡片…") : data.title}</span>
          {streaming && <span className="widget-card-streaming"><span className="spinner" /></span>}
        </div>
      )}
      <div className="widget-card-body">
        {streaming ? (
          <div className="widget-card-placeholder">
            <div className="widget-card-placeholder-shape" />
            <span>{data.loading_messages?.[0] ?? "正在生成…"}</span>
          </div>
        ) : (
          <WidgetRenderer data={data} dark={dark} />
        )}
      </div>
    </div>
  );
});
