/**
 * 媒体预览弹窗（10-20）：视频 / 音频 / 3D 的统一出口。
 *
 * 入口三条，汇到同一个模块级 target：
 *   ① 文件卡 / 附件 chip → registerMediaPreview（src/lib/ui-channels，基座不反向依赖 features）
 *   ② 工具产物 → MediaResultCards
 *   ③ 引擎 harness_tools 的 media_source_open → 主进程 media-preview:open → 本组件
 *
 * 视频：mp4/webm 等原生 controls；m3u8 走 hls.js（懒加载，Chromium 不原生支持 HLS）。
 * 音频：自绘播放条（播放/暂停/进度/音量），单文件。
 * 3D：复用既有 ModelViewerModal（本地 glb/gltf）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Box, ExternalLink, FolderOpen, Loader2, Music2, Pause, Play, Volume2, VolumeX, X } from "lucide-react";
import { collectMediaPaths, isHlsSource, isRemoteMediaSource, mediaDisplaySrc, mediaKindOf, type MediaKind } from "../../lib/media-kind.mjs";
import { openMediaPreview, registerMediaPreview, resolveFilePath, type MediaPreviewTarget } from "../../lib/ui-channels";
import { openModelViewer } from "../model-viewer";

type Kind = Exclude<MediaKind, "">;

const KIND_LABEL: Record<Kind, string> = { video: "视频", audio: "音频", model: "3D 模型" };

function basenameOf(path: string): string {
  return String(path ?? "").split(/[\\/]/).pop() || String(path ?? "");
}

function isAbsoluteLocalPath(path: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(String(path ?? ""));
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const total = Math.floor(value);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function kindIcon(kind: Kind, size = 15) {
  if (kind === "audio") return <Music2 size={size} />;
  if (kind === "model") return <Box size={size} />;
  return <Play size={size} />;
}

async function authorizeDirectory(source: string): Promise<boolean> {
  const dir = source.replace(/[\\/][^\\/]*$/, "");
  if (!dir || dir === source) return false;
  await window.codex.allowFsPath(dir);
  return true;
}

/* ── 视频 ─────────────────────────────────────────────────────────────────── */

function HlsVideo({ source, poster, autoPlay, onFatal }: { source: string; poster?: string; autoPlay?: boolean; onFatal: (message: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fatalRef = useRef(onFatal);
  fatalRef.current = onFatal;
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let hls: { destroy: () => void } | null = null;
    setLoading(true);
    void (async () => {
      try {
        const mod = await import("hls.js");
        const Hls = mod.default;
        if (cancelled) return;
        if (Hls.isSupported()) {
          const instance = new Hls({ enableWorker: true, backBufferLength: 90 });
          hls = instance;
          instance.on(Hls.Events.MANIFEST_PARSED, () => {
            if (cancelled) return;
            setLoading(false);
            if (autoPlay) void video.play().catch(() => undefined);
          });
          instance.on(Hls.Events.ERROR, (_event: unknown, data: { fatal?: boolean; type?: string; details?: string }) => {
            if (cancelled || !data?.fatal) return;
            setLoading(false);
            fatalRef.current(`HLS 播放失败：${data.details || data.type || "未知错误"}`);
          });
          instance.loadSource(source);
          instance.attachMedia(video);
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = source;
          setLoading(false);
          if (autoPlay) void video.play().catch(() => undefined);
        } else {
          setLoading(false);
          fatalRef.current("当前环境不支持 HLS 播放");
        }
      } catch (error) {
        setLoading(false);
        fatalRef.current(`HLS 模块加载失败：${String((error as Error)?.message ?? error)}`);
      }
    })();
    return () => {
      cancelled = true;
      try { hls?.destroy(); } catch { /* 已销毁 */ }
    };
  }, [source, autoPlay]);

  return (
    <div className="media-video-wrap">
      <video ref={videoRef} className="media-video" controls playsInline poster={poster} />
      {loading ? <div className="media-video-loading"><Loader2 size={15} className="spin" />正在加载 HLS 流…</div> : null}
    </div>
  );
}

