/**
 * RPA 键鼠录制/回放（Windows 原生层，11-13）。
 *
 * 读取：`resources/rpa/record.ps1` 用 Windows PowerShell 轮询键盘/鼠标，写 NDJSON；
 * 回放：`resources/rpa/play.ps1` 按录制的动作重放（坐标按录制分辨率等比缩放）。
 * ⛔ 只支持 Windows（系统自带 PowerShell 5.1），mac 明确返回不支持；不做静默降级。
 * ⛔ 录制内容可能包含密码——只落本机 userData，主进程日志只记数量/时长，不打印事件正文。
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, globalShortcut } from "electron";
import { existingToolPath } from "./toolchain";
import { rpaStore } from "./runtime-refs";
import type { RpaRecipe } from "./rpa-store";
import { convertRecording, type RpaRecordedDraft } from "./rpa-convert";

type RecorderState = {
  supported: boolean;
  recording: boolean;
  playing: boolean;
  recipeId: string;
  startedAt: number;
  hotkeys: { record: string; play: string };
  hotkeyReady: { record: boolean; play: boolean };
  draft: RpaRecordedDraft | null;
};

const HOTKEY_RECORD = "CommandOrControl+Alt+F9";
const HOTKEY_PLAY = "CommandOrControl+Alt+F10";
const HOTKEY_LABELS = { record: "Ctrl+Alt+F9", play: "Ctrl+Alt+F10" };

let notify: (payload: Record<string, unknown>) => void = () => {};
let recordProc: ChildProcess | null = null;
let recordWin: BrowserWindow | null = null;
let recordOut = "";
let recordStop = "";
let recordStartedAt = 0;
let recordStopping = false;
let recordHotkeyReady = false;
let lastDraft: RpaRecordedDraft | null = null;

let playProc: ChildProcess | null = null;
let playWin: BrowserWindow | null = null;
let playInput = "";
let playStop = "";
let playRecipeId = "";
let playHotkeyReady = false;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 注入事件广播（rpa-ipc 的 setup 里接 window-bus，避免基础层反向依赖域）。 */
export function setRpaRecorderNotifier(fn: (payload: Record<string, unknown>) => void) {
  notify = typeof fn === "function" ? fn : () => {};
}

function powershellPath(): string {
  if (process.platform !== "win32") return "";
  const root = process.env.SystemRoot || "C:\\Windows";
  const exe = path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  try { return fs.existsSync(exe) ? exe : ""; } catch { return ""; }
}

function scriptPath(name: string): string {
  const bundled = existingToolPath("rpa", name);
  if (bundled) return bundled;
  return path.join(app.getAppPath(), "resources", "rpa", name);
}

function scriptsReady(): boolean {
  try {
    return fs.existsSync(scriptPath("record.ps1")) && fs.existsSync(scriptPath("play.ps1"));
  } catch {
    return false;
  }
}

/** 当前平台能不能真录制：Windows + 系统 PowerShell + 两个脚本都在。 */
export function rpaRecorderSupported(): boolean {
  return process.platform === "win32" && Boolean(powershellPath()) && scriptsReady();
}

function recordingsDir(): string {
  const dir = path.join(app.getPath("userData"), "rpa-recordings");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function restoreWindow(win: BrowserWindow | null) {
  if (!win || win.isDestroyed()) return;
  try {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  } catch { /* 窗口已关就不管 */ }
}

async function waitForMeta(file: string, proc: ChildProcess, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 0) return true;
    } catch { /* 文件还没落 */ }
    if (proc.exitCode !== null) return false;
    await delay(50);
  }
  return false;
}

async function waitForExit(proc: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (proc.exitCode !== null) return true;
  return await Promise.race([
    new Promise<boolean>((resolve) => proc.once("close", () => resolve(true))),
    delay(timeoutMs).then(() => false),
  ]);
}

/* ── 录制 ─────────────────────────────────────────────────────── */

