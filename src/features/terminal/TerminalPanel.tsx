/** 命令执行 / 终端面板（从 src/App.tsx 原样搬来，内容未改）。域公开面见 ./index.ts */
import { ThreadItem } from "../../lib/thread-item";
import { useCardOpen, CardStatusIcon } from "../../components/CardShell";
import type { ActionStatus } from "../../components/CardShell";
import { useMemo, useRef, useEffect, useState } from "react";
import { TerminalSquare, ChevronDown, ShieldCheck, CircleCheck } from "lucide-react";
import { truncateTailLines } from "../../lib/truncate-tail-lines";
import { usePacketRevealText } from "../shared/use-packet-reveal-text";
import { bufferedToolRevealStarts } from "../../lib/buffered-tool-reveal-starts";
import { Fold } from "../shared/Fold";
import { ToolCodeBlock } from "../shared/ToolCodeBlock";
import { formatDuration } from "../../lib/format-duration";
import { itemStatusLabel } from "../../lib/item-status-label";
import { INTENT_VERB, commandIntentOf, commandPurpose, commandTarget, displayCommand } from "../../lib/command-display.mjs";
import { skillOfItem, skillTargetLabel } from "../../lib/tool-display.mjs";

function durationLabel(status: unknown, durationMs: unknown) {
  const duration = formatDuration(durationMs);
  return duration ? `${itemStatusLabel(status)} · ${duration}` : itemStatusLabel(status);
}

function commandCodeLanguage(command: string): { language: string; label: string } {
  if (/\b(?:powershell|pwsh)(?:\.exe)?\b/i.test(command)) return { language: "powershell", label: "PowerShell" };
  if (/^\s*(?:cmd(?:\.exe)?\s+\/c|call\s+)/i.test(command)) return { language: "batch", label: "Command Prompt" };
  return { language: "bash", label: "Shell" };
}

