/**
 * 应用内实时通话界面（全屏遮罩，不是独立窗口）。
 *
 * 观感对标手机来电/微信语音通话页：深色底、居中大头像（跟着声音呼吸发光）、
 * 通话状态大字、实时字幕（你说 / 回复）+ 可回看的历史、底部大号圆形操作按钮。
 *
 * 分工：本组件纯展示 + 按钮回调，音频链路（麦克风/AEC/TTS/打断门控）全部留在
 * VoiceCallFloat——这里只拿状态与回调。
 *
 * 性能（09-13 审视）：电平**不经过 props/state**——父组件的电平循环直接把
 * `--voice-level` 写到本组件根元素上（每帧合成器处理），本组件不因音量重渲染。
 * 09-13 新增：静音钮、通话时长、跳过本段、字幕回看。
 */

import { useEffect, useRef, useState } from "react";
import { AlertCircle, AudioLines, LoaderCircle, Mic, MicOff, Minimize2, Phone, PhoneOff, SkipForward } from "lucide-react";
import VoiceMascot from "./VoiceMascot";

type VoicePhase = "idle" | "starting" | "active";

type TranscriptEntry = { role: "user" | "agent"; text: string; at: number };

type Props = {
  phase: VoicePhase;
  state: "listening" | "thinking" | "speaking" | string;
  userText: string;
  agentText: string;
  notice: string;
  modelsReady: boolean;
  muted: boolean;
  startedAt: number | null;
  transcript: TranscriptEntry[];
  onToggleMute: () => void;
  onSkip: () => void;
  onStart: () => void;
  onBarge: () => void;
  onHangup: () => void;
  onMinimize: () => void;
};

/** 通话时长 mm:ss（每秒自查一次，只重渲这个小部件） */
function CallDuration({ startedAt }: { startedAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  if (!startedAt) return null;
  const total = Math.max(0, Math.floor((now - startedAt) / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return <span className="voice-call-duration">{mm}:{ss}</span>;
}

export default function VoiceCallScreen({
  phase,
  state,
  userText,
  agentText,
  notice,
  modelsReady,
  muted,
  startedAt,
  transcript,
  onToggleMute,
  onSkip,
  onStart,
  onBarge,
  onHangup,
  onMinimize,
}: Props) {
  const stateLabel =
    phase === "starting"
      ? "正在接通…"
      : state === "listening"
        ? "聆听中"
        : state === "thinking"
          ? "思考中"
          : "播报中";

  // 字幕历史自动滚到底（新内容始终可见）
  const historyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = historyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript.length, userText, agentText]);

  // 说话中才显示「跳过本段」（跳过当前排队的播报，后续内容接着说）
  const canSkip = phase === "active" && state === "speaking";

  return (
    <div className="voice-call-screen" role="dialog" aria-label="实时通话界面">
      {/* 右上角：收起（关界面不挂断）+ 时长 */}
      <div className="voice-call-top">
        {phase === "active" && <CallDuration startedAt={startedAt} />}
        <button className="voice-call-min" title="收起（不挂断，通话继续）" onClick={onMinimize}>
          <Minimize2 size={16} />
        </button>
      </div>

      {/* 居中：大头像 + 状态 + 提示 */}
      <div className="voice-call-center">
        <div className={`voice-call-avatar is-${phase === "active" ? state : "idle"} ${muted ? "is-muted" : ""}`}>
          <span className="voice-call-ring" aria-hidden />
          <span className="voice-call-ring" aria-hidden />
          <VoiceMascot
            mode={muted ? "idle" : phase === "starting" ? "thinking" : phase === "active" ? (state as "listening" | "thinking" | "speaking") : "idle"}
            size={116}
          />
          {phase === "starting" && (
            <span className="voice-call-loading" aria-label="正在接通">
              <LoaderCircle size={30} className="spin" />
            </span>
          )}
          {muted && phase === "active" && (
            <span className="voice-call-muted-badge" aria-label="已静音"><MicOff size={16} /></span>
          )}
        </div>
        <strong className="voice-call-state">
          {phase === "active" ? (muted ? "已静音" : stateLabel) : "语音通话"}
        </strong>
        <small className="voice-call-sub">
          {phase === "active"
            ? muted
              ? "麦克风已静音，点下方「取消静音」继续说话"
              : "本机离线识别 · 开口即可打断"
            : phase === "starting"
              ? "正在启动语音引擎…"
              : modelsReady
                ? "点下方按钮开始通话"
                : "语音模型未下载完整，可到语音设置里下载"}
        </small>
      </div>

      {/* 字幕区：历史可回看 + 当前行。通话中才占位，避免空框 */}
      {phase === "active" && (
        <div className="voice-call-captions">
          {transcript.length > 0 && (
            <div className="voice-call-history" ref={historyRef} data-voice-history>
              {transcript.map((entry) => (
                <div className={`voice-call-history-row is-${entry.role}`} key={entry.at + entry.text.slice(0, 8)}>
                  <span className="voice-call-caption-tag">{entry.role === "user" ? "你说" : "回复"}</span>
                  <p>{entry.text}</p>
                </div>
              ))}
            </div>
          )}
          <div className="voice-call-caption-row">
            <span className="voice-call-caption-tag">你说</span>
            <p>{userText || "…"}</p>
          </div>
          <div className="voice-call-caption-row agent">
            <span className="voice-call-caption-tag">回复</span>
            <p>{agentText || "…"}</p>
          </div>
        </div>
      )}

      {/* 底部操作区：手机通话式大圆钮 */}
      <div className="voice-call-actions">
        {phase === "active" ? (
          <>
            <div className="voice-call-action">
              <button
                className={`voice-call-btn is-quiet ${muted ? "is-active" : ""}`}
                onClick={onToggleMute}
                title={muted ? "取消静音" : "静音麦克风"}
              >
                {muted ? <MicOff size={22} /> : <Mic size={22} />}
              </button>
              <span>{muted ? "已静音" : "静音"}</span>
            </div>
            <div className="voice-call-action">
              <button className="voice-call-btn" onClick={onBarge} title="打断播报">
                <AudioLines size={22} />
              </button>
              <span>打断</span>
            </div>
            <div className="voice-call-action">
              <button className="voice-call-btn is-quiet" onClick={onSkip} disabled={!canSkip} title="跳过当前这段播报，继续后面的内容">
                <SkipForward size={20} />
              </button>
              <span>跳过本段</span>
            </div>
            <div className="voice-call-action">
              <button className="voice-call-btn is-hangup" onClick={onHangup} title="挂断">
                <PhoneOff size={26} />
              </button>
              <span>挂断</span>
            </div>
          </>
        ) : (
          <>
            <div className="voice-call-action">
              <button
                className="voice-call-btn is-start"
                onClick={onStart}
                disabled={phase === "starting"}
                title={phase === "starting" ? "正在接通…" : "开始通话"}
              >
                {phase === "starting" ? <LoaderCircle size={26} className="spin" /> : <Phone size={26} />}
              </button>
              <span>{phase === "starting" ? "接通中" : "开始通话"}</span>
            </div>
            <div className="voice-call-action">
              <button className="voice-call-btn is-quiet" onClick={onMinimize} title="收起界面">
                <Mic size={22} />
              </button>
              <span>用悬浮球</span>
            </div>
          </>
        )}
      </div>

      {notice && (
        <div className="voice-call-notice">
          <AlertCircle size={13} />
          <span>{notice}</span>
        </div>
      )}
    </div>
  );
}
