/**
 * BOSS 会话的**专属**空态（10-25 用户令：「BOSS 会话定制的，跟其他任何会话没关系，
 * 跟欢迎界面也没关系」）。
 *
 * ⛔ 不复用 `.welcome-state`：那套是「新会话欢迎页」（大字标题铺在上半屏 + 输入框下方
 *    还有一排快捷任务），BOSS 会话里既不属于它的语汇、也会把引导顶到输入框上。
 *    这里是一张**会话内的引导卡**，居中在消息区，只属于 BOSS 会话。
 * ⛔ 也不动普通会话的任何样式/结构 —— 本组件只在「当前是 BOSS 会话且没有回合」时渲染。
 */
import { Crown } from "lucide-react";

const SUGGESTIONS = [
  "做个落地页：设计 + 前端 + 测试",
  "仓库过一遍，找安全问题",
  "写份竞品分析，三个视角",
];

export function BossThreadIntro({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="boss-intro">
      <div className="boss-intro-card">
        <span className="boss-intro-mark"><Crown size={26} strokeWidth={1.6} /></span>
        <h2 className="boss-intro-title">你好 BOSS，今天要做什么？</h2>
        <p className="boss-intro-sub">
          说需求就行 —— 我拉群喊人：专家、专家团、你本机的 CLI agent 都能叫来干活。
          人齐了我派活、盯进度，审不过就打回重做。
        </p>
        <div className="boss-intro-chips">
          {SUGGESTIONS.map((text) => (
            <button key={text} type="button" className="boss-intro-chip" onClick={() => onPick(text)}>
              {text}
            </button>
          ))}
        </div>
        <p className="boss-intro-foot">这个会话会一直用下去，不会每轮新建。</p>
      </div>
    </div>
  );
}
