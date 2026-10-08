/**
 * VoiceCallFloat —— **视图层**（09-22：状态与逻辑已提成 useVoiceCallFloatState，本文件只剩 JSX）。
 * ⛔ 解构名与 hook 返回键同名 ⇒ JSX 与搬迁前逐字一致。
 */
import { createPortal } from "react-dom";
import { AlertCircle, AudioLines, Download, EyeOff, LoaderCircle, Mic, PhoneOff, Settings2, X } from "lucide-react";
import VoiceMascot from "./VoiceMascot";
import { patchVoiceStage, requestVoiceDictationSend, requestVoiceOpenSettings, resetVoiceStage, setVoiceDictationHandler, setVoiceLevel, setVoiceStopHandler } from "../voice/wave-level";
import { useVoiceCallFloatState } from "./VoiceCallFloat/use-voice-call-float-state";

export type VoicePhase = "idle" | "starting" | "active";
export type VoiceState = "listening" | "thinking" | "speaking";
export type ModelsStatus = { ready: boolean; missing: string[]; readyFiles: number; totalFiles: number; bytes: number; /** 10-03：基础模型是否被用户停用（false = 停用；缺省 true 兼容老主进程） */ baseEnabled?: boolean };
export const POS_KEY = "voice-float-pos";
const DEFAULT_POS = { right: 22, bottom: 104 };
export const CAPTURE_RATE = 16000;
/** 两次自动打断之间的冷却。⛔ 10-03 由 1200 抬到 2500：原来 1.2s 就允许再打断一次，
 *  表现为「Codex 刚要开口又被自己噎住」—— 一句话里能触发好几次。 */
export const BARGUE_COOLDOWN_MS = 2500;
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
  /** 10-03：被**停用**（不是没下载）。文案必须指向"启用"而不是"下载" ——
   *  否则用户会去重下 270MB，而正确动作只是点一下「启用」。 */
  modelsDisabled: [
    "模型已停用",
    "去设置里启用",
    "启用后才能通话",
  ],
};
/** 按当前 phase/state/模型状态挑一个最合适的池子随机抽 */
export function pickHint(phase: VoicePhase, state: VoiceState, modelsReady: boolean, modelsDisabled = false): string {
  let pool: string[];
  if (!modelsReady && modelsDisabled && phase !== "active") {
    pool = HINT_POOLS.modelsDisabled;
  } else if (!modelsReady && phase !== "active") {
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
  const { phase, setPhase, state, setState, expanded, setExpanded, levelRef, screenElRef, applyLevel, muted, setMuted, mutedRef, toggleMute, transcript, setTranscript, callStartedAt, setCallStartedAt, userText, setUserText, agentText, setAgentText, ballVisible, setBallVisible, hintsEnabled, setHintsEnabled, hint, setHint, menu, setMenu, agentTextRef, ballRef, notice, setNotice, endpointSec, setEndpointSec, models, setModels, download, setDownload, pos, setPos, mediaStreamRef, captureCtxRef, workletRef, playCtxRef, playQueueRef, playingCountRef, aecRef, bargeModeRef, micSettingsRef, volumeRef, gateRef, chunkerRef, speakFilterRef, prebufferRef, liveRef, refRingRef, refWriteRef, refReadRef, refDropsRef, endpointArmedRef, quietSinceRef, lastBargeAtRef, speakingRef, phaseRef, voiceModeRef, dragRef, refreshModels, busyElsewhere, setBusyElsewhere, onBallContextMenu, hideBall, pushRef, enqueuePlay, speechEpochRef, bumpSpeechEpoch, stopPlayback, skipCurrent, speakDelta, flushSpeech, startCapture, teardown, startCall, endCall, startCallRef, callToggleRef, pushTranscript, wakeCfg, setWakeCfg, installModels, draggedRef, onPointerDown, onPointerMove, onPointerUp, onBallClick, stateLabel, modelsReady, ballClass } = useVoiceCallFloatState({ threadId });
  return createPortal(
    <>
      {/* ⛔ 10-08 用户要求「不要做两个实时语音弹窗，展示一个就行了」：通话语义只保留**输入框上方的舞台条**。
          这里原先有两块重复面 —— ① 接通即自动弹出的全屏通话界面（`VoiceCallScreen` / `.voice-call-screen`）
          ② 右下角通话面板（`.voice-panel` 的 `phase === "active"` 分支）。
          ① 连状态一起删掉了（组件文件也已删除）；② 改为**只在待机时**出现（它还要承担
          「开始通话 / 下载语音模型」的入口，不能整块删）。通话中唯一的面 = 舞台条。 */}
      <div className="voice-float-layer" style={{ right: pos.right, bottom: pos.bottom }}>
      {expanded && phase !== "active" && (
        <div className="voice-panel" role="dialog" aria-label="语音通话">
          <header className="voice-panel-head">
            <span className="voice-dot is-idle" />
            <strong>语音通话</strong>
            <button className="voice-icon-btn" title="收起" onClick={() => setExpanded(false)}>
              <X size={14} />
            </button>
          </header>

          {/* ⛔ 10-08：这里原先是 `phase === "active" ? (通话态) : (待机态)` 的三元。
              通话态整块删除（面板只在待机时渲染；留着的分支连 tsc 都会以 TS2367 挡下）。
              待机入口（开始通话 / 下载语音模型）必须留着，所以只留待机这一支。 */}
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
              {/* ⛔ 10-08：全屏通话界面已删 ⇒「打开通话界面」整项移除；「打开通话面板」只在**待机**时给
                  （面板的通话态已按用户要求撤掉，通话中点了会毫无反应 —— 不让用户点到空动作）。 */}
              {phase !== "active" && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setMenu(null); setExpanded((open) => !open); }}
                >
                  <AudioLines size={13} />{expanded ? "收起语音面板" : "打开语音面板"}
                </button>
              )}
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
