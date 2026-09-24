/**
 * app-view/helpers/components（09-22 架构改造：从 helpers.tsx 按功能域拆出，纯搬迁）
 *
 * 域：本域 JSX 组件（工具卡片 / 请求卡片 / 语音设置桥）
 * 符号（3）：ToolCard / RequestCard / VoiceSettingsBridge
 *
 * 代码与拆分前逐字一致；依赖边经 AST 依赖图核对，**不跨模块** ⇒ 本文件不 import 同目录其他模块。
 */
import { useEffect, useState } from "react";
import { Check, ChevronDown, Globe2, MessageSquarePlus, Monitor, Play, ShieldCheck, Wrench } from "lucide-react";
import { ToolStatusEntry } from "../../../features/session-cards";
import { setVoiceOpenSettingsHandler } from "../../../voice/wave-level";
import type { PendingRequest } from "../types";



export function ToolCard({ tool }: { tool: ToolStatusEntry }) {
  const Icon = tool.id === "nuphus-mcp" ? Monitor : tool.id === "cloakbrowser" ? ShieldCheck : Globe2;
  const state = !tool.installed ? "missing" : !tool.binaryReady ? "partial" : "ready";
  const stateLabel = state === "ready" ? "就绪" : state === "partial" ? "待下载内核" : "未安装";
  return (
    <div className={`tool-card ${state}`}>
      <span className="tool-card-icon"><Icon size={16} /></span>
      <div className="tool-card-main">
        <div className="tool-card-head">
          <strong>{tool.name}</strong>
          {tool.version && <code className="tool-card-version">v{tool.version}</code>}
          <span className={`tool-card-state ${state}`}>{stateLabel}</span>
        </div>
        <p>{tool.detail}</p>
        <code className="tool-card-command">{tool.command}</code>
      </div>
    </div>
  );
}

export /** 深度思考卡片：live→done 保持同一 DOM 节点（换 key 会整块重建、视觉闪烁）；
 * 展开态受控：思考中默认展开，用户手动收起后尊重其选择 */




/** memo 版消息项：流式期间父级每帧重渲染，已完成的消息项（item 引用不变）直接跳过，
 * 只有正在出字的那条（text 变化）会重渲染，滚动和已渲染内容保持静止不闪 */


/** memo 回合视图：输入框打字等 App 级状态变化不再穿透到消息列表（闪烁根源之一）；
 * turn 对象引用在 stableItem/mergeTurn 下只有真正变化的回合会更新 */


