/**
 * ItemView（原 src/features/shared/ItemView.tsx，09-24 分层解环迁入 session-queue 域：
 * 它消费 terminal/session-cards/preview/markdown/inline-cards 五个域，本就不是基座组件；
 * Progressive 两组件的全仓唯一消费者就是本文件，随之原样搬入 ⇒ 与 SessionQueue 的双向环解除）。
 */
/** ItemView（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { isCompactionItem } from "../../lib/compaction-item.mjs";
import { ThreadItem } from "../../lib/thread-item";
import { Turn } from "../../lib/turn";
import { UserMessageView } from "../shared/UserMessageView";
import { MessageFooter } from "../shared/MessageFooter";
import { CommandExecutionCard } from "../terminal";
import { diffStats } from "../../lib/diff-stats";
import { useCardOpen } from "../../components/CardShell";
import type { ActionStatus } from "../../components/CardShell";
import { basename } from "../../lib/basename";
import { ActionCard } from "../session-cards";
import { FileCode2, Wrench, BookOpen, Search, Bot, ImagePlus, Clock3, LoaderCircle, CircleX, CircleCheck, Brain, ChevronDown } from "lucide-react";
import { itemStatusLabel } from "../../lib/item-status-label";
import { resolveTeamMember, AVATAR_GRADIENTS, avatarToneOf } from "../../lib/entity-avatar";
import { formatDuration } from "../../lib/format-duration";
import { PlanEditor } from "../../components/PlanEditor";
import { ImagePreview } from "../preview";
import { Markdown } from "../markdown";
import { InlineFileCards } from "../inline-cards";
import { usePacketRevealText } from "../shared/use-packet-reveal-text";
import { ToolCodeBlock } from "../shared/ToolCodeBlock";
import { bufferedAgentRevealStarts } from "../../lib/buffered-agent-reveal-starts";
import { bufferedToolRevealStarts } from "../../lib/buffered-tool-reveal-starts";
import { useCallback, useRef, useMemo, useState, useEffect } from "react";
import { ReasoningCard } from "../shared/ReasoningCard";
import { skillOfItem, argSummary, pluginOfItem } from "../../lib/tool-display.mjs";
import { Fold } from "../shared/Fold";

export function ItemView({ item, turn, turnActive, usage, tokenUsage, fallbackWindow, hideFooter, waitingForApproval, onCopy, onQuote, onFork, onImageCopy, onEditSubmit, onOpenFile, onOpenThread, onApplyPlan, pending }: { item: ThreadItem; turn?: Turn; turnActive?: boolean; usage?: any; tokenUsage?: any; fallbackWindow?: number; hideFooter?: boolean; waitingForApproval?: boolean; onCopy: (text: string) => void; onQuote: (text: string) => void; onFork?: () => void; onImageCopy?: (path: string) => void; onEditSubmit?: (item: ThreadItem) => void; onOpenFile?: (path: string) => void; onOpenThread?: (id: string) => void; onApplyPlan?: (markdown: string) => void; pending?: boolean }) {
  if (item.type === "userMessage") {
    return <UserMessageView item={item} turn={turn} pending={pending} onCopy={onCopy} onQuote={onQuote} onImageCopy={onImageCopy} onEditSubmit={onEditSubmit} onOpenFile={onOpenFile} onOpenThread={onOpenThread} />;
  }
  if (item.type === "agentMessage") {
    // 流式过程中会产生空的 agentMessage 片段，不渲染，避免空 div 把内容撑出滚动条
    if (!String(item.text ?? "").trim()) return null;
    // 模型在转入命令/工具调用前常会留下尾部换行；remark-breaks 会把它们
    // 变成一个没有文字的段落，段落行高正是正文与下一张工具卡之间的异常空隙。
    const assistantText = String(item.text ?? "").replace(/\s+$/u, "");
    return (
      <div className="message assistant-message" data-ruler-mark="agent" data-turn-id={turn?.id} data-item-id={item.id}>
        {/* 头像 + 名字（09-17 用户要求："给 codex 消息上面加一个名字和头像"）。
            头像 + 名字已**提到回合级**（TurnView 的 `.turn-head`，一轮只渲染一份）—— 09-17 用户
            「一轮会话就一个 Codex 名字和 Codex 头像就行，就在会话上面就行」。
            ⛔ 别在这里加回来：一个回合可能有多段 agentMessage，加回来就是一份一份地重复；
            而且头部长在这里要等首 token（空 text 被上面那条 `return null` 挡掉），
            症状正是用户报的「名字和头像没有第一时间出来」。 */}
        <div className="assistant-col">
          {/* 流式与完成态同一条 Markdown 渲染路径（raf 合帧保证流畅；remark-breaks 保真单换行），
              完成瞬间不再切换渲染方式，消除“回复完闪一下变样” */}
          <ProgressiveAgentBody
            itemId={item.id}
            text={assistantText}
            active={turnActive}
            onOpenFile={onOpenFile}
            footer={!hideFooter ? <MessageFooter item={item} turn={turn} usage={usage} tokenUsage={tokenUsage} fallbackWindow={fallbackWindow} onCopy={onCopy} onQuote={onQuote} onFork={onFork} /> : undefined}
          />
        </div>
      </div>
    );
  }
  if (item.type === "reasoning") {
    return <ReasoningCard item={item} turnActive={turnActive} />;
  }
  if (item.type === "commandExecution") {
    return <CommandExecutionCard item={item} waitingForApproval={waitingForApproval} turnActive={turnActive} />;
  }
  if (item.type === "fileChange") {
    const changes = item.changes ?? [];
    const stats = changes.reduce((sum: { added: number; deleted: number }, change: any) => { const next = diffStats(change.diff ?? ""); return { added: sum.added + next.added, deleted: sum.deleted + next.deleted }; }, { added: 0, deleted: 0 });
    const editing = item.status === "inProgress" || item.status === "running";
    const status: ActionStatus = editing ? "running" : "done";
    const fileNames = changes.map((change: any) => basename(change.path ?? change.filePath ?? "文件")).join("、") || "文件";
    return (
      <ActionCard icon={<FileCode2 size={13} />} verb={editing ? "正在编辑" : "已编辑"} info={fileNames ? <code>{fileNames}</code> : undefined} status={status} statusText={<><b>+{stats.added}</b> <i>-{stats.deleted}</i></>}>
        {changes.length > 0 && changes.map((change: any, idx: number) => (
          <div key={idx} className="action-diff">
            <strong>{change.path ?? change.filePath ?? "文件"}</strong>
            <ProgressiveToolPayload itemId={`${item.id}-diff-${idx}`} text={String(change.diff ?? "")} active={turnActive} language="diff" />
          </div>
        ))}
      </ActionCard>
    );
  }
  if (item.type === "mcpToolCall" || item.type === "dynamicToolCall") {
    const title = item.type === "mcpToolCall" ? `${item.server} / ${item.tool}` : item.tool;
    const running = item.status === "inProgress" || item.status === "running";
    const failed = item.status === "failed" || item.status === "error";
    const status: ActionStatus = running ? "running" : failed ? "error" : "done";
    const label = itemStatusLabel(item.status);
    // ★ 技能归属（09-24 用户：「使用了技能类似没看见」）：`desktop_screenshot` / `markitdown`
    //   这类调用原本只显示成「调用 nuphus/desktop_screenshot」，看不出在用技能、更看不出用哪个。
    //   命中技能 ⇒ 动词改「正在使用技能 / 已使用技能」+ 显示**中文技能名**（工具原名仍在展开里）。
    //   ⚠️ 来源要分清（09-24 用户：「技能，插件，mcp 等等都要展示出来怎么用了」）：
    //     mcpToolCall = MCP 服务器；dynamicToolCall = 插件注册的**动态工具**；
    //     命中技能特征（desktop_* / markitdown …）的一律按**技能**算（技能优先于来源）。
    const skill = skillOfItem(item);
    const isMcp = item.type === "mcpToolCall";
    const source = skill ? "技能" : isMcp ? "MCP" : "插件";
    const how = argSummary(item.arguments);
    // 插件包名：命令/工具里出现 `plugins/cache/<vendor>/<plugin>/…` 或 `connectors-marketplace/<x>/…`
    // ⇒ 连"来自哪个插件"一起显示（09-24：技能目录同理，见 skillOfItem 的路径兜底）。
    const plugin = skill ? null : pluginOfItem(item);
    const verb = skill
      ? running ? "正在使用技能" : "已使用技能"
      : running ? `正在调用${source}` : `已调用${source}`;
    // 团队成员调度卡：点亮该成员的渐变头像替代通用扳手图标（查模块级注册表，见 entity-avatar.ts）
    const invokedMember = item.tool === "team_member_invoke"
      ? resolveTeamMember(String(turn?.id ?? ""), String((item.arguments as any)?.memberId ?? ""))
      : null;
    return (
      <ActionCard
        icon={invokedMember
          ? <span className={`tool-member-avatar ${running ? "running" : ""}`} style={{ background: AVATAR_GRADIENTS[avatarToneOf(invokedMember.id || invokedMember.name)] }} aria-hidden="true">{invokedMember.label.slice(0, 1)}</span>
          : <Wrench size={13} />}
        verb={invokedMember ? (running ? `正在咨询 ${invokedMember.label}` : `咨询 ${invokedMember.label}`) : verb}
        /* 名字 + 「怎么用的」（入参里最能说明这次在干什么的那个值，如 url / 路径 / 查询词） */
        info={<><code>{skill ? skill.label : title}</code>{plugin ? <code className="action-plugin">（插件 {plugin.plugin}）</code> : null}{how ? <span className="action-arg" title={how}> · {how}</span> : null}</>} status={status} statusText={running ? undefined : formatDuration(item.durationMs) || label}>
        <ProgressiveToolPayload itemId={`${item.id}-payload`} text={String(item.progress || JSON.stringify(item.result ?? item.arguments ?? item.contentItems, null, 2) || "")} active={turnActive} />
      </ActionCard>
    );
  }
  if (item.type === "plan") {
    // 计划是**可编辑构件**（09-21 用户点名）：条目可勾选/改字/增删，改完「交给 Codex」把它作为
    // 一条用户消息发回。⛔ 语义是「用户改了计划 → 让模型按新的执行」，**不是**"直接改引擎里的计划"
    // （计划的权威状态在模型侧，我们传不进去）—— 编造"已同步"的假象比不做更糟。
    return (
      <ActionCard icon={<BookOpen size={13} />} verb="计划" status="done" defaultExpanded>
        <PlanEditor itemId={String(item.id)} text={String(item.text ?? "")} onSubmit={(markdown) => onApplyPlan?.(markdown)} />
      </ActionCard>
    );
  }
  if (item.type === "webSearch") {
    return (
      <ActionCard icon={<Search size={13} />} verb="网页搜索" info={item.query ? <code>{item.query}</code> : undefined} status="done" statusText={item.status ?? "完成"} />
    );
  }
  if (item.type === "collabAgentToolCall" || item.type === "subAgentActivity") {
    const title = item.type === "collabAgentToolCall" ? item.tool : item.kind;
    return (
      <ActionCard icon={<Bot size={13} />} verb={item.type === "collabAgentToolCall" ? "协作代理" : "子代理"} info={title ? <code>{title}</code> : undefined} status="done" statusText={item.status ?? item.agentPath ?? ""} />
    );
  }
  if (item.type === "imageView") return <div className="message"><div className="avatar agent"><ImagePlus size={15} /></div><div className="message-body"><ImagePreview path={item.path} alt="Codex 查看图片" onCopy={() => onImageCopy?.(item.path)} /></div></div>;
  if (item.type === "imageGeneration") return <div className="message"><div className="avatar agent"><ImagePlus size={15} /></div><div className="message-body">{item.savedPath || item.result ? <ImagePreview path={item.savedPath || item.result} alt="生成图片" onCopy={() => onImageCopy?.(item.savedPath || item.result)} /> : <p>{item.failure?.message ?? item.status}</p>}</div></div>;
  if (item.type === "sleep") {
    return <ActionCard icon={<Clock3 size={13} />} verb="等待" status={item.status === "inProgress" ? "running" : "done"} statusText={item.status ?? "进行中"} />;
  }
  if (item.type === "enteredReviewMode" || item.type === "exitedReviewMode") {
    return <ActionCard icon={<Search size={13} />} verb={item.type === "enteredReviewMode" ? "开始代码审查" : "完成代码审查"} info={item.review ? <code>{item.review}</code> : undefined} status="done" />;
  }
  if (item.type === "hookPrompt") {
    return <ActionCard icon={<Wrench size={13} />} verb="Hook" status="done" statusText="完成" />;
  }
  if (isCompactionItem(item)) {
    // 压缩结果常驻为「两边虚线 + 中间文字」分隔线（与压缩进行中的过渡态同一形态），
    // 不再渲染「上下文压缩 · 完成」工具卡——那张卡用户明确不要。
    // 进行中的压缩必须渲染成转圈「正在压缩上下文」：此前 inProgress 也走成功分支，
    // 时间线里先冒出一条假「上下文压缩成功」，下面又挂着「正在压缩上下文」，自相矛盾（用户实测）。
    const failed = item.status === "error" || Boolean(item.failure?.message);
    const running = !failed && (item.status === "inProgress" || item.status === "running");
    if (running) return (
      <div className="compact-divider compact-divider--running" role="status" aria-label="上下文压缩状态">
        <i className="compact-divider-line" aria-hidden />
        <span className="compact-divider-text"><LoaderCircle size={13} className="spin" />正在压缩上下文</span>
        <i className="compact-divider-line" aria-hidden />
      </div>
    );
    return (
      <div className={`compact-divider ${failed ? "compact-divider--error" : "compact-divider--success"}`} role="status" aria-label="上下文压缩状态">
        <i className="compact-divider-line" aria-hidden />
        <span className="compact-divider-text">
          {failed ? <CircleX size={13} /> : <CircleCheck size={13} />}
          {failed ? `上下文压缩失败：${item.failure?.message ?? "请稍后重试"}` : "上下文压缩成功"}
        </span>
        <i className="compact-divider-line" aria-hidden />
      </div>
    );
  }
  return (
    <ActionCard icon={<Wrench size={13} />} verb={item.type} status="done">
      <pre>{JSON.stringify(item, null, 2)}</pre>
    </ActionCard>
  );
}

function payloadLanguage(text: string): string {
  const value = text.trim();
  if ((value.startsWith("{") && value.endsWith("}")) || (value.startsWith("[") && value.endsWith("]"))) return "json";
  return "text";
}

export function ProgressiveAgentBody({ itemId, text, active, footer, onOpenFile }: { itemId: string; text: string; active?: boolean; footer?: React.ReactNode; onOpenFile?: (path: string) => void }) {
  const { displayed, revealing } = usePacketRevealText(itemId, text, Boolean(active), bufferedAgentRevealStarts, 24);
  return <div className={`message-body markdown ${revealing ? "packet-revealing" : ""}`}><Markdown>{displayed}</Markdown>{!revealing ? <InlineFileCards text={text} onOpenFile={onOpenFile} /> : null}{!revealing ? footer : null}</div>;
}

export function ProgressiveToolPayload({ itemId, text, active, className, language }: { itemId: string; text: string; active?: boolean; className?: string; language?: string }) {
  const { displayed, revealing } = usePacketRevealText(itemId, text, Boolean(active), bufferedToolRevealStarts, 48);
  return <ToolCodeBlock language={language ?? payloadLanguage(text)} text={displayed} revealing={revealing} className={className} />;
}
