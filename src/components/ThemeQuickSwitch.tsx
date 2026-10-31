/**
 * 明暗切换控件（10-31 用户：「主题色切换，白天黑夜的图标优化一下，现在太 low 了」）。
 *
 * 形态：**滑轨胶囊**（track + 会滑动的 thumb + 两枚自绘图标），
 * 而不是原来那两个各自变色的方块按钮 —— 后者的问题不是配色，是**没有"这个开关在哪一档"的几何线索**：
 * 两个按钮只换底色，用户要靠读图标判断当前态。
 *
 * 动画（都在 CSS，`17-visual-cards.css` 的 `.theme-quick` 段）：
 *   · thumb 沿轨道平移，`cubic-bezier(.34, 1.4, .64, 1)` 带一点过冲 —— 有"咔哒"感；
 *   · 太阳的八道光线旋转 45° 并轻微放大（激活时），月亮旁那颗星放大点亮；
 *   · 图标不做位移动画（避免与 thumb 抢视觉焦点）。
 *
 * ⛔ 两个按钮各自**独立回调**（`onLight` / `onDark`）而不是 `onChange(id)`：
 *   调用方要把每一次切换都送进 `runVisualSwitch`（唯一入口，守卫【11w】钉着"浅色/深色都走它"）。
 * ⛔ 无障碍：用 `aria-pressed` 表达当前态，容器 `role="group"` 带中文名；键盘 Tab 可依次到达。
 */
type Props = {
  theme: string;
  onLight: () => void;
  onDark: () => void;
};

/** 自绘太阳：圆 + 八道光线（光线组单独成 `.tq-rays` 以便激活时旋转）。 */
function SunGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="4.1" />
      <g className="tq-rays">
        <line x1="12" y1="2.4" x2="12" y2="5.2" />
        <line x1="12" y1="18.8" x2="12" y2="21.6" />
        <line x1="2.4" y1="12" x2="5.2" y2="12" />
        <line x1="18.8" y1="12" x2="21.6" y2="12" />
        <line x1="5.2" y1="5.2" x2="7.2" y2="7.2" />
        <line x1="16.8" y1="16.8" x2="18.8" y2="18.8" />
        <line x1="5.2" y1="18.8" x2="7.2" y2="16.8" />
        <line x1="16.8" y1="7.2" x2="18.8" y2="5.2" />
      </g>
    </svg>
  );
}

/** 自绘月亮：月牙 + 一颗星（星在激活时点亮放大）。 */
function MoonGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M20.2 14.6A8.7 8.7 0 1 1 9.4 3.8a6.9 6.9 0 0 0 10.8 10.8Z" />
      <circle className="tq-star" cx="17.6" cy="6.4" r="1" />
    </svg>
  );
}

export function ThemeQuickSwitch({ theme, onLight, onDark }: Props) {
  const dark = theme === "dark";
  return (
    <span className={`theme-quick${dark ? " is-dark" : ""}`} role="group" aria-label="界面主题">
      <span className="theme-quick-thumb" aria-hidden="true" />
      <button type="button" className="theme-quick-btn" aria-pressed={!dark} title="浅色" aria-label="切换到浅色主题" onClick={onLight}>
        <SunGlyph />
      </button>
      <button type="button" className="theme-quick-btn" aria-pressed={dark} title="深色" aria-label="切换到深色主题" onClick={onDark}>
        <MoonGlyph />
      </button>
    </span>
  );
}
