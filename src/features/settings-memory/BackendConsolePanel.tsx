/**
 * BackendConsolePanel —— 「记忆后端选项」的界面（10-10 用户要求：**每个板块一套独立界面**）。
 *
 * ── 这一套的形态：**设备控制台**（不是列表、不是书架、不是金字塔）──────────────
 *   顶：状态灯条（当前生效后端 · 是否就绪 · 回退原因）—— 一眼看"现在跑在哪"
 *   中：两个**设备大卡**（内置金字塔 / MCP 记忆服务）横排，卡上有状态灯 + 选中标记
 *   下：三条**控制行**（保存位置 / 工作区记忆 / 安装与检测）—— 开关与动作集中在一列
 *   ⛔ 与另外两套刻意区分：书架是**左右分栏**、金字塔是**纵向梯形**、这一套是**设备面板**
 *     （状态灯 + 横向大卡 + 控制行），三套骨架互不相同。
 *
 * ── 为什么不用 `MemoryBackendSection` ──────────────────────────────
 *   用户明确要求三套界面各自独立、不复用。这里**自己调同一组 IPC**
 *   （readMemoryBackend / setMemoryBackend / install·uninstall·verifyMemoryMcp），
 *   ⛔ 功能不缩水：安装、检测、卸载、装到哪、复制命令都保留。
 *
 * ── 反馈效果（10-10 用户反馈「安装、连通性检查和卸载都缺少反馈效果」）──────────
 *   此前三个动作只有**一行灰字**：点下去 => "安装中…" => "安装完成"，
 *   ① 中间几分钟完全没有进度（npm 装依赖 + 补原生绑定 + 握手），看起来像卡死；
 *   ② **失败也显示"完成"** —— 主进程回执带退出码与 error，界面却没读，把失败演成成功。
 *   ⇒ 现在：进度条（主进程把安装器的 `@@STAGE/@@PROGRESS` 经 `runtime:progress` 实时推来，
 *     与「开发工具页装运行时」「知识库装语义后端」**同一条通道、同一套样式**）
 *     + 终态横幅（成功绿 / 失败红 / 未就绪琥珀，⛔ 判定在主进程做一次，这里只展示）。
 */
import { useCallback, useEffect, useState } from "react";
import { Database, Server, CircleDot, Check, Download, RefreshCw, Trash2, Copy, CheckCircle2, XCircle, AlertTriangle, X } from "lucide-react";

type BackendStatus = {
  backend?: string;
  effective?: string;
  installed?: boolean;
  installRoot?: string;
  installCommand?: string;
  fallbackReason?: string;
  version?: string;
};

/** 控制台上的三类动作 + 后端切换（同一个 busy 位 ⇒ 一次只允许一个动作）。 */
type ActionKey = "install" | "uninstall" | "verify" | "switch";
type Tone = "ok" | "bad" | "warn";
type Verdict = { tone: Tone; title: string; detail?: string };

const ACTION_LABEL: Record<ActionKey, string> = { install: "安装", uninstall: "卸载", verify: "连通性检查", switch: "切换后端" };

/** 主进程进度事件的 id 前缀（与 electron/features/memory-ipc.ts 的 MCP_PROGRESS 同源）。 */
const PROGRESS_PREFIX = "memory-mcp";

