/**
 * Agent 提问卡（10-11 从 composer 内联 JSX 抽出；同日二改：统一「先选中、再确认」）。
 * ⛔ 交互定稿（用户 10-11）：选项**点击只选中**（高亮 + 勾选标记），**点提交按钮才回给引擎** ——
 *    单选/多选同一套流程，差别只在「能选几项」：单选 = 圆形单选标记（选新的自动取消旧的）、
 *    多选 = 方形勾选框（可多项）。单选/多选由 **Codex** 在 agent_ask 工具里用 multiple 决定。
 * 自定义输入可与勾选项一起提交（拼接符「；」）。
 */
import { useState } from "react";
import { Sparkles, Check, Circle, CircleCheck } from "lucide-react";

export type AgentAskPayload = {
  threadId: string;
  question: string;
  options: string[];
  recommended: string | null;
  allowFree: boolean;
  multiple?: boolean;
  resolve: (answer: string) => void;
};

/** 询问卡：单选/多选 + 推荐项预选 + 自由输入，确认后把选择回给引擎。 */
export function AgentAskCard({ ask, onClose }: { ask: AgentAskPayload; onClose: () => void }) {
  const multi = ask.multiple === true;
  // 单选时预选推荐项：老流程「点推荐 = 一步完成」，预选后推荐路径仍是点一次「确认」
  const [picked, setPicked] = useState<string[]>(() => (!multi && ask.recommended ? [ask.recommended] : []));
  const [freeText, setFreeText] = useState("");
  /* ⛔ 11-24 用户：「自定义输入，没有选中功能」—— 单选语义下「选项」与「自定义」是**互斥**的
     （只能给一个答案）。旧实现两边都留着 ⇒ 点选项后再打字，提交会变成「选项；自定义」两条答案。
     ⇒ 选选项时清掉自定义、打自定义时清掉选项；多选不受影响（自定义是额外一项）。 */
  const toggle = (option: string) => {
    if (!multi) setFreeText("");
    setPicked((current) => (multi
      ? (current.includes(option) ? current.filter((entry) => entry !== option) : [...current, option])
      : (current.includes(option) ? [] : [option]))); // 单选：选新的自动取消旧的；再点一次取消
  };
  /** 自定义输入非空 = 已选中一项（与选项行同款视觉），参与按钮计数。 */
  const freeActive = freeText.trim().length > 0;
  /** 真正会提交的项数：选项 + 自定义（单选时两者互斥，不会同时为真）。 */
  const chosenCount = picked.length + (freeActive ? 1 : 0);
  const canSubmit = chosenCount > 0;
  const submit = () => {
    if (!canSubmit) return;
    const parts = [...picked];
    if (freeText.trim()) parts.push(freeText.trim());
    ask.resolve(parts.join("；"));
    onClose();
  };
  return (
    <div className="agent-ask-inline" role="dialog" aria-label="Agent 提问">
      <header>
        <Sparkles size={15} />
        <strong>Agent 想问你</strong>
        <span className="agent-ask-mode" title={multi ? "可勾选多项一起提交" : "选择一项后点「确认」提交"}>{multi ? "可多选" : "单选"}</span>
      </header>
      <p className="agent-ask-question">{ask.question}</p>
      <div className="agent-ask-options" data-multiple={multi ? "true" : undefined}>
        {ask.options.map((option, index) => {
          const checked = picked.includes(option);
          return (
            <button
              type="button"
              key={index}
              className={`agent-ask-option-row ${checked ? "checked" : ""}`}
              role={multi ? "checkbox" : "radio"}
              aria-checked={checked}
              onClick={() => toggle(option)}
            >
              {multi
                ? <span className="agent-ask-mark box" aria-hidden>{checked && <Check size={12} />}</span>
                : <span className="agent-ask-mark radio" aria-hidden>{checked && <CircleCheck size={15} />}{!checked && <Circle size={15} />}</span>}
              <span className="agent-ask-option-text">{option}</span>
              {option === ask.recommended && <span className="agent-ask-badge">推荐</span>}
            </button>
          );
        })}
      </div>
      {ask.allowFree !== false && (
        <form
          className={`agent-ask-free${freeActive ? " has-value" : ""}`}
          onSubmit={(event) => { event.preventDefault(); submit(); }}
        >
          {/* ⛔ 11-24：自定义输入也要有「选中」标记 —— 与选项行同款（单选圆点 / 多选方框），
              否则用户打完字不知道自己这条算不算被选中、会不会一起提交。 */}
          <span className={`agent-ask-mark${multi ? " box" : " radio"}`} aria-hidden>
            {freeActive && (multi ? <Check size={12} /> : <CircleCheck size={15} />)}
          </span>
          <input
            value={freeText}
            onChange={(event) => {
              const next = event.target.value;
              setFreeText(next);
              if (!multi && next.trim()) setPicked([]);
            }}
            name="freeText"
            aria-label="自定义答案"
            placeholder={multi ? "或者输入你的想法（可与勾选一起提交）…" : "或者输入你的想法…"}
          />
          <button type="submit" className="primary-setting" disabled={!canSubmit}>
            <Check size={14} />{multi ? `提交${chosenCount ? `（已选 ${chosenCount} 项）` : ""}` : "确认"}
          </button>
        </form>
      )}
      {ask.allowFree === false && (
        <div className="agent-ask-free agent-ask-free--plain">
          <button type="button" className="primary-setting" disabled={!canSubmit} onClick={submit}>
            <Check size={14} />{multi ? `提交${chosenCount ? `（已选 ${chosenCount} 项）` : ""}` : "确认"}
          </button>
        </div>
      )}
    </div>
  );
}
