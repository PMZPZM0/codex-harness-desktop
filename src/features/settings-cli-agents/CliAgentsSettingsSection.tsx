/**
 * 设置页 · CLI 智能体（10-31 用户令：「把 cli 智能体入口放到设置-专家/专家团里面」）。
 *
 * 它属于「智能体」而不是「开发工具」—— 和专家 / 专家团 / 子智能体一样是可被 @ 派活的调度对象。
 * 二级入口页：返回条回到「专家/专家团」入口页；内容 = CliAgentsPanel（工作证小卡 + 预览）。
 * ⛔ 页面只做外壳（返回 + 标题对齐同族页），管理逻辑全在 CliAgentsPanel（单一实现）。
 */
import { ArrowLeft } from "lucide-react";
import { CliAgentsPanel } from "../cli-agents";

export type CliAgentsSettingsSectionProps = {
  setNotice?: (text: string, detail?: string) => void;
  onBack?: () => void;
};

export function CliAgentsSettingsSection({ setNotice, onBack }: CliAgentsSettingsSectionProps) {
  return (
    <section className="settings-section stack cli-agents-page">
      <div className="settings-toolbar-row">
        {onBack && <button type="button" className="settings-back-row" onClick={onBack}><ArrowLeft size={14} />返回专家/专家团</button>}
      </div>
      <CliAgentsPanel setNotice={setNotice} />
    </section>
  );
}
