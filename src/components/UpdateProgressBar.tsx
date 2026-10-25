/**
 * 更新进度条（10-25 用户令：「检查更新和下载进度都加一下进度条展示，默认隐藏，鼠标放上去显示进度」）
 *
 * ⛔ 只在**进行中**渲染（`active=false` 直接不占 DOM）：空闲时 hover 出一条 0% 的空槽是噪声。
 * ⛔ 默认透明 —— 由宿主按钮的 `:hover` / `:focus-visible` 规则显形（见 17-visual-cards.css）；
 *    进度条自己**不**接管指针事件，避免挡住按钮点击。
 * · 检查更新没有百分比事件 ⇒ `indeterminate` 跑循环滑块；
 * · 下载有真实 `updates:download-progress`（0..1）⇒ 按比例填充。
 */
export function UpdateProgressBar({ active, progress = 0, indeterminate = false }: {
  active: boolean;
  /** 0..1（主进程推的就是这个量纲） */
  progress?: number;
  indeterminate?: boolean;
}) {
  if (!active) return null;
  const pct = Math.max(0, Math.min(1, Number(progress) || 0)) * 100;
  return (
    <span className={`update-progress-bar${indeterminate ? " indeterminate" : ""}`} aria-hidden="true">
      <span className="update-progress-fill" style={indeterminate ? undefined : { width: `${pct}%` }} />
    </span>
  );
}