export function CommandExecutionCard({ item, waitingForApproval, turnActive }: { item: ThreadItem; waitingForApproval?: boolean; turnActive?: boolean }) {
  const running = item.status === "inProgress" || item.status === "running";
  const failed = !running && item.exitCode != null && item.exitCode !== 0;
  const command = String(item.command ?? "").trim();
  const output = String(item.aggregatedOutput ?? "").trim();
  const terminalInput = String(item.terminalInput ?? "").trim();
  // 命令输出默认收起。运行过程优先展示模型的文字说明和思考，代码/终端输出由用户按需展开；
  // 否则长输出会占满视口，让用户误以为运行时“只有代码、没有文字过程”。
  const { open, toggle } = useCardOpen(false);
  const { text: tailOutput, omittedLines } = useMemo(() => truncateTailLines(output, 500), [output]);
  const { displayed: displayedOutput, revealing: outputRevealing } = usePacketRevealText(String(item.id), tailOutput, Boolean(turnActive), bufferedToolRevealStarts, 48);
  const contentRef = useRef<HTMLDivElement | null>(null);
  // 流式输出时贴底滚动（对齐 ReasoningCard 的 rAF 合帧方案）
  // ⚠️ 必须有「用户接管」守卫（09-13 审计）：原来无条件贴底，用户往上翻看这段长输出时，
  // 下一个 delta 就把他拽回底部 —— 和主时间线当初那个 bug 同类。判据用经典口径：
  // **只有本来就在底部附近才继续跟**（用户滚上去就不再动他的视口），不需要额外监听输入。
  useEffect(() => {
    if (!running && !outputRevealing) return;
    const el = contentRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 40) return;   // 用户已上滚：不抢
    const raf = requestAnimationFrame(() => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight > 40) return; // 帧内二次确认
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [displayedOutput, running, outputRevealing]);
  /* ★ 真实状态映射（09-24 用户附截图：「这个还是显示已运行没有显示具体的真实映射」）：
     表头原本只有「已运行 + 一段脚本原文」，看不出这条命令在干什么。现在：
       · 动词按**命令意图**走（查看/定位/编辑/运行 × 正在/已/失败）—— 与折叠芯片同一套
         `commandIntentOf`（策略纯函数，守卫【127】）；
       · 后面优先显示**文件目标**，没有目标就显示从脚本输出标签提炼的**用途**（commandPurpose，
         如 `"=== 结构 ==="` → 「结构」），再没有才退回剥壳截断的命令原文。
     ⛔ 展开里的完整命令仍是引擎原文（用户要照着复现），只动表头这一行。 */
  // ★ 技能优先于命令意图（09-24 用户：「工具板块不显示使用了那个技能」+ 真回合实测）：
  //   模型"用技能"最常见的动作就是一条命令 —— **读 SKILL.md**（真机抓到的是
  //   `Get-Content -LiteralPath '…/skills/humanizer/SKILL.md'`）。以前这里只按命令意图
  //   显示「已查看 …/skills/humanizer/SKILL.md」，看不出那是**在用技能**。
  //   ⛔ Console: 与折叠芯片同一个真相源 `skillOfItem` / `skillTargetLabel`（守卫【127】）。
  const skill = command ? skillOfItem({ type: "commandExecution", command }) : null;
  const intent = commandIntentOf(command);
  const intentVerb = INTENT_VERB[intent] ?? "运行";
  const target = command ? commandTarget(command) : "";
  const purpose = command ? commandPurpose(command) : "";
  /* 表头映射串 = 用途 · 目标（有哪个用哪个）：
     「已查看 结构 · …/.codex-harness」「已定位 pin-shrink-follow」「已运行 npm run build」
     命中技能时换成技能中文名（目标按上面的规则取舍）。 */
  const hint = skill ? skillTargetLabel(target) || skill.label : [purpose, target].filter(Boolean).join(" · ");
  const verb = waitingForApproval && running ? "等待批准"
    : skill ? (running ? "正在使用技能" : failed ? "使用技能失败" : "已使用技能")
      : running ? `正在${intentVerb}` : failed ? `${intentVerb}失败` : `已${intentVerb}`;
  const status: ActionStatus = running ? (waitingForApproval ? "pending" : "running") : failed ? "error" : "done";
  const emptySuccess = !running && !failed && output === "";
  const shell = commandCodeLanguage(command);
  const codeText = [
    command,
    terminalInput ? `$ ${terminalInput}` : "",
    displayedOutput || (running ? "等待输出…" : ""),
  ].filter(Boolean).join("\n\n");
  return (
    <div className={`cmd-card ${status} ${open ? "open" : "closed"}`}>
      <button type="button" className="cmd-head" onClick={toggle}>
        <span className="cmd-icon"><TerminalSquare size={14} /></span>
        <span className="cmd-verb">{verb}</span>
        {/* ⛔ 表头只显示**剥壳后**的命令（09-23 用户：「图一看着很变扭」）：
            引擎给的 `item.command` 是宿主包过 shell 启动器的形态，真机原样是
              "D:\…\resources\tools\pwsh\pwsh.exe" -Command "Get-Content -Lit…"
            ——每行都以同一段 ~90 字符绝对路径开头，真正要看的东西被挤没了。
            展开里的完整命令仍用引擎原文 `command`（用户要能照着复现），只有这一行是展示形态。
            ★ 09-24：优先显示真实映射（用途 · 目标 → 截断命令），见上方 intent/target/purpose/hint。 */}
        <span className={`cmd-command ${running ? "loading" : ""}`}>{hint || displayCommand(command) || "命令"}</span>
        <span className="cmd-status">
          <CardStatusIcon status={status} />
          {!running && <span className="cmd-duration">{durationLabel(item.status, item.durationMs)}</span>}
        </span>
        <ChevronDown size={13} className="cmd-chevron" />
      </button>
      <Fold open={open}>
        <div className="cmd-content" ref={contentRef}>
          {waitingForApproval && running && <div className="cmd-approval"><ShieldCheck size={13} />需要批准才能继续</div>}
          <div className="cmd-title">{shell.label}</div>
          <div className="cmd-output">
            {emptySuccess ? (
              <span className="cmd-output-success"><CircleCheck size={14} />运行成功</span>
            ) : (
              <>
                {omittedLines > 0 && <span className="cmd-output-truncated">⋯ 已省略前 {omittedLines} 行</span>}
                <ToolCodeBlock language={shell.language} text={codeText} revealing={outputRevealing} className="" maxHeight={230} />
              </>
            )}
          </div>
          {failed && <div className="cmd-exit">退出码 {item.exitCode}</div>}
        </div>
      </Fold>
    </div>
  );
}

export function TerminalPanel({ id, workspace, active }: { id: string; workspace: string; active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<any>(null);
  const [failed, setFailed] = useState(false);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    let disposed = false;
    let disposeTerm: (() => void) | null = null;
    void (async () => {
      try {
        const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
        if (disposed || !hostRef.current) return;
        const term = new Terminal({ fontSize: 12, cursorBlink: true, theme: { background: "#161615", foreground: "#e8e8e5", selectionBackground: "#45454188" } });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(hostRef.current);
        try { fit.fit(); } catch { /* host not laid out yet */ }
        fitRef.current = fit;
        const offData = window.codex.onTerminalData((terminalId, data) => { if (terminalId === id) term.write(data); });
        term.onData((data) => void window.codex.terminalInput(id, data));
        term.onResize(({ cols, rows }) => void window.codex.terminalResize(id, cols, rows));
        const onWindowResize = () => { try { fit.fit(); } catch { /* hidden */ } };
        window.addEventListener("resize", onWindowResize);
        disposeTerm = () => { offData(); window.removeEventListener("resize", onWindowResize); term.dispose(); };
        setStarted(true);
      } catch {
        setFailed(true);
      }
    })();
    return () => { disposed = true; disposeTerm?.(); };
  }, [id]);
  useEffect(() => {
    if (!started) return;
    void window.codex.restartTerminal(id, workspace || undefined);
  }, [started, id, workspace]);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => { try { fitRef.current?.fit(); } catch { /* hidden */ } }, 60);
    return () => clearTimeout(timer);
  }, [active]);
  return (
    <section className="terminal-section">
      <div className="terminal-host" ref={hostRef} />
      {failed && <div className="panel-loading">终端组件加载失败</div>}
    </section>
  );
}
