/**
 * VoiceSettingsSectionWakeWord —— VoiceSettingsSection 的 JSX 第 9 段（09-22 从 VoiceSettingsSection.tsx 分出，纯搬迁）。
 * ⛔ props 类型由 TypeChecker 从**原作用域**推断（不是 any）⇒ 静态检查强度不降。
 */
import { Trash2, Upload, Headphones, Keyboard, Mic, Play, Radio, ShieldAlert, Sparkles, Square, Zap } from "lucide-react";
import { Settings } from "../VoiceSettingsSection";

type Props = {
  apply: (patch: Partial<import("../VoiceSettingsSection.tsx").Settings>) => void;
  commitWakePhrase: () => void;
  installKws: () => Promise<void>;
  kws: { ready: boolean; } | null;
  kwsDownload: { percent: number; message: string; } | null;
  saving: boolean;
  setWakePhraseDraft: React.Dispatch<React.SetStateAction<string>>;
  settings: Settings;
  wakePhraseDraft: string;
  wakeState: import("../../voice/wake-state.ts").WakeState;
};

export function VoiceSettingsSectionWakeWord({ apply, commitWakePhrase, installKws, kws, kwsDownload, saving, setWakePhraseDraft, settings, wakePhraseDraft, wakeState }: Props) {
  return (
    <div className="voice-card">
            <div className="voice-card-head"><Radio size={15} /><span>语音唤醒</span></div>
            <div className="voice-card-body">
              <label className="voice-toggle">
                <input
                  type="checkbox"
                  checked={settings.wake.enabled}
                  onChange={(e) => apply({ wake: { enabled: e.target.checked, phrase: wakePhraseDraft || settings.wake.phrase } })}
                  disabled={saving}
                />
                <span>持续聆听并等待唤醒词</span>
              </label>
              <input
                className="voice-input"
                value={wakePhraseDraft}
                placeholder="唤醒词，例如：小柯小柯"
                onChange={(e) => setWakePhraseDraft(e.target.value)}
                onBlur={commitWakePhrase}
                onKeyDown={(e) => { if (e.key === "Enter") commitWakePhrase(); }}
                disabled={saving}
              />
              <div className="voice-card-hint">
                说出唤醒词即可开始通话（识别文本归一化 + <strong>同音容错</strong>后再匹配：唤醒词只要求读音相同，
                所以「小柯小柯」能被「小科小科/小可小可」命中）。
                <strong>注意：开启后会持续占用 CPU</strong>——这里复用的是已有的识别模型，不是专门的低功耗唤醒模型；不用时建议关掉。
              </div>
              {/* 「为什么没唤醒」的唯一可用诊断：通用模型会把生僻字听成同音常用字，
                  只有把「最近听到什么」显示出来，用户才知道该换词还是该改匹配。 */}
              <div className="voice-card-hint" data-voice-wake-status>
                {wakeState.error
                  ? `唤醒未启动：${wakeState.error}`
                  : wakeState.listening
                    ? `正在聆听「${wakeState.phrase}」（${wakeState.engine === "kws" ? "关键词模型：只认读音、不误唤醒" : "识别模型匹配"}）${wakeState.device ? `｜麦克风：${wakeState.device}` : ""}${wakeState.heard ? `｜最近听到：${wakeState.heard}${wakeState.matched ? " ✅ 已命中" : ""}` : ""}`
                    : settings.wake.enabled
                      ? "已开启：通话中会暂停聆听，挂断后自动恢复"
                      : "唤醒未开启（打开上面的开关并保持应用运行即可）"}
              </div>
              {wakeState.hint && <div className="voice-card-hint">⚠️ {wakeState.hint}</div>}
              {/* 关键词模型（KWS）：装了才是「只认读音、不误唤醒、CPU 低」的那条路 */}
              {kws && !kws.ready && (
                <div className="voice-row">
                  <button className="secondary-setting" onClick={() => void installKws()} disabled={Boolean(kwsDownload)}>
                    {kwsDownload ? `下载中 ${kwsDownload.percent >= 0 ? kwsDownload.percent + "%" : "…"}` : "下载唤醒模型（约 31MB，推荐）"}
                  </button>
                  {/* 下载可取消（用户 09-13：「还没有取消下载功能」）：取消会**保留**已下载的部分，
                      再点「下载」从断点续传，不必从头再来 */}
                  {kwsDownload && (
                    <button className="secondary-setting" onClick={() => void window.codex.voiceKwsCancel()}>
                      取消下载
                    </button>
                  )}
                  <span className="voice-card-hint">不装也能用：会回退到识别模型匹配（更易误唤醒、更费 CPU）</span>
                </div>
              )}
              {kwsDownload && (
                <div className="voice-progress">
                  <div className="voice-progress-bar">
                    <span style={{ width: `${kwsDownload.percent >= 0 ? kwsDownload.percent : 5}%` }} />
                  </div>
                  <small>{kwsDownload.message}</small>
                </div>
              )}
            </div>
          </div>
  );
}
