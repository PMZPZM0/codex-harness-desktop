// 图像工坊浮层（image-lab 域，2026-10-09）：Codex 调用 image_generate / image_edit / image_view 时
// 弹出「生成中 / 编辑中 → 产物」的实时预览，工具调用结束自动收起（用户明确要求的联动）。
//
// 联动链：引擎 harness_tools → 主进程 pushImageLabEvent（sendToWindow "image-lab:event"）→
//   本浮层 onImageLabEvent → image-lab:read 拉字节 → Blob URL 显示。
// ⛔ 自包含、本地 state、不进 bag（样板 = model-viewer / codex-official-market）。
// ⛔ 单通道三态：open（弹出）/ update（换状态与图）/ close（收起）。close 后**先亮一下最终结果**
//    再卸载（~900ms）——否则"编辑很快"的工具会让浮层一闪而过，用户根本看不清。
import { useEffect, useRef, useState } from "react";

type LabEvent = {
  phase: "open" | "update" | "close";
  taskId: string;
  mode?: "generate" | "edit";
  title?: string;
  status?: "running" | "done" | "error";
  images?: string[];
  note?: string;
};

type LabState = {
  taskId: string;
  mode: "generate" | "edit";
  title: string;
  status: "running" | "done" | "error";
  images: string[];
  note: string;
};

/** close 之后停留多久再卸载（让用户看清最后一帧）。 */
const LINGER_MS = 900;

export function ImageLabBridge() {
  const [state, setState] = useState<LabState | null>(null);
  const [urls, setUrls] = useState<string[]>([]);
  const [error, setError] = useState("");
  const urlsRef = useRef<string[]>([]);
  const lingerRef = useRef<number | null>(null);

  useEffect(() => {
    const clearLinger = () => { if (lingerRef.current !== null) { window.clearTimeout(lingerRef.current); lingerRef.current = null; } };
    const off = window.codex.onImageLabEvent((event: LabEvent) => {
      if (!event?.taskId) return;
      if (event.phase === "close") {
        // 先亮最终态，再卸载
        setState((prev) => (prev && prev.taskId === event.taskId ? { ...prev, status: prev.status === "error" ? "error" : "done" } : prev));
        clearLinger();
        lingerRef.current = window.setTimeout(() => { setState(null); setUrls([]); setError(""); }, LINGER_MS);
        return;
      }
      clearLinger();
      setState((prev) => {
        // 新的 open 或同 id 的 update 才接受；过期任务的 update 直接丢
        if (prev && prev.taskId !== event.taskId && event.phase === "update") return prev;
        return {
          taskId: event.taskId,
          mode: event.mode ?? prev?.mode ?? "edit",
          title: event.title ?? prev?.title ?? "图像工坊",
          status: event.status ?? prev?.status ?? "running",
          images: event.images ?? prev?.images ?? [],
          note: event.note ?? (event.phase === "open" ? "" : prev?.note ?? ""),
        };
      });
    });
    return () => { off?.(); clearLinger(); };
  }, []);

  // 图列表变化 → 逐张拉字节建 Blob URL（旧的先释放）
  useEffect(() => {
    const images = state?.images ?? [];
    let cancelled = false;
    void (async () => {
      const next: string[] = [];
      for (const file of images.slice(0, 6)) {
        try {
          const result = await window.codex.readImage(file);
          if (cancelled) { next.forEach((u) => URL.revokeObjectURL(u)); return; }
          const bytes = result.data as unknown as BlobPart;
          next.push(URL.createObjectURL(new Blob([bytes], { type: guessMime(file) })));
        } catch (err) {
          if (!cancelled) setError(String((err as Error)?.message ?? err));
        }
      }
      if (cancelled) return;
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      urlsRef.current = next;
      setUrls(next);
      setError("");
    })();
    return () => { cancelled = true; };
  }, [state?.taskId, (state?.images ?? []).join("|")]);

  useEffect(() => () => { urlsRef.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  if (!state) return null;

  const statusText = state.status === "running"
    ? (state.mode === "generate" ? "生成中…" : "处理中…")
    : state.status === "error" ? "失败" : "完成";

  return (
    <div className="image-lab-backdrop" onClick={() => setState(null)}>
      <div className="image-lab-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="image-lab-head">
          <span className="image-lab-title" title={state.title}>{state.title}</span>
          <span className={`image-lab-status is-${state.status}`}>{statusText}</span>
          <button type="button" className="image-lab-close" onClick={() => setState(null)}>✕</button>
        </div>
        <div className="image-lab-body">
          {error && <div className="image-lab-error">{error}</div>}
          {!error && urls.length === 0 && (
            <div className="image-lab-empty">
              {state.status === "running" ? "正在准备画面…" : "没有可显示的图像"}
              {state.note && <div className="image-lab-note">{state.note}</div>}
            </div>
          )}
          {!error && urls.length > 0 && (
            <div className="image-lab-grid">
              {urls.map((url, index) => (
                <img key={url} className="image-lab-image" src={url} alt={`结果 ${index + 1}`} />
              ))}
            </div>
          )}
        </div>
        {state.note && urls.length > 0 && <div className="image-lab-foot">{state.note}</div>}
      </div>
    </div>
  );
}

function guessMime(file: string): string {
  const ext = file.toLowerCase().split(".").pop() ?? "";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "bmp") return "image/bmp";
  if (ext === "tif" || ext === "tiff") return "image/tiff";
  if (ext === "gif") return "image/gif";
  return "image/png";
}
