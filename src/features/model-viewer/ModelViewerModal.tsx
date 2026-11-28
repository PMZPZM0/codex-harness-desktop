// 3D 模型预览（model-viewer 域，2026-10-05 立；11-28 迁入右栏标签页）
// 两条入口汇到模块级 store（见 store.mjs）：
//   ① 主进程推送 model-viewer:open（引擎 harness_tools preview_3d 触发）；
//   ② 渲染层内部 openModelViewer()（文件卡等后续联动走这里，不走 IPC）。
// ⛔ 模型库 @google/model-viewer（~1MB）必须懒加载：首次打开才 import，主包零开销。
// ⛔ 11-28 用户令：「3D 建模展示接到侧边栏新标签页展示，其他也都检查一下」——
//   ⇒ 渲染位置从**整屏浮层**改成右栏「3D 预览」页（`variant="inline"`）；
//     桥（Bridge）只剩"收事件 → 写 store → 请宿主切页"，不再渲染任何 UI，
//     这样右栏没开时目标也不会丢（右栏打开时补上）。
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getModelViewerTarget, setModelViewerTarget, subscribeModelViewerTarget, type ModelViewerTarget } from "./store.mjs";

export type { ModelViewerTarget };

/** 渲染层内部打开入口（与本 IPC 推送同一出口；参数不合法时面板内会显示真实报错） */
export function openModelViewer(path: string, title = ""): void {
  setModelViewerTarget({ path, title });
}

let viewerPromise: Promise<void> | null = null;
function ensureModelViewer(): Promise<void> {
  viewerPromise ??= import("@google/model-viewer").then(() => undefined);
  return viewerPromise;
}

// React 19 的 JSX 命名空间在 react 模块内（全局 JSX 已不存在）—— 自定义元素声明挂那里
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        alt?: string;
        "camera-controls"?: boolean;
        "auto-rotate"?: boolean;
        "shadow-intensity"?: string;
        exposure?: string;
      };
    }
  }
}

/**
 * 3D 预览面板：只负责**渲染**当前目标（右栏「3D 预览」页用）。
 * `variant="inline"` 时填满父容器、无遮罩；没有目标时给一句引导而不是空白。
 * ⛔ 不要在这里订阅 IPC —— 事件统一由 `ModelViewerBridge` 写 store。
 */
export function ModelViewerPanel({ variant = "inline" }: { variant?: "overlay" | "inline" }) {
  const target = useSyncExternalStore(subscribeModelViewerTarget, getModelViewerTarget, getModelViewerTarget);
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const blobRef = useRef("");

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setError("");
    setReady(false);
    void (async () => {
      try {
        await ensureModelViewer();
        const result = await window.codex.readModel(target.path);
        if (cancelled) return;
        if (blobRef.current) URL.revokeObjectURL(blobRef.current);
        // .gltf 是 JSON（可能引用外部 .bin，blob 路径下解析不出），mime 按扩展名给；
        // ⛔ TS 5.9 的 BlobPart 不收 ArrayBufferLike（SharedArrayBuffer 恐慌）—— 显式收窄
        const bytes = result.data as unknown as BlobPart;
        const isGltf = target.path.toLowerCase().endsWith(".gltf");
        blobRef.current = URL.createObjectURL(new Blob([bytes], { type: isGltf ? "model/gltf+json" : "model/gltf-binary" }));
        setSrc(blobRef.current);
        setReady(true);
      } catch (err) {
        if (!cancelled) setError(String((err as Error)?.message ?? err));
      }
    })();
    return () => { cancelled = true; };
  }, [target]);

  const title = target ? (target.title || target.path.split(/[\\/]/).pop() || "3D 预览") : "";
  const close = () => setModelViewerTarget(null);

  if (!target) {
    return (
      <div className={`model-viewer-backdrop${variant === "inline" ? " is-inline" : ""}`} data-empty="1">
        <div className="model-viewer-empty">
          <strong>还没有要预览的 3D 模型</strong>
          <p>让 Codex 用 `preview_3d` 打开一个 .glb / .gltf，或在文件页里点模型文件 —— 会自动出现在这里。</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`model-viewer-backdrop${variant === "inline" ? " is-inline" : ""}`} onClick={variant === "inline" ? undefined : close}>
      <div className="model-viewer-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="model-viewer-head">
          <span className="model-viewer-title" title={target.path}>{title}</span>
          <button type="button" className="model-viewer-close" onClick={close} title="清空预览">✕</button>
        </div>
        {error
          ? <div className="model-viewer-error">{error}</div>
          : <div className="model-viewer-stage">
              {ready && <model-viewer src={src} alt={title} camera-controls auto-rotate shadow-intensity="1" exposure="1" />}
              {!ready && <div className="model-viewer-loading">模型加载中…</div>}
            </div>}
      </div>
    </div>
  );
}

/**
 * 3D 预览桥：**不渲染 UI**，只做「收事件 → 写 store → 请宿主切到 3D 页」。
 * `onOpen` 由宿主给（AppView 传 `openPanelTab("3d", "3D 预览")`）。
 * ⛔ 右栏关着的时候也要收（store 是模块级的），否则模型一预览用户什么也看不到。
 */
export function ModelViewerBridge({ onOpen }: { onOpen?: () => void }) {
  useEffect(() => {
    const off = window.codex.onModelViewerOpen((event) => {
      if (!event?.path) return;
      setModelViewerTarget({ path: event.path, title: event.title ?? "" });
      onOpen?.();
    });
    return () => { off?.(); };
  }, [onOpen]);
  return null;
}
