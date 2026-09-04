import { memo } from "react";
import { Check } from "lucide-react";

/**
 * 动态执行流程拓扑图（复刻 WorkBuddy 的流程可视化）。
 * 把 AI 的执行计划渲染成横向节点图：节点按状态点亮——
 *   待执行 pending   → 灰底细边框
 *   进行中 inProgress→ 主题蓝底 + 静态光圈（无动画）
 *   已完成 completed → 绿底 + 对勾
 * 节点之间用「连线 + 箭头」连接。
 *
 * 重要：inProgress 一律**不用 spin / 呼吸 / 流动动画**。
 * 引擎的 `turn/plan/updated` 只在计划创建或修订时发一次（实测 24h 内仅 2 次，
 * 18 万条日志里历史共 3 次），不会推 step 推进通知。给"进行中"加持续动画
 * 会让用户误以为系统还在实时推进，实际上状态可能已长时间未变——
 * 因此只用静态颜色/光圈区分状态，不暗示"正在工作"。
 */
export type FlowStepStatus = "pending" | "inProgress" | "completed";

export type FlowStep = {
  step: string;
  // 引擎推来的 plan.status 是宽泛 string，组件内部归一化为 FlowStepStatus（未知值按 pending）
  status: string;
};

export const FlowDiagram = memo(function FlowDiagram({ steps }: { steps: FlowStep[] }) {
  if (!steps.length) return null;
  return (
    <div className="flow-diagram" role="img" aria-label={`执行流程 ${steps.length} 步`}>
      {steps.map((entry, index) => {
        const status: FlowStepStatus =
          entry.status === "completed" || entry.status === "inProgress" ? entry.status : "pending";
        const isLast = index === steps.length - 1;
        return (
          <div className="flow-diagram-item" key={index}>
            <div className={`flow-node flow-node--${status}`}>
              <span className="flow-node-badge">
                {status === "completed" ? <Check size={13} /> : index + 1}
              </span>
              <span className="flow-node-label" title={entry.step}>{entry.step}</span>
            </div>
            {!isLast && (
              <span className={`flow-link flow-link--${status}`} aria-hidden>
                <i />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
});
