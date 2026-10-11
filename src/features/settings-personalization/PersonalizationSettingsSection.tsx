/**
 * 设置页 · personalization（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX / 体内语句与原块逐字一致（仅去掉外层缩进与 IIFE 包装）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 */
import { Zap } from "lucide-react";
import { moodTone } from "../../lib/agent-mood.mjs";

export type PersonalizationSettingsSectionProps = { adaptiveTone: any; changeAdaptiveTone: any; thread: any; readMood: any };

export function PersonalizationSettingsSection(props: PersonalizationSettingsSectionProps) {
  const { adaptiveTone, changeAdaptiveTone, thread, readMood } = props;
  return (
    <>
      {/* 10-11 重排：与上一段同构（同一条 660 内容列 + 同款组卡 + 同款标题层级）。
          原来这里是又一个 `.settings-section`（自带 26/28 内边距 + min-height:100%）
          ⇒ 两段之间多出整屏留白、且内容列左边界与上一段对不上。标题从 h2 降为 h3
          —— 它的上一级是页面标题「个性化」。文案未动。 */}
      <section className="personalization-section">
        <div className="personalization-group">
          <div className="personalization-group-title"><Zap size={13} /><h3>语气自适应</h3></div>
          <p className="personalization-group-desc">按会话维护状态，回复语气随进展变化；只影响说法，不影响内容。</p>
          <div className="settings-subhead personalization-row-label">开关<span className="settings-subhead-hint">每个会话各自一份、互不影响；回合失败收紧、顺利轻快，空闲半小时慢慢回到基线。关掉即停止更新，并摘掉当前会话已注入的语气块</span></div>
          <div className="theme-switch" role="group" aria-label="语气自适应">
            <button type="button" className={adaptiveTone ? "active" : ""} onClick={() => changeAdaptiveTone(true)}>开启</button>
            <button type="button" className={!adaptiveTone ? "active" : ""} onClick={() => changeAdaptiveTone(false)}>关闭</button>
          </div>
          {thread?.id ? (() => { const t = moodTone(readMood(thread.id)); return <div className="settings-actions"><span>当前会话语气：<b>{t.label}</b> —— {t.tone}</span></div>; })() : null}
        </div>
      </section>
    </>
  );
}
