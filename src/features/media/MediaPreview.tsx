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
import type { PointerEvent as ReactPointerEvent } from "react";
import { AlertTriangle, Box, ExternalLink, FolderOpen, Loader2, Maximize, Maximize2, Minimize2, Music2, Pause, PictureInPicture2, Play, Repeat, RotateCcw, RotateCw, Volume2, VolumeX, X } from "lucide-react";
import { AppSelect } from "../../components/AppSelect";
import { collectMediaPaths, isHlsSource, isRemoteMediaSource, mediaDisplaySrc, mediaKindOf, type MediaKind } from "../../lib/media-kind.mjs";
import { openMediaPreview, registerMediaPreview, resolveFilePath, type MediaPreviewTarget } from "../../lib/ui-channels";
import { recordMediaPlayback } from "../../lib/media-playback-store.mjs";
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

/* 10-29 用户令：harness-media 协议已不判可信根（任意位置音视频都能播）⇒
   原来这里"先授权所在目录再播放"的函数没有存在意义了，整段删除。 */

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
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    setFatal("");
    setNativeFailed(false);
  }, [source, reloadKey]);

  /* 倍速：原生 controls 在 Chromium 里没有稳定的倍速菜单 ⇒ 自绘一个。
     ⛔ 直接在 DOM 上找 <video>（HLS 与原生两条分支都由它渲染），不为写法差异各存一份 ref。 */
  const videoEl = (): HTMLVideoElement | null => stageRef.current?.querySelector("video") ?? null;
  useEffect(() => {
    const video = videoEl();
    if (video) video.playbackRate = rate;
  }, [rate, reloadKey]);

  const toggleFullscreen = () => {
    const stage = stageRef.current;
    if (!stage) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void stage.requestFullscreen?.().catch(() => undefined);
  };
  const togglePip = () => {
    const video = videoEl();
    if (!video) return;
    const doc = document as Document & { pictureInPictureEnabled?: boolean; exitPictureInPicture?: () => Promise<void> };
    if (document.pictureInPictureElement) void doc.exitPictureInPicture?.().catch(() => undefined);
    else void video.requestPictureInPicture?.().catch(() => undefined);
  };
  const pipSupported = typeof document !== "undefined" && Boolean((document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled);

  /* ⛔ 10-29：重试不再需要授权（协议已放开），直接重挂载即可。 */
  const retry = () => {
    setFatal("");
    setNativeFailed(false);
    setReloadKey((current) => current + 1);
  };

  return (
    <div className="media-stage media-stage-video" ref={stageRef}>
      {/* 11-01 用户实测「这一排按键显示位置不对」：不再浮在画面上，改成视频上方的一行工具条
          （左边标题、右边倍速/画中画/全屏）。浮层无论放哪都会压住画面或原生控制条。 */}
      <div className="media-video-bar">
        <span className="media-video-title" title={source}>{title}</span>
        <div className="media-video-tools">
          <label className="media-video-rate" title="播放速度">
            倍速
            <AppSelect value={String(rate)} onChange={(value) => setRate(Number(value))} options={RATE_OPTIONS} ariaLabel="播放速度" className="media-video-rate-select" />
          </label>
          {pipSupported ? (
            <button type="button" className="media-video-tool" onClick={togglePip} title="画中画（浮到最前，不挡操作）" aria-label="画中画">
              <PictureInPicture2 size={14} />
            </button>
          ) : null}
          <button type="button" className="media-video-tool" onClick={toggleFullscreen} title="全屏" aria-label="全屏">
            <Maximize size={14} />
          </button>
        </div>
      </div>
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
    </div>
  );
}

/* ── 音频（自绘播放条）────────────────────────────────────────────────────── */

