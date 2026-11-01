/**
 * 影视播放器（开发工具 → 影视播放器，11-01 用户令）
 *
 * ⛔ 定位：**对话内播放（media_preview 工具）之外的手动入口**。
 *   对话里让 Codex 搜片时它会直接起播（渲染层 MediaPreview 自挂载）；
 *   这个卡片给的是「我自己有地址，想直接播」的场景，以及验证播放器内核是否可用。
 *
 * ⛔ 播放内核 = **hls.js（MIT，约 200KB）+ 原生 `<video>`**，按需从 CDN 取：
 *   不随包分发、不内置播放器二进制（吸取 611MB Chromium 的教训）。
 *   取不到时明确提示「内核未就绪」并给出兜底（交给系统浏览器打开），不假装能播。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Tv, X } from "lucide-react";

const HLS_CDN = [
  "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js",
  "https://unpkg.com/hls.js@1.5.17/dist/hls.min.js",
];

type Kernel = "idle" | "loading" | "ready" | "failed";

/* ⛔ 内置影视源的**接口地址**（苹果CMS v10 vod 接口）。这里只做展示与复制，
   真正的请求在内存侧的 media-sources.ts（同一份配置，单一真相源）。
   用户要看「资源从哪来」时，直接把这几条给出来，不用去翻配置文件。 */
const SOURCE_APIS: Array<[string, string]> = [
  ["非凡资源", "https://api.ffzyapi.com/api.php/provide/vod"],
  ["量子资源", "https://cj.lziapi.com/api.php/provide/vod"],
  ["光速资源", "https://api.guangsuapi.com/api.php/provide/vod"],
  ["暴风资源", "https://bfzyapi.com/api.php/provide/vod"],
];

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`加载失败：${src}`));
    document.head.appendChild(el);
  });
}

export function MediaPlayerCard({ onNotice }: { onNotice?: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [kernel, setKernel] = useState<Kernel>("idle");
  const [url, setUrl] = useState("");
  const [playing, setPlaying] = useState<string>("");
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);

  /* 打开面板时**才**去取内核（按需下载：不打开就零成本） */
  useEffect(() => {
    if (!open || kernel !== "idle") return;
    let alive = true;
    setKernel("loading");
    (async () => {
      for (const src of HLS_CDN) {
        try {
          await loadScript(src);
          if (!alive) return;
          setKernel("ready");
          return;
        } catch { /* 换下一个 CDN */ }
      }
      if (alive) setKernel("failed");
    })();
    return () => { alive = false; };
  }, [open, kernel]);

  const play = useCallback(async (source: string) => {
    const target = source.trim();
    if (!target) return;
    if (!/^https?:\/\//i.test(target)) { setError("需要一个 http(s) 地址（m3u8 或 mp4）"); return; }
    setError("");
    setPlaying(target);
    const video = videoRef.current;
    if (!video) return;
    const Hls = (window as any).Hls;
    if (/\.m3u8(\?|$)/i.test(target)) {
      if (Hls?.isSupported?.()) {
        const hls = new Hls({ lowLatencyMode: false, maxBufferLength: 30 });
        hls.loadSource(target);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_e: unknown, data: any) => {
          if (data?.fatal) setError(`播放失败：${data?.details ?? "未知"}（可换一个片源试试）`);
        });
      } else {
        setError("HLS 内核未就绪 —— m3u8 需要它；可直接用外部播放器打开该地址。");
      }
    } else {
      video.src = target;
    }
    video.play().catch(() => { /* 用户未交互前可能被拦截，界面已给出播放按钮 */ });
    onNotice?.("已开始播放");
  }, [onNotice]);

  return (
    <>
      <div className="voice-devtools-card">
        <div className="voice-devtools-card-head">
          <div className="voice-devtools-icon"><Tv size={20} /></div>
          <strong className="voice-devtools-name">影视播放器</strong>
          <span className="voice-devtools-badge">{kernel === "ready" ? "内核已就绪 · 按需下载" : "按需下载"}</span>
        </div>
        <div className="voice-devtools-body">
          <span className="voice-devtools-sub">hls.js（MIT）+ 原生 video · m3u8 / mp4 · 不内置播放器二进制</span>
          <div className="voice-devtools-desc">
            影视源（非凡 / 量子 / 光速 / 暴风…）已内置于后端。<strong>在对话里直接说「放某部电影」</strong>，
            Codex 会用内置源搜索并在对话播放器里起播；
            这个面板给「手上已有播放地址」的场景，也可以用来验证内核是否可用。
            <br />
            只做索引与播放，不托管、不下载任何影视内容。
          </div>
        </div>
        <div className="voice-devtools-actions" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>资源网址（内置源接口，对话里由 Codex 自动调用）：</div>
          {SOURCE_APIS.map(([name, api]) => (
            <div key={api} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
              <span style={{ width: 64, flex: "none" }}>{name}</span>
              <code style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{api}</code>
              <button className="secondary-setting" style={{ flex: "none" }} onClick={() => { void navigator.clipboard?.writeText(api); onNotice?.("已复制源地址"); }}>复制</button>
            </div>
          ))}
        </div>
        <div className="voice-devtools-actions">
          <button className="primary-setting" onClick={() => setOpen(true)}>
            <Play size={13} />打开播放器
          </button>
        </div>
      </div>

      {open ? (
        <div className="devtool-health-backdrop" onClick={() => setOpen(false)}>
          <div className="devtool-health-dialog" style={{ width: "min(760px, 94vw)" }} onClick={(e) => e.stopPropagation()}>
            <div className="devtool-health-head">
              <strong>影视播放器{kernel === "loading" ? " · 正在加载内核…" : kernel === "failed" ? " · 内核未就绪" : ""}</strong>
              <button className="secondary-setting" onClick={() => setOpen(false)}><X size={13} />关闭</button>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="粘贴 m3u8 / mp4 地址"
                style={{ flex: 1, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--line-soft, rgba(0,0,0,.15))" }}
              />
              <button className="primary-setting" onClick={() => void play(url)}>播放</button>
            </div>
            {error ? <div className="devtool-health-row is-bad"><span className="devtool-health-badge">✕</span><span className="devtool-health-detail">{error}</span></div> : null}
            <video
              ref={videoRef}
              controls
              playsInline
              style={{ width: "100%", maxHeight: "52vh", background: "#000", borderRadius: 8 }}
              src={playing && !/\.m3u8(\?|$)/i.test(playing) ? playing : undefined}
            />
            <small style={{ color: "var(--muted)" }}>
              {kernel === "failed" ? "内核加载失败（网络受限）：可直接把地址复制到外部播放器（VLC / IINA）播放。" : "支持 m3u8（HLS）与 mp4；拖动进度条、倍速由浏览器原生控件提供。"}
            </small>
          </div>
        </div>
      ) : null}
    </>
  );
}
