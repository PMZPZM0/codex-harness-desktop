/**
 * 应用内实时通话界面（全屏遮罩，不是独立窗口）。
 *
 * 观感对标手机来电/微信语音通话页：深色底、居中大头像（跟着声音呼吸发光）、
 * 通话状态大字、实时字幕（你说 / 回复）、底部大号圆形操作按钮（打断 / 挂断）。
 *
 * 分工：本组件纯展示 + 按钮回调，音频链路（麦克风/AEC/TTS/打断门控）全部留在
 * VoiceCallFloat——这里只拿到已算好的状态与电平。收起（onMinimize）不挂断，
 * 通话继续在悬浮球上跑；挂断（onHangup）由 VoiceCallFloat 走完整 teardown。
 */

import { AlertCircle, AudioLines, LoaderCircle, Mic, Minimize2, Phone, PhoneOff } from "lucide-react";
import VoiceMascot from "./VoiceMascot";

type VoicePhase = "idle" | "starting" | "active";

type Props = {
  phase: VoicePhase;
  state: "listening" | "thinking" | "speaking" | string;
  level: number;
  userText: string;
  agentText: string;
  notice: string;
  modelsReady: boolean;
  onStart: () => void;
  onBarge: () => void;
  onHangup: () => void;
  onMinimize: () => void;
};

export default function VoiceCallScreen({
  phase,
  state,
  level,
  userText,
  agentText,
  notice,
  modelsReady,
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

  return (
    <div className="voice-call-screen" style={{ ["--voice-level" as any]: String(level) }} role="dialog" aria-label="实时通话界面">
      {/* 右上角收起：关界面不挂断 */}
      <button className="voice-call-min" title="收起（不挂断，通话继续）" onClick={onMinimize}>
        <Minimize2 size={16} />
      </button>

      {/* 居中：大头像 + 状态 + 提示 */}
      <div className="voice-call-center">
        <div className={`voice-call-avatar is-${phase === "active" ? state : "idle"}`}>
          <span className="voice-call-ring" aria-hidden />
          <span className="voice-call-ring" aria-hidden />
          <VoiceMascot
            mode={phase === "starting" ? "thinking" : phase === "active" ? (state as "listening" | "thinking" | "speaking") : "idle"}
            size={116}
          />
          {phase === "starting" && (
            <span className="voice-call-loading" aria-label="正在接通">
              <LoaderCircle size={30} className="spin" />
            </span>
          )}
        </div>
        <strong className="voice-call-state">{phase === "active" ? stateLabel : "语音通话"}</strong>
        <small className="voice-call-sub">
          {phase === "active"
            ? "本机离线识别 · 开口即可打断"
            : phase === "starting"
              ? "正在启动语音引擎…"
              : modelsReady
                ? "点下方按钮开始通话"
                : "语音模型未下载完整，可到语音设置里下载"}
        </small>
      </div>

      {/* 字幕区：通话中有内容才占位，避免空框 */}
      {phase === "active" && (
        <div className="voice-call-captions">
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
              <button className="voice-call-btn" onClick={onBarge} title="打断播报">
                <AudioLines size={22} />
              </button>
              <span>打断</span>
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
