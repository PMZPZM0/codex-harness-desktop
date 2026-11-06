/**
 * 团队模式 · 输入框（11-06）
 *
 * 用户：「对话框的文件上传、+ 号、技能、模型都没有，功能跟对话框对齐，
 *        除了不用 @ 专家那些」。
 *
 * 做法：**只搬主对话工具行的能力，不搬 mention 面板**（群自己的 @ 伙伴 chips 在
 * `04-team-group-view.tsx` 的 atbar 里，与主对话 `@点名专家/子智能体/CLI` 零共享）。
 * 复用的都是纯 props 组件：`ComposerMenu`（权限 / 模型）、`EffortPicker`（推理档位），
 * 以及 `approvalMenuOptions` / `effortLabels` 两个纯函数 —— ⛔ 不碰全局 bag。
 *
 * ⛔ 所有选中项都**真生效**，不是装饰：
 *   · model / effort / sandbox / approvalPolicy → `invokeAgent` → `runDelegatedTask`
 *     → `turn/start.model|effort`、`thread/start.sandbox|approvalPolicy`（类型与透传通道均已存在）；
 *   · 技能 → 发送时拼 `[本轮已引用技能]…[请按上述技能工作流执行]` 进 query（主对话同款）；
 *   · 文件 → 发送时拼 `[附件文件]…[附件结束]` 进 query，伙伴按绝对路径自己读；
 *   · 权限胶囊的 `never` ⇒ `danger-full-access`（与 `changePermissionMode` 同一映射）。
 *
 * 已知边界：麦克风不接。主对话语音听写是**全局单 handler**，会同时把字幕写进主
 * `bag.prompt`；群面板接了会污染主输入框草稿（除非先加 owner 标志改造全局链路）。
 */
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { Bot, ChevronDown, Paperclip, Plus, Send, ShieldCheck, Sparkles, X } from "lucide-react";
import { ComposerMenu } from "../composer";
import { EffortPicker } from "../../components/EffortPicker";
import { effortLabels } from "../../lib/effort-labels";
import { approvalMenuOptions } from "../app-view/helpers/catalogs";

export type TeamRunOpts = {
  model: string;
  effort: string;
  sandbox: "workspace-write" | "danger-full-access";
  approvalPolicy: "never" | "on-request" | "untrusted";
  skills: Array<{ name: string; description: string }>;
  files: string[];
};

/** 只传给 `runDelegatedTask` 的四项（技能/文件在派活前拼进 query，不走 IPC 字段）。 */
export type TeamRunParams = {
  /** 空串/缺省 = 跟随全局模型；⛔ 必须是裸模型名，不是 custom:<p>:<m> 复合串 */
  model?: string;
  effort: string;
  sandbox: TeamRunOpts["sandbox"];
  approvalPolicy: TeamRunOpts["approvalPolicy"];
};

export const DEFAULT_TEAM_RUN_OPTS: TeamRunOpts = {
  model: "",
  effort: "high",
  sandbox: "workspace-write",
  approvalPolicy: "never",
  skills: [],
  files: [],
};