/** 开始键鼠录制：最小化应用窗口 → 启动原生录制器 → 注册停止快捷键。 */
export async function startRpaRecording(win: BrowserWindow | null): Promise<{ ok: boolean; startedAt?: number; hotkeyReady?: boolean; error?: string }> {
  if (!rpaRecorderSupported()) return { ok: false, error: "键鼠录制仅支持 Windows（需要系统自带 PowerShell 与随包录制脚本）" };
  if (recordProc) return { ok: false, error: "已经在录制中" };
  if (playProc) return { ok: false, error: "正在回放别的配方，先停止回放" };
  const dir = recordingsDir();
  const stamp = Date.now();
  const out = path.join(dir, `record-${stamp}.ndjson`);
  const stop = path.join(dir, `record-${stamp}.stop`);
  try {
    fs.writeFileSync(out, "", "utf8");
    fs.rmSync(stop, { force: true });
  } catch (error) {
    return { ok: false, error: `创建录制文件失败：${(error as Error)?.message ?? error}` };
  }
  lastDraft = null;
  recordWin = win;
  if (win && !win.isDestroyed()) {
    try { win.minimize(); } catch { /* 已隐藏 */ }
    await delay(350);
  }
  const proc = spawn(powershellPath(), [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
    "-File", scriptPath("record.ps1"),
    "-OutFile", out,
    "-StopFile", stop,
    "-IntervalMs", "25",
  ], { windowsHide: true, stdio: "ignore" });
  const ready = await waitForMeta(out, proc, 4500);
  if (!ready) {
    try { proc.kill(); } catch { /* ignore */ }
    restoreWindow(recordWin);
    recordWin = null;
    fs.rmSync(out, { force: true });
    fs.rmSync(stop, { force: true });
    return { ok: false, error: "录制器没有启动：Windows PowerShell 可能被安全策略拦住，或随包脚本缺失" };
  }
  recordProc = proc;
  recordOut = out;
  recordStop = stop;
  recordStartedAt = Date.now();
  recordHotkeyReady = globalShortcut.register(HOTKEY_RECORD, () => { void stopRpaRecording(); });
  proc.once("close", () => {
    // 进程意外退出：下一次 stop/state 会发现没有录到内容，这里只做兜底清理
    if (recordProc === proc) recordProc = null;
  });
  notify({ type: "rpa-recorder", state: "recording", startedAt: recordStartedAt, hotkeyReady: recordHotkeyReady });
  return { ok: true, startedAt: recordStartedAt, hotkeyReady: recordHotkeyReady };
}

/** 停止录制并返回可直接保存的草稿（由回合/事件层决定是否保存）。 */
export async function stopRpaRecording(): Promise<{ ok: boolean; draft?: RpaRecordedDraft; error?: string }> {
  if (!recordProc) return { ok: false, error: "当前没有在录制" };
  if (recordStopping) return { ok: false, error: "正在停止录制，请稍候" };
  recordStopping = true;
  try {
    if (recordHotkeyReady) { globalShortcut.unregister(HOTKEY_RECORD); recordHotkeyReady = false; }
    try { fs.writeFileSync(recordStop, "stop", "utf8"); } catch { /* ignore */ }
    const exited = await waitForExit(recordProc, 2500);
    if (!exited) { try { recordProc.kill(); } catch { /* ignore */ } }
    recordProc = null;
    restoreWindow(recordWin);
    recordWin = null;
    const raw = fs.readFileSync(recordOut, "utf8");
    fs.rmSync(recordOut, { force: true });
    fs.rmSync(recordStop, { force: true });
    const draft = convertRecording(raw);
    if (!draft.ok) {
      lastDraft = null;
      notify({ type: "rpa-recorder", state: "stopped", ok: false, error: draft.error });
      return { ok: false, error: draft.error };
    }
    lastDraft = draft.draft;
    notify({ type: "rpa-recorder", state: "stopped", ok: true, eventCount: draft.draft.eventCount, durationMs: draft.draft.durationMs });
    return { ok: true, draft: draft.draft };
  } catch (error) {
    restoreWindow(recordWin);
    recordWin = null;
    recordProc = null;
    const message = (error as Error)?.message ?? String(error);
    notify({ type: "rpa-recorder", state: "stopped", ok: false, error: message });
    return { ok: false, error: `读取录制失败：${message}` };
  } finally {
    recordStopping = false;
  }
}

/** 丢弃最近一次录制草稿（用户取消命名时调用）。 */
export function discardRpaRecording() {
  lastDraft = null;
}

/** 当前录制/回放状态；draft 为最近一次停止后的未保存草稿。 */
export function rpaRecorderState(): RecorderState {
  return {
    supported: rpaRecorderSupported(),
    recording: Boolean(recordProc),
    playing: Boolean(playProc),
    recipeId: playRecipeId,
    startedAt: recordStartedAt,
    hotkeys: HOTKEY_LABELS,
    hotkeyReady: { record: recordHotkeyReady, play: playHotkeyReady },
    draft: lastDraft,
  };
}

/* ── 回放 ─────────────────────────────────────────────────────── */

