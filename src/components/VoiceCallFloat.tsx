/**
 * VoiceCallFloat —— **视图层**（09-22：状态与逻辑已提成 useVoiceCallFloatState，本文件只剩 JSX）。
 * ⛔ 解构名与 hook 返回键同名 ⇒ JSX 与搬迁前逐字一致。
 */
import { createPortal } from "react-dom";
import { AlertCircle, AudioLines, Download, EyeOff, LoaderCircle, Mic, Monitor, PhoneOff, Settings2, X } from "lucide-react";
import VoiceMascot from "./VoiceMascot";
import VoiceCallScreen from "./VoiceCallScreen";
import { patchVoiceStage, requestVoiceDictationSend, requestVoiceOpenSettings, resetVoiceStage, setVoiceDictationHandler, setVoiceLevel, setVoiceStopHandler } from "../voice/wave-level";
import { useVoiceCallFloatState } from "./VoiceCallFloat/use-voice-call-float-state";

export type VoicePhase = "idle" | "starting" | "active";
export type VoiceState = "listening" | "thinking" | "speaking";
export type ModelsStatus = { ready: boolean; missing: string[]; readyFiles: number; totalFiles: number; bytes: number };
export const POS_KEY = "voice-float-pos";
const DEFAULT_POS = { right: 22, bottom: 104 };
export const CAPTURE_RATE = 16000;
export const BARGUE_COOLDOWN_MS = 1200;
/** 参考环 30 秒（审计 ⑤①）：TTS 队列领先量可以到十几秒，2 秒的环必然失步 */
export const REF_RING_SECONDS = 30;
/** AEC 延迟线上限 256ms：蓝牙耳机也够（真实值由 outputLatency 按次校正） */
export const AEC_MAX_DELAY_SAMPLES = Math.round(CAPTURE_RATE * 0.256);
export const AEC_DEFAULT_DELAY_SAMPLES = Math.round(CAPTURE_RATE * 0.02);
/** 听写/通话：先开麦时最多暂存多久音频（等 ASR 加载时用）。超出丢最旧的。 */
export const PREBUFFER_MAX_SAMPLES = CAPTURE_RATE * 3;
/** 端点提前判定：partial 以句末标点收尾 + 连续这么久低能量 → 立即提交（审计 ④） */
export const ENDPOINT_QUIET_RMS = 0.006;
export const ENDPOINT_QUIET_MS = 500;
/**
 * 悬浮球的随机短提示词——按任务状态**分池**，每条池里是"运行状态/搞笑话语/个性化"三类混合。
 *
 * **刻意写得很短（≤6 字）**：气泡是从悬浮球往左弹出的，太长会盖住输入框。
 * 所以每条都压到 6 个字以内，配合设置里的"是否弹出"开关，不想要可以关掉。
 * 弹的频率也调低了（15~25 秒一次，显示 3 秒）——之前 7~12 秒太吵。
 */
