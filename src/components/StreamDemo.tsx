import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  FileCode2,
  FileText,
  Loader2,
  PenLine,
  Terminal,
  User,
} from "lucide-react";

/**
 * 完整「流式状态机」模拟演示 —— 纯展示用假数据，不涉及真实会话。
 * 脚本时间线推进 phase：用户提问 → 智能体活动 → 计划步骤逐个推进 →
 * 一串工具调用卡（bash / read_file / edit_file / bash）依次运行→完成 →
 * 正文流式打字 → 汇报要点逐条浮现 → 结论 → 文件卡。
 * 播完停在结尾（不循环）；内容增长由外部容器做自动跟随滚动。
 */
const SCRIPT = [600, 1200, 2000, 2800, 3600, 4400, 5200, 6000, 6800, 7600, 8600, 9600, 10800, 12000, 13200];
// 四个计划步骤的「激活 / 完成」phase 阈值
const STEP_ACTIVE = [2, 4, 6, 10];
const STEP_DONE = [3, 5, 7, 11];
const STEP_LABELS = ["分析结构", "检查文档", "编写说明", "验证构建"];
// 正文流式打字内容
const MARKDOWN = "已核对项目结构与现有文档：README 缺少安装说明。已补充「快速开始」章节，涵盖环境要求、依赖安装与启动命令，并验证构建通过。";

function ToolCard(props: {
  phase: number;
  at: number;
  doneAt: number;
  icon: React.ReactNode;
  name: string;
  args: string;
  out?: string;
  children?: React.ReactNode;
}) {
  const { phase, at, doneAt, icon, name, args, out, children } = props;
  if (phase < at) return null;
  const done = phase >= doneAt;
  return (
    <div className={`sd-tool${done ? " done" : ""}`}>
      <div className="sd-tool-head">
        {icon}
        <code>{name}</code>
        <span className="sd-tool-args">{args}</span>
        {done ? <Check size={11} /> : <Loader2 size={11} className="sd-spin" />}
      </div>
      {done && out !== undefined && <pre className="sd-tool-out">{out}</pre>}
      {children}
    </div>
  );
}

export function StreamDemo() {
  const [phase, setPhase] = useState(0);
  const [typed, setTyped] = useState(0);

  // 一次性脚本：推进 phase 到 15 后停下（不循环）
  useEffect(() => {
    const timers = SCRIPT.map((at, index) =>
      window.setTimeout(() => setPhase(index + 1), at),
    );
    return () => { timers.forEach((timer) => window.clearTimeout(timer)); };
  }, []);

  // 流式打字：phase>=12 起逐字追加
  useEffect(() => {
    if (phase < 12) { setTyped(0); return; }
    setTyped(0);
    const iv = window.setInterval(() => {
      setTyped((current) => {
        if (current >= MARKDOWN.length) { window.clearInterval(iv); return current; }
        return Math.min(current + 2, MARKDOWN.length);
      });
    }, 22);
    return () => window.clearInterval(iv);
  }, [phase]);

  const bullets = Math.min(Math.max(phase - 13, 0), 4);
  const stepState = (index: number) => (phase >= STEP_DONE[index] ? 2 : phase >= STEP_ACTIVE[index] ? 1 : 0);

  return (
    <div className="sd-demo" aria-hidden="true">
      <div className="sd-stage">
        {phase >= 1 && (
          <div className="sd-user">
            <User size={12} />
            <span>帮我完善 README，补一份安装说明</span>
          </div>
        )}

        {phase >= 2 && (
          <div className="sd-agent">
            <div className="sd-activity">
              <Bot size={13} className={phase < 11 ? "sd-spin" : ""} />
              <span>{phase < 11 ? "正在处理你的请求…" : "全部步骤已完成"}</span>
            </div>

            {/* 计划步骤（FlowDiagram 风格 pill） */}
            <div className="sd-steps">
              {STEP_LABELS.map((label, index) => (
                <span className={`sd-step s${stepState(index)}`} key={label}>
                  {stepState(index) === 2 ? <Check size={11} /> : <span className="sd-step-dot" />}
                  {label}
                </span>
              ))}
            </div>

            {/* 工具调用卡 1：bash 列表 */}
            <ToolCard phase={phase} at={4} doneAt={5} icon={<Terminal size={12} />} name="bash" args="ls -1" out={"package.json\nsrc/\nREADME.md"} />

            {/* 工具调用卡 2：读取文件 */}
            <ToolCard phase={phase} at={6} doneAt={7} icon={<FileText size={12} />} name="read_file" args="README.md" out={"# Demo\n\n一个示例项目。"} />

            {/* 工具调用卡 3：编辑文件（内嵌 diff） */}
            {phase >= 8 && (
              <div className={`sd-tool${phase >= 9 ? " done" : ""}`}>
                <div className="sd-tool-head">
                  <PenLine size={12} />
                  <code>edit_file</code>
                  <span className="sd-tool-args">README.md</span>
                  {phase >= 9 ? <Check size={11} /> : <Loader2 size={11} className="sd-spin" />}
                </div>
                {phase >= 9 && (
                  <div className="sd-diff">
                    <div className="sd-diff-line del">- 一个示例项目。</div>
                    <div className="sd-diff-line add">+ ## 快速开始</div>
                    <div className="sd-diff-line add">+ npm install</div>
                    <div className="sd-diff-line add">+ npm run dev</div>
                  </div>
                )}
              </div>
            )}

            {/* 工具调用卡 4：bash 验证 */}
            <ToolCard phase={phase} at={10} doneAt={11} icon={<Terminal size={12} />} name="bash" args="npm run build" out="✓ build passed in 2.3s" />

            {/* 流式打字正文 */}
            {phase >= 12 && (
              <div className="sd-text">{MARKDOWN.slice(0, typed)}<span className="sd-caret" /></div>
            )}

            {/* 汇报要点 + 结论 + 文件卡 */}
            {phase >= 13 && (
              <div className="sd-report">
                <div className="sd-report-title">🔧 本次改动</div>
                <ul>
                  <li className={bullets >= 1 ? "show ok" : ""}><Check size={11} /> 定位到 README 缺少安装说明</li>
                  <li className={bullets >= 2 ? "show ok" : ""}><Check size={11} /> 新增「快速开始」章节（环境/安装/启动）</li>
                  <li className={bullets >= 3 ? "show ok" : ""}><Check size={11} /> 保持原有目录结构不变</li>
                  <li className={bullets >= 4 ? "show warn" : ""}><AlertTriangle size={11} /> 运行前请确认 Node ≥ 18</li>
                </ul>
                <p className={`sd-conclusion${phase >= 14 ? " show" : ""}`}>结论：README 已补齐安装说明，构建验证通过，可以直接使用。</p>
                <span className={`sd-file${phase >= 15 ? " show" : ""}`}><FileCode2 size={12} /> README.md</span>
              </div>
            )}
          </div>
        )}
        {/* 自动跟随锚点：内容增长时外部容器滚动到这里 */}
        <span className="sd-scroll-anchor" data-sd-phase={phase} />
      </div>
    </div>
  );
}
