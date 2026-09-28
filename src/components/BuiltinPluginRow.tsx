/**
 * 内置插件「紧凑行」（09-28 三卡统一，用户要求）。
 *
 * ⛔ 为什么改（用户原话）：「为啥这三个卡片要占这么多，不会做出二级弹窗吗」。
 *   上一版把三个字段直接摊在卡片上（怕用户找不到填写处），结果三张卡加起来占掉大半个
 *   设置页，滚半天看不到下面的插件市场。现在：**卡片只留一行摘要 + 一个「配置」入口**，
 *   真正的字段全部收进二级弹窗（点「配置」才展开）。
 *
 * 行的语义固定为四段：图标 → 标题/一句话 → 状态胶囊 → 动作按钮。
 * 三张内置卡（生图 / 视觉辅助 / 视频生成接口）都渲染它，改版式只改这一个文件。
 */
import type { LucideIcon } from "lucide-react";

export function BuiltinPluginRow({
  icon: Icon,
  title,
  desc,
  state,
  tone = "none",
  actionLabel,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  /** 一句话说明（单行省略：行高固定，不让长文案把卡片撑高） */
  desc: string;
  /** 状态文案：未配置 / 已启用 / 已停用 / 2 / 8 已配置 */
  state: string;
  tone?: "ready" | "off" | "none";
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <article className={`bi-row is-${tone}`}>
      <span className="bi-row-icon"><Icon size={16} /></span>
      <div className="bi-row-text">
        <b>{title}</b>
        <small title={desc}>{desc}</small>
      </div>
      <span className="bi-row-state">{state}</span>
      <button className="secondary-setting" onClick={onAction}>{actionLabel}</button>
    </article>
  );
}