function VideoStage({ source, title, poster, autoPlay }: { source: string; title: string; poster?: string; autoPlay?: boolean }) {
  const remote = isRemoteMediaSource(source);
  const hls = isHlsSource(source) && remote;
  const [fatal, setFatal] = useState("");
  const [nativeFailed, setNativeFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const local = isAbsoluteLocalPath(source);
  const failed = Boolean(fatal) || nativeFailed;

  useEffect(() => {
    setFatal("");
    setNativeFailed(false);
  }, [source, reloadKey]);

  const retry = async () => {
    const ok = await authorizeDirectory(source).catch(() => false);
    if (!ok) return;
    setFatal("");
    setNativeFailed(false);
    setReloadKey((current) => current + 1);
  };

  return (
    <div className="media-stage media-stage-video">
      {hls ? (
        <HlsVideo key={reloadKey} source={source} poster={poster} autoPlay={autoPlay} onFatal={setFatal} />
      ) : (
        <div className="media-video-wrap">
          <video
            key={reloadKey}
            className="media-video"
            controls
            autoPlay={autoPlay}
            playsInline
            preload="metadata"
            poster={poster}
            src={mediaDisplaySrc(source)}
            onError={() => setNativeFailed(true)}
          />
        </div>
      )}
      {failed ? (
        <div className="media-preview-overlay" role="alert">
          <AlertTriangle size={20} />
          <strong>无法播放这个媒体</strong>
          <span>{fatal || "文件可能不存在、编码不受支持，或路径不在可信目录内。"}</span>
          <div className="media-preview-overlay-actions">
            {local ? <button type="button" onClick={() => void retry()}>授权所在目录后重试</button> : null}
            {remote ? <button type="button" onClick={() => void window.codex.openExternal(source)}><ExternalLink size={13} />在浏览器打开</button> : null}
          </div>
        </div>
      ) : null}
      <span className="media-stage-caption" title={source}>{title}</span>
    </div>
  );
}

/* ── 音频（自绘播放条）────────────────────────────────────────────────────── */

export function AudioPlayer({ source, title, autoPlay, compact = false }: { source: string; title?: string; autoPlay?: boolean; compact?: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    setError("");
  }, [source, reloadKey]);

  useEffect(() => {
    if (autoPlay) void audioRef.current?.play().catch(() => undefined);
  }, [autoPlay, source, reloadKey]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch((reason) => setError(`无法播放：${String(reason?.message ?? reason)}`));
    else audio.pause();
  };

  const seek = (value: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = value;
    setCurrent(value);
  };

  const changeVolume = (value: number) => {
    const audio = audioRef.current;
    setVolume(value);
    setMuted(value === 0);
    if (audio) { audio.volume = value; audio.muted = value === 0; }
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const next = !audio.muted;
    audio.muted = next;
    setMuted(next);
  };

  const progress = duration > 0 ? Math.min(100, Math.max(0, (current / duration) * 100)) : 0;
  const name = title || basenameOf(source);
  const local = isAbsoluteLocalPath(source);

  const retry = async () => {
    const ok = await authorizeDirectory(source).catch(() => false);
    if (!ok) return;
    setError("");
    setReloadKey((currentKey) => currentKey + 1);
  };

  return (
    <div className={`media-audio${compact ? " is-compact" : ""}`}>
      <div className={`media-audio-cover${playing ? " is-playing" : ""}`} aria-hidden="true">
        <Music2 size={compact ? 16 : 24} />
        <span /><span /><span />
      </div>
      <div className="media-audio-main">
        <div className="media-audio-title" title={source}>{name}</div>
        <div className="media-audio-controls">
          <button type="button" className="media-audio-toggle" title={playing ? "暂停" : "播放"} aria-label={playing ? "暂停" : "播放"} onClick={toggle}>
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <span className="media-audio-time">{formatTime(current)}</span>
          <input
            type="range"
            className="media-audio-seek"
            aria-label="播放进度"
            min={0}
            max={duration > 0 ? duration : 0}
            step={0.1}
            value={current}
            style={{ "--media-progress": `${progress}%` } as React.CSSProperties}
            onChange={(event) => seek(Number(event.target.value))}
          />
          <span className="media-audio-time">{formatTime(duration)}</span>
          {!compact ? (
            <div className="media-audio-volume">
              <button type="button" className="media-audio-iconbtn" title={muted ? "取消静音" : "静音"} onClick={toggleMute}>
                {muted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
              <input
                type="range"
                aria-label="音量"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                style={{ "--media-progress": `${(muted ? 0 : volume) * 100}%` } as React.CSSProperties}
                onChange={(event) => changeVolume(Number(event.target.value))}
              />
            </div>
          ) : null}
        </div>
        {error ? (
          <div className="media-audio-error">
            <AlertTriangle size={13} />
            <span>{error}</span>
            {local ? <button type="button" onClick={() => void retry()}>授权目录重试</button> : null}
          </div>
        ) : null}
      </div>
      <audio
        key={reloadKey}
        ref={audioRef}
        src={mediaDisplaySrc(source)}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(Number(event.currentTarget.duration) || 0)}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrent(0); }}
        onError={() => setError("音频加载失败（文件不存在或路径不在可信目录内）")}
      />
    </div>
  );
}

/* ── 3D ──────────────────────────────────────────────────────────────────── */

function ModelStage({ source, title }: { source: string; title: string }) {
  const resolved = resolveFilePath(source);
  const local = isAbsoluteLocalPath(resolved);
  return (
    <div className="media-stage media-stage-model">
      <div className="media-model-orb" aria-hidden="true"><Box size={54} /></div>
      <strong className="media-model-title">{title}</strong>
      <p className="media-model-note">{local ? "本地 3D 模型 · 支持 glb / gltf" : "远程 3D 模型地址"}</p>
      <button
        type="button"
        className="media-primary-btn"
        onClick={() => {
          if (local) openModelViewer(resolved, title);
          else void window.codex.openExternal(source);
        }}
      >
        {local ? <><Box size={15} />打开 3D 预览</> : <><ExternalLink size={15} />在浏览器打开</>}
      </button>
    </div>
  );
}

