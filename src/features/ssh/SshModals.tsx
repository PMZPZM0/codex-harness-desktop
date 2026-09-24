/**
 * SSH / 远程执行域（从 src/App.tsx 原样搬来，纯搬迁零行为改动）。
 *
 * 公开面见同目录 index.ts。
 */

import { Spinner } from "../../components/CardShell";
import { X, TerminalSquare, Play } from "lucide-react";
import { hk } from "../../lib/hk";
import { useRef, useState, useEffect } from "react";

export function SshTerminalModal({ server, onClose }: { server: SshServer; onClose: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<string | null>(null);
  const fitRef = useRef<any>(null);
  const [status, setStatus] = useState<"connecting" | "online" | "closed" | "error">("connecting");
  const [message, setMessage] = useState("");

  // Esc 关闭：xterm 会吞掉按键，所以在 window 上监听
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;
    void (async () => {
      try {
        const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
        if (disposed || !hostRef.current) return;
        const term = new Terminal({
          fontSize: 12.5,
          cursorBlink: true,
          convertEol: true,
          scrollback: 5000,
          theme: { background: "#141414", foreground: "#e8e8e5", cursor: "#7cabf8", selectionBackground: "#3a3a3888" },
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(hostRef.current);
        try { fit.fit(); } catch { /* 容器还没布局完 */ }
        fitRef.current = fit;

        const offData = window.codex.onSshData((payload) => term.write(payload.data ?? ""));
        const offExit = window.codex.onSshExit(() => {
          if (disposed) return;
          setStatus("closed");
          term.write("\r\n\x1b[90m[会话已断开，按 Esc 或点关闭退出]\x1b[0m\r\n");
        });
        const dataSubscription = term.onData((data) => { if (sessionRef.current) void window.codex.sshSessionWrite(sessionRef.current, data); });
        const resizeSubscription = term.onResize(({ cols, rows }) => { if (sessionRef.current) void window.codex.sshSessionResize(sessionRef.current, cols, rows); });
        const onWindowResize = () => { try { fitRef.current?.fit(); } catch { /* ignore */ } };
        window.addEventListener("resize", onWindowResize);
        cleanup = () => {
          offData();
          offExit();
          dataSubscription.dispose();
          resizeSubscription.dispose();
          window.removeEventListener("resize", onWindowResize);
          if (sessionRef.current) void window.codex.sshSessionClose(sessionRef.current);
          term.dispose();
        };

        const opened = await window.codex.sshSessionOpen(server, term.cols || 100, term.rows || 30);
        if (disposed) return;
        if ("error" in opened) {
          setStatus("error");
          setMessage(opened.error);
          term.write(`\x1b[31m连接失败：${opened.error}\x1b[0m\r\n`);
          return;
        }
        sessionRef.current = opened.sessionId;
        setStatus("online");
        term.focus();
        try { fit.fit(); } catch { /* ignore */ }
      } catch {
        if (!disposed) { setStatus("error"); setMessage("终端组件加载失败"); }
      }
    })();
    return () => { disposed = true; cleanup?.(); };
  }, [server.id]);

  useEffect(() => {
    const timer = setTimeout(() => { try { fitRef.current?.fit(); } catch { /* ignore */ } }, 80);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="modal-backdrop ssh-terminal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="ssh-terminal-modal" role="dialog" aria-modal="true" aria-label={`${server.name} 终端`}>
        <header>
          <div className="ssh-terminal-title">
            <span className={`ssh-status-dot ${status === "online" ? "ok" : status === "error" ? "fail" : "testing"}`} />
            <strong>{server.name}</strong>
            <code>{server.username}@{server.host}{server.port !== 22 ? `:${server.port}` : ""}</code>
            {server.jumpHost?.host ? <span className="ssh-tag">跳板：{server.jumpHost.host}</span> : null}
          </div>
          <div className="ssh-terminal-state">
            {status === "connecting" && <><Spinner /><span>正在建立 SSH 会话…</span></>}
            {status === "online" && <span className="ssh-terminal-online">已连接</span>}
            {status === "closed" && <span>会话已断开</span>}
            {status === "error" && <span className="ssh-terminal-error">{message || "连接失败"}</span>}
            <button className="icon-button" title="关闭终端（Esc）" onClick={onClose}><X size={16} /></button>
          </div>
        </header>
        <div className="ssh-terminal-host" ref={hostRef} />
        <footer>
          <span>会话仅限本机使用；关闭终端即断开 SSH 连接。</span>
          <button className="secondary-setting" onClick={onClose}>关闭</button>
        </footer>
      </section>
    </div>
  );
}

/** 远程命令执行：一次性 exec，展示 stdout/stderr/退出码/耗时 */
export function SshExecModal({ server, onClose }: { server: SshServer; onClose: () => void }) {
  const [command, setCommand] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SshExecResult | null>(null);
  const run = async () => {
    if (!command.trim() || running) return;
    setRunning(true);
    setResult(null);
    try {
      setResult(await window.codex.execSshCommand(server, command));
    } catch (error: any) {
      setResult({ ok: false, error: error.message });
    } finally { setRunning(false); }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="connector-setup-modal ssh-exec-modal" role="dialog" aria-modal="true" aria-label={`在 ${server.name} 上运行命令`}>
        <header>
          <div className="connector-setup-title">
            <span><TerminalSquare size={17} /></span>
            <div><strong>在「{server.name}」上运行命令</strong><p>{server.username}@{server.host}{server.port !== 22 ? `:${server.port}` : ""} · 一次性执行，超时 30 秒</p></div>
          </div>
          <button className="icon-button relay-modal-close" title="关闭" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="connector-form">
          <label><span>命令 <small>{hk("Ctrl+Enter")} 运行</small></span>
            <textarea rows={3} value={command} spellCheck={false} placeholder="例如：uname -a && df -h" onChange={(event) => setCommand(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void run(); } }} />
          </label>
          {result && <div className={`ssh-exec-result ${result.ok ? "ok" : "fail"}`}>
            <div className="ssh-exec-meta">
              <span>退出码 {result.code ?? "-"}</span><span>耗时 {result.latencyMs ?? "-"}ms</span>
              {result.error ? <span className="ssh-exec-error">{result.error}</span> : null}
            </div>
            {result.stdout ? <pre>{result.stdout}</pre> : null}
            {result.stderr ? <pre className="ssh-exec-stderr">{result.stderr}</pre> : null}
          </div>}
        </div>
        <footer>
          <button className="secondary-setting" onClick={onClose}>关闭</button>
          <button className="primary-setting" disabled={!command.trim() || running} onClick={() => void run()}>{running ? <Spinner /> : <Play size={14} />}运行</button>
        </footer>
      </section>
    </div>
  );
}