function RequestCard({ request, onDone }: { request: PendingRequest; onDone: () => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [replyError, setReplyError] = useState("");
  const params = request.params ?? {};
  const questions = params.questions ?? [];
  const legacyApproval = request.method === "execCommandApproval" || request.method === "applyPatchApproval";
  const commandLike = legacyApproval || request.method === "item/commandExecution/requestApproval" || request.method === "item/fileChange/requestApproval";
  const available = params.availableDecisions ?? [];
  const allowOnce = legacyApproval ? "approved" : "accept";
  const allowSession = legacyApproval ? "approved_for_session" : "acceptForSession";
  const decline = legacyApproval ? { denied: { rejection: "User denied request" } } : "decline";
  const isUserInput = request.method === "item/tool/requestUserInput";
  const isElicitation = request.method === "mcpServer/elicitation/request";
  // 09-14 用户反馈「审批弹窗有点丑，卡片太大了，两个卡片直接占满」→ 改成**输入框上一行**：
  // 收起态只占一行（图标 + 一句话摘要 + 允许/拒绝），点摘要才展开预览正文。
  // ⛔ 例外：要用户**填东西**的两类（问问题 / MCP elicitation）必须默认展开——收起了就没法填，
  // 那不是审美问题是不可用；它们本来就只需要一行标题 + 表单。
  const [expanded, setExpanded] = useState(() => isUserInput || isElicitation);
  const command = String(params.command ?? "");
  const title = isUserInput
    ? "Codex 需要你的输入"
    : isElicitation
      ? `${params.serverName ?? "MCP"} 请求确认`
      : request.method.includes("fileChange") ? "批准文件改动" : request.method.includes("permissions") ? "批准额外权限" : "批准命令执行";
  /** 收起态露出的那一眼信息：命令取首个非空行，其余取原因 / 问题标题 / 服务端消息 */
  const peek = isUserInput
    ? String(questions[0]?.header || questions[0]?.question || "")
    : isElicitation ? String(params.message ?? "")
      : command ? (command.split("\n").find((line: string) => line.trim()) ?? "") : String(params.reason ?? params.grantRoot ?? "");
  const RequestIcon = isUserInput ? MessageSquarePlus : isElicitation ? Wrench : ShieldCheck;

  async function reply(result: unknown) {
    setSubmitting(true);
    setReplyError("");
    try {
      await window.codex.respond(request.id, result);
      onDone();
    } catch (error: any) {
      setReplyError(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  const elicitationProperties = params.requestedSchema?.properties ?? {};
  const elicitationContent = Object.fromEntries(Object.keys(elicitationProperties).map((key) => [key, answers[key] ?? ""]));

  return (
    <section className={`approval-card compact ${expanded ? "expanded" : ""}`}>
      <header className="approval-line">
        <button
          type="button"
          className="approval-summary"
          aria-expanded={expanded}
          title={command || peek || title}
          onClick={() => setExpanded((value) => !value)}
        >
          <RequestIcon size={14} />
          <strong>{title}</strong>
          {peek && <span className={`approval-peek ${command ? "mono" : ""}`}>{peek}</span>}
          <ChevronDown size={13} className="approval-caret" />
        </button>
        {/* 审批类：收起状态也要能直接允许/拒绝（点开只为看内容，不是操作前置） */}
        {!isUserInput && !isElicitation && (
          <div className="approval-actions">
            <button disabled={submitting} onClick={() => void reply(commandLike ? { decision: decline } : { permissions: {}, scope: "turn" })}>拒绝</button>
            <button className="primary" disabled={submitting} onClick={() => void reply(commandLike ? { decision: allowOnce } : { permissions: Object.fromEntries(Object.entries(params.permissions ?? {}).filter(([, value]) => value != null)), scope: "turn" })}><Play size={13} />允许</button>
          </div>
        )}
      </header>

      {expanded && (
        <div className="approval-detail">
          {isUserInput && questions.map((question: any) => (
            <label className="question" key={question.id}>
              <span>{question.header || question.question}</span>
              {question.header && <small>{question.question}</small>}
              {question.options ? (
                <select value={answers[question.id] ?? ""} onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })}>
                  <option value="">请选择</option>
                  {question.options.map((option: any) => <option key={option.label} value={option.label}>{option.label} - {option.description}</option>)}
                </select>
              ) : (
                <input type={question.isSecret ? "password" : "text"} value={answers[question.id] ?? ""} onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })} />
              )}
            </label>
          ))}
          {isElicitation && <>
            {params.message && <p>{params.message}</p>}
            {params.mode === "url" && <button onClick={() => void window.codex.openExternal(params.url)}>在浏览器中打开</button>}
            {params.mode !== "url" && Object.entries(elicitationProperties).map(([key, schema]: [string, any]) => <label className="question" key={key}><span>{schema.title ?? key}</span>{schema.description && <small>{schema.description}</small>}{schema.enum ? <select value={answers[key] ?? ""} onChange={(event) => setAnswers({ ...answers, [key]: event.target.value })}><option value="">请选择</option>{schema.enum.map((value: string) => <option value={value} key={value}>{value}</option>)}</select> : <input type={schema.type === "number" || schema.type === "integer" ? "number" : "text"} value={answers[key] ?? ""} onChange={(event) => setAnswers({ ...answers, [key]: event.target.value })} />}</label>)}
          </>}
          {!isUserInput && !isElicitation && <>
            {params.reason && <p>{params.reason}</p>}
            {command && <pre>{command}</pre>}
            {params.cwd && <div className="tool-meta">{params.cwd}</div>}
            {!commandLike && Object.keys(params.permissions ?? {}).length > 0 && <pre>{JSON.stringify(params.permissions, null, 2)}</pre>}
          </>}
          {replyError && <p className="request-error">{replyError}</p>}
        </div>
      )}

      {expanded && (isUserInput || isElicitation) && (
        <footer>
          {isUserInput
            ? <button className="primary" disabled={submitting} onClick={() => void reply({ answers: Object.fromEntries(questions.map((q: any) => [q.id, { answers: [answers[q.id] ?? ""] }])) })}><Check size={15} />提交</button>
            : <><button disabled={submitting} onClick={() => void reply({ action: "decline", content: null, _meta: params._meta ?? null })}>拒绝</button><button className="primary" disabled={submitting} onClick={() => void reply({ action: "accept", content: params.mode === "url" ? null : elicitationContent, _meta: params._meta ?? null })}><Check size={14} />确认</button></>}
        </footer>
      )}
      {expanded && !isUserInput && !isElicitation && commandLike && (!available.length || available.includes(allowSession)) && (
        <footer><button disabled={submitting} onClick={() => void reply({ decision: allowSession })}>本会话允许</button></footer>
      )}
    </section>
  );
}

export /** 把「打开设置 → 语音通话页」注册给悬浮球（悬浮球是 body portal，拿不到 App 的 setSettingsPage）。 */
function VoiceSettingsBridge({ onOpen }: { onOpen: () => void }): null {
  useEffect(() => {
    setVoiceOpenSettingsHandler(onOpen);
    return () => setVoiceOpenSettingsHandler(null);
  }, [onOpen]);
  return null;
}