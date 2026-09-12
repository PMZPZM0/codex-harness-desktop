/**
 * 语音萌宠：透明 3D 风的小狐狸（玻璃质感）。
 *
 * 之前一版是"圈+底色+里面一个3D"（圆形渐变背景里嵌一只蛋形角色），
 * 用户要的是**动物本身就是 3D 玻璃挂件**——身体半透明，背景透出，
 * 眼睛/嘴/腮红是实心的"灵魂"，加上内部高光、边缘亮线、落影做 3D 体积感。
 *
 * 三种状态：
 *  - idle 待机：耳朵 / 尾巴轻轻呼吸
 *  - listening 聆听：耳朵竖直 + 触须亮（耳朵是这种姿态）
 *  - speaking 播报：嘴巴张合 + 整体跟音量轻微脉动
 */
import type { VoiceWaveMode } from "../voice/wave-level";

type Props = {
  mode: VoiceWaveMode;
  /** 默认 42px（替换原 lucide 图标后保持同等大小） */
  size?: number;
};

export default function VoiceMascot({ mode, size = 42 }: Props) {
  return (
    <svg
      className={`voice-mascot voice-mascot-${mode}`}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
      <defs>
        {/* 身体：暖琥珀/橙色玻璃渐变（左上打高光，右下自然变深）+ 半透明 */}
        <radialGradient id="vm-body" cx="35%" cy="28%" r="75%">
          <stop offset="0%"  stopColor="#fff3d6" stopOpacity="0.95" />
          <stop offset="30%" stopColor="#ffb066" stopOpacity="0.78" />
          <stop offset="75%" stopColor="#e87a2b" stopOpacity="0.70" />
          <stop offset="100%" stopColor="#a8490d" stopOpacity="0.72" />
        </radialGradient>
        {/* 尾巴：稍深一点的暖红，呼应"狐狸" */}
        <radialGradient id="vm-tail" cx="35%" cy="35%" r="80%">
          <stop offset="0%"  stopColor="#ffdcb0" stopOpacity="0.85" />
          <stop offset="50%" stopColor="#ff9a4a" stopOpacity="0.72" />
          <stop offset="100%" stopColor="#c8521a" stopOpacity="0.75" />
        </radialGradient>
        {/* 耳朵内层（粉嫩 + 更半透明） */}
        <linearGradient id="vm-ear-in" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffc1a4" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#ff7a8c" stopOpacity="0.75" />
        </linearGradient>
        {/* 落影（半透明） */}
        <radialGradient id="vm-shadow" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#000" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        {/* 玻璃高光：白→透明的椭圆，叠在身体左上做"打光"感 */}
        <radialGradient id="vm-shine" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="80%"  stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 落影 */}
      <ellipse className="vm-shadow" cx="50" cy="90" rx="24" ry="4.5" fill="url(#vm-shadow)" />

      <g className="vm-hop">
        {/* 尾巴：蓬松大尾巴，从背后甩到右上（z 序在身体下） */}
        <path
          className="vm-tail"
          d="M28 64 Q12 50 18 30 Q24 16 38 18 Q44 22 42 36 Q40 50 32 58 Z"
          fill="url(#vm-tail)"
        />
        {/* 尾巴尖端白色（蓬松感） */}
        <ellipse cx="22" cy="24" rx="6" ry="5" fill="#fff5e6" opacity="0.85" />

        {/* 耳朵：两个尖三角（外层玻璃、内层粉嫩） */}
        <path d="M30 30 L40 8 L48 32 Z" fill="url(#vm-body)" />
        <path d="M33 28 L40 14 L44 30 Z" fill="url(#vm-ear-in)" />
        <path d="M70 30 L60 8 L52 32 Z" fill="url(#vm-body)" />
        <path d="M67 28 L60 14 L56 30 Z" fill="url(#vm-ear-in)" />

        {/* 身体/头：圆滚滚的玻璃球（橙红琥珀） */}
        <ellipse cx="50" cy="54" rx="30" ry="28" fill="url(#vm-body)" />
        {/* 边缘高光（玻璃质感的关键：上半部描一道亮线） */}
        <path
          d="M26 44 Q34 30 50 28"
          stroke="#fff5e0"
          strokeOpacity="0.6"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
        {/* 内部高光斑（白色椭圆，左上角打光） */}
        <ellipse cx="38" cy="36" rx="10" ry="6" fill="url(#vm-shine)" />

        {/* 眼睛（实体，玻璃里露出来的小灵魂） */}
        <g className="vm-eyes">
          <ellipse cx="41" cy="52" rx="5" ry="6.5" fill="#1d0f08" />
          <ellipse cx="59" cy="52" rx="5" ry="6.5" fill="#1d0f08" />
          {/* 眼内大高光（让眼睛"亮起来"） */}
          <circle cx="42.5" cy="49" r="2.2" fill="#ffffff" />
          <circle cx="60.5" cy="49" r="2.2" fill="#ffffff" />
          {/* 眼内小高光（次级反光） */}
          <circle cx="40" cy="55" r="1" fill="#ffffff" opacity="0.7" />
          <circle cx="58" cy="55" r="1" fill="#ffffff" opacity="0.7" />
        </g>

        {/* 鼻子：小三角（实心，玻璃里最"实"的部分） */}
        <path d="M47 64 L53 64 L50 69 Z" fill="#3a1a0a" />

        {/* 嘴：W 形小嘴（播报时张合） */}
        <g className="vm-mouth">
          <path d="M50 69 L50 72" stroke="#3a1a0a" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M45 73 Q47 71 50 73 Q53 71 55 73" stroke="#3a1a0a" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </g>

        {/* 腮红：极淡的粉（在玻璃下透出一点点） */}
        <ellipse cx="30" cy="60" rx="4.5" ry="2.5" fill="#ff7ea3" opacity="0.45" />
        <ellipse cx="70" cy="60" rx="4.5" ry="2.5" fill="#ff7ea3" opacity="0.45" />

        {/* 胡须（3D 玻璃体上几根发丝） */}
        <g stroke="#3a1a0a" strokeWidth="0.6" strokeLinecap="round" opacity="0.55">
          <line x1="33" y1="64" x2="22" y2="62" />
          <line x1="33" y1="66" x2="22" y2="67" />
          <line x1="67" y1="64" x2="78" y2="62" />
          <line x1="67" y1="66" x2="78" y2="67" />
        </g>
      </g>
    </svg>
  );
}
