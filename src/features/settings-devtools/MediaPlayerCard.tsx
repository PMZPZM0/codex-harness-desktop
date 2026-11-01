/**
 * 影视播放器（开发工具 · **卡片内联版**，11-01）
 *
 * ⛔ 用户三条裁定（本轮按此改）：
 *   ① **不要内嵌弹窗**：播放器直接长在卡片里，不再用全屏 backdrop 浮层
 *      （上一版浮层挡住输入框，地址根本没法粘贴）。
 *   ② **按需下载**：hls.js 不随包分发，展开卡片时才从 CDN 取；取不到就说清楚并给外部播放器兜底。
 *   ③ 放回**卡片里**、与其它工具卡同级；并写明**免责声明**。
 *
 * 资源网址：列出内置苹果CMS源接口（与后端 media-sources.ts 同一份配置），可一键复制。
 * 搜索：搜片由对话里的 Codex 调用后端工具（media_search → media_detail → media_preview）；
 *   本卡片负责「手动地址播放 / 验证内核」。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Tv } from "lucide-react";

const HLS_CDN = [
  "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js",
  "https://unpkg.com/hls.js@1.5.17/dist/hls.min.js",
];

const SOURCE_APIS: Array<[string, string]> = [
  ["非凡资源", "https://api.ffzyapi.com/api.php/provide/vod"],
  ["量子资源", "https://cj.lziapi.com/api.php/provide/vod"],
  ["光速资源", "https://api.guangsuapi.com/api.php/provide/vod"],
  ["暴风资源", "https://bfzyapi.com/api.php/provide/vod"],
];

type Kernel = "idle" | "loading" | "ready" | "failed";

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("load failed: " + src));
    document.head.appendChild(el);
  });
}

export function MediaPlayerCard({ onNotice }: { onNotice?: (message: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [kernel, setKernel] = useState<Kernel>("idle");
  const [url, setUrl] = useState("");
  const [playing, setPlaying] = useState("");
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!expanded || kernel !== "idle") return;
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
  }, [expanded, kernel]);

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
        const hls = new Hls({ maxBufferLength: 30 });
        hls.loadSource(target);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_e: unknown, data: any) => {
          if (data?.fatal) setError("播放失败：" + String(data?.details ?? "未知") + "（可换一个片源试试）");
        });
      } else {
        setError("HLS 内核未就绪 —— m3u8 需要它；可把地址复制到 VLC / IINA 播放。");
      }
    } else {
      video.src = target;
    }
    video.play().catch(() => { /* 需用户再点一次播放按钮 */ });
    onNotice?.("已开始播放");
  }, [onNotice]);

  return (
    <div className="voice-devtools-card">
      <div className="voice-devtools-card-head">
        <div className="voice-devtools-icon"><Tv size={20} /></div>
        <span className="voice-group-tag">按需</span>
        <strong className="voice-devtools-name">影视播放器</strong>
        <span className="voice-devtools-badge">
          {kernel === "ready" ? "内核已就绪" : kernel === "failed" ? "内核不可用" : "按需下载"}
        </span>
      </div>

      <div className="voice-devtools-body">
        <span className="voice-devtools-sub">hls.js（MIT）+ 原生 video · m3u8 / mp4 · 不随包分发</span>
        <div className="voice-devtools-desc">
          影视源已内置于后端。<strong>在对话里直接说「放某部电影」</strong>，Codex 会搜片并在对话播放器里起播；
          这张卡是「手上已有播放地址」时的手动入口，也用来验证播放内核。
        </div>

        {expanded ? (
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void play(url); }}
                placeholder="粘贴 m3u8 / mp4 地址，回车播放"
                spellCheck={false}
                style={{ flex: 1, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--line-soft, rgba(0,0,0,.15))", background: "var(--bg, #fff)", color: "var(--text)" }}
              />
              <button className="primary-setting" onClick={() => void play(url)}>播放</button>
            </div>
            {error ? <div className="voice-devtools-desc" style={{ color: "#dc2626" }}>{error}</div> : null}
            <video
              ref={videoRef}
              controls
              playsInline
              style={{ width: "100%", maxHeight: 360, background: "#000", borderRadius: 8 }}
              src={playing && !/\.m3u8(\?|$)/i.test(playing) ? playing : undefined}
            />
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
              支持 m3u8（HLS）与 mp4；进度、倍速、全屏用浏览器原生控件。
              {kernel === "failed" ? " 内核加载失败（网络受限）：可直接把地址复制到 VLC / IINA。" : ""}
            </div>

            <div style={{ marginTop: 10, fontSize: 12 }}>
              <div style={{ color: "var(--muted)", marginBottom: 4 }}>资源网址（内置源接口，对话里由 Codex 自动调用）：</div>
              {SOURCE_APIS.map(([name, api]) => (
                <div key={api} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                  <span style={{ width: 64, flex: "none" }}>{name}</span>
                  <code style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{api}</code>
                  <button
                    className="secondary-setting"
                    style={{ flex: "none" }}
                    onClick={() => { void navigator.clipboard?.writeText(api); onNotice?.("已复制源地址"); }}
                  >
                    复制
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="voice-devtools-actions">
        <button className="primary-setting" onClick={() => setExpanded((v) => !v)}>
          <Play size={13} />{expanded ? "收起播放器" : "打开播放器"}
        </button>
      </div>

      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>
        声明：本功能仅提供<b>索引与播放</b>能力，不托管、不存储、不分发任何影视内容；片源由第三方接口提供，
        可用性与合法性由其自行负责。请遵守当地法律与版权规定。
      </div>
    </div>
  );
}
