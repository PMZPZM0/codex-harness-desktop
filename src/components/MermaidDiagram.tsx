/**
 * Mermaid 图表渲染器 —— 用官方 mermaid 引擎渲染 ```mermaid 代码块。
 * 支持全部图表类型：flowchart / sequenceDiagram / gantt / classDiagram /
 * stateDiagram / pie / timeline / mindmap / erDiagram 等。
 * 样式：跟随应用深浅主题；初始化主题 dark/neutral。
 * 懒加载：mermaid 引擎按需动态 import，仅当真有 mermaid 代码块时才加载。
 */
import { memo, useEffect, useRef, useState } from "react";

let mermaidPromise: Promise<any> | null = null;
function loadMermaid() {
  if (!mermaidPromise) mermaidPromise = import("mermaid").then((m: any) => {
    const mm = m.default ?? m;
    mm.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme: document.documentElement.classList.contains("dark") ? "dark" : "neutral",
      fontFamily: "inherit",
    });
    return mm;
  });
  return mermaidPromise;
}

export const MermaidDiagram = memo(function MermaidDiagram({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    loadMermaid()
      .then(async (mm: any) => {
        if (cancelled) return;
        const el = ref.current;
        if (!el) return;
        // 生成唯一 id，避免 mermaid 全局 id 冲突（同一页多个图）
        const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
        try {
          const { svg } = await mm.render(id, code);
          if (cancelled) return;
          el.innerHTML = svg;
          setState("ok");
        } catch (e: any) {
          if (cancelled) return;
          setError(e?.message ?? String(e));
          setState("error");
        }
      })
      .catch((e: any) => {
        if (cancelled) return;
        setError("加载 mermaid 引擎失败: " + (e?.message ?? e));
        setState("error");
      });
    return () => { cancelled = true; };
  }, [code]);

  return (
    <div className="mermaid-diagram">
      {state === "loading" && <div className="mermaid-loading">⏳ 渲染流程图…</div>}
      {state === "error" && (
        <div className="mermaid-error">
          <div>⚠️ Mermaid 渲染失败：{error}</div>
          <pre className="mermaid-source">{code}</pre>
        </div>
      )}
      <div ref={ref} style={{ display: state === "ok" ? "block" : "none" }} />
    </div>
  );
});