/* ── 弹窗 / 桥 ────────────────────────────────────────────────────────────── */

export function MediaPreviewModal({ target, onClose }: { target: MediaPreviewTarget; onClose: () => void }) {
  const source = target.source;
  const kind = (target.kind || mediaKindOf(source)) as Kind | "";
  const title = target.title || basenameOf(source) || "媒体预览";
  const remote = isRemoteMediaSource(source);
  const resolved = resolveFilePath(source);
  const local = isAbsoluteLocalPath(resolved);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="media-preview-backdrop" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`media-preview-dialog is-${kind || "unknown"}`} onMouseDown={(event) => event.stopPropagation()}>
        <header className="media-preview-head">
          <span className="media-preview-kind">{kind ? kindIcon(kind) : <AlertTriangle size={15} />}{kind ? KIND_LABEL[kind] : "媒体"}</span>
          <strong className="media-preview-title" title={source}>{title}</strong>
          <button type="button" className="media-preview-iconbtn" title="关闭 (Esc)" aria-label="关闭" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="media-preview-body">
          {kind === "video" ? <VideoStage source={source} title={title} poster={target.poster} autoPlay={target.autoPlay} /> : null}
          {kind === "audio" ? <AudioPlayer source={source} title={title} autoPlay={target.autoPlay} /> : null}
          {kind === "model" ? <ModelStage source={source} title={title} /> : null}
          {!kind ? <div className="media-preview-empty"><AlertTriangle size={22} /><strong>这个文件不是可预览的媒体</strong><span>支持视频（mp4 / webm / mov / m4v / ogv）、音频（mp3 / wav / m4a / aac / ogg / flac / opus）与 3D（glb / gltf）。</span></div> : null}
        </div>
        <footer className="media-preview-foot">
          <span className="media-preview-path" title={source}>{source.length > 140 ? `${source.slice(0, 140)}…` : source}</span>
          <div className="media-preview-actions">
            {local ? <button type="button" onClick={() => void window.codex.shellReveal(resolved)}><FolderOpen size={13} />文件夹</button> : null}
            {remote ? <button type="button" onClick={() => void window.codex.openExternal(source)}><ExternalLink size={13} />浏览器打开</button> : null}
          </div>
        </footer>
      </div>
    </div>
  );
}

type MediaBridgeApi = {
  onMediaPreviewOpen?: (listener: (event: MediaPreviewTarget) => void) => (() => void) | undefined;
};

export function MediaPreviewBridge() {
  const [target, setTarget] = useState<MediaPreviewTarget | null>(null);

  useEffect(() => {
    registerMediaPreview((next) => setTarget(next));
    const api = window.codex as unknown as MediaBridgeApi;
    const off = api.onMediaPreviewOpen?.((event) => { if (event?.source) setTarget(event); });
    return () => {
      off?.();
      registerMediaPreview(null);
    };
  }, []);

  if (!target) return null;
  return <MediaPreviewModal target={target} onClose={() => setTarget(null)} />;
}

/* ── 工具产物里的媒体条 ───────────────────────────────────────────────────── */

export function MediaResultCards({ text, limit = 8 }: { text: string; limit?: number }) {
  const candidates = useMemo(() => collectMediaPaths(text, limit), [text, limit]);
  const [confirmed, setConfirmed] = useState<Array<{ path: string; kind: Kind }>>([]);

  useEffect(() => {
    let alive = true;
    setConfirmed([]);
    void (async () => {
      const next: Array<{ path: string; kind: Kind }> = [];
      for (const item of candidates) {
        if (isRemoteMediaSource(item.path)) { next.push(item); continue; }
        const abs = resolveFilePath(item.path);
        try {
          const result = await window.codex.fileExists(abs);
          if (result?.exists) next.push({ path: abs, kind: item.kind });
        } catch { /* 探测失败就不出卡，避免点开报错 */ }
      }
      if (alive) setConfirmed(next);
    })();
    return () => { alive = false; };
  }, [candidates]);

  if (!confirmed.length) return null;
  return (
    <div className="media-result-strip" aria-label="媒体产物">
      {confirmed.map((item, index) => (
        <button
          type="button"
          className={`media-result-card is-${item.kind}`}
          key={`${item.path}-${index}`}
          title={item.path}
          onClick={() => openMediaPreview({ source: item.path, kind: item.kind, title: basenameOf(item.path) })}
        >
          <span className="media-result-icon">{kindIcon(item.kind, 14)}</span>
          <span className="media-result-name">{basenameOf(item.path)}</span>
          <span className="media-result-action">{item.kind === "model" ? "预览" : "播放"}</span>
        </button>
      ))}
    </div>
  );
}
