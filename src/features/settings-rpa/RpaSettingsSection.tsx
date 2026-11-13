/**
 * 设置页 · rpa（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX 与原块逐字一致（仅去掉外层缩进）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Play, Trash2 } from "lucide-react";
import { basename } from "../../lib/basename";
import { trackRpaRun } from "../../lib/rpa-run-tracker.mjs";
import { ToggleSwitch } from "../../components/SettingsWidgets";

type RecorderDraft = {
  actions: unknown[];
  steps: string[];
  screen: { width: number; height: number };
  target: string;
  durationMs: number;
  eventCount: number;
  recordedAt: number;
  platform: "win32" | "darwin";
};

type RecorderState = {
  supported: boolean;
  recording: boolean;
  playing: boolean;
  recipeId: string;
  startedAt: number;
  hotkeys: { record: string; play: string };
  hotkeyReady: { record: boolean; play: boolean };
  draft: RecorderDraft | null;
};

export type RpaSettingsSectionProps = { rpaRecipes: any; rpaRunning: any; thread: any; setNotice: any; setRpaRunning: any; selectedModel: any; modelName: any; modelId: any; sandboxPolicy: any; sandbox: any; workspace: any; openAppConfirm: any; openAppPrompt: any; setRpaRecipes: any; taskList: any; setTaskList: any };

/** RPA 设置：配方列表、键鼠录制/回放、运行态与任务队列。 */
export function RpaSettingsSection(props: RpaSettingsSectionProps) {
  const { rpaRecipes, rpaRunning, thread, setNotice, setRpaRunning, selectedModel, modelName, modelId, sandboxPolicy, sandbox, workspace, openAppConfirm, openAppPrompt, setRpaRecipes, taskList, setTaskList } = props;
  const [recorder, setRecorder] = useState<RecorderState | null>(null);
  const [recorderBusy, setRecorderBusy] = useState(false);
  const handledDraftRef = useRef(0);

  const refreshRecorder = useCallback(async () => {
    const next = await window.codex.rpaRecorderState().catch(() => null);
    if (next) setRecorder(next as RecorderState);
  }, []);

  /* 打开 RPA 页时重拉一次：配方可能刚由模型（rpa_save）或别处写入，bag 里的列表只在启动时拉过。 */
  useEffect(() => { void window.codex.listRpaRecipes().then(setRpaRecipes).catch(() => undefined); }, [setRpaRecipes]);

  /* 录制状态由主进程广播（快捷键停止时页面可能还在最小化）—— 收到事件后重新拉状态。 */
  useEffect(() => {
    void refreshRecorder();
    const off = window.codex.onHarnessEvent((event: unknown) => {
      const evt = event as { type?: string; ok?: boolean; id?: string; error?: string };
      if (evt.type !== "rpa-recorder" && evt.type !== "rpa-play-finished") return;
      void refreshRecorder();
      if (evt.type === "rpa-play-finished") {
        void window.codex.listRpaRecipes().then(setRpaRecipes).catch(() => undefined);
        setNotice(evt.ok ? "RPA 回放完成" : `RPA 回放未完成：${evt.error ?? "未知原因"}`);
      }
    });
    return off;
  }, [refreshRecorder, setNotice, setRpaRecipes]);

  const saveDraft = useCallback(async (draft: RecorderDraft) => {
    if (!draft || !Array.isArray(draft.steps) || !draft.steps.length) return;
    if (typeof openAppPrompt !== "function") return;
    const suggested = `录制流程 ${new Date(draft.recordedAt).toLocaleString()}`;
    const name = await openAppPrompt("保存 RPA 录制", suggested).catch(() => null);
    if (!name || !String(name).trim()) {
      await window.codex.discardRpaRecording().catch(() => undefined);
      await refreshRecorder();
      return;
    }
    try {
      const saved = await window.codex.saveRpaRecipe({
        name: String(name).trim(),
        desc: `键鼠录制 · ${draft.eventCount} 个动作`,
        kind: "desktop",
        steps: draft.steps,
        target: draft.target,
        actions: draft.actions,
        screen: draft.screen,
        recordedOs: draft.platform,
        recordedAt: draft.recordedAt,
        durationMs: draft.durationMs,
      }) as { name?: string };
      await window.codex.discardRpaRecording().catch(() => undefined);
      const fresh = await window.codex.listRpaRecipes().catch(() => null);
      if (Array.isArray(fresh)) setRpaRecipes(fresh);
      await refreshRecorder();
      setNotice(`RPA 录制已保存：${saved?.name ?? String(name).trim()}（${draft.eventCount} 个动作）`);
    } catch (error: unknown) {
      setNotice("保存录制失败：" + ((error as { message?: string })?.message ?? String(error)));
    }
  }, [openAppPrompt, refreshRecorder, setNotice, setRpaRecipes]);

  /* 快捷键停止后：主进程留下草稿并广播；这里只提示一次（按 recordedAt 去重）。 */
  useEffect(() => {
    const draft = recorder?.draft;
    if (!draft || !Array.isArray(draft.steps) || !draft.steps.length) return;
    if (handledDraftRef.current === draft.recordedAt) return;
    handledDraftRef.current = draft.recordedAt;
    if (Date.now() - draft.recordedAt > 10 * 60_000) { void window.codex.discardRpaRecording(); return; }
    void saveDraft(draft);
  }, [recorder?.draft, saveDraft]);

  /** 开始录制：主进程会最小化应用，停止快捷键 Ctrl+Alt+F9。 */
  const startRecording = async () => {
    if (typeof openAppConfirm === "function") {
      const ok = await openAppConfirm(
        "开始键鼠录制",
        "录制期间会记录键盘和鼠标操作（可能包含密码/验证码），只保存在本机。请勿在录制时输入敏感信息。中文输入法可能无法逐字回放，滚轮暂不录制。停止快捷键：Ctrl+Alt+F9。",
        "开始录制",
      ).catch(() => false);
      if (!ok) return;
    }
    setRecorderBusy(true);
    try {
      const result = await window.codex.startRpaRecording();
      if (!result.ok) setNotice(result.error ?? "录制启动失败");
      else setNotice("录制中：去操作目标窗口，按 Ctrl+Alt+F9 停止");
      await refreshRecorder();
    } catch (error: unknown) {
      setNotice("录制启动失败：" + ((error as { message?: string })?.message ?? String(error)));
    } finally {
      setRecorderBusy(false);
    }
  };

  /** 停止录制并把草稿交给命名保存。 */
  const stopRecording = async () => {
    setRecorderBusy(true);
    try {
      const result = await window.codex.stopRpaRecording();
      if (!result.ok) setNotice(result.error ?? "停止录制失败");
      else if (result.draft) {
        handledDraftRef.current = result.draft.recordedAt;
        await saveDraft(result.draft as RecorderDraft);
      }
      await refreshRecorder();
    } catch (error: unknown) {
      setNotice("停止录制失败：" + ((error as { message?: string })?.message ?? String(error)));
    } finally {
      setRecorderBusy(false);
    }
  };

  /** 原生回放录制动作（文本配方仍走 runRecipe）。 */
  const playRecorded = async (recipe: { id: string; name: string }) => {
    if (typeof openAppConfirm === "function") {
      const ok = await openAppConfirm(
        "回放键鼠录制",
        `将按录制时的鼠标/键盘操作回放「${recipe.name}」，可能修改真实数据。开始后按 Ctrl+Alt+F10 停止。`,
        "开始回放",
      ).catch(() => false);
      if (!ok) return;
    }
    setRecorderBusy(true);
    try {
      const result = await window.codex.playRpaRecipe(recipe.id);
      if (!result.ok) setNotice(result.error ?? "回放启动失败");
      else setNotice("回放中：按 Ctrl+Alt+F10 停止");
      await refreshRecorder();
    } catch (error: unknown) {
      setNotice("回放启动失败：" + ((error as { message?: string })?.message ?? String(error)));
    } finally {
      setRecorderBusy(false);
    }
  };

  const stopPlayback = async () => {
    await window.codex.stopRpaPlayback().catch(() => undefined);
    await refreshRecorder();
  };

  /** 在当前会话执行文本配方：只负责启动回合并登记结算；成功/失败由回合结束事件回写。 */
  const runRecipe = async (recipe: { id: string; name: string; steps?: string[]; target?: string }) => {
    if (!thread) { setNotice("请先打开或新建一个会话再执行配方"); return; }
    setRpaRunning(recipe.id);
    const targetNote = recipe.target ? `（目标：${recipe.target}）` : "";
    const stepsText = (recipe.steps ?? []).map((step, index) => `${index + 1}. ${step}`).join("\n");
    try {
      const result = await window.codex.request("turn/start", {
        threadId: thread.id,
        input: [{ type: "text", text: `请执行 RPA 配方「${recipe.name}」${targetNote}：\n${stepsText}`, text_elements: [] }],
        model: selectedModel?.model ?? modelName(modelId),
        sandboxPolicy: sandboxPolicy(sandbox, thread.cwd ?? workspace ?? ""),
      });
      /* ⛔ turn/start 返回只代表回合已启动，不代表流程跑完 ⇒ 不在这里清运行态，
         把它交给回合结束事件（turn/completed / aborted / failed / interrupted）结算。 */
      trackRpaRun({ recipeId: recipe.id, threadId: String(thread.id), turnId: String((result as { turn?: { id?: string } })?.turn?.id ?? "") });
    } catch (error: unknown) {
      setRpaRunning(null);
      setNotice("执行失败：" + ((error as { message?: string })?.message ?? String(error)));
    }
  };
  return (
    <>
      <section className="settings-section stack">
                    <div className="auto-card rpa-recorder-card">
                      <div className="auto-card-head">
                        <strong>键鼠录制</strong>
                        <span className="auto-card-tag">{(window.codex as { platform?: string }).platform === "darwin" ? "macOS" : "Windows"}</span>
                        {recorder?.recording ? <span className="rpa-status ok">录制中</span> : null}
                        {recorder?.playing ? <span className="rpa-status ok">回放中</span> : null}
                      </div>
                      <p className="rpa-recorder-hint">录制真实键鼠操作并保存为可原生回放的配方。⚠️ 录制会记录键盘输入（可能包含密码/验证码），只保存在本机；中文输入法可能无法逐字回放，滚轮暂不录制。</p>
                      {(window.codex as { platform?: string }).platform === "darwin" ? (
                        <p className="rpa-recorder-hint">macOS 首次使用需要授权：系统设置 → 隐私与安全性 →「输入监控」（录制）与「辅助功能」（回放）；如果列表里出现 RPA helper（rpa-input-mac），也要一起允许。授权后若仍失败，重启应用再试。</p>
                      ) : null}
                      <div className="rpa-recorder-actions">
                        {recorder === null ? (
                          <span className="muted">读取录制状态…</span>
                        ) : !recorder.supported ? (
                          <span className="muted">当前系统暂不支持键鼠录制（需要 Windows 自带 PowerShell，或 macOS 随包原生 helper）。</span>
                        ) : recorder.recording ? (
                          <button type="button" className="rpa-recorder-btn is-danger" disabled={recorderBusy} onClick={() => void stopRecording()}>停止录制（{recorder.hotkeys.record}）</button>
                        ) : (
                          <button type="button" className="rpa-recorder-btn" disabled={recorderBusy || recorder.playing} onClick={() => void startRecording()}>开始录制</button>
                        )}
                        {recorder?.playing ? (
                          <button type="button" className="rpa-recorder-btn is-danger" onClick={() => void stopPlayback()}>停止回放（{recorder.hotkeys.play}）</button>
                        ) : null}
                      </div>
                      {recorder && recorder.recording && !recorder.hotkeyReady.record ? (
                        <p className="rpa-recorder-hint">全局停止快捷键被占用，请回本页点「停止录制」。</p>
                      ) : null}
                    </div>
                    <div className="auto-card">
                      {rpaRecipes.length === 0 ? (
                        <div className="auto-empty"><p className="muted">还没有 RPA 配方。让 Codex 跑通一条流程后说「把这次流程存成 RPA 配方」，它会用 rpa_save 保存步骤；之后说「运行 &lt;名字&gt;」即可复用。</p></div>
                      ) : (
                        <div className="auto-cards">
                          {rpaRecipes.map((recipe: any) => (
                            <div className="auto-card-item" key={recipe.id}>
                              <div className="auto-card-head">
                                <strong title={recipe.name}>{recipe.name}</strong>
                                <span className="auto-card-tag">{recipe.kind === "browser" ? "浏览器" : recipe.kind === "desktop" ? "桌面" : "混合"}</span>
                                {recipe.actions?.length ? <span className="auto-card-tag">录制 {recipe.actions.length} 动作</span> : null}
                                {rpaRunning === recipe.id && <span className="subagent-badge"><Bot size={11} />执行中</span>}
                                {recipe.lastStatus === "ok" && <span className="rpa-status ok">上次成功</span>}
                                {recipe.lastStatus === "fail" && <span className="rpa-status fail" title={recipe.lastError ?? ""}>上次失败</span>}
                              </div>
                              {recipe.desc && <p className="auto-card-desc" title={recipe.desc}>{recipe.desc}</p>}
                              {recipe.steps?.length > 0 && <ol className="rpa-steps">{recipe.steps.map((step: string, index: number) => <li key={index}>{step}</li>)}</ol>}
                              <div className="auto-card-foot">
                                <span className="auto-card-next">{recipe.workspace ? basename(recipe.workspace) : "全局"} · 已存 {recipe.runCount ?? 0} 次运行</span>
                                <div className="auto-card-actions">
                                  <button className="icon-button" title="执行（文本配方走模型，录制配方原生回放）" disabled={recorder?.recording || recorder?.playing || recorderBusy || rpaRunning !== null} onClick={() => { if (recipe.actions?.length) void playRecorded(recipe); else void runRecipe(recipe); }}><Play size={13} /></button>
                                  <button className="icon-button danger" title="删除" onClick={async () => { if (!(await openAppConfirm("删除配方", `配方「${recipe.name}」将被删除，此操作无法撤销。`, "删除"))) return; void window.codex.deleteRpaRecipe(recipe.id).then(() => setRpaRecipes((current: any) => current.filter((entry: any) => entry.id !== recipe.id))).catch((error: any) => setNotice("删除失败：" + error.message)); }}><Trash2 size={13} /></button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="auto-templates"><h3>任务清单 <span className="muted" style={{ fontWeight: 400 }}>（Codex 通过 task_add / task_update 自主维护）</span></h3>
                      <div className="rpa-task-panel">
                        <ul className="rpa-task-list">
                          {taskList.length === 0 && <li className="muted">清单为空。让 Codex 跑通流程时自主安排待办，无需手动添加。</li>}
                          {taskList.map((task: any) => (
                            <li key={task.id} className={task.status}>
                              {/* ⛔ 成败都要回执（10-06 用户：「很多开发都没有通知提醒」）：
                                  原来是 `.catch(() => undefined)` —— 失败连一点响动都没有，
                                  勾选框看着变了、盘上却没写成功。 */}
                              <ToggleSwitch checked={task.status === "done"} title={task.status === "done" ? "标记待办" : "标记完成"} onChange={() => { const next = task.status === "done" ? "todo" : "done"; void window.codex.updateTask({ id: task.id, patch: { status: next } }).then((updated: any) => { setTaskList((current: any) => current.map((entry: any) => entry.id === updated.id ? updated : entry)); setNotice(next === "done" ? `待办已完成：${String(task.text ?? "").slice(0, 30)}` : `待办已恢复：${String(task.text ?? "").slice(0, 30)}`); }).catch((error: any) => setNotice(`更新待办失败：${error?.message ?? error}`)); }} />
                              <span className="rpa-task-text">{task.text}</span>
                              <span className={`rpa-task-priority ${task.priority}`}>{task.priority === "high" ? "高" : task.priority === "low" ? "低" : "中"}</span>
                              <button className="icon-button" title="删除" onClick={() => { void window.codex.deleteTask(task.id).then(() => { setTaskList((current: any) => current.filter((entry: any) => entry.id !== task.id)); setNotice(`任务「${task.name || task.id}」已删除`); }).catch((error: any) => setNotice(`删除任务失败：${error?.message ?? error}`)); }}><Trash2 size={13} /></button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </section>
    </>
  );
}
