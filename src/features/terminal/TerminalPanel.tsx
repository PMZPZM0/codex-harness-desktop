/** 命令执行 / 终端面板（从 src/App.tsx 原样搬来，内容未改）。域公开面见 ./index.ts */
import { ThreadItem } from "../../lib/thread-item";
import { useCardOpen, CardStatusIcon } from "../../components/CardShell";
import type { ActionStatus } from "../../components/CardShell";
import { useMemo, useRef, useEffect, useState } from "react";
import { TerminalSquare, ChevronDown, ShieldCheck, CircleCheck, FileText, FileCode2, FolderTree, GitBranch, Search } from "lucide-react";
import { truncateTailLines } from "../../lib/truncate-tail-lines";
import { usePacketRevealText } from "../shared/use-packet-reveal-text";
import { bufferedToolRevealStarts } from "../../lib/buffered-tool-reveal-starts";
import { Fold } from "../shared/Fold";
import { ToolCodeBlock } from "../shared/ToolCodeBlock";
import { formatDuration } from "../../lib/format-duration";
import { basename } from "../../lib/basename";
import { INTENT_VERB, commandAction, commandIntentOf, commandPurpose, commandTarget, displayCommand } from "../../lib/command-display.mjs";

function commandCodeLanguage(command: string): { language: string; label: string } {
  if (/\b(?:powershell|pwsh)(?:\.exe)?\b/i.test(command)) return { language: "powershell", label: "PowerShell" };
  if (/^\s*(?:cmd(?:\.exe)?\s+\/c|call\s+)/i.test(command)) return { language: "batch", label: "Command Prompt" };
  return { language: "bash", label: "Shell" };
}

/** 命令卡左侧图标：按**这一步在干什么**分类。
 *  ⛔⛔ 10-29 用户实测截图：「这个图标全部一样了」—— 之前每条命令都挂 `SquareTerminal`，
 *    14px 下外框+内部符号糊在一起，读文件 / 建目录 / 看 git 配置 / 跑脚本 长得一模一样，
 *    扫时间线只能靠右侧的 ✓ 判断"做完了"，看不出做的是什么。
 *  判据与表头动作**同源**（`commandIntentOf`），另加两个轻量特判：
 *    · git —— 在意图表里会退化成 read（`git config --get` 命中 type/read）或 command，
 *      而"看 git 配置 / 改分支"跟"读文件 / 跑脚本"是两件事；
 *    · 列目录 —— `Get-ChildItem`/`dir`/`ls` 与"读文件内容"同属 read，但图标必须分开。
 *  ⛔ 状态不靠图标形状表达（running/done/failed 由 CSS 着色 + 右侧 CardStatusIcon 管）。 */
