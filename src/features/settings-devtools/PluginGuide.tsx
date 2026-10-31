/**
 * 插件 / 工具卡片里共用的「能做什么 + 怎么用 + 注意」说明块（10-31）。
 *
 * ⛔ 版式与「飞书 CLI」卡片完全一致（复用 feishu-cli-* 的样式）：用户点名
 *   「前面三个参考飞书 cli 界面更新一下排版和教程和功能介绍」——
 *   MoeKoe / Laya / 手机控制 之前只有一行状态，下面是整屏空白。
 * ⛔ 只说人话与真实入口；不写实现词，不承诺未验证的能力。
 */
import type { ComponentType } from "react";

export type PluginGuideCapability = { icon: ComponentType<{ size?: number | string }>; title: string; desc: string };

export function PluginGuide({ capabilities, steps, notes }: {
  capabilities: PluginGuideCapability[];
  steps: { b: string; s: string }[];
  notes: string[];
}) {
  return (
    <section className="feishu-cli-guide">
      <div className="feishu-cli-guide-head">
        <strong>能做什么</strong>
        <small>装好后可以在对话里直接让它干这些事，不用记命令</small>
      </div>
      <div className="feishu-cli-cap-grid">
        {capabilities.map(({ icon: Icon, title, desc }) => (
          <div className="feishu-cli-cap" key={title}>
            <span className="feishu-cli-cap-icon"><Icon size={15} /></span>
            <span className="feishu-cli-cap-copy"><strong>{title}</strong><small>{desc}</small></span>
          </div>
        ))}
      </div>

      <div className="feishu-cli-guide-head">
        <strong>怎么用</strong>
        <small>按顺序做完上面那一步即可，不懂的可以直接问 Codex</small>
      </div>
      <ol className="feishu-cli-guide-steps">
        {steps.map((step) => <li key={step.b}><b>{step.b}</b><span>{step.s}</span></li>)}
      </ol>

      <ul className="feishu-cli-notes">
        {notes.map((note) => <li key={note}>{note}</li>)}
      </ul>
    </section>
  );
}
