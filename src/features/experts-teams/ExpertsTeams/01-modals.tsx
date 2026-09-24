/**
 * ExpertsTeams 的「modals」部分（09-22 从同目录 ExpertsTeams.tsx 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { createPortal } from "react-dom";
import { Users, X, Plus, Trash2, Info, Check, Bot, Sparkles, LoaderCircle, Clock3 } from "lucide-react";
import { ALL_EFFORTS } from "../../../lib/effort";
import { effortLabels } from "../../../lib/effort-labels";
export function SubAgentEditorModal({ draft, onChange, onClose, onSave }: { draft: SubAgentEntry; onChange: (draft: SubAgentEntry) => void; onClose: () => void; onSave: (draft: SubAgentEntry) => void }) {
  const valid = Boolean(draft.name.trim() && draft.systemPrompt.trim());
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="connector-setup-modal subagent-editor-modal" role="dialog" aria-modal="true" aria-label="编辑子智能体">
        <header>
          <div className="connector-setup-title">
            <span><Bot size={17} /></span>
            <div><strong>{draft.id ? `编辑「${draft.name}」` : "新建子智能体"}</strong><p>子智能体会跟随主对话的模型/沙箱/审批配置；保存后会被 Codex 通过 dynamicTools 调用。</p></div>
          </div>
          <button className="icon-button relay-modal-close" title="关闭" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="connector-form">
          <label><span>名称 <em>必填</em></span><input autoFocus value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} placeholder="例如：代码审查员 / Bug Hunter / 测试工程师" /></label>
          <label><span>简介 <small>一句话说明它负责什么</small></span><input value={draft.description} onChange={(event) => onChange({ ...draft, description: event.target.value })} placeholder="例如：专门审查 PR 改动并列出潜在问题" /></label>
          <label><span>系统提示词 <em>必填</em></span><textarea rows={6} value={draft.systemPrompt} onChange={(event) => onChange({ ...draft, systemPrompt: event.target.value })} placeholder="例如：你是一名资深前端审查员，专注 React 性能、可访问性与安全问题。请基于用户给定的代码或需求给出结构化结论。" /></label>
          <div className="settings-grid three subagent-config-grid">
            <label><span>推理强度</span><select value={draft.effort} onChange={(event) => onChange({ ...draft, effort: event.target.value })}>{ALL_EFFORTS.map((level) => <option key={level} value={level}>{effortLabels[level] ?? level}</option>)}</select></label>
            <label><span>模型</span>
              <label className="subagent-toggle"><input type="checkbox" checked={draft.inheritModel} onChange={(event) => onChange({ ...draft, inheritModel: event.target.checked, model: event.target.checked ? undefined : draft.model })} />跟随主对话</label>
              {!draft.inheritModel && <input value={draft.model ?? ""} onChange={(event) => onChange({ ...draft, model: event.target.value })} placeholder="例如：claude-sonnet-4" />}
            </label>
            <label><span>沙箱</span>
              <label className="subagent-toggle"><input type="checkbox" checked={draft.inheritSandbox} onChange={(event) => onChange({ ...draft, inheritSandbox: event.target.checked, sandbox: event.target.checked ? undefined : draft.sandbox })} />跟随主对话</label>
              {!draft.inheritSandbox && <select value={draft.sandbox ?? "workspace-write"} onChange={(event) => onChange({ ...draft, sandbox: event.target.value as any })}><option value="read-only">只读</option><option value="workspace-write">工作区写入</option><option value="danger-full-access">完全访问</option></select>}
            </label>
          </div>
          <div className="settings-grid three subagent-config-grid">
            <label><span>审批策略</span>
              <label className="subagent-toggle"><input type="checkbox" checked={draft.inheritApproval} onChange={(event) => onChange({ ...draft, inheritApproval: event.target.checked, approvalPolicy: event.target.checked ? undefined : draft.approvalPolicy })} />跟随主对话</label>
              {!draft.inheritApproval && <select value={draft.approvalPolicy ?? "on-request"} onChange={(event) => onChange({ ...draft, approvalPolicy: event.target.value as any })}><option value="never">从不</option><option value="on-request">按需</option><option value="on-failure">失败时</option><option value="untrusted">不可信</option></select>}
            </label>
            <label><span>状态</span>
              <label className="subagent-toggle"><input type="checkbox" checked={draft.enabled} onChange={(event) => onChange({ ...draft, enabled: event.target.checked })} />已启用</label>
            </label>
            <label><span>工具名</span>
              <div className="subagent-tool-name"><code>subagent_invoke</code></div>
            </label>
          </div>
          <div className="connector-example"><Info size={14} /><span>Codex 调用时会附带 <code>name</code> 与 <code>query</code>；主会话配置变更后，子智能体会自动跟随。</span></div>
        </div>
        <footer>
          <button className="secondary-setting" onClick={onClose}>取消</button>
          <button className="primary-setting" disabled={!valid} onClick={() => onSave(draft)}><Check size={15} />保存</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export function ExpertTeamEditorModal({ draft, onChange, onClose, onSave }: { draft: ExpertTeamConfig; onChange: (draft: ExpertTeamConfig) => void; onClose: () => void; onSave: (draft: ExpertTeamConfig) => void }) {
  const valid = Boolean(draft.displayName.zh.trim() && draft.lead.name.trim() && draft.lead.systemPrompt.trim());
  const setLead = (patch: Partial<ExpertTeamMember>) => onChange({ ...draft, lead: { ...draft.lead, ...patch } });
  const setMember = (index: number, patch: Partial<ExpertTeamMember>) => onChange({ ...draft, members: draft.members.map((m, i) => i === index ? { ...m, ...patch } : m) });
  const setTag = (index: number, value: string) => onChange({ ...draft, tags: draft.tags.map((t, i) => i === index ? { ...t, zh: value, en: value } : t) });
  const setPrompt = (index: number, value: string) => onChange({ ...draft, quickPrompts: draft.quickPrompts.map((p, i) => i === index ? { ...p, zh: value, en: value } : p) });
  const categoryOptions = [
    ["01-ProductDesign", "产品设计"], ["02-Engineering", "技术工程"], ["03-GameSpatial", "游戏空间"],
    ["04-DataAI", "数据智能"], ["05-MarketingGrowth", "营销增长"], ["06-ContentCreative", "内容创作"],
    ["07-SalesCommerce", "销售商务"], ["08-FinanceInvestment", "金融投资"], ["09-OperationsHR", "运营人力"],
    ["10-ProjectQuality", "项目质量"], ["11-SecurityCompliance", "法务安全"], ["12-IndustryConsultant", "行业顾问"],
  ];
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="connector-setup-modal expert-team-editor-modal" role="dialog" aria-modal="true" aria-label="编辑专家团">
        <header>
          <div className="connector-setup-title">
            <span><Users size={17} /></span>
            <div><strong>{draft.teamId ? `编辑「${draft.displayName.zh}」` : "新建专家团"}</strong><p>复刻 WorkBuddy 专家团：主理人编排，成员独立产出，按 SOP 分阶段协作。</p></div>
          </div>
          <button className="icon-button relay-modal-close" title="关闭" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="connector-form">
          <div className="settings-grid two expert-team-grid">
            <label><span>团队名称（中文） <em>必填</em></span><input autoFocus value={draft.displayName.zh} onChange={(event) => { const zh = event.target.value; onChange({ ...draft, displayName: { ...draft.displayName, zh }, profession: { ...draft.profession, zh } }); }} placeholder="例如：软件开发专家团" /></label>
            <label><span>团队名称（英文）</span><input value={draft.displayName.en} onChange={(event) => { const en = event.target.value; onChange({ ...draft, displayName: { ...draft.displayName, en }, profession: { ...draft.profession, en } }); }} placeholder="例如：Software Dev Team" /></label>
          </div>
          <div className="settings-grid three expert-team-grid">
            <label><span>行业分类</span><select value={draft.category} onChange={(event) => onChange({ ...draft, category: event.target.value })}>{categoryOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            <label><span>启用状态</span>
              <label className="subagent-toggle"><input type="checkbox" checked={draft.enabled} onChange={(event) => onChange({ ...draft, enabled: event.target.checked })} />已启用</label>
            </label>
            <label><span>团队 ID <small>kebab-case，留空自动生成</small></span><input value={draft.teamId} onChange={(event) => onChange({ ...draft, teamId: event.target.value })} placeholder="例如：software-dev-team" /></label>
          </div>
          <label><span>展示描述 <small>中文 40-50 字</small></span><textarea rows={2} value={draft.description.zh} onChange={(event) => onChange({ ...draft, description: { ...draft.description, zh: event.target.value } })} placeholder="例如：由产品、架构、开发、测试四人协同，从需求澄清到交付验收全流程把关。" /></label>
          <div className="settings-grid three expert-team-grid">
            {[0, 1, 2].map((index) => <label key={index}><span>标签 {index + 1}</span><input value={draft.tags[index]?.zh ?? ""} onChange={(event) => setTag(index, event.target.value)} placeholder="例如：需求梳理" /></label>)}
          </div>
          <div className="settings-grid three expert-team-grid">
            {[0, 1, 2].map((index) => <label key={index}><span>推荐提示词 {index + 1}</span><input value={draft.quickPrompts[index]?.zh ?? ""} onChange={(event) => setPrompt(index, event.target.value)} placeholder="例如：请带领团队完成我的任务" /></label>)}
          </div>
          <div className="expert-team-section">
             <div className="expert-team-section-title"><strong>主理人 <small>负责编排调度，不显示个人姓名</small></strong></div>
            <div className="settings-grid three expert-team-grid">
               <label><span>内部角色标识</span><input value={draft.lead.name} onChange={(event) => setLead({ name: event.target.value })} placeholder="例如：delivery-lead" /></label>
              <label><span>职业头衔</span><input value={draft.lead.profession.zh} onChange={(event) => setLead({ profession: { ...draft.lead.profession, zh: event.target.value } })} placeholder="例如：交付总监" /></label>
              <label><span>成员 ID <small>kebab-case</small></span><input value={draft.lead.id} onChange={(event) => setLead({ id: event.target.value })} placeholder="例如：software-dev-team-lead" /></label>
            </div>
            <label><span>一句话职责</span><input value={draft.lead.description} onChange={(event) => setLead({ description: event.target.value })} placeholder="例如：编排调度整个团队，把控交付节奏与质量" /></label>
            <label><span>主理人系统提示词 <em>必填</em></span><textarea rows={5} value={draft.lead.systemPrompt} onChange={(event) => setLead({ systemPrompt: event.target.value })} placeholder={"例如：你是团队主理人，负责编排调度成员…\n协作铁律：由你亲自编排、成员独立产出、信息经你中转、采信成员结论。"} /></label>
          </div>
          <div className="expert-team-section">
            <div className="expert-team-section-title"><strong>团队成员 <small>{draft.members.length} 人 · 每个成员独立会话产出</small></strong>
              <button className="secondary-setting" onClick={() => onChange({ ...draft, members: [...draft.members, { id: "", name: "", profession: { zh: "", en: "" }, description: "", systemPrompt: "" }] })}><Plus size={12} />添加成员</button>
            </div>
            {draft.members.map((member, index) => (
              <div className="expert-team-member" key={index}>
                 <div className="expert-team-member-head"><strong>成员 {index + 1} · {member.profession.zh || "未命名角色"}</strong>
                  <button className="icon-button" title="删除成员" onClick={() => onChange({ ...draft, members: draft.members.filter((_, i) => i !== index) })}><Trash2 size={13} /></button>
                </div>
                <div className="settings-grid three expert-team-grid">
                   <label><span>内部角色标识</span><input value={member.name} onChange={(event) => setMember(index, { name: event.target.value })} placeholder="例如：engineer" /></label>
                  <label><span>职业头衔</span><input value={member.profession.zh} onChange={(event) => setMember(index, { profession: { ...member.profession, zh: event.target.value } })} placeholder="例如：开发工程师" /></label>
                  <label><span>成员 ID <small>kebab-case</small></span><input value={member.id} onChange={(event) => setMember(index, { id: event.target.value })} placeholder="例如：engineer" /></label>
                </div>
                <label><span>一句话职责</span><input value={member.description} onChange={(event) => setMember(index, { description: event.target.value })} placeholder="例如：代码实现" /></label>
                <label><span>系统提示词 <em>必填</em></span><textarea rows={4} value={member.systemPrompt} onChange={(event) => setMember(index, { systemPrompt: event.target.value })} placeholder={"例如：你是团队成员，负责…\n完成后通过 SendMessage 将完整结果回传给主理人。"} /></label>
              </div>
            ))}
            {!draft.members.length && <div className="expert-team-member-empty">还没有成员，点击「添加成员」创建第一个。</div>}
          </div>
          <label><span>标准工作流程（SOP）</span><textarea rows={6} value={draft.sop} onChange={(event) => onChange({ ...draft, sop: event.target.value })} placeholder={"例如：\n### Phase 1（并行）：…\n### Phase 2（串行）：…\n### Phase N：主理人汇总输出"} /></label>
          <div className="connector-example"><Info size={14} /><span>发起团队会话后，主理人（lead）会在独立会话中通过 <code>team_member_invoke(memberId, query)</code> 调度成员，按 SOP 分阶段协作，最终汇总交付。</span></div>
        </div>
        <footer>
          <button className="secondary-setting" onClick={onClose}>取消</button>
          <button className="primary-setting" disabled={!valid} onClick={() => onSave(draft)}><Check size={15} />保存专家团</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