export function AudioPlayer({ source, title, autoPlay, compact = false, poster }: { source: string; title?: string; autoPlay?: boolean; compact?: boolean; poster?: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [posterFailed, setPosterFailed] = useState(false);
  /* 11-01 用户令「音乐播放组件也丰富一下，要可以边听歌边干活」：
     倍速 / 循环 / ±15 秒（原生 controls 的音频条做不出这些）；缩小到迷你播放器在标题栏。 */
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);

  useEffect(() => { setPosterFailed(false); }, [poster]);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    setError("");
  }, [source, reloadKey]);

  useEffect(() => {
    if (autoPlay) void audioRef.current?.play().catch(() => undefined);
  }, [autoPlay, source, reloadKey]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = rate;
  }, [rate, reloadKey]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.loop = loop;
  }, [loop, reloadKey]);

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

  const skip = (delta: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const durationSeconds = Number.isFinite(audio.duration) ? audio.duration : 0;
    audio.currentTime = Math.max(0, Math.min(durationSeconds || audio.currentTime + delta, audio.currentTime + delta));
  };

  const progress = duration > 0 ? Math.min(100, Math.max(0, (current / duration) * 100)) : 0;
  const name = title || basenameOf(source);
  const local = isAbsoluteLocalPath(source);

  const retry = () => {
    setError("");
    setReloadKey((currentKey) => currentKey + 1);
  };

  return (
    <div className={`media-audio${compact ? " is-compact" : ""}`}>
      <div className={`media-audio-cover${playing ? " is-playing" : ""}${poster && !posterFailed ? " has-poster" : ""}`} aria-hidden="true">
        {poster && !posterFailed
          ? <img className="media-audio-poster" src={poster} alt="" loading="lazy" onError={() => setPosterFailed(true)} />
          : <Music2 size={compact ? 16 : 24} />}
        {(!poster || posterFailed) ? <><span /><span /><span /></> : null}
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
          {/* 11-01：±15 秒 / 循环 / 倍速（音频原生控件做不到这些） */}
          <button type="button" className="media-audio-iconbtn" title="后退 15 秒" aria-label="后退 15 秒" onClick={() => skip(-15)}><RotateCcw size={14} /></button>
          <button type="button" className="media-audio-iconbtn" title="前进 15 秒" aria-label="前进 15 秒" onClick={() => skip(15)}><RotateCw size={14} /></button>
          <button type="button" className={`media-audio-iconbtn${loop ? " is-on" : ""}`} title={loop ? "取消循环" : "循环播放"} aria-label="循环播放" onClick={() => setLoop((value) => !value)}><Repeat size={14} /></button>
          <AppSelect className="media-audio-rate" value={String(rate)} onChange={(value) => setRate(Number(value))} options={RATE_OPTIONS} ariaLabel="播放速度" title="播放速度" />
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
        onError={() => setError(source.startsWith("harness-music://")
          ? "音乐取流失败：酷狗直链被拒（可稍后重试、换一首，或让 Codex 重新播放一次）"
          : "音频加载失败（文件不存在或路径不在可信目录内）")}
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

const RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => ({ value: String(value), label: `${value}×` }));

