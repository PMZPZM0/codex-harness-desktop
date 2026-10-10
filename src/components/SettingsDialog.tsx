/**
 * SettingsDialog —— 设置页内的**二级弹窗**（10-10 开发工具页两级信息架构的载体）。
 *
 * ⛔⛔ 为什么必须是弹窗、不许页内展开 / 内嵌：开发工具页原来把全部板块（能力链路 / 运行时列表 /
 *   检查工具 / 工具清单 / 手机控制 / Laya / 功能域 / 声明式插件）平铺在一个长滚动页里 ——
 *   层级混乱、各板块展示方式不统一、可读性差（用户 10-10 反馈原话）。
 *   两级 IA 的契约 = **一级只渲染分类卡片，内容只在弹窗里出现**（守卫【dtIA】钉死：
 *   内容组件不得出现在一级渲染分支里）。
 *
 * ── 交互与视觉规范（与设置内既有弹窗同款，样板见 memory-center-modal）────────────
 *   · 遮罩 z-index = 900（设置内弹窗档：<800 给页面内浮层，1000 给 AppSelect 这类最顶层）
 *   · Esc 关闭 + 点遮罩空白关闭；⛔ 点内容区不关（避免误触丢操作态：安装进度/二次确认都在弹窗里）
 *   · 结构固定为「标题栏（图标 + 标题 + 副标题 + 关闭）+ 独立滚动的 body」
 *   · 宽度按 `size` 分级（md 720 / lg 1080）—— ⛔ 不要让调用方各自写宽度内联样式
 *   · 颜色一律走主题变量（--line/--bg/--dim/--green…），皮肤切换自动跟随
 *   · ⛔ 不锁 body 滚动：设置面板自己就是滚动容器，锁了会跳位
 */
import { useEffect } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export type SettingsDialogProps = {
  title: string;
  /** 标题栏左侧图标（与一级卡片同一枚，保证"点哪张卡就进哪一页"的视觉连续性） */
  icon?: ReactNode;
  hint?: string;
  size?: "md" | "lg";
  onClose: () => void;
  children: ReactNode;
};

export function SettingsDialog({ title, icon, hint, size = "md", onClose, children }: SettingsDialogProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    /* ⛔ 只在**点遮罩本身**时关（e.target === currentTarget）：冒泡上来的内容区点击不关。 */
    <div className="settings-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="settings-dialog" data-size={size} role="dialog" aria-modal="true" aria-label={title}>
        <div className="settings-dialog-head">
          {icon ? <span className="settings-dialog-logo">{icon}</span> : null}
          <span className="settings-dialog-heading">
            <strong>{title}</strong>
            {hint ? <small>{hint}</small> : null}
          </span>
          <button type="button" className="settings-dialog-close" onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </div>
        <div className="settings-dialog-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