type Props = {
  value: string;
  onValueChange: (next: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  opts: TeamRunOpts;
  onOpts: (next: TeamRunOpts) => void;
  sending: boolean;
  canSend: boolean;
  onSend: () => void;
  targetNames: string[];
};

type ModelOption = { value: string; title: string; desc?: string };

export function TeamComposer({
  value, onValueChange, textareaRef, onKeyDown, placeholder,
  opts, onOpts, sending, canSend, onSend, targetNames,
}: Props) {
  const [plusOpen, setPlusOpen] = useState(false);
  const [skillOpen, setSkillOpen] = useState(false);
  const [skills, setSkills] = useState<Array<{ name: string; description: string }>>([]);
  const [models, setModels] = useState<ModelOption[]>([{ value: "", title: "跟随全局" }]);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { providers } = await window.codex.listCustomModels();
        const seen = new Set<string>([""]);
        const list: ModelOption[] = [{ value: "", title: "跟随全局", desc: "用应用当前生效的模型" }];
        for (const p of Array.isArray(providers) ? providers : []) {
          const entries = Array.isArray(p.models) && p.models.length ? p.models : [{ id: p.model }];
          for (const m of entries) {
            const id = String(m?.id ?? "").trim();
            if (!id || seen.has(id)) continue;
            seen.add(id);
            /* ⛔ value 必须是**裸模型名**：`runDelegatedTask` 把它直接下发给 turn/start.model，
               传 `custom:<provider>:<model>` 复合串引擎不认。 */
            list.push({ value: id, title: id, desc: p.name || undefined });
          }
        }
        if (alive) setModels(list);
      } catch { /* 目录读不到就保留「跟随全局」，⛔ 不让输入框打不开 */ }
    })();
    void (async () => {
      try {
        const list = await window.codex.listLocalSkills();
        if (!alive) return;
        setSkills((Array.isArray(list) ? list : [])
          .filter((s) => s && s.name && s.enabled !== false)
          .map((s) => ({ name: String(s.name), description: String(s.description ?? s.descriptionZh ?? "") }))
          .slice(0, 40));
      } catch { /* 没有技能就只留文件入口 */ }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!plusOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) { setPlusOpen(false); setSkillOpen(false); }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [plusOpen]);

  const pickFiles = async () => {
    try {
      const paths = await window.codex.chooseFiles();
      if (!Array.isArray(paths) || !paths.length) return;
      onOpts({ ...opts, files: [...new Set([...opts.files, ...paths])].slice(0, 20) });
    } catch { /* 取消选择：什么都不做 */ }
    setPlusOpen(false);
  };

  const addSkill = (s: { name: string; description: string }) => {
    if (opts.skills.some((x) => x.name === s.name)) return;
    onOpts({ ...opts, skills: [...opts.skills, s].slice(0, 8) });
    setSkillOpen(false);
    setPlusOpen(false);
  };

  const fullAccess = opts.sandbox === "danger-full-access";
  const permValue = fullAccess ? "never" : opts.approvalPolicy;
  const onPermission = (next: string) => {
    if (next === "never") onOpts({ ...opts, sandbox: "danger-full-access", approvalPolicy: "never" });
    else onOpts({ ...opts, sandbox: "workspace-write", approvalPolicy: next as TeamRunOpts["approvalPolicy"] });
  };

  const fileName = (p: string) => p.split(/[\\/]/).pop() || p;

  return (
    <div className="team-composer" ref={wrapRef}>
      {(opts.files.length > 0 || opts.skills.length > 0) && (
        <div className="team-composer__chips">
          {opts.files.map((p) => (
            <span key={`f:${p}`} className="team-composer__chip is-file" title={p}>
              <Paperclip size={11} /> <span>{fileName(p)}</span>
              <button type="button" aria-label={`移除 ${fileName(p)}`} onClick={() => onOpts({ ...opts, files: opts.files.filter((x) => x !== p) })}><X size={10} /></button>
            </span>
          ))}
          {opts.skills.map((s) => (
            <span key={`s:${s.name}`} className="team-composer__chip is-skill" title={s.description}>
              <Sparkles size={11} /> <span>{s.name}</span>
              <button type="button" aria-label={`移除技能 ${s.name}`} onClick={() => onOpts({ ...opts, skills: opts.skills.filter((x) => x.name !== s.name) })}><X size={10} /></button>
            </span>
          ))}
        </div>
      )}

      <textarea
        ref={textareaRef}
        className="team-composer__input"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        rows={2}
      />

      <div className="team-composer__actions composer-actions">
        <div className="team-composer__left composer-left">
          <button type="button" className={`icon-button team-composer__icon${plusOpen ? " is-on" : ""}`} title="添加文件 / 引用技能" aria-label="添加" onClick={() => { setPlusOpen((v) => !v); setSkillOpen(false); }}>
            <Plus size={16} />
          </button>
          <button type="button" className="icon-button team-composer__icon" title="添加文件（本地绝对路径）" aria-label="添加文件" onClick={() => void pickFiles()}>
            <Paperclip size={15} />
          </button>
          <ComposerMenu
            icon={ShieldCheck}
            label="权限"
            title="本轮派活的沙箱与审批方式"
            value={permValue}
            options={approvalMenuOptions(fullAccess)}
            onChange={onPermission}
            tone={fullAccess ? "danger" : undefined}
            disabled={sending}
          />
          {plusOpen && (
            <div className="team-composer__pop" role="menu">
              <button type="button" role="menuitem" onClick={() => void pickFiles()}><Paperclip size={13} /> 添加文件</button>
              <button type="button" role="menuitem" onClick={() => setSkillOpen((v) => !v)}><Sparkles size={13} /> 引用技能 <ChevronDown size={11} /></button>
              {skillOpen && (
                <div className="team-composer__sub">
                  {skills.length === 0 && <p className="team-composer__empty">没有本地技能</p>}
                  {skills.map((s) => (
                    <button key={s.name} type="button" role="menuitem" title={s.description} onClick={() => addSkill(s)}>
                      <strong>{s.name}</strong><small>{s.description.slice(0, 42)}</small>
                    </button>
                  ))}
                </div>
              )}
              <button type="button" role="menuitem" onClick={() => { onOpts({ ...opts, files: [], skills: [] }); setPlusOpen(false); setSkillOpen(false); }}><X size={13} /> 清空本轮附件</button>
            </div>
          )}
        </div>

        <div className="team-composer__right composer-right">
          <span className="team-composer__count" title="本轮输入字符数（不是 token）">{value.length} 字</span>
          <ComposerMenu icon={Bot} label="模型" title="本轮派活使用的模型" value={opts.model} options={models} onChange={(v) => onOpts({ ...opts, model: v })} width={360} disabled={sending} />
          <EffortPicker levels={["low", "medium", "high", "xhigh"]} value={opts.effort || "high"} labels={effortLabels} modelId={opts.model || undefined} disabled={sending} onCommit={(v) => onOpts({ ...opts, effort: v })} />
          <button type="button" className="team-composer__send" onClick={onSend} disabled={sending || !canSend} title={targetNames.length ? `派给 ${targetNames.join("、")}` : "先点上面的 @ 选伙伴"}>
            <Send size={15} /> 发送
          </button>
        </div>
      </div>
    </div>
  );
}
