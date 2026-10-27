import { useState } from "react";
import type { ReactNode } from "react";
import { Briefcase, Check, RotateCcw, Volume2 } from "lucide-react";
import { USER_PERSONAS, userPersonaFields } from "../../lib/user-personas.mjs";

/** 用户人格（10-25 从用户中心搬到「人格市场」，与 Codex 人格同一页）：
 *  选一个行业身份，写进档案的 occupation / userContext，Codex 按这个背景配合你。 */
export function UserPersonaPanel({ onNotice, action }: { onNotice: (message: string) => void; /** 标题行右侧的附加操作（10-27：人格市场的「刷新」放在这里） */ action?: ReactNode }) {
  const [applied, setApplied] = useState<string | null>(null);
  const apply = async (personaId: string) => {
    const fields = personaId === "default" ? { occupation: "", userContext: "" } : userPersonaFields(personaId);
    if (!fields) { onNotice(`没有叫「${personaId}」的用户人格`); return; }
    try {
      await window.codex.saveIdentity(fields);
      const hit = USER_PERSONAS.find((p) => p.id === personaId);
      setApplied(personaId === "default" ? null : personaId);
      onNotice(hit ? `已应用「${hit.label}」用户人格（配套工具：${hit.tools.join("、")}）` : "已恢复空白用户人格");
    } catch (err: any) {
      onNotice(`用户人格应用失败：${err?.message ?? err}`);
    }
  };
  return (
    <section className="uc-panel user-persona-panel">
      <div className="uc-panel-head">
        <span className="uc-panel-icon"><Briefcase size={14} /></span>
        <div><strong>用户人格</strong><small>与 Codex 人格放在一起：选一个行业身份，Codex 按这个背景配合你（写进档案，随时可换 / 可清空）</small></div>
        {action ? <div className="uc-panel-action">{action}</div> : null}
      </div>
      <div className="user-persona-grid">
        {USER_PERSONAS.map((p) => {
          const active = applied === p.id;
          return (
            <button
              key={p.id}
              type="button"
              className={`user-persona-card ${active ? "active" : ""}`}
              aria-pressed={active}
              onClick={() => void apply(p.id)}
            >
              <span><strong>{p.label}</strong><small>{p.userContext}</small></span>
              <span className="user-persona-tools">{p.tools.map((t) => <em key={t}>{t}</em>)}</span>
              {active ? <Check size={13} /> : null}
            </button>
          );
        })}
      </div>
      <div className="user-persona-foot">
        <span><Volume2 size={12} />配套工具只是建议，不自动改你的功能开关；要配套去「设置 → 对应板块」开启</span>
        <button type="button" className="ghost-button" onClick={() => void apply("default")}><RotateCcw size={12} />恢复空白</button>
      </div>
    </section>
  );
}
