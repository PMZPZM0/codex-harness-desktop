/**
 * 后台任务胶囊（10-09 建）：输入框**左上角**那颗「N 个后台任务运行中」。
 *
 * ⛔ 三条硬规则（需求原文）：
 *   ① **无任务时隐藏** —— 平时 DOM 里什么都没有（轮询是偶发行为，常驻一条"0 个任务"是噪音）；
 *   ② 点开面板**与输入框同宽**（它是 `.composer-wrap` 的直接子节点，`left:0/right:0` 天然对齐，
 *      ❼ 别写成视口坐标 —— 输入框宽度会随窗口变，写死就歪）；
 *   ③ 面板**最多展示 3 条、超出滚动**（`max-height` 卡在三行，内部 `overflow-y:auto`）。
 *
 * ⛔ 为什么"查看"是滚到对话里的那张卡而不是再开一个弹窗：轮询卡已经在流里了，再开一层
 *    就是同一件事两个地方看 —— 用户点「查看」的意图是"它在哪、现在怎样"，滚过去即可。
 *
 * ⛔ 配置（间隔 / 超时 / 重试）为什么放在这里：它就是"轮询怎么跑"的唯一用户侧入口；
 *    改完同时写本地 store（立刻生效）与主进程（下一轮 wait 用新值）—— 两边都要，缺一边
 *    就是"面板改了但跑起来还是老样子"。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronUp, CircleStop, LoaderCircle, Settings2, Eye } from "lucide-react";
import { POLL_LIMITS, formatPollDuration, pollStatusTone } from "../../lib/poll-config.mjs";
import { abortPollTask, getPollConfig, requestToolAbort, setPollConfig } from "../../polling/poll-store";
import type { PollTask } from "../../polling/poll-store";
import { usePollTasks } from "./use-poll-tasks";

/** 面板里同时可见的行数（超出滚动 —— 需求「最多展示 3 条、超出滚动」）。 */
const VISIBLE_ROWS = 3;

export function BackgroundTaskCapsule({ threadId = "" }: { threadId?: string }) {
  const tasks = usePollTasks();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const wrapRef = useRef<HTMLDivElement>(null);
  const [config, setLocalConfig] = useState(getPollConfig);

  const running = useMemo(
    /* ⛔ threadId 为空（欢迎页/新任务，还没有会话）⇒ 直接不显示任何后台任务 ——
     原来的 `!threadId` 恒真会把**别的会话**的后台任务整包带进欢迎页（10-10 用户截图：「串到欢迎界面」）。 */
    () => (threadId ? tasks.filter((task) => task.status === "polling" && (!task.threadId || task.threadId === threadId)) : []),
    [tasks, threadId],
  );

  // 计数（以及卡上的已耗时）每秒刷一次；没有运行中的任务时**不挂定时器**
  useEffect(() => {
    if (!running.length) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running.length]);

  // 收起三件套：点面板外 / 按 ESC / 在别处打字。
  // ⛔ 用 pointerdown 而不是 click：click 会在输入框上先把焦点抢走，体验是"点了没反应"。
  // ⛔ 第三条不能省：面板是 z-index 10000 档（composer 浮层带，高于命令面板的 35 档），
  //    用户在面板开着时敲 `/` 会弹出命令面板 —— 不主动收起就把它盖住了（正是需求要避免的互相遮挡）。
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const el = wrapRef.current;
      if (el && !el.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      const el = wrapRef.current;
      if (event.key === "Escape") { setOpen(false); return; }
      if (el && !el.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 任务全没了 ⇒ 面板没有内容可看，收起（否则留一个空壳浮层）
  useEffect(() => { if (!running.length) setOpen(false); }, [running.length]);

  if (!running.length) return null;

  const jumpTo = (task: PollTask) => {
    /* 轮询任务 → 对话里那张轮询卡；长命令/长工具调用 → 它所在的那个回合
       （它在流里是普通工具卡，没有 `poll-` 锚点）。 */
    const anchor = task.kind === "tool" ? `turn-${task.turnId}` : `poll-${task.id}`;
    document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setOpen(false);
  };
  const stopOne = (task: PollTask) => {
    abortPollTask(task.id);
    /* ⛔ 两条中止路径不同：轮询（视频）走 `poll:abort` —— 主进程那个等待循环才是真正要停的东西；
       长命令只能**打断当前回合**（命令是引擎在跑），回调由 PollBridge 从 app 上注册进来。 */
    if (task.kind === "tool") { requestToolAbort(task.id); return; }
    void window.codex.pollAbort({ taskId: task.id }).catch(() => undefined);
  };
  const applyConfig = (patch: Partial<{ intervalMs: number; timeoutMs: number; maxRetry: number }>) => {
    const next = setPollConfig(patch);
    setLocalConfig(next);
    void window.codex.pollConfigSave(next).catch(() => undefined);
  };

  return (
    <div className="poll-bg-wrap" ref={wrapRef}>
      <button type="button" className="poll-bg-pill" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        title={open ? "收起后台任务面板" : "展开后台任务面板（可查看与中止）"}>
        <LoaderCircle size={12} className="spin" />
        <span className="poll-bg-count">{running.length} 个后台任务运行中</span>
        <ChevronUp size={12} className={open ? "poll-bg-caret up" : "poll-bg-caret"} />
      </button>
      {open && (
        <div className="poll-bg-panel" role="dialog" aria-label="后台任务">
          <div className="poll-bg-head">
            <span>后台任务</span>
            <small>点「查看」跳到对话里的轮询卡</small>
          </div>
          <div className="poll-bg-list" style={{ maxHeight: `${VISIBLE_ROWS * 34}px` }}>
            {running.map((task) => (
              <div className="poll-bg-row" key={task.id}>
                <span className={`poll-bg-dot poll-t-${pollStatusTone(task.status)}`} aria-hidden="true" />
                <span className="poll-bg-title" title={task.title}>{task.title}</span>
                <span className="poll-bg-meta">{formatPollDuration(now - task.startedAt)}</span>
                <button type="button" className="poll-bg-act" onClick={() => jumpTo(task)} title="滚到它在对话里的位置"><Eye size={11} />查看</button>
                <button type="button" className="poll-bg-act danger" onClick={() => stopOne(task)} title={task.kind === "tool" ? "中止这次工具调用（打断当前回合）" : "中止这次轮询"}><CircleStop size={11} />中止</button>
              </div>
            ))}
          </div>
          <div className="poll-bg-config">
            <span className="poll-bg-config-title"><Settings2 size={11} />轮询配置</span>
            <label>
              间隔
              <input type="number" min={POLL_LIMITS.intervalMs.min / 1000} max={POLL_LIMITS.intervalMs.max / 1000} step={1}
                value={Math.round(config.intervalMs / 1000)}
                onChange={(event) => applyConfig({ intervalMs: Number(event.target.value) * 1000 })} />
              秒
            </label>
            <label>
              超时
              <input type="number" min={POLL_LIMITS.timeoutMs.min / 1000} max={POLL_LIMITS.timeoutMs.max / 1000} step={30}
                value={Math.round(config.timeoutMs / 1000)}
                onChange={(event) => applyConfig({ timeoutMs: Number(event.target.value) * 1000 })} />
              秒
            </label>
            <label>
              重试
              <input type="number" min={POLL_LIMITS.maxRetry.min} max={POLL_LIMITS.maxRetry.max} step={1}
                value={config.maxRetry}
                onChange={(event) => applyConfig({ maxRetry: Number(event.target.value) })} />
              次
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