function iconOfCommand(command: string, intent: string) {
  if (/^\s*git\b|\bgit\s+(?:config|status|diff|log|show|branch|rev-parse|add|commit|checkout)\b/i.test(command)) return GitBranch;
  if (intent === "modify") return FileCode2;
  if (intent === "read") return /Get-ChildItem|\bdir\b|\bls\b|\bfind\s/i.test(command) ? FolderTree : FileText;
  if (intent === "search") return Search;
  return TerminalSquare;
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
  /* ⛔ 10-29：技能**不在这里**了 —— 命中技能的调用由 features/skill-usage 的技能卡渲染
     （用户原话：「为啥使用技能是运行命令呢…不要展示运行命令」）。命令卡只管真命令，
     表头动词永远按命令意图走；两边各管一种形态，不再互相让位。 */
  /* ⛔ 引擎的 `command` 常带 shell 启动器外壳（`pwsh.exe,-Command,…`），个别形态剥壳后会
     残留 `-Command,` 粘连，导致动作/用途识别错位 ⇒ 三者统一优先用 `parsed_cmd` 的**内层脚本**；
     展开体的原文仍用 `command`（复现用）。 */
  const parsed = (item as any).parsed_cmd;
  const innerCommand = Array.isArray(parsed) ? String(parsed[0]?.cmd ?? "") : "";
  const commandText = innerCommand || command;
  const intent = commandIntentOf(commandText);
  const intentVerb = INTENT_VERB[intent] ?? "运行";
  /* 图标按动作分类（读 / 改 / 找 / 目录 / git / 命令），⛔ 不再一律 TerminalSquare。 */
  const CmdIcon = iconOfCommand(commandText, intent);
  const target = commandText ? commandTarget(commandText) : "";
  const purpose = commandText ? commandPurpose(commandText) : "";
  /* 表头映射串 = 用途 · 目标（有哪个用哪个）：
     「已查看 结构 · …/.codex-harness」「已定位 pin-shrink-follow」「已运行 npm run build」
     ★ 10-22：**不再进折叠态表头**（用户：「折叠态后面不再显示地址与耗时」）——它连同耗时一起
       落到展开体的元信息行，想看清"这条到底动了哪儿"的仍然一眼能看到。 */
  const hint = [purpose, target].filter(Boolean).join(" · ");
  /* ★ 动作短语（10-21，参照 WorkBuddy 的命令标题形态）：把「已运行 npm run check」升级成
     「跑全量检查」——看得出**这一步在干什么**，而不只是"在操作什么"。
     ⛔ 来源限制：引擎只给 `command` 字面（没有模型给的 description），所以是**模式识别**
        （`commandAction`，规则见 lib/command-display.mjs）；认不出时 `action` 为空 ⇒ 退回
        原来的 verb，绝不显示拼出来的假动作。
     ⛔ 状态仍由右侧图标表达（✓/!/○）：有 action 时不再在标题前加「已/正在」，
        与 WorkBuddy 同形。
     ⛔ 10-29 用户令（实测截图）：**结束的命令行一律显示 ✓**，不显示 ×/「失败」——
        很多命令非零退出是正常探测（`git config --get user.name` 没配就 exit 1、
        非仓库里 `git status` 也非零），标成失败只会让人误以为出错。
        退出码仍留在展开体（`.cmd-exit`），真要看细节的人点开就有。 */
  const action = commandText ? commandAction(commandText) : "";
  /* 10-29 用户令：「已运行为啥后面不显示运行了啥命令，把命令映射成中文展示它是干嘛的」。
     表头优先级：动作短语（规则/通用子命令）→ 用途（脚本里的中文字面量）→ 「动词 + 剥壳命令原文」。
     ⛔ 都认不出时**一定**给命令原文（截断），不允许只剩一个「已运行」。
     ⛔ 等待批准时目标换成"在等我点"（同原让位逻辑）。 */
  const headlineText = action || purpose;
  /* ⛔⛔ 10-29 用户实测截图：「编辑文件 / 运行过程中 / 运行完成后那个都不见了」——
     原来动作短语一旦命中就**只剩「写文件」这种无状态的说法**，运行中和已完成长得一样，
     状态全靠右侧那枚 12px 的小图标。⇒ 运行时补「正在」前缀（动作短语本身是动词，读起来自然：
     「正在写文件」/「正在看 git 配置」）；完成时保持简洁（不加「已」，与 WorkBuddy 同形）。
     ⛔ 只给 action 加：`purpose`/原文兜底不是动词短语，拼「正在」会成了病句。 */
  const headline = headlineText && !(waitingForApproval && running)
    ? (running && action ? `正在${action}` : headlineText)
    : "";
  const commandSnippet = headline || !commandText ? "" : displayCommand(commandText, 46);
  const verb = waitingForApproval && running ? "等待批准"
    : running ? `正在${intentVerb}` : `已${intentVerb}`;
  const status: ActionStatus = running ? (waitingForApproval ? "pending" : "running") : "done";
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
        <span className="cmd-icon"><CmdIcon size={14} /></span>
        <span className="cmd-verb">{headline || verb}</span>
        {commandSnippet ? <span className="cmd-snippet" title={command}>{commandSnippet}</span> : null}
        {targetName ? <span className="cmd-target" title={target}>{targetName}</span> : null}
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
