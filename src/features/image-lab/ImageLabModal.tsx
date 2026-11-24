// 图像工坊浮层（image-lab 域，2026-10-09）：Codex 调用 image_generate / image_edit / image_view 时
// 弹出「生成中 / 编辑中 → 产物」的实时预览，工具调用结束自动收起（用户明确要求的联动）。
//
// 联动链：引擎各自的独立工具（image_generate / image_edit / image_view）→ 主进程 pushImageLabEvent（sendToWindow "image-lab:event"）→
//   本浮层 onImageLabEvent → image-lab:read 拉字节 → Blob URL 显示。
// ⛔ 自包含、本地 state、不进 bag（样板 = model-viewer / codex-official-market）。
// ⛔ 单通道三态：open（弹出）/ update（换状态与图）/ close（收起）。close 后**先亮一下最终结果**
//    再卸载（~900ms）——否则"编辑很快"的工具会让浮层一闪而过，用户根本看不清。
import { useEffect, useRef, useState } from "react";
import { ImageGenFx } from "./ImageGenFx";

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

/** 浮窗拖动位置记忆（用户的窗口别每次都弹回原位）。 */
const IMAGE_LAB_POS_KEY = "image-lab-float-pos";

/** 拿不到卡片实际尺寸时的兜底（CSS 里宽 340；高度按常见三行内容估）。 */
const DIALOG_FALLBACK_SIZE = { width: 340, height: 240 };

/**
 * 把位置钳进当前视口：⛔ 边界必须按**卡片实际尺寸**算。
 * 用固定值（比如"至少露 120px"）会让卡片拖到右下角时大面积出屏 —— 用户只看到一条边，
 * 而且这个位置还会被记住，下次打开还是「只剩一条」。
 */
function clampPos(left: number, top: number, size?: { width: number; height: number }): { left: number; top: number } {
  const width = size?.width || DIALOG_FALLBACK_SIZE.width;
  const height = size?.height || DIALOG_FALLBACK_SIZE.height;
  return {
    left: Math.max(8, Math.min(left, Math.max(8, window.innerWidth - width - 8))),
    top: Math.max(8, Math.min(top, Math.max(8, window.innerHeight - height - 8))),
  };
}

