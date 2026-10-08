/**
 * VoiceSettingsSectionAnnounce —— 设置页「语音播报」卡片（10-08 新增）。
 *
 * 用户需求：「新增两个播报功能：一是运行过程中的正文实时播报，二是运行结束后对最终消息进行汇总播报」
 * + 「在设置界面中为这两个播报功能分别添加对应的开关选项」。
 *
 * ⛔ 两个开关**正交**，都在 `settings.announce`（主进程 voice-settings.json）：
 *   · live    —— 正文流式生成时逐句念（就是通话原有的行为，默认开）；
 *   · summary —— 回合结束时念一段**本地压缩**出来的要点（默认关，见 src/lib/voice-summary.mjs）。
 * ⛔ 语速**不在这里另开一份**：与通话共用 `tts.speed`（单一真相源）—— 两个语速迟早对不上。
 */
import { Volume2 } from "lucide-react";
import { Settings } from "../VoiceSettingsSection";

type Props = {
  apply: (patch: Partial<Settings>) => void;
  saving: boolean;
  settings: Settings;
};

export function VoiceSettingsSectionAnnounce({ apply, saving, settings }: Props) {
  /* ⛔ 兜底（与 VoiceDevToolsSection 的 `enabled !== false` 同一约定）：设置是**显式字段映射**
     过的对象，老主进程（未重启 / 渲染层被单独 reload）回包可能没有 `announce` ——
     直接读 `settings.announce.live` 会让整个语音设置页白屏。缺省 = 「保持通话既有行为」。 */
  const announce = settings.announce ?? { live: true, summary: false };
  return (
    <div className="voice-card" data-voice-announce="1">
      <div className="voice-card-head"><Volume2 size={15} /><span>语音播报</span></div>
      <div className="voice-card-body">
        <div className="voice-toggles">
          <label className="voice-toggle">
            <input
              type="checkbox"
              checked={announce.live}
              onChange={(e) => apply({ announce: { live: e.target.checked, summary: announce.summary } })}
              disabled={saving}
            />
            <span>运行过程中的正文实时播报</span>
          </label>
          <label className="voice-toggle">
            <input
              type="checkbox"
              checked={announce.summary}
              onChange={(e) => apply({ announce: { live: announce.live, summary: e.target.checked } })}
              disabled={saving}
            />
            <span>运行结束后汇总播报</span>
          </label>
        </div>
        <div className="voice-card-hint">
          「实时播报」= 正文一边生成一边<strong>逐句</strong>念出来；「汇总播报」= 这一轮跑完后，
          再念一段<strong>本机压缩</strong>出来的要点（取结论句，剩下的只报「另有 N 句」——
          不额外调用模型，不联网）。两个可以同时开，也可以都关（通话只做输入、不念回复）。
          <br />
          通话中与非通话时都生效；<strong>非通话时只听不说话</strong>（不开麦克风）。
          语速见下方「语速」卡片（播报与通话共用同一档）。
        </div>
      </div>
    </div>
  );
}
