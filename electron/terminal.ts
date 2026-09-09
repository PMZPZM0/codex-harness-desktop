// Integrated terminal backend. Default: piped PowerShell with local line-editing/echo —
// reliable in this environment. CODEX_HARNESS_PTY=1 opts into ConPTY via @lydell/node-pty
// (full colors/interactive, but pty input pipe proved flaky here).
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { augmentedPath, bundledPwsh } from "./toolchain";

let ptyModule: any = null;
if (process.env.CODEX_HARNESS_PTY === "1") {
  try {
    ptyModule = require("@lydell/node-pty");
  } catch {
    ptyModule = null;
  }
}

function findFile(candidates: string[], name: string) {
  for (const dir of candidates) {
    const full = `${dir}\\${name}`;
    try { if (fs.existsSync(full)) return full; } catch { /* skip */ }
  }
  return name;
}

const pathDirs = augmentedPath().split(";");
const pwshPath = findFile(pathDirs, "pwsh.exe");

export class TerminalService {
  private proc: any = null;
  private mode: "pty" | "pipe" | "none" = "none";
  private cwd = "";
  private handlers = new Set<(data: string) => void>();
  private lineBuf = "";
  private intentionalKill = false;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor() {
    console.log(`[terminal] backend mode: ${ptyModule ? "pty" : "pipe (reliable default; CODEX_HARNESS_PTY=1 for ConPTY)"}`);
  }

  private shell(pipeMode: boolean) {
    if (process.platform === "win32") {
      // 优先内置 pwsh（应用自带），其次 PATH 里的 pwsh，最后退回 powershell.exe(5.1)
      const bundled = bundledPwsh();
      const file = bundled || (pwshPath !== "pwsh.exe" ? pwshPath : "powershell.exe");
      return { file, args: ["-NoLogo", "-Command", "-"] };
    }
    const file = process.env.SHELL || "/bin/bash";
    return { file, args: ["-i"] };
  }

  private childEnv() {
    return { ...process.env, PATH: augmentedPath() } as Record<string, string>;
  }

  private emit(data: string) {
    for (const handler of this.handlers) handler(data);
  }

  private prompt() {
    this.emit(`PS ${this.cwd}> `);
  }

  // 命令输出停止 350ms 后补一个提示符，避免用户盲打
  private schedulePrompt() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.proc && this.mode === "pipe") this.prompt();
    }, 350);
  }

  /** 后台终端会话状态（/bashes 用）：进程是否存活 + 当前工作目录 */
  get alive() {
    return Boolean(this.proc);
  }
  get dir() {
    return this.cwd;
  }

  start(cwd: string) {
    if (this.proc) return;
    this.cwd = cwd || this.cwd || os.homedir();
    const { file, args } = this.shell(!ptyModule);
    if (ptyModule) {
      this.mode = "pty";
      this.proc = ptyModule.spawn(file, args, { name: "xterm-256color", cols: 80, rows: 24, cwd: this.cwd, env: this.childEnv() });
      this.proc.onData((data: string) => this.emit(data));
      this.proc.onExit(() => { this.proc = null; if (!this.intentionalKill) this.emit("\r\n[进程已退出]\r\n"); this.intentionalKill = false; });
    } else {
      // ponytail: pipe 模式无 TTY（无颜色/光标控制），但命令执行可靠；升级路径 = pty 输入管道修复
      this.mode = "pipe";
      this.proc = spawn(file, args, { cwd: this.cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true }) as ChildProcess;
      this.proc.stdout?.on("data", (chunk: Buffer) => { this.emit(chunk.toString()); this.schedulePrompt(); });
      this.proc.stderr?.on("data", (chunk: Buffer) => { this.emit(chunk.toString()); this.schedulePrompt(); });
      this.proc.on("exit", () => { this.proc = null; if (!this.intentionalKill) this.emit("\r\n[进程已退出]\r\n"); this.intentionalKill = false; });
      this.prompt();
    }
  }

  input(data: string) {
    if (!this.proc) this.start(this.cwd);
    if (this.mode === "pty") {
      this.proc?.write(data);
      return;
    }
    for (const ch of data) {
      if (ch === "\r" || ch === "\n") {
        const line = this.lineBuf;
        this.lineBuf = "";
        this.emit(`\r\n`);
        this.proc?.stdin?.write(line + "\n");
        this.schedulePrompt();
      } else if (ch === "\u007f" || ch === "\b") {
        if (this.lineBuf.length) {
          this.lineBuf = this.lineBuf.slice(0, -1);
          this.emit("\b \b");
        }
      } else if (ch >= " ") {
        this.lineBuf += ch;
        this.emit(ch);
      }
    }
  }

  resize(cols: number, rows: number) {
    try { this.proc?.resize?.(cols, rows); } catch { /* pipe 模式无 resize */ }
  }

  restart(cwd?: string) {
    this.kill();
    this.start(cwd || this.cwd);
  }

  onData(handler: (data: string) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  kill() {
    this.intentionalKill = true;
    try { this.proc?.kill(); } catch { /* already dead */ }
    this.proc = null;
  }
}