/** 图像工坊浮层桥：接主进程的开/关指令，把生成或编辑结果挂成可预览的 URL。 */
export function ImageLabBridge() {
  const [state, setState] = useState<LabState | null>(null);
  const [urls, setUrls] = useState<string[]>([]);
  const [error, setError] = useState("");
  /* 最小化状态：⛔ 新任务开始时必须复位 —— 否则上一轮最小化成胶囊后，
     下一轮生图只冒出一枚小胶囊，用户会以为「没开始」。 */
  const [minimized, setMinimized] = useState(false);
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
      /* 新任务开窗：把上一轮的「最小化」复位，否则用户只看到一枚胶囊。
         ⛔ 不用闭包里的 state 判「是否同一任务」—— 这个 effect 只跑一次，闭包里是首帧的 null。 */
      if (event.phase === "open") setMinimized(false);
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

  /* ── 11-24：可拖动 / 可最小化 + 进度百分比 ─────────────────────────────── */
  /* 位置记忆：用户拖到哪儿，下次还在那儿（默认右下角 —— 不压对话）。 */
  const [pos, setPos] = useState<{ left: number; top: number } | null>(() => {
    try {
      const raw = localStorage.getItem(IMAGE_LAB_POS_KEY);
      const parsed = raw ? JSON.parse(raw) as { left?: number; top?: number } : null;
      if (parsed && Number.isFinite(parsed.left) && Number.isFinite(parsed.top)) {
        /* ⛔ 必须按**当前**视口钳一次：上次拖到副屏 / 窗口缩小后，旧的 left/top 可能落在屏幕外，
           卡片就再也看不见了（用户会以为"生图弹窗坏了"）。 */
        return clampPos(Number(parsed.left), Number(parsed.top));
      }
    } catch { /* 隐私模式 / 坏数据：用默认位置 */ }
    return null;
  });
  const [percent, setPercent] = useState(1);
  /* 拖动时要记住「按下点相对卡片左上角的偏移」+ **卡片当时的尺寸**（钳边界要用真实尺寸）。 */
  const dragRef = useRef<{ dx: number; dy: number; width: number; height: number } | null>(null);
  /* 窗口尺寸变了要重钳：否则拖到右下角的位置在窗口缩小后会跑到屏幕外。 */
  useEffect(() => {
    const onResize = () => setPos((current) => (current ? clampPos(current.left, current.top) : current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  /* 上游生图接口是同步的、不返回解码进度 ⇒ 百分比只能按时间估算：
     指数曲线 26 秒时间常数、封顶 95%，**出图那一刻**由 status=done 直接跳 100。
     ⛔ 别把它写成"假进度条"式的匀速 —— 真实生图是前快后慢，匀速反而一眼假。 */
  useEffect(() => {
    if (state?.status !== "running") return;
    const startedAt = Date.now();
    setPercent(1);
    const timer = window.setInterval(() => {
      const seconds = (Date.now() - startedAt) / 1000;
      setPercent(Math.max(1, Math.min(95, Math.round(95 * (1 - Math.exp(-seconds / 26))))));
    }, 400);
    return () => window.clearInterval(timer);
  }, [state?.status, state?.taskId]);

  const onHeadPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    /* ⛔ 点在按钮上不启动拖动，否则「最小化 / 关闭」会连带把窗口挪走。 */
    if ((event.target as HTMLElement).closest("button")) return;
    const rect = (event.currentTarget.closest(".image-lab-dialog") as HTMLElement | null)?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, width: rect.width, height: rect.height };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onHeadPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setPos(clampPos(event.clientX - drag.dx, event.clientY - drag.dy, drag));
  };
  const onHeadPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    /* ⛔ 存 DOM 上的真实位置，别存 state 里的 pos：pointermove 的 setPos 是异步的，
        松手那一帧闭包里的 pos 可能还差一步（下次打开就偏几像素）。 */
    const rect = (event.currentTarget.closest(".image-lab-dialog") as HTMLElement | null)?.getBoundingClientRect();
    const next = rect ? { left: Math.round(rect.left), top: Math.round(rect.top) } : pos;
    if (next) { try { localStorage.setItem(IMAGE_LAB_POS_KEY, JSON.stringify(next)); } catch { /* 隐私模式 */ } }
  };

  if (!state) return null;

  const statusText = state.status === "running"
    ? (state.mode === "generate" ? "生成中" : "处理中")
    : state.status === "error" ? "失败" : "完成";
  const percentText = state.status === "done" ? 100 : state.status === "error" ? 0 : percent;
  const stageText = percentText >= 80 ? "正在最后打磨" : percentText >= 55 ? "正在细化质感" : percentText >= 25 ? "正在铺陈光影" : "正在勾勒草图";

  /* 最小化：只留一枚小胶囊（⛔ 用户要的是"别挡住对话框"，不是"关掉"—— 关了就看不着进度了）。 */
  if (minimized) {
    return (
      <button type="button" className={`image-lab-mini is-${state.status}`} onClick={() => setMinimized(false)} title="展开图像工坊">
        <span className="image-lab-mini-dot" />
        <span>{state.status === "running" ? `${stageText} ${percentText}%` : statusText}</span>
      </button>
    );
  }

  return (
    /* ⛔ 11-24 用户：「这个窗口挡住我看对话框」⇒ 不再用整屏遮罩的模态：
       容器只做定位（pointer-events:none），卡片自身可拖动、可最小化，
       默认落在右下角、宽 340 —— 主体对话始终可见可点。 */
    <div className="image-lab-layer">
      <div
        className="image-lab-dialog"
        style={pos ? { left: pos.left, top: pos.top, right: "auto", bottom: "auto" } : undefined}
        role="dialog"
        aria-label="图像工坊"
      >
        <div
          className="image-lab-head"
          onPointerDown={onHeadPointerDown}
          onPointerMove={onHeadPointerMove}
          onPointerUp={onHeadPointerUp}
          onPointerCancel={onHeadPointerUp}
          title="按住拖动"
        >
          <span className="image-lab-grip" aria-hidden="true">⋮⋮</span>
          <span className="image-lab-title" title={state.title}>{state.title}</span>
          <span className={`image-lab-status is-${state.status}`}>{statusText}</span>
          <button type="button" className="image-lab-btn" onClick={() => setMinimized(true)} title="最小化">–</button>
          <button type="button" className="image-lab-close" onClick={() => setState(null)} title="关闭">✕</button>
        </div>
        <div className="image-lab-body">
          {error && <div className="image-lab-error">{error}</div>}
          {!error && urls.length === 0 && (
            state.status === "running" ? (
              /* 11-24 用户：参考 owui-fx 的点阵效果 —— 中心扩散的点阵 + 阶段文案 + 右下角百分比。 */
              <div className="image-lab-fx">
                <ImageGenFx />
                <span className="image-lab-fx-cap">
                  {stageText}
                  <i className="d" /><i className="d" /><i className="d" />
                </span>
                <span className="image-lab-fx-pct">{percentText}%</span>
              </div>
            ) : (
              <div className="image-lab-empty">
                没有可显示的图像
                {state.note && <div className="image-lab-note">{state.note}</div>}
              </div>
            )
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
