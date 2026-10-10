/**
 * Agent 提问卡（10-11 从 composer 内联 JSX 抽出 —— 多选需要本地勾选状态，内联写不进 hooks）。
 * 单选 = 原形态（点一项立即回）；多选 = 勾选框 + 提交按钮（勾选结果用「；」拼接回给引擎，
 * 自定义内容与勾选项一起拼 —— 用户 10-10 要求「自定义内容按现在可以」）。
 * ⛔ 单选/多选由 **Codex** 在 agent_ask 工具里用 multiple 参数决定，前端不猜。
 */
import { useState } from "react";
import { Sparkles, Check } from "lucide-react";

export type AgentAskPayload = {
  threadId: string;
  question: string;
  options: string[];
  recommended: string | null;
  allowFree: boolean;
  multiple?: boolean;
  resolve: (answer: string) => void;
};

export function AgentAskCard({ ask, onClose }: { ask: AgentAskPayload; onClose: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const submitMulti = () => {
    const parts = [...picked];
    if (freeText.trim()) parts.push(freeText.trim());
    if (!parts.length) return;
    ask.resolve(parts.join("；"));
    onClose();
  };
  return (
    <div className="agent-ask-inline" role="dialog" aria-label="Agent 提问">
      <header>
        <Sparkles size={15} />
        <strong>Agent 想问你</strong>
        {ask.multiple && <span className="agent-ask-mode" title="可勾选多项一起提交">可多选</span>}
      </header>
      <p className="agent-ask-question">{ask.question}</p>
      <div className="agent-ask-options" data-multiple={ask.multiple ? "true" : undefined}>
        {ask.options.map((option, index) => (
          ask.multiple ? (
            <label className={`agent-ask-option-row ${picked.includes(option) ? "checked" : ""}`} key={index}>
              <input
                type="checkbox"
                checked={picked.includes(option)}
                onChange={(event) => setPicked((current) => (event.target.checked ? [...current, option] : current.filter((entry) => entry !== option)))}
              />
              <span className="agent-ask-option-text">{option}</span>
              {option === ask.recommended && <span className="agent-ask-badge">推荐</span>}
            </label>
          ) : (
            <button
              key={index}
              className={option === ask.recommended ? "agent-ask-option recommended" : "agent-ask-option"}
              onClick={() => { ask.resolve(option); onClose(); }}
            >
              {option === ask.recommended && <span className="agent-ask-badge">推荐</span>}
              {option}
            </button>
          )
        ))}
      </div>
      {ask.multiple ? (
        <form
          className="agent-ask-free"
          onSubmit={(event) => { event.preventDefault(); submitMulti(); }}
        >
          <input
            value={freeText}
            onChange={(event) => setFreeText(event.target.value)}
            name="freeText"
            placeholder="或者输入你的想法（可与勾选一起提交）…"
          />
          <button type="submit" className="primary-setting" disabled={!picked.length && !freeText.trim()}>
            <Check size={14} />提交{picked.length ? `（已选 ${picked.length} 项）` : ""}
          </button>
        </form>
      ) : (
        ask.allowFree && (
          <form
            className="agent-ask-free"
            onSubmit={(event) => {
              event.preventDefault();
              const input = event.currentTarget.elements.namedItem("freeText") as HTMLInputElement;
              if (input.value.trim()) { ask.resolve(input.value.trim()); onClose(); }
            }}
          >
            <input name="freeText" placeholder="或者输入你的想法…" />
            <button type="submit" className="primary-setting"><Check size={14} />回复</button>
          </form>
        )
      )}
    </div>
  );
}
