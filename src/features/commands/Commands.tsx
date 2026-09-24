/** 内置命令与快捷键（从 src/App.tsx 原样搬来，内容未改）。域公开面见 ./index.ts */
import { createPortal } from "react-dom";
import { TerminalSquare, X, Info, Check } from "lucide-react";
import { Spinner } from "../../components/CardShell";

export type BuiltinCommandDef = { name: string; description: string; hint?: string; category: string };

export type CommandEditorDraft = { mode: "new" | "edit"; name: string; source: CommandSource; description: string; argumentHint: string; allowedTools: string; model: string; body: string; prevFilePath?: string };

export function CommandEditorModal({ draft, saving, onChange, onClose, onSave }: {
  draft: CommandEditorDraft;
  saving: boolean;
  onChange: (draft: CommandEditorDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const valid = Boolean(draft.name.trim() && draft.body.trim());
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section className="connector-setup-modal command-editor-modal" role="dialog" aria-modal="true" aria-label={draft.mode === "edit" ? "编辑命令" : "新建命令"}>
        <header>
          <div className="connector-setup-title">
            <span><TerminalSquare size={17} /></span>
            <div><strong>{draft.mode === "edit" ? `编辑 /${draft.name}` : "新建自定义命令"}</strong><p>保存为 commands/*.md 文件，输入框里敲 <code>/{draft.name || "命令名"}</code> 即可触发。</p></div>
          </div>
          <button className="icon-button relay-modal-close" title="关闭" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="connector-form">
          <div className="settings-grid two command-editor-grid">
            <label><span>命令名 <em>必填</em> <small>不含斜杠</small></span><input autoFocus value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} placeholder="例如：git:commit（冒号分层，如 frontend:build）" /></label>
            <label><span>存放位置</span>
              <select value={draft.source} onChange={(event) => onChange({ ...draft, source: event.target.value as CommandSource })}>
                <option value="project">项目级（当前工作区 .codex/commands/）</option>
                <option value="global">个人全局（$CODEX_HOME/commands/）</option>
              </select>
            </label>
          </div>
          <label><span>描述 <small>在命令列表与补全提示中展示</small></span><input value={draft.description} onChange={(event) => onChange({ ...draft, description: event.target.value })} placeholder="例如：创建 git 提交（自动收集状态与变更）" /></label>
          <div className="settings-grid three command-editor-grid">
            <label><span>参数提示</span><input value={draft.argumentHint} onChange={(event) => onChange({ ...draft, argumentHint: event.target.value })} placeholder="例如：[message] 或 [pr-number]" /></label>
            <label><span>允许工具</span><input value={draft.allowedTools} onChange={(event) => onChange({ ...draft, allowedTools: event.target.value })} placeholder="例如：Bash(git:*), Read" /></label>
            <label><span>指定模型</span><input value={draft.model} onChange={(event) => onChange({ ...draft, model: event.target.value })} placeholder="例如：gemini-3.1-pro" /></label>
          </div>
          <label><span>命令内容 <em>必填</em></span>
            <textarea rows={9} value={draft.body} onChange={(event) => onChange({ ...draft, body: event.target.value })} placeholder={"例如：\n请为我运行 `npm run test -- $1` 并总结结果。未提供测试文件则运行全部测试。"} />
          </label>
          <div className="connector-example"><Info size={14} /><span>模板语法：<code>$1</code>…<code>$9</code> 位置参数、<code>$ARGUMENTS</code> 全部参数；<code>@src/utils/helpers.js</code> 注入文件内容；行首 <code>!`git status`</code> 执行 shell 命令并把输出作为上下文。</span></div>
        </div>
        <footer>
          <button className="secondary-setting" onClick={onClose}>取消</button>
          <button className="primary-setting" disabled={!valid || saving} onClick={onSave}>{saving ? <Spinner /> : <Check size={15} />}保存命令</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
