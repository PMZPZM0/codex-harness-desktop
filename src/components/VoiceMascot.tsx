/**
 * 语音小助手 logo：现代语音助手风格的多色透明 3D 球。
 *
 * 设计参考：Siri / Google Assistant / Spotify 的 logo 共性——
 *  ① **抽象**（不拟人、不拟动物）
 *  ② **多色流动渐变**（不是纯色）
 *  ③ **玻璃感**（半透明 + 内部高光 + 边缘暗影 → 3D 体积）
 *  ④ **简洁的"灵魂点"**（两颗发光小点，给它个性但不拟人）
 *  ⑤ **状态变色**（idle 冷紫 / listening 冷静青绿 / speaking 暖橙）
 *  ⑥ **透明 3D 球** + 两圈脉冲环（音量越大扩散越远）
 *
 * 不再是 SVG 画一只动物——直接 div + CSS 渐变做圆球，更"现代 logo"。
 */
import type { VoiceWaveMode } from "../voice/wave-level";

type Props = {
  mode: VoiceWaveMode;
  size?: number;
};

export default function VoiceMascot({ mode, size = 44 }: Props) {
  return (
    <span
      className={`voice-mascot voice-mascot-orb voice-mascot-${mode}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span className="orb-eyes">
        <span className="orb-eye orb-eye-l" />
        <span className="orb-eye orb-eye-r" />
      </span>
    </span>
  );
}
