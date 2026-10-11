/**
 * 输入框底栏「动态状态灯」（10-12 立）：权限胶囊右侧那块空位 —— 后台有状态时亮一盏小图标。
 *
 * 状态源（全部是既有 bag 状态，不新开真相源）：
 *   · 目标模式（goalText/goalStatus）→ 🎯 Target；活动态呼吸、暂停变灰、受阻红、完成绿
 *   · 引擎等待用户选择（agentAsk）→ 🔔 Bell（上方选项卡在等，容易没看见）
 *   · 后台挂起消息（queue/queueTimers）→ Clock3 / 有定时项时 AlarmClock + 条数徽标
 *   · RPA 配方执行中（rpaRunning）→ Workflow
 *   · 子智能体运行中（subAgentRunning）→ Bot；专家团调度中（expertTeamRunning）→ Users
 *
 * 展示规则（用户定稿）：**最多亮一盏**；多盏并存时每 3 秒轮流展示（key 变化触发 fade-in，
 * 视觉上是"换灯"不是列表）。窗口变窄自适应：≤1280px 先收文字只留图标，≤1060px 整块隐藏
 * （给权限胶囊与右侧模型/发送控件让位）—— ⛔ 用窗口媒体查询，不在 .composer 上开
 * container-type：那会给后代绝对定位弹层造新包含块，quick-pop 的翻转定位会跟着歪。
 */
import { useEffect, useState } from "react";
import { AlarmClock, Bell, Bot, Clock3, Target, Users, Workflow } from "lucide-react";

type StatusLight = {
  key: string;
  icon: typeof Target;
  tone: "accent" | "pending" | "danger" | "ok" | "muted";
  label: string;
  title: string;
  badge?: string;
  pulse?: boolean;
};

export function ComposerStatusLights({ goalText, goalStatus, agentAskThreadId, queuedCount, scheduledCount, rpaRunning, subAgentRunning, expertTeamRunning }: {
  goalText: string;
  goalStatus: string | null;
  agentAskThreadId: string | null;
  queuedCount: number;
  scheduledCount: number;
  rpaRunning: string | null;
  subAgentRunning: string | null;
  expertTeamRunning: string | null;
}) {
  const lights: StatusLight[] = [];
  if (goalText && goalStatus) {
    const done = goalStatus === "complete";
    const blocked = goalStatus === "blocked";
    const paused = goalStatus === "paused";
    lights.push({
      key: "goal",
      icon: Target,
      tone: done ? "ok" : blocked ? "danger" : paused ? "muted" : "accent",
      label: "目标模式",
      title: `目标模式 · ${done ? "已完成" : paused ? "已暂停" : blocked ? "受阻" : "自动推进中"}（详情见输入框上方目标条）`,
      pulse: !done && !paused && !blocked,
    });
  }
  if (agentAskThreadId) {
    lights.push({ key: "ask", icon: Bell, tone: "pending", label: "等待选择", title: "引擎在等你做选择（见消息区的选项卡）", pulse: true });
  }
  if (queuedCount > 0) {
    lights.push({
      key: "queue",
      icon: scheduledCount > 0 ? AlarmClock : Clock3,
      tone: "pending",
      label: `${queuedCount} 条排队`,
      badge: String(queuedCount),
      title: scheduledCount > 0
        ? `后台挂起 ${queuedCount} 条消息（其中 ${scheduledCount} 条定时，到点自动发送）`
        : `后台挂起 ${queuedCount} 条消息，回合结束后自动发送`,
    });
  }
  if (rpaRunning) lights.push({ key: "rpa", icon: Workflow, tone: "accent", label: "配方执行中", title: `自动化配方执行中：${rpaRunning}`, pulse: true });
  if (subAgentRunning) lights.push({ key: "subagent", icon: Bot, tone: "accent", label: "子智能体", title: `子智能体运行中：${subAgentRunning}`, pulse: true });
  if (expertTeamRunning) lights.push({ key: "team", icon: Users, tone: "accent", label: "专家团", title: "专家团调度运行中（详情见专家团面板）", pulse: true });

  /* 轮流展示：只在 >1 盏时挂 3s 定时器；rot 只增不取模 —— 取模放在渲染处，
     状态集变化（某盏灭了）时序号不需要修正也不会越界。 */
  const [rot, setRot] = useState(0);
  useEffect(() => {
    if (lights.length < 2) return;
    const timer = window.setInterval(() => setRot((current) => current + 1), 3000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lights.length]);
  if (!lights.length) return null;
  const light = lights[rot % lights.length];
  const Icon = light.icon;
  return (
    <div className="composer-status-lights" role="status" aria-label="后台状态">
      <span key={`${light.key}:${rot}`} className={`composer-status-light tone-${light.tone}${light.pulse ? " pulse" : ""}`} title={light.title}>
        <Icon size={13} />
        {light.badge && <em>{light.badge}</em>}
        <i className="light-label">{light.label}</i>
      </span>
    </div>
  );
}
