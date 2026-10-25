/**
 * 语音悬浮球里的角色（10-25 用户：「gorkbot 那种样式」）。
 *
 * 视觉基线 = Grok Bot 图标：大圆脸、两颗**竖直胶囊形**眼睛（无瞳孔/眼白/高光/睫毛）、
 * 两颊椭圆腮红，**没有鼻子和嘴**；不同外观只换脸/眼/腮红配色与一个小配件。
 * 状态只动表情与轻微位移（眨眼 / 聆听睁眼 / 思考眯眼 / 播报腮红呼吸），不加第二个角色。
 *
 * ⛔ 颜色全部由 `.voice-bot--skin-*` 的 CSS 变量提供；组件不写死皮肤色。
 * ⛔ 眼型必须是「胶囊」而不是圆点（圆点会退回旧版 Siri 球，用户点名不要）。
 */
import { normalizeVoiceBallStyle } from "../lib/voice-ball-styles.mjs";
import type { VoiceWaveMode } from "../voice/wave-level";

type Props = {
  mode: VoiceWaveMode;
  size?: number;
  /** 外观 id（目录见 src/lib/voice-ball-styles.mjs） */
  skin?: string;
};

export default function VoiceMascot({ mode, size = 44, skin }: Props) {
  const style = normalizeVoiceBallStyle(skin);
  return (
    <span
      className={`voice-mascot voice-bot voice-bot--skin-${style} voice-mascot-${mode}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span className="voice-bot-eye voice-bot-eye--left" />
      <span className="voice-bot-eye voice-bot-eye--right" />
      <span className="voice-bot-blush voice-bot-blush--left" />
      <span className="voice-bot-blush voice-bot-blush--right" />
    </span>
  );
}
