/** Codex 的默认头像（09-17 用户要求：「给设计一个好看一点的默认头像」）。
 *
 *  设计说明（改之前先读）：
 *  - **圆角方形**而非圆形：与侧栏徽标（应用图标，也是圆角方）成体系，且在消息列表里
 *    比圆形更容易和"用户头像（圆形）"区分开 —— 一眼知道哪条是它说的。
 *  - **靛蓝→紫的斜向渐变**：与增强按钮（#7048e8）、应用图标同色系但更收敛，暗色/亮色主题下都成立
 *    （底色自带，不依赖主题变量，避免在浅色主题里发灰）。
 *  - **四角星（spark）**：比字母更耐看、不绑定名字；也避免与用户取名后的首字母头像逻辑打架。
 *  - 右上角一点柔光：让纯色块看起来有体积，不至于像占位图。
 *
 *  用户上传自定义头像后这个组件不再使用（由 <img> 接管）。
 */
export function DefaultCodexAvatar({ size = 24 }: { size?: number }) {
  return (
    <svg
      className="codex-avatar-default"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="Codex 默认头像"
    >
      <defs>
        <linearGradient id="codex-avatar-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4f6bff" />
          <stop offset="55%" stopColor="#6a54e8" />
          <stop offset="100%" stopColor="#8b53d8" />
        </linearGradient>
        <radialGradient id="codex-avatar-glow" cx="0.78" cy="0.22" r="0.6">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.38" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="32" height="32" rx="9" fill="url(#codex-avatar-bg)" />
      <rect x="0" y="0" width="32" height="32" rx="9" fill="url(#codex-avatar-glow)" />
      {/* 四角星：细长十字 + 中心实心，比纯十字更有"闪光"感 */}
      <path
        d="M16 6.4c.5 3.6 1.4 5.4 2.6 6.6 1.2 1.2 3 2.1 6 2.9-3 .8-4.8 1.7-6 2.9-1.2 1.2-2.1 3-2.6 6.6-.5-3.6-1.4-5.4-2.6-6.6-1.2-1.2-3-2.1-6-2.9 3-.8 4.8-1.7 6-2.9 1.2-1.2 2.1-3 2.6-6.6z"
        fill="#ffffff"
        fillOpacity="0.95"
      />
      <circle cx="24.5" cy="8.5" r="1.35" fill="#ffffff" fillOpacity="0.85" />
    </svg>
  );
}
