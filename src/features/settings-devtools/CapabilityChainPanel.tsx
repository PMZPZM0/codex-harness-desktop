/**
 * 当前能力链路面板（10-10 从 DevtoolsSettingsSection 原样搬出，内容零改写）。
 *
 * 回答"现在实际走哪条" —— 原先这些规则散在技能文案与代码注释里，用户只能看到零散的安装状态，
 * 出问题无法判断走的是哪条。**判据的唯一来源**见 electron/capability-registry.ts
 * （⛔ 前端只渲染，不自己算）。
 *
 * ⛔ 搬出原因同 RuntimeToolsPanel：开发工具页改两级 IA，本面板内容改在二级弹窗里渲染。
 */
import { CircleCheck } from "lucide-react";

export type CapabilityChainPanelProps = { capabilityRows: any; capabilityError: any };

export function CapabilityChainPanel({ capabilityRows, capabilityError }: CapabilityChainPanelProps) {
  return (
    <div className="settings-section stack">
      <div className="devtools-capabilities" data-count={capabilityRows.length}>
        <div className="settings-subhead">
          <CircleCheck size={13} />当前能力链路
          <span className="settings-subhead-hint">同一件事多个后端时，现在实际走哪条</span>
        </div>
        {capabilityRows.length === 0
          ? <div className="settings-card-hint">{capabilityError || "读取中…（打开本页时自动刷新）"}</div>
          : capabilityRows.map((cap: any) => (
            <div className={`capability-row ${cap.activeId ? "" : "missing"}`} key={cap.id} data-capability={cap.id} data-active={cap.activeId ?? "none"}>
              <span className="capability-copy"><strong>{cap.label}</strong><small>{cap.purpose}</small></span>
              <span className="capability-active">{cap.activeId ? <CircleCheck size={14} /> : null}{cap.activeLabel}</span>
              <span className="capability-why">{cap.activeWhy}</span>
              {cap.alternatives.length > 0 && (
                <span className="capability-alt">备选：{cap.alternatives.map((alt: any) => `${alt.label}${alt.available ? "（就绪）" : "（未就绪）"}`).join("、")}</span>
              )}
              {cap.note ? <span className="capability-note">{cap.note}</span> : null}
            </div>
          ))}
      </div>
    </div>
  );
}
