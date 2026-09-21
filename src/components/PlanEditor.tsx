import { memo, useEffect, useMemo, useState } from "react";
import { CircleCheck, Circle, Plus, RotateCcw, Trash2, Send } from "lucide-react";
import { parsePlan, serializePlan } from "../lib/plan-steps.mjs";

/**
 * 计划可编辑构件（09-21 用户点名：对标 ECC 的「plan → editable artifact」）。
 *
 * 背景：引擎把计划以**结构化**形态发过来（`turn/plan/updated` 的 `plan: [{ step, status }]`），
 * 我们在事件层拍平成 markdown 存进 `item.text`（`- [ ] 步骤` / `- [x] 步骤`）。这里把它**解析回条目**，
 * 让用户能改：勾选、改文字、删、加。改完点「交给 Codex」→ 序列化后**作为一条用户消息**交回去。
 *
 * ⛔ 为什么不"直接改引擎里的计划"：计划的权威状态在模型侧（`update_plan` 是模型自己的工具），
 *   我们传不进去。所以这里的语义是**「用户改了计划 → 让模型按新的执行」** —— 这是真实可达的路径。
 *   编造一个"已同步到引擎"的假象，比不做更糟（用户会以为改完就一定生效）。
 *
 * ⛔ 本地编辑按 itemId 存 localStorage：改了还没交回就切会话/关窗口，回来还在。
 *   一旦「交给 Codex」就清掉（内容已进对话，再留着会与后续模型产出的新计划打架）。
 */

export type PlanStep = { text: string; done: boolean };

/** 解析 / 序列化在 `src/lib/plan-steps.mjs`（纯函数，预检能直接跑真断言）—— 组件只管交互。 */

const STORE_PREFIX = "plan-edit-v1:";

/** 读取本地编辑（只在与引擎原文不同才有意义，但仍原样返回，由调用方比对）。 */
function loadLocal(itemId: string): { intro: string; steps: PlanStep[] } | null {
  try {
    const raw = window.localStorage.getItem(STORE_PREFIX + itemId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.steps)) return null;
    return { intro: String(parsed.intro ?? ""), steps: parsed.steps.map((s: any) => ({ text: String(s?.text ?? ""), done: Boolean(s?.done) })) };
  } catch { return null; }
}

export const PlanEditor = memo(function PlanEditor({ itemId, text, onSubmit }: {
  itemId: string;
  text: string;
  /** 交回：把（可能被改过的）计划作为一条用户消息发出去 */
  onSubmit: (markdown: string) => void;
}) {
  const original = useMemo(() => parsePlan(text), [text]);
  const [draft, setDraft] = useState<{ intro: string; steps: PlanStep[] }>(() => loadLocal(itemId) ?? original);

  // 引擎那边计划更新了（模型又动过计划）→ 如果本地没有未提交的编辑，就跟随刷新
  useEffect(() => {
    const local = loadLocal(itemId);
    if (!local) setDraft(original);
  }, [itemId, original]);

  useEffect(() => {
    try { window.localStorage.setItem(STORE_PREFIX + itemId, JSON.stringify(draft)); } catch { /* 配额满等情况忽略 */ }
  }, [itemId, draft]);

  const dirty = JSON.stringify(draft.steps) !== JSON.stringify(original.steps) || draft.intro !== original.intro;
  const doneCount = draft.steps.filter((s) => s.done).length;

  const patch = (index: number, next: Partial<PlanStep>) =>
    setDraft((current) => ({ ...current, steps: current.steps.map((s, i) => (i === index ? { ...s, ...next } : s)) }));

  return (
    <div className="plan-editor" data-plan-item={itemId} data-steps={draft.steps.length} data-dirty={dirty ? "1" : "0"}>
      {draft.intro ? <div className="plan-editor-intro">{draft.intro}</div> : null}
      <ol className="plan-editor-steps">
        {draft.steps.map((step, index) => (
          <li className={`plan-step ${step.done ? "done" : ""}`} key={index} data-step={index}>
            <button
              type="button"
              className="plan-step-check"
              aria-label={step.done ? `第 ${index + 1} 步已完成，点击标为未完成` : `第 ${index + 1} 步未完成，点击标为已完成`}
              onClick={() => patch(index, { done: !step.done })}
            >
              {step.done ? <CircleCheck size={15} /> : <Circle size={15} />}
            </button>
            <textarea
              className="plan-step-text"
              value={step.text}
              rows={1}
              aria-label={`第 ${index + 1} 步`}
              onChange={(event) => patch(index, { text: event.target.value })}
              onInput={(event) => {
                // 高度自适应：内容多了不出现滚动条（与输入框同款手感）
                const el = event.currentTarget;
                el.style.height = "auto";
                el.style.height = `${el.scrollHeight}px`;
              }}
            />
            <button
              type="button"
              className="plan-step-del"
              aria-label={`删除第 ${index + 1} 步`}
              onClick={() => setDraft((current) => ({ ...current, steps: current.steps.filter((_, i) => i !== index) }))}
            >
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ol>
      <div className="plan-editor-actions">
        <button type="button" className="plan-op" onClick={() => setDraft((current) => ({ ...current, steps: [...current.steps, { text: "", done: false }] }))}>
          <Plus size={13} />加一条
        </button>
        {dirty && (
          <button type="button" className="plan-op" onClick={() => { try { window.localStorage.removeItem(STORE_PREFIX + itemId); } catch { /* 忽略 */ } setDraft(original); }}>
            <RotateCcw size={13} />还原
          </button>
        )}
        <span className="plan-editor-progress">{doneCount}/{draft.steps.length} 已完成</span>
        <button
          type="button"
          className="plan-op primary"
          disabled={!draft.steps.length}
          title="把当前计划作为一条消息发给 Codex，让它按这份执行"
          onClick={() => {
            onSubmit(serializePlan(draft.intro, draft.steps.filter((s) => s.text.trim())));
            try { window.localStorage.removeItem(STORE_PREFIX + itemId); } catch { /* 忽略 */ }
          }}
        >
          <Send size={13} />交给 Codex
        </button>
      </div>
    </div>
  );
});