/** 媒体预览弹窗：图片/视频/音频统一播放，本地与远程来源都接。 */
export function MediaPreviewModal({ target, onClose }: { target: MediaPreviewTarget; onClose: () => void }) {
  const source = target.source;
  const kind = (target.kind || mediaKindOf(source)) as Kind | "";
  const title = target.title || basenameOf(source) || "媒体预览";
  const remote = isRemoteMediaSource(source);
  const resolved = resolveFilePath(source);
  const local = isAbsoluteLocalPath(resolved);
  /* 11-01 用户实测：「开了这个窗口只能 ❌ 掉才能继续干活」⇒ 迷你模式：
     去掉全屏遮罩与页面拦截，缩到右下角小窗继续播；点「还原」回到大窗。
     ⛔ 只切样式、不换 DOM —— 换写法会重建 <video>，进度与播放状态全丢。 */
  const [mini, setMini] = useState(false);
  const [miniPos, setMiniPos] = useState<{ left: number; top: number } | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; left: number; top: number } | null>(null);
  useEffect(() => { setMini(false); setMiniPos(null); }, [source]);

  /* 迷你窗拖动：默认停右上角，按住标题栏可拖到任意位置（不挡输入框/侧栏）。 */
  const startMiniDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!mini) return;
    if ((event.target as HTMLElement).closest("button")) return;
    const el = backdropRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = { sx: event.clientX, sy: event.clientY, left: rect.left, top: rect.top };
    const move = (ev: PointerEvent) => {
      const start = dragRef.current;
      if (!start) return;
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      setMiniPos({
        left: Math.max(8, Math.min(window.innerWidth - width - 8, start.left + ev.clientX - start.sx)),
        top: Math.max(8, Math.min(window.innerHeight - height - 8, start.top + ev.clientY - start.sy)),
      });
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (mini) setMini(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, mini]);

  return (
    <div
      ref={backdropRef}
      className={`media-preview-backdrop${mini ? " is-mini" : ""}`}
      style={mini && miniPos ? { left: `${miniPos.left}px`, top: `${miniPos.top}px`, right: "auto", bottom: "auto" } : undefined}
      role="dialog"
      aria-modal={mini ? "false" : "true"}
      aria-label={title}
      onMouseDown={(event) => { if (!mini && event.target === event.currentTarget) onClose(); }}
    >
      <div className={`media-preview-dialog is-${kind || "unknown"}${mini ? " is-mini" : ""}`} onMouseDown={(event) => event.stopPropagation()}>
        <header className="media-preview-head" onPointerDown={startMiniDrag} style={mini ? { cursor: "move" } : undefined}>
          <span className="media-preview-kind">{kind ? kindIcon(kind) : <AlertTriangle size={15} />}{kind ? KIND_LABEL[kind] : "媒体"}</span>
          <strong className="media-preview-title" title={source}>{title}</strong>
          {mini ? (
            <button type="button" className="media-preview-iconbtn" title="还原大窗" aria-label="还原" onClick={() => { setMini(false); setMiniPos(null); }}><Maximize2 size={16} /></button>
          ) : (
            <button type="button" className="media-preview-iconbtn" title="缩小为悬浮小窗（可拖动，不挡操作）" aria-label="缩小" onClick={() => setMini(true)}><Minimize2 size={16} /></button>
          )}
          <button type="button" className="media-preview-iconbtn" title="关闭 (Esc)" aria-label="关闭" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="media-preview-body">
          {kind === "video" ? <VideoStage source={source} title={title} poster={target.poster} autoPlay={target.autoPlay} /> : null}
          {kind === "audio" ? <AudioPlayer source={source} title={title} autoPlay={target.autoPlay} poster={target.poster} /> : null}
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

/** 媒体预览桥：⛔ 只有**引擎**发起的预览才记成卡片（用户自己点附件不算）。 */
export function MediaPreviewBridge({ threadId = "", runningTurnIdsRef }: { threadId?: string; runningTurnIdsRef?: { current: Map<string, string> | null } }) {
  const [target, setTarget] = useState<MediaPreviewTarget | null>(null);

  useEffect(() => {
    /* 打开预览：来自**引擎**（`media-preview:open` = Codex 调了视频/音乐工具）才记卡片；
       用户自己点附件/文件卡打开的不记 —— 否则汇总下面会冒出一堆"没让 Codex 放过"的卡片。
       ⛔ 且必须当时有运行中的回合（runningTurnIdsRef），否则归不到任一回合、卡片无处可挂。 */
    const open = (next: MediaPreviewTarget, fromEngine = false) => {
      if (!next?.source) return;
      setTarget(next);
      if (!fromEngine) return;
      /* 只给视频/音乐出卡片：media_preview 也能开 3D 模型，那种卡片点了会按视频重开（错类型）。 */
      const kind = String(next.kind ?? "") || mediaKindOf(next.source);
      if (kind !== "video" && kind !== "audio") return;
      const turnId = runningTurnIdsRef?.current?.get(String(threadId ?? "")) ?? "";
      if (!turnId) return;
      recordMediaPlayback({ threadId, turnId, source: next.source, title: next.title ?? "", kind });
    };
    registerMediaPreview((next) => open(next, false));
    const api = window.codex as unknown as MediaBridgeApi;
    const off = api.onMediaPreviewOpen?.((event) => { if (event?.source) open(event, true); });
    return () => {
      off?.();
      registerMediaPreview(null);
    };
  }, [threadId, runningTurnIdsRef]);

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
