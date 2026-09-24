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
      <section className="settings-section stack">
                    <div className="settings-copy"><h2>语气自适应</h2><p>按会话维护状态，回复语气随进展变化；只影响说法，不影响内容。</p></div>
                    <div className="settings-subhead"><Zap size={13} />开关<span className="settings-subhead-hint">每个会话各自一份、互不影响；回合失败收紧、顺利轻快，空闲半小时慢慢回到基线。关掉即停止更新，并摘掉当前会话已注入的语气块</span></div>
                    <div className="theme-switch" role="group" aria-label="语气自适应">
                      <button type="button" className={adaptiveTone ? "active" : ""} onClick={() => changeAdaptiveTone(true)}>开启</button>
                      <button type="button" className={!adaptiveTone ? "active" : ""} onClick={() => changeAdaptiveTone(false)}>关闭</button>
                    </div>
                    {thread?.id ? (() => { const t = moodTone(readMood(thread.id)); return <div className="settings-actions"><span>当前会话语气：<b>{t.label}</b> —— {t.tone}</span></div>; })() : null}
                  </section>
    </>
  );
}