/** 回放一条含录制动作的配方：最小化窗口 → 启动播放器 → 结束回写运行结果。 */
export async function startRpaPlayback(recipe: RpaRecipe, win: BrowserWindow | null): Promise<{ ok: boolean; error?: string }> {
  if (!rpaRecorderSupported()) return { ok: false, error: "原生回放仅支持 Windows" };
  if (recordProc) return { ok: false, error: "正在录制，不能同时回放" };
  if (playProc) return { ok: false, error: "已经在回放中" };
  const actions = Array.isArray(recipe.actions) ? recipe.actions : [];
  if (!actions.length) return { ok: false, error: "这条配方没有录制动作；文本配方请让 Codex 用 rpa_run 逐步复现" };
  const dir = recordingsDir();
  const stamp = Date.now();
  const input = path.join(dir, `play-${stamp}.json`);
  const stop = path.join(dir, `play-${stamp}.stop`);
  try {
    fs.writeFileSync(input, JSON.stringify({ actions, screen: recipe.screen ?? null }), "utf8");
    fs.rmSync(stop, { force: true });
  } catch (error) {
    return { ok: false, error: `创建回放文件失败：${(error as Error)?.message ?? error}` };
  }
  playWin = win;
  if (win && !win.isDestroyed()) {
    try { win.minimize(); } catch { /* ignore */ }
    await delay(350);
  }
  const proc = spawn(powershellPath(), [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
    "-File", scriptPath("play.ps1"),
    "-InputFile", input,
    "-StopFile", stop,
    "-RecipeWidth", String(Number(recipe.screen?.width) || 0),
    "-RecipeHeight", String(Number(recipe.screen?.height) || 0),
  ], { windowsHide: true, stdio: "ignore" });
  playProc = proc;
  playInput = input;
  playStop = stop;
  playRecipeId = recipe.id;
  playHotkeyReady = globalShortcut.register(HOTKEY_PLAY, () => { void stopRpaPlayback(); });
  notify({ type: "rpa-recorder", state: "playing", recipeId: recipe.id });
  let settled = false;
  const finish = (code: number | null, spawnError?: Error) => {
    if (settled) return;
    settled = true;
    const ok = !spawnError && code === 0;
    const stopped = !spawnError && code === 2;
    const error = ok ? "" : spawnError ? String(spawnError.message ?? spawnError) : stopped ? "用户停止回放" : `回放失败（退出码 ${code ?? "?"}）`;
    if (playHotkeyReady) { globalShortcut.unregister(HOTKEY_PLAY); playHotkeyReady = false; }
    restoreWindow(playWin);
    playWin = null;
    playProc = null;
    const id = playRecipeId;
    playRecipeId = "";
    try { fs.rmSync(playInput, { force: true }); } catch { /* ignore */ }
    try { fs.rmSync(playStop, { force: true }); } catch { /* ignore */ }
    if (id) void rpaStore.recordRun(id, ok, error || undefined).catch(() => undefined);
    notify({ type: "rpa-play-finished", id, ok, error });
    notify({ type: "rpa-recorder", state: "idle" });
  };
  proc.once("close", (code) => finish(code));
  proc.once("error", (error) => finish(null, error));
  return { ok: true };
}

/** 请求停止回放（快捷键/按钮）；播放器看到 stop 文件后退出。 */
export function stopRpaPlayback(): { ok: boolean } {
  if (!playProc) return { ok: true };
  try { fs.writeFileSync(playStop, "stop", "utf8"); } catch { /* ignore */ }
  if (playHotkeyReady) { globalShortcut.unregister(HOTKEY_PLAY); playHotkeyReady = false; }
  const proc = playProc;
  setTimeout(() => { if (playProc === proc) { try { proc.kill(); } catch { /* ignore */ } } }, 1500);
  return { ok: true };
}

/** 退出/卸载时清理：杀子进程、注销快捷键、删临时文件。 */
export function cleanupRpaRecorder() {
  try { if (recordHotkeyReady) globalShortcut.unregister(HOTKEY_RECORD); } catch { /* ignore */ }
  try { if (playHotkeyReady) globalShortcut.unregister(HOTKEY_PLAY); } catch { /* ignore */ }
  recordHotkeyReady = false;
  playHotkeyReady = false;
  try { recordProc?.kill(); } catch { /* ignore */ }
  try { playProc?.kill(); } catch { /* ignore */ }
  recordProc = null;
  playProc = null;
  for (const file of [recordOut, recordStop, playInput, playStop]) {
    if (file) { try { fs.rmSync(file, { force: true }); } catch { /* ignore */ } }
  }
  recordOut = "";
  recordStop = "";
  playInput = "";
  playStop = "";
}