const HINT_POOLS: Record<string, string[]> = {
  // 待机（ball 显示但通话没开）
  idle: [
    "点我开始 →",
    "戳我说话",
    "右键可隐藏",
    "今天聊点啥",
    "我在呢",
    "说句话呗",
  ],
  // 启动中
  starting: [
    "准备中…",
    "马上好…",
  ],
  // 聆听
  listening: [
    "我在听…",
    "慢慢说",
    "嗯，在听",
    "继续说",
  ],
  // 思考
  thinking: [
    "想想…",
    "让我想想",
    "算一下…",
    "有意思",
  ],
  // 播报
  speaking: [
    "我在说…",
    "可打断我",
    "稍等…",
  ],
  // 模型没下完
  modelsMissing: [
    "先下模型",
    "去设置下",
    "还没准备好",
  ],
};
/** 按当前 phase/state/模型状态挑一个最合适的池子随机抽 */
export function pickHint(phase: VoicePhase, state: VoiceState, modelsReady: boolean): string {
  let pool: string[];
  if (!modelsReady && phase !== "active") {
    pool = HINT_POOLS.modelsMissing;
  } else if (phase === "active") {
    pool = HINT_POOLS[state] ?? HINT_POOLS.idle;
  } else if (phase === "starting") {
    pool = HINT_POOLS.starting;
  } else {
    pool = HINT_POOLS.idle;
  }
  return pool[Math.floor(Math.random() * pool.length)];
}
function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(0)} MB`;
}
export function readPos(): { right: number; bottom: number } {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return DEFAULT_POS;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.right === "number" && typeof parsed?.bottom === "number") return parsed;
  } catch {
    /* 坏数据就当没存过 */
  }
  return DEFAULT_POS;
}

export default function VoiceCallFloat({ threadId }: { threadId?: string }) {
  const { phase, setPhase, state, setState, expanded, setExpanded, levelRef, screenElRef, applyLevel, muted, setMuted, mutedRef, toggleMute, transcript, setTranscript, callStartedAt, setCallStartedAt, userText, setUserText, agentText, setAgentText, ballVisible, setBallVisible, hintsEnabled, setHintsEnabled, hint, setHint, menu, setMenu, callScreen, setCallScreen, agentTextRef, ballRef, notice, setNotice, endpointSec, setEndpointSec, models, setModels, download, setDownload, pos, setPos, mediaStreamRef, captureCtxRef, workletRef, playCtxRef, playQueueRef, playingCountRef, aecRef, bargeModeRef, micSettingsRef, volumeRef, gateRef, chunkerRef, speakFilterRef, prebufferRef, liveRef, refRingRef, refWriteRef, refReadRef, refDropsRef, endpointArmedRef, quietSinceRef, lastBargeAtRef, speakingRef, phaseRef, voiceModeRef, dragRef, refreshModels, busyElsewhere, setBusyElsewhere, onBallContextMenu, hideBall, pushRef, enqueuePlay, speechEpochRef, bumpSpeechEpoch, stopPlayback, skipCurrent, speakDelta, flushSpeech, startCapture, teardown, startCall, endCall, startCallRef, callToggleRef, pushTranscript, wakeCfg, setWakeCfg, installModels, draggedRef, onPointerDown, onPointerMove, onPointerUp, onBallClick, stateLabel, modelsReady, ballClass } = useVoiceCallFloatState({ threadId });
  return createPortal(
    <>
      {/* 应用内通话界面：全屏遮罩，接通自动弹出、可收起（收起不挂断） */}
      {callScreen && (
        <VoiceCallScreen
          phase={phase}
          state={state}
          userText={userText}
          agentText={agentText}
          notice={notice}
          modelsReady={modelsReady}
          muted={muted}
          startedAt={callStartedAt}
          transcript={transcript}
          onToggleMute={toggleMute}
          onSkip={() => skipCurrent()}
          onStart={() => void startCall()}
          onBarge={() => {
            stopPlayback();
            void window.codex.voiceBarge().catch(() => undefined);
          }}
          onHangup={() => void endCall()}
          onMinimize={() => setCallScreen(false)}
        />
      )}
      <div className="voice-float-layer" style={{ right: pos.right, bottom: pos.bottom }}>
      {expanded && (
        <div className="voice-panel" role="dialog" aria-label="语音通话">
          <header className="voice-panel-head">
            <span className={`voice-dot is-${phase === "active" ? state : "idle"}`} />
            <strong>{phase === "active" ? stateLabel : "语音通话"}</strong>
            <button className="voice-icon-btn" title="收起" onClick={() => setExpanded(false)}>
              <X size={14} />
            </button>
          </header>

          {phase === "active" ? (
            <>
              <div className="voice-level" aria-hidden>
                {Array.from({ length: 22 }).map((_, index) => {
                  const threshold = (index % 11) / 11;
                  return <i key={index} style={{ height: `${6 + (index % 6) * 3}px`, "--t": String(threshold) } as any} />;
                })}
              </div>
              <div className="voice-caption">
                <div className="voice-caption-row">
                  <span className="voice-caption-tag">你说</span>
                  <p>{userText || "…"}</p>
                </div>
                <div className="voice-caption-row agent">
                  <span className="voice-caption-tag">回复</span>
                  <p>{agentText || "…"}</p>
                </div>
              </div>
              <div className="voice-panel-actions">
                <button
                  className="voice-secondary"
                  onClick={() => {
                    stopPlayback();
                    void window.codex.voiceBarge().catch(() => undefined);
                  }}
                >
                  <AudioLines size={14} />打断
                </button>
                <button className="voice-danger" onClick={() => void endCall()}>
                  <PhoneOff size={14} />挂断
                </button>
              </div>
              {/* 端点静音：说完了等多久算一句话（越小越跟手，太小会截断长句）。
                  设置 → 语音通话 → 长句提前断句 可调；这里只做「可见」。 */}
              <div className="voice-latency-hint">
                说完停顿 {endpointSec.toFixed(1)}s 即回话（设置里可调）
              </div>
            </>
          ) : (
            <>
              <p className="voice-hint">
                点一下麦克风开始通话：本机离线识别，开口即可打断。原有打字输入完全不受影响。
              </p>
              <div className="voice-models">
                {models ? (
                  modelsReady ? (
                    <span className="voice-models-ok">语音模型已就绪（{formatBytes(models.bytes)}）</span>
                  ) : (
                    <span className="voice-models-missing">
                      语音模型未下载（{models.readyFiles}/{models.totalFiles}，约 270MB）
                    </span>
                  )
                ) : (
                  <span className="voice-models-missing">无法读取模型状态</span>
                )}
              </div>
              {download && (
                <div className="voice-progress">
                  <div className="voice-progress-bar">
                    <span style={{ width: `${download.percent >= 0 ? download.percent : 5}%` }} />
                  </div>
                  <small>{download.message}</small>
                </div>
              )}
              <div className="voice-panel-actions">
                {!modelsReady && (
                  download ? (
                    <button className="voice-secondary" onClick={() => void window.codex.voiceModelsCancel()}>
                      <X size={14} />取消下载
                    </button>
                  ) : (
                    <button className="voice-secondary" onClick={() => void installModels()}>
                      <Download size={14} />下载模型
                    </button>
                  )
                )}
                <button className="voice-primary" disabled={phase === "starting"} onClick={() => void startCall()}>
                  {phase === "starting" ? <LoaderCircle size={14} className="spin" /> : <Mic size={14} />}开始通话
                </button>
              </div>
            </>
          )}

          {notice && (
            <div className="voice-notice">
              <AlertCircle size={13} />
              <span>{notice}</span>
            </div>
          )}
        </div>
      )}

      {ballVisible && (
        <>
          {/* 随机短提示气泡 */}
          {hint && <div className="voice-hint-bubble" role="status">{hint}</div>}

          <button
            ref={ballRef}
            className={ballClass}
            title={phase === "active" ? "语音通话进行中（点击展开/收起，右键更多）" : busyElsewhere ? "其他窗口正在语音通话中（挂断后此处恢复）" : "语音通话（本机离线，右键更多）"}
            aria-label={phase === "active" ? "语音通话进行中" : "开始语音通话"}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onClick={onBallClick}
            onContextMenu={onBallContextMenu}
          >
            {/* 两圈脉冲环（错开动画，音量越大扩散越远） */}
            <span className="voice-ball-ring" aria-hidden />
            <span className="voice-ball-ring" aria-hidden />
            {/* 启动中也始终保留语音 logo：之前用 LoaderCircle 直接替换 logo，
                但 button 本身 color:transparent，导致点击后整颗球像"透明消失"。 */}
            <VoiceMascot
              mode={phase === "starting" ? "thinking" : phase === "active" ? (state as "listening" | "thinking" | "speaking") : "idle"}
              size={34}
            />
            {phase === "starting" && (
              <span className="voice-ball-loading" aria-label="语音正在启动">
                <LoaderCircle size={19} className="spin" />
              </span>
            )}
          </button>

          {/* 右键菜单：隐藏 / 跳转到语音设置 */}
          {menu && (
            <div
              className="voice-ball-menu"
              style={{ left: menu.x, top: menu.y }}
              role="menu"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => { setMenu(null); setCallScreen(true); }}
              >
                <Monitor size={13} />打开通话界面
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => { setMenu(null); setExpanded((open) => !open); }}
              >
                <AudioLines size={13} />{expanded ? "收起通话面板" : "打开通话面板"}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => { setMenu(null); requestVoiceOpenSettings(); }}
              >
                <Settings2 size={13} />语音设置
              </button>
              <button type="button" role="menuitem" onClick={hideBall}>
                <EyeOff size={13} />隐藏悬浮球
              </button>
            </div>
          )}
        </>
      )}
      </div>
    </>,
    document.body
  );
}
