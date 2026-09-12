/**
 * 语音小小英雄（类似云顶之弈「小小英雄」的 Q 版 3D 萌宠）。
 *
 * 为什么用 SVG 而不是 three.js / 模型文件：
 *   悬浮球只有 52px，真正的 3D 引擎要额外引 three + 模型资源，既拖包体又没必要；
 *   SVG 的 radialGradient（高光/暗部）+ 内阴影 + 边缘光 + 落影已经足够做出"体积感"，
 *   再配合 CSS 的呼吸/跳动动画，观感上就是一只会动的小小英雄。
 *
 * 三种状态：idle 待机（轻呼吸）/ listening 聆听（耳朵竖直、眼睛睁大）/ speaking 播报（跳动 + 张嘴）
 */
import type { VoiceWaveMode } from "../voice/wave-level";

type Props = {
  mode: VoiceWaveMode;
  /** 0..1，音量越大跳得越明显（由外部每帧写入 CSS 变量 --voice-level 一起驱动缩放） */
  size?: number;
};

export default function VoiceMascot({ mode, size = 34 }: Props) {
  return (
    <svg
      className={`voice-mascot voice-mascot-${mode}`}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
      <defs>
        {/* 身体主渐变：左上打光 → 右下暗部，做出球体体积 */}
        <radialGradient id="vm-body" cx="34%" cy="28%" r="78%">
          <stop offset="0%" stopColor="#8ab4ff" />
          <stop offset="42%" stopColor="#4f7cf7" />
          <stop offset="100%" stopColor="#2c3fd6" />
        </radialGradient>
        {/* 肚子：更浅的球面 */}
        <radialGradient id="vm-belly" cx="50%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#dbe7ff" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#a9c2ff" stopOpacity="0.75" />
        </radialGradient>
        {/* 触角光球 */}
        <radialGradient id="vm-orb" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#fff6b0" />
          <stop offset="55%" stopColor="#ffc93c" />
          <stop offset="100%" stopColor="#f0932b" />
        </radialGradient>
        {/* 落影 */}
        <radialGradient id="vm-shadow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#000" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 落影（随音量轻微放大） */}
      <ellipse className="vm-shadow" cx="50" cy="88" rx="24" ry="5" fill="url(#vm-shadow)" />

      <g className="vm-hop">
        {/* 耳朵 */}
        <ellipse className="vm-ear vm-ear-l" cx="34" cy="26" rx="9" ry="13" fill="#3b5fd9" />
        <ellipse className="vm-ear vm-ear-r" cx="66" cy="26" rx="9" ry="13" fill="#3b5fd9" />
        <ellipse cx="34" cy="27" rx="4.5" ry="7" fill="#7ea0ff" opacity="0.75" />
        <ellipse cx="66" cy="27" rx="4.5" ry="7" fill="#7ea0ff" opacity="0.75" />

        {/* 触角 */}
        <path d="M50 16 Q52 8 58 6" stroke="#2c3fd6" strokeWidth="3" fill="none" strokeLinecap="round" />
        <circle className="vm-orb" cx="60" cy="6" r="6" fill="url(#vm-orb)" />

        {/* 身体（蛋形） */}
        <ellipse cx="50" cy="56" rx="30" ry="30" fill="url(#vm-body)" />
        {/* 边缘光（右下） */}
        <ellipse cx="50" cy="56" rx="29" ry="29" fill="none" stroke="#9fc0ff" strokeOpacity="0.35" strokeWidth="2" />
        {/* 肚子 */}
        <ellipse cx="50" cy="62" rx="19" ry="17" fill="url(#vm-belly)" />

        {/* 眼睛（大大 + 高光） */}
        <g className="vm-eyes">
          <ellipse cx="41" cy="50" rx="6.5" ry="8" fill="#141a3a" />
          <ellipse cx="59" cy="50" rx="6.5" ry="8" fill="#141a3a" />
          <circle cx="43" cy="46" r="2.4" fill="#fff" opacity="0.95" />
          <circle cx="61" cy="46" r="2.4" fill="#fff" opacity="0.95" />
          <circle cx="39" cy="54" r="1.2" fill="#fff" opacity="0.6" />
          <circle cx="57" cy="54" r="1.2" fill="#fff" opacity="0.6" />
        </g>

        {/* 腮红 */}
        <ellipse cx="32" cy="60" rx="4.5" ry="3" fill="#ff7eb6" opacity="0.55" />
        <ellipse cx="68" cy="60" rx="4.5" ry="3" fill="#ff7eb6" opacity="0.55" />

        {/* 嘴（播报时张合） */}
        <path className="vm-mouth" d="M45 66 Q50 71 55 66" stroke="#141a3a" strokeWidth="2.5" fill="none" strokeLinecap="round" />

        {/* 小脚 */}
        <ellipse cx="41" cy="82" rx="7" ry="4.5" fill="#2c3fd6" />
        <ellipse cx="59" cy="82" rx="7" ry="4.5" fill="#2c3fd6" />
      </g>
    </svg>
  );
}
