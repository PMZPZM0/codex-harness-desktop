// 3D 模型预览弹窗（model-viewer 域，2026-10-05）：自包含、本地 state、不进 bag（样板 = codex-official-market）。
// 两个入口汇到同一个模块级状态：
//   ① 主进程推送 model-viewer:open（引擎 harness_tools preview_3d 触发，联动链见 electron/features/model-viewer-ipc.ts 头注）；
//   ② 渲染层内部 openModelViewer()（文件卡等后续联动走这里，不走 IPC）。
// ⛔ 模型库 @google/model-viewer（~1MB）必须懒加载：首次打开才 import，主包零开销。
import { useEffect, useRef, useState } from "react";

export type ModelViewerTarget = { path: string; title: string };

let pushTarget: ((target: ModelViewerTarget) => void) | null = null;

/** 渲染层内部打开入口（与本 IPC 推送同一出口；参数不合法时弹窗内会显示真实报错） */
export function openModelViewer(path: string, title = ""): void {
  pushTarget?.({ path, title });
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

export function ModelViewerBridge() {
  const [target, setTarget] = useState<ModelViewerTarget | null>(null);
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const blobRef = useRef("");

  useEffect(() => {
    pushTarget = (next) => setTarget(next);
    const off = window.codex.onModelViewerOpen((event) => {
      if (event?.path) setTarget({ path: event.path, title: event.title ?? "" });
    });
    return () => { off?.(); pushTarget = null; };
  }, []);

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

  if (!target) return null;
  const title = target.title || target.path.split(/[\\/]/).pop() || "3D 预览";
  return (
    <div className="model-viewer-backdrop" onClick={() => setTarget(null)}>
      <div className="model-viewer-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="model-viewer-head">
          <span className="model-viewer-title" title={target.path}>{title}</span>
          <button type="button" className="model-viewer-close" onClick={() => setTarget(null)}>✕</button>
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