export function BackendConsolePanel({ workspace, workspaceEnabled }: {
  workspace: string;
  workspaceEnabled: boolean;
}) {
  /* ⛔ 工作区开关直接走 IPC（与记忆中心同一条通道）—— 不依赖 app 的 state setter。 */
  const [wsEnabled, setWsEnabled] = useState(workspaceEnabled);
  useEffect(() => { setWsEnabled(workspaceEnabled); }, [workspaceEnabled]);
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [busy, setBusy] = useState<"" | ActionKey>("");
  const [prog, setProg] = useState<{ percent?: number; stage?: string; message?: string; done?: boolean } | null>(null);
  const [note, setNote] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const api = () => (window as any).codex;

  const toggleWorkspace = async (enabled: boolean) => {
    setWsEnabled(enabled);
    try { await api()?.setWorkspaceMemoryEnabled?.({ workspace, enabled }); setNote(enabled ? "该项目记忆已开启" : "该项目记忆已关闭：背景、项目记忆、日志不会注入或捕获"); }
    catch (error: any) { setNote(`保存项目记忆开关失败：${String(error?.message ?? error).slice(0, 120)}`); }
  };

  const refresh = useCallback(async () => {
    try {
      const raw = await api()?.readMemoryBackend?.();
      setStatus((raw ?? null) as BackendStatus | null);
    } catch { setStatus(null); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  /* ── 进度订阅（10-10）─────────────────────────────────────────────
     复用主进程的 `runtime:progress`（id 以 memory-mcp 开头，三个动作各一个 id）。
     ⛔ 横幅**不由这里设置**：终态判定在主进程做一次、随 IPC 回执一起回来（同一判定两处消费），
       在这里再判一遍迟早出现「进度条说成功、横幅说失败」的自相矛盾。这里只负责进度条本身。 */
  useEffect(() => {
    const off = api()?.onRuntimeProgress?.((payload: any) => {
      if (typeof payload?.id !== "string" || !payload.id.startsWith(PROGRESS_PREFIX)) return;
      if (payload.done) { setProg((prev) => ({ ...(prev ?? {}), percent: 100, done: true, ...(payload.message ? { message: String(payload.message) } : {}) })); return; }
      setProg((prev) => ({ ...(prev ?? {}), ...payload }));
    });
    return typeof off === "function" ? off : undefined;
  }, []);

  /* ⛔ 判定口径：主进程回执带 `ok` + `message`（与终态事件同一次判定）⇒ 前端只做展示。
     仅当回执缺字段时在本层兜底（异常/旧构建），兜底只认安装器自己的 verified / 退出码。 */
  const mcpJudge = (action: Exclude<ActionKey, "switch">) => (value: any): Verdict => {
    const ok = typeof value?.ok === "boolean"
      ? value.ok
      : action === "verify" ? value?.result?.verified === true : value?.code === 0;
    const title = typeof value?.message === "string" && value.message ? value.message : `${ACTION_LABEL[action]}${ok ? "完成" : "失败"}`;
    const detail = ok ? undefined : String(value?.result?.error ?? value?.result?.hint ?? value?.log ?? "").trim().slice(0, 400) || undefined;
    return { tone: ok ? "ok" : "bad", title, detail };
  };
  const switchJudge = (backend: "builtin" | "mcp") => (value: any): Verdict => {
    if (backend === "mcp" && String(value?.effective ?? "") !== "mcp") {
      return { tone: "warn", title: "已记下选择，但 MCP 服务尚未就绪 —— 当前仍走内置金字塔（记忆不会丢）", detail: String(value?.fallbackReason ?? "").slice(0, 300) || undefined };
    }
    return { tone: "ok", title: backend === "mcp" ? "已切到 MCP 记忆后端：技能与连接器已同步，重启应用后引擎侧生效" : "已切回内置记忆金字塔：技能与连接器已同步，重启应用后引擎侧生效" };
  };

  const run = async (action: ActionKey, judge: (value: any) => Verdict, fn: () => Promise<any>) => {
    setBusy(action);
    setVerdict(null);
    setNote("");
    /* ⛔ 立刻上进度条（不等第一条进度事件）：否则"点下去 → 子进程起来"之间的一两秒里界面
       没有任何变化，用户会以为点空了（这次要修的正是这类"没有反馈"）。 */
    setProg({ percent: 2, stage: action === "install" ? "准备安装…" : action === "uninstall" ? "准备卸载…" : action === "verify" ? "准备检测…" : "正在切换…" });
    try {
      const value = await fn();
      setVerdict(judge(value));
    } catch (error: any) {
      setVerdict({ tone: "bad", title: `${ACTION_LABEL[action]}失败`, detail: String(error?.message ?? error).slice(0, 300) });
    } finally {
      setBusy("");
      setProg(null);
      void refresh();
    }
  };

  const pick = (backend: "builtin" | "mcp") => run("switch", switchJudge(backend), () => api()?.setMemoryBackend?.(backend));

  const current = status?.effective ?? status?.backend ?? "builtin";
  const ready = status?.installed === true;
  /** 灯色：内置恒绿；MCP 看是否就绪（未装 = 琥珀，装了 = 绿） */
  const lampOf = (id: "builtin" | "mcp") => (id === "builtin" ? "ok" : ready ? "ok" : "warn");

  const DEVICES = [
    { id: "builtin" as const, name: "内置记忆金字塔", icon: <Database size={16} />, desc: "随包内置、离线可用；L0–L7 分层注入", tag: "默认" },
    { id: "mcp" as const, name: "MCP 记忆服务", icon: <Server size={16} />, desc: "@vheins/local-memory-mcp · 装到应用数据目录的独立目录", tag: ready ? "已就绪" : "未安装" },
  ];

  /** 动作按钮：运行中的那个显示转圈 + 文案，其余禁用（一次只跑一个）。 */
  const actionButton = (action: Exclude<ActionKey, "switch">, idle: React.ReactNode, disabled?: boolean) => (
    <button className="secondary-setting" disabled={Boolean(busy) || disabled}
      onClick={() => void run(action, mcpJudge(action), () => api()?.[action === "install" ? "installMemoryMcp" : action === "uninstall" ? "uninstallMemoryMcp" : "verifyMemoryMcp"]?.())}>
      {busy === action ? <RefreshCw size={12} className="mui-spin" /> : idle}
      {busy === action ? `${ACTION_LABEL[action]}中…` : ACTION_LABEL[action] === "连通性检查" ? "检测连通性" : ready && action === "install" ? "重新安装" : ACTION_LABEL[action]}
    </button>
  );

  return (
    <div className="bc-root">
      {/* ── 状态灯条 ────────────────────────────────────────────────── */}
      <div className="bc-statusbar" data-backend={current}>
        <span className={`bc-lamp is-${busy ? "warn" : ready || current === "builtin" ? "ok" : "warn"}`} />
        <span className="bc-statusbar-copy">
          <strong>当前生效：{busy ? `${ACTION_LABEL[busy as ActionKey]}进行中…` : current === "mcp" ? "MCP 记忆服务" : "内置记忆金字塔"}</strong>
          <small>
            {status?.version ? `版本 ${status.version} · ` : ""}
            {current === "mcp"
              ? (ready ? "服务已就绪，写入走 MCP" : `未就绪${status?.fallbackReason ? `：${status.fallbackReason}` : ""} —— 会自动回退到内置金字塔，记忆不会丢`)
              : "写入落在本机分层文件里，无需额外依赖"}
          </small>
        </span>
        <button type="button" className="bc-iconbtn" title="重新读取后端状态" onClick={() => void refresh()}>
          <RefreshCw size={13} className={busy ? "mui-spin" : ""} />
        </button>
      </div>

      {/* ── 设备大卡（横排）────────────────────────────────────────── */}
      <div className="bc-devices" role="radiogroup" aria-label="记忆后端">
        {DEVICES.map((d) => (
          <button type="button" role="radio" aria-checked={current === d.id} key={d.id} data-bc-device={d.id}
            className={`bc-device ${current === d.id ? "is-on" : ""}`} disabled={Boolean(busy)}
            onClick={() => void pick(d.id)}>
            <span className="bc-device-top">
              <span className="bc-device-icon">{d.icon}</span>
              <span className={`bc-lamp is-${lampOf(d.id)}`} />
              <em className="bc-device-tag">{d.tag}</em>
              {current === d.id ? <span className="bc-device-check"><Check size={12} />使用中</span> : null}
            </span>
            <strong>{d.name}</strong>
            <small>{d.desc}</small>
          </button>
        ))}
      </div>

      {/* ── 控制行 ──────────────────────────────────────────────────── */}
      <div className="bc-rows">
        <div className="bc-row">
          <span className="bc-row-label">保存位置</span>
          <span className="bc-row-value">内置分层文件（本机）· 条目按项目 / 会话隔离</span>
        </div>
        <div className="bc-row">
          <span className="bc-row-label">工作区记忆</span>
          <label className="bc-switch">
            <input type="checkbox" checked={wsEnabled} disabled={!workspace}
              onChange={(event) => void toggleWorkspace(event.target.checked)} />
            <span>{workspace ? (wsEnabled ? "已开启：背景 / 项目记忆 / 日志会注入并捕获" : "已关闭：只注入用户档案") : "先选项目"}</span>
          </label>
        </div>
        <div className="bc-row">
          <span className="bc-row-label">MCP 服务</span>
          <span className="bc-row-actions">
            {actionButton("install", <Download size={12} />)}
            {actionButton("verify", <CircleDot size={12} />, !ready)}
            {actionButton("uninstall", <Trash2 size={12} />, !ready)}
            {status?.installCommand ? (
              <button className="secondary-setting" disabled={Boolean(busy)}
                onClick={() => { void navigator.clipboard.writeText(String(status.installCommand)); setNote("安装命令已复制"); }}>
                <Copy size={12} />复制命令
              </button>
            ) : null}
          </span>
        </div>

        {/* ── 进行中：实时进度条（主进程按阶段推送；没有字节级进度时按阶段推进）──────── */}
        {(busy || prog) ? (
          <div className="bc-progress" role="status" aria-live="polite">
            <span className="runtime-progress-bar" role="progressbar" aria-label="记忆服务操作进度"
              aria-valuenow={prog?.percent ?? 0} aria-valuemin={0} aria-valuemax={100}
              data-indeterminate={typeof prog?.percent !== "number" ? "true" : "false"}>
              <i style={{ width: `${prog?.percent ?? 0}%` }} />
            </span>
            <span className="bc-progress-meta">
              <strong>{busy ? `${ACTION_LABEL[busy as ActionKey]}中` : "处理中"}{typeof prog?.percent === "number" ? ` · ${prog.percent}%` : ""}</strong>
              <small>{prog?.stage ?? prog?.message ?? "正在准备…"}</small>
            </span>
          </div>
        ) : null}

        {/* ── 已完成：明确的成功 / 失败 / 未就绪 提醒（role=alert ⇒ 读屏也立刻播报）──── */}
        {verdict && !busy ? (
          <div className={`bc-verdict is-${verdict.tone}`} role="alert" data-tone={verdict.tone}>
            <span className="bc-verdict-icon">
              {verdict.tone === "ok" ? <CheckCircle2 size={14} /> : verdict.tone === "warn" ? <AlertTriangle size={14} /> : <XCircle size={14} />}
            </span>
            <span className="bc-verdict-copy">
              <strong>{verdict.title}</strong>
              {verdict.detail ? <small>{verdict.detail}</small> : null}
            </span>
            <button type="button" className="bc-verdict-close" title="关闭提示" onClick={() => setVerdict(null)}><X size={12} /></button>
          </div>
        ) : null}

        {status?.installRoot ? <p className="bc-path">装到 <code>{status.installRoot}</code></p> : null}
        <p className="bc-hint">安装默认走国内镜像（registry.npmmirror.com），依赖与原生绑定同理；镜像不可用时自动换源，无需你配置。</p>
      </div>

      {note ? <p className="settings-status">{note}</p> : null}
    </div>
  );
}
