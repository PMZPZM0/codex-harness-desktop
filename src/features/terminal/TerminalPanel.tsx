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
import { basename } from "../../lib/basename";
import { INTENT_VERB, commandAction, commandIntentOf, commandPurpose, commandTarget } from "../../lib/command-display.mjs";
import { skillOfItem, skillTargetLabel } from "../../lib/tool-display.mjs";

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
     命中技能时换成技能中文名（目标按上面的规则取舍）。
     ★ 10-22：**不再进折叠态表头**（用户：「折叠态后面不再显示地址与耗时」）——它连同耗时一起
       落到展开体的元信息行，想看清"这条到底动了哪儿"的仍然一眼能看到。 */
  const hint = skill ? skillTargetLabel(target) || skill.label : [purpose, target].filter(Boolean).join(" · ");
  /* ★ 动作短语（10-21，参照 WorkBuddy 的命令标题形态）：把「已运行 npm run check」升级成
     「跑全量检查」——看得出**这一步在干什么**，而不只是"在操作什么"。
     ⛔ 来源限制：引擎只给 `command` 字面（没有模型给的 description），所以是**模式识别**
        （`commandAction`，规则见 lib/command-display.mjs）；认不出时 `action` 为空 ⇒ 退回
        原来的 verb，绝不显示拼出来的假动作。
     ⛔ 状态仍由右侧图标表达（✓/!/○）：有 action 时不再在标题前加「已/正在」，
        与 WorkBuddy 同形；失败时保留「失败」后缀（红色卡片 + 图标之外再给一处明确文字）。 */
  const action = command ? commandAction(command) : "";
  /* ⛔ 两处**让位**（自查抓到的回归）：动作短语是"这句命令在干什么"，但有两种情况它的优先级更低——
     ① 命中技能（09-24 用户明确要求「工具板块要显示用了哪个技能」）：读 SKILL.md 也是一条命令，
        显示「跑脚本 xxx」会把「已使用技能 humanizer」盖掉 ⇒ 技能态必须优先；
     ② 等待批准：用户此刻要知道的是"在等我点"，不是"这条命令在干什么"。
     技能态下技能名仍跟在标题后面（`cmd-name`），信息不丢。 */
  const headline = action && !skill && !(waitingForApproval && running)
    ? (failed ? `${action}失败` : action)
    : "";
  const verb = waitingForApproval && running ? "等待批准"
    : skill ? (running ? "正在使用技能" : failed ? "使用技能失败" : "已使用技能")
      : running ? `正在${intentVerb}` : failed ? `${intentVerb}失败` : `已${intentVerb}`;
  const status: ActionStatus = running ? (waitingForApproval ? "pending" : "running") : failed ? "error" : "done";
  const emptySuccess = !running && !failed && output === "";
  const shell = commandCodeLanguage(command);
  /* 耗时只进展开体（10-22 用户点名）——`formatDuration` 返回中文口径（"9.1 秒"） */
  const duration = formatDuration(item.durationMs);
  /* 折叠行的短目标（10-22 用户：「读取/编辑这类精确到文件，不要再地址」）：
     `commandTarget` 给的是路径 ⇒ 只取最后一段；完整路径留在展开体的元信息行里。 */
  const targetName = target ? basename(target) : "";
  const codeText = [
    command,
    terminalInput ? `$ ${terminalInput}` : "",
    displayedOutput || (running ? "等待输出…" : ""),
  ].filter(Boolean).join("\n\n");
  return (
    /* ★ 10-22 用户要求（附 WorkBuddy 截图）：**折叠态只留一句中文**，命令原文 / 地址 / 耗时全部
       收进展开体。原因是命令字面自带一长串绝对路径，扫时间线时看不出"这一步在干什么"。
       ⛔ 原文一个字都不删：展开体里仍是引擎原样的 `command`（用户要能照着复现）。 */
    <div className={`cmd-card ${status} ${open ? "open" : ""}`}>
      <button type="button" className="cmd-head" onClick={toggle} aria-expanded={open} title={command || undefined}>
        <span className="cmd-icon"><TerminalSquare size={14} /></span>
        <span className="cmd-verb">{headline || verb}</span>
        {targetName ? <span className="cmd-target" title={target}>{targetName}</span> : null}
        {/* 技能名（09-24 用户点名「看得出用了哪个技能」）：是专有名词、不是命令内容，留在折叠行 */}
        {skill?.label ? <span className="cmd-name">{skill.label}</span> : null}
        <span className="cmd-status"><CardStatusIcon status={status} /></span>
        {/* 明确的展开标识：文案 + 箭头一起变（只有一个小箭头不够明确 —— 用户 10-22 点名） */}
        {/* ★ 10-22 用户：「『展开』字样不要，鼠标放上去再浮出箭头，移开就隐藏」。
           ⛔ 不要再写回「展开/收起」文案；状态由 aria-expanded + 箭头方向表达。 */}
        <span className="cmd-toggle" aria-hidden="true">
          <ChevronDown size={13} className="cmd-chevron" />
        </span>
      </button>
      <Fold open={open}>
        <div className="cmd-content" ref={contentRef}>
          {waitingForApproval && running && <div className="cmd-approval"><ShieldCheck size={13} />需要批准才能继续</div>}
          <div className="cmd-title">
            <span className="cmd-title-shell">{shell.label}</span>
            {hint ? <span className="cmd-title-hint" title={hint}>{hint}</span> : null}
            {duration ? <span className="cmd-duration">{duration}</span> : null}
          </div>
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
