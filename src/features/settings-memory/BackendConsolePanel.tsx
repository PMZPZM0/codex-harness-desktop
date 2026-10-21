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
import { Database, Server, Cloud, CircleDot, Check, Download, RefreshCw, Trash2, Copy, CheckCircle2, XCircle, AlertTriangle, X } from "lucide-react";
import { refreshWithReceipt } from "../../lib/refresh-receipt.mjs";

type BackendStatus = {
  backend?: string;
  effective?: string;
  installed?: boolean;
  installRoot?: string;
  installCommand?: string;
  fallbackReason?: string;
  version?: string;
  /** 云端记忆开通 / 生效状态（主进程单一判定，⛔ 界面不自己反推） */
  cloudActivation?: {
    state: "active" | "inactive" | "unknown";
    reason: string;
    entitled: boolean;
    applied: boolean;
    checkedAt: number;
    reasonText: string;
  };
};

/** 控制台上的三类动作 + 后端切换（同一个 busy 位 ⇒ 一次只允许一个动作）。 */
type ActionKey = "install" | "uninstall" | "verify" | "switch" | "cloud-confirm";
type Tone = "ok" | "bad" | "warn";
type Verdict = { tone: Tone; title: string; detail?: string };

const ACTION_LABEL: Record<ActionKey, string> = { install: "安装", uninstall: "卸载", verify: "连通性检查", switch: "切换后端", "cloud-confirm": "确认云端记忆" };

/** 主进程进度事件的 id 前缀（与 electron/features/memory-ipc.ts 的 MCP_PROGRESS 同源）。 */
const PROGRESS_PREFIX = "memory-mcp";

export function BackendConsolePanel({ workspace, workspaceEnabled, onNotice, onOpenCloudAccount, focus }: {
  workspace: string;
  workspaceEnabled: boolean;
  onNotice?: (message: string) => void;
  /** 去「云账号」页开通 / 登录（10-20：云端记忆未开通时的引导出口） */
  onOpenCloudAccount?: () => void;
  /** 10-21：只显示这一块后端的详情（从三块板进来）；不传 = 旧的整体控制台。 */
  focus?: "builtin" | "mcp" | "cloud";
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
      return "";
    } catch (error: any) {
      setStatus(null);
      // ⛔ 原来 `catch { setStatus(null) }` 静默：点「重新读取后端状态」失败时没有任何提示。
      onNotice?.(`读取记忆后端状态失败：${error?.message ?? error}`);
      return String(error?.message ?? error);
    }
  }, [onNotice]);
  useEffect(() => { void refresh(); }, [refresh]);

  /* ── 开通状态变化 ⇒ 立刻重读（10-20 用户要求「开通状态变化后界面需及时同步更新」）────
     变化点在主进程（确认开通 / 切后端 / 登录登出换账号），这里只负责重读，
     ⛔ 不自己推断"应该已开通" —— 那是两份判定，迟早与主进程打架。 */
  useEffect(() => {
    const off = api()?.onMemoryBackendChanged?.(() => { void refresh(); });
    return typeof off === "function" ? off : undefined;
  }, [refresh]);

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
  const switchJudge = (backend: "builtin" | "mcp" | "cloud") => (value: any): Verdict => {
    if (backend === "cloud") {
      /* ⛔ 主进程会在未开通时**拒绝落盘**并回执 refused（第二道闸）。这里照实转述，
         不能把它演成"已切换"（那就是"可点击却无法使用"的另一半）。 */
      if (value?.refused) {
        return {
          tone: "warn",
          title: `未切换：云端记忆不可用（${String(value?.cloudActivation?.reasonText ?? value.refused)}）`,
          detail: "先按下方提示确认 / 开通云端记忆，成功后再选。当前仍按原后端工作，记忆不会丢。",
        };
      }
      return { tone: "ok", title: "已切到云端记忆：对话记忆由 memapi 自动注入与回写，本地金字塔停止写入" };
    }
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
    setProg({ percent: 2, stage: action === "install" ? "准备安装…" : action === "uninstall" ? "准备卸载…" : action === "verify" ? "准备检测…" : action === "cloud-confirm" ? "正在向账号服务确认开通状态…" : "正在切换…" });
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

  /* ── 云端记忆的可达性（10-20）────────────────────────────────────────
     三种"不可用"要分开引导，别混成一句"未开通"：
       · 未登录      ⇒ 去登录云账号
       · 已登录未开通 ⇒ 去开通（服务端不建空间、不发 userKey）
       · 未确认       ⇒ 当场确认一次（网络/换账号后常见）
     已开通但未接通（有权益、缺凭据或上游没切）⇒ 提供「接通」而不是「去开通」。 */
  const act = status?.cloudActivation;
  const cloudReady = Boolean(act?.entitled && act?.applied);
  const cloudConfirming = busy === "cloud-confirm";
  const cloudTag = cloudConfirming ? "确认中…" : cloudReady ? "已开通" : act?.entitled ? "待接通" : act?.state === "unknown" ? "未确认" : "未开通";
  const cloudNeedLogin = !cloudReady && act?.reason === "not-logged-in";
  const cloudAction: { label: string; kind: "confirm" | "account" } =
    act?.entitled ? { label: "接通云端记忆", kind: "confirm" }
      : act?.state === "unknown" || !act ? { label: "确认开通状态", kind: "confirm" }
        : { label: cloudNeedLogin ? "去登录云账号" : "去开通云端记忆", kind: "account" };

  const confirmCloud = () => run("cloud-confirm", (value: any): Verdict => {
    const a = value?.activation;
    if (value?.ok) return { tone: "ok", title: "云端记忆已接通：对话上游已切到记忆端点，记忆在请求层自动注入与回写" };
    const err = String(value?.error ?? "");
    /* ⛔ 已开通却没接通 = 这次是网络/凭据问题（开通状态没变）⇒ 要说清"这次为什么没成"，
       只复述「已开通但尚未接通」用户看不出该干什么。 */
    if (a?.state === "active") {
      return {
        tone: "warn",
        title: err.startsWith("unreachable") ? "未能接通：连不上账号服务（网络问题，已开通状态不变）" : `未能接通：${err || a?.reasonText || "未知原因"}`,
        detail: "稍后点「接通云端记忆」重试即可；这一步失败不会影响已存下的记忆。",
      };
    }
    return {
      tone: "warn",
      title: `未能接通：${String(a?.reasonText || err || "未知原因")}`,
      detail: a?.reason === "not-logged-in" ? "先在「云账号」登录，再回来确认。" : "去「云账号」开通 / 续期云端记忆后，回到这里再确认一次。",
    };
  }, () => api()?.cloudMemorySync?.());

  const pick = (backend: "builtin" | "mcp" | "cloud") => {
    if (busy) return;
    /* ⛔ 卡片已置灰，这里是键盘 / 旧构建绕过来的兜底：不切换、给明确提示。 */
    if (backend === "cloud" && !cloudReady) {
      setVerdict({
        tone: "warn",
        title: `云端记忆当前不可用：${String(act?.reasonText ?? "尚未确认开通状态")}`,
        detail: `先点「${cloudAction.label}」，成功后再选云端。当前后端不变，记忆不会丢。`,
      });
      return;
    }
    void run("switch", switchJudge(backend), () => api()?.setMemoryBackend?.(backend));
  };

  const current = status?.effective ?? status?.backend ?? "builtin";
  const shown = focus ?? current;
  const ready = status?.installed === true;
  /** 灯色：内置恒绿；MCP 看是否就绪（未装 = 琥珀，装了 = 绿）；云端看开通状态（不可用 = 灰灯） */
  const lampOf = (id: "builtin" | "mcp" | "cloud") =>
    id === "builtin" ? "ok" : id === "cloud" ? (cloudConfirming ? "warn" : cloudReady ? "ok" : "off") : ready ? "ok" : "warn";

  const DEVICES = [
    { id: "builtin" as const, name: "内置记忆金字塔", icon: <Database size={16} />, desc: "随包内置、离线可用；L0–L7 分层注入", tag: "默认" },
    {
      id: "cloud" as const,
      name: "云端记忆",
      icon: <Cloud size={16} />,
      desc: cloudReady
        ? "memapi · 跨设备 · 对话自动注入与回写"
        : `${String(act?.reasonText ?? "尚未确认开通状态")} · 开通后可用`,
      tag: cloudTag,
    },
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
    <div className="bc-root" data-focus={focus ?? undefined}>
      {!focus ? (<>
      {/* ── 状态灯条 ────────────────────────────────────────────────── */}
      <div className="bc-statusbar" data-backend={current}>
        <span className={`bc-lamp is-${busy ? "warn" : ready || current === "builtin" ? "ok" : "warn"}`} />
        <span className="bc-statusbar-copy">
          <strong>当前生效：{busy ? `${ACTION_LABEL[busy as ActionKey]}进行中…` : current === "cloud" ? "云端记忆" : current === "mcp" ? "MCP 记忆服务" : "内置记忆金字塔"}</strong>
          <small>
            {status?.version ? `版本 ${status.version} · ` : ""}
            {status?.fallbackReason
              ? status.fallbackReason
              : current === "cloud"
              ? "写入走云端 memapi：对话自动注入与回写，跨设备共享；本地金字塔已停止写入"
              : current === "mcp"
              ? (ready ? "服务已就绪，写入走 MCP" : "未就绪 —— 会自动回退到内置金字塔，记忆不会丢")
              : "写入落在本机分层文件里，无需额外依赖"}
          </small>
        </span>
        <button type="button" className="bc-iconbtn" title="重新读取后端状态" onClick={() => void refreshWithReceipt(onNotice, "重新读取后端状态", refresh)}>
          <RefreshCw size={13} className={busy ? "mui-spin" : ""} />
        </button>
      </div>

      {/* ── 设备大卡（横排）────────────────────────────────────────── */}
      <div className="bc-devices" role="radiogroup" aria-label="记忆后端">
        {DEVICES.map((d) => {
          /* ⛔ 云端未开通/未接通 ⇒ 卡片**真禁用**（不是"点了没反应"）：
             disabled 让键盘与读屏也进不去，鼠标 hover 有 not-allowed，旁边还有引导条说明原因。 */
          const locked = d.id === "cloud" && !cloudReady;
          return (
            <button type="button" role="radio" aria-checked={current === d.id} key={d.id} data-bc-device={d.id}
              data-locked={locked ? "true" : undefined}
              aria-disabled={locked || undefined}
              title={locked ? `云端记忆不可用：${String(act?.reasonText ?? "尚未确认开通状态")}` : undefined}
              className={`bc-device ${current === d.id ? "is-on" : ""}`} disabled={Boolean(busy) || locked}
              onClick={() => pick(d.id)}>
              <span className="bc-device-top">
                <span className="bc-device-icon">{d.icon}</span>
                <span className={`bc-lamp is-${lampOf(d.id)}`} />
                <em className="bc-device-tag">{d.tag}</em>
                {current === d.id ? <span className="bc-device-check"><Check size={12} />使用中</span> : null}
              </span>
              <strong>{d.name}</strong>
              <small>{d.desc}</small>
            </button>
          );
        })}
      </div>

      </>) : null}

      {/* ── 云端记忆引导条（10-20：未开通时卡片置灰 + 这里给出**唯一出口**）──────
          ⛔ 未登录 / 未开通 / 未确认 三种原因分别给不同按钮，⛔ 不要笼统一句"去开通"。 */}
      {(!focus || focus === "cloud") && !cloudReady ? (
        <div className="bc-cloudgate" role="status" data-cloud-state={act?.state ?? "unknown"}>
          <span className="bc-cloudgate-copy">
            <strong>
              {cloudConfirming
                ? "正在向账号服务确认开通状态…"
                : act?.entitled
                ? "云端记忆已开通，但尚未接通"
                : act?.state === "unknown"
                ? "尚未确认云端记忆的开通状态"
                : `云端记忆不可用：${String(act?.reasonText ?? "未开通")}`}
            </strong>
            <small>
              {cloudConfirming
                ? "确认期间云端卡片保持不可用，避免切到一半的状态。"
                : act?.entitled
                ? "账号有权益，但本机还没拿到记忆凭据 / 对话上游没切过去 —— 点右侧「接通」当场补齐。"
                : act?.state === "unknown"
                ? "登录过云账号但还没向服务端确认过；换账号后也会回到这个状态。"
                : "云端权益未开通时服务端不会建记忆空间、也不发凭据，切过去会一条都存不下（所以这里直接锁住）。"}
            </small>
          </span>
          <button type="button" className="secondary-setting" disabled={Boolean(busy)}
            onClick={() => { if (cloudAction.kind === "confirm") confirmCloud(); else onOpenCloudAccount?.(); }}>
            {cloudConfirming ? <RefreshCw size={12} className="mui-spin" /> : null}
            {cloudConfirming ? "确认中…" : cloudAction.label}
          </button>
        </div>
      ) : null}

      {/* ── 控制行 ──────────────────────────────────────────────────── */}
      <div className="bc-rows">
        <div className="bc-row">
          <span className="bc-row-label">保存位置</span>
          <span className="bc-row-value">
            {shown === "cloud"
              ? "云端 memapi · 跨设备 / 跨会话（本地不再落盘）"
              : shown === "mcp"
              ? "MCP 记忆库 memory.db · 按 type 分类"
              : "内置分层文件（本机）· 条目按项目 / 会话隔离"}
          </span>
        </div>
        {shown === "cloud" ? (
          <>
            <div className="bc-row">
              <span className="bc-row-label">云端账号</span>
              <span className="bc-row-value">由「云账号」页管理（登录 / 记忆开通状态在那里查看）</span>
            </div>
            <div className="bc-row">
              <span className="bc-row-label">记忆端点</span>
              <span className="bc-row-value"><code>memapi.ppz123.asia</code> · 每账号独立空间</span>
            </div>
            <div className="bc-row">
              <span className="bc-row-label">注入 / 回写</span>
              <span className="bc-row-value">请求前自动注入相关记忆，回合结束后自动写回（由网关配置控制，此处只读）</span>
            </div>
            <div className="bc-row">
              <span className="bc-row-label">本地落盘</span>
              <span className="bc-row-value">已关闭 —— 云端模式下本地金字塔不再写入，避免一份记忆存两处</span>
            </div>
          </>
        ) : null}
        {shown !== "cloud" ? (
        <div className="bc-row">
          <span className="bc-row-label">工作区记忆</span>
          <label className="bc-switch">
            <input type="checkbox" checked={wsEnabled} disabled={!workspace}
              onChange={(event) => void toggleWorkspace(event.target.checked)} />
            <span>{workspace ? (wsEnabled ? "已开启：背景 / 项目记忆 / 日志会注入并捕获" : "已关闭：只注入用户档案") : "先选项目"}</span>
          </label>
        </div>
        ) : null}
        {shown === "mcp" ? (
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
        ) : null}

        {/* ── 进行中：实时进度条（主进程按阶段推送；没有字节级进度时按阶段推进）──────── */}
        {shown === "mcp" && (busy || prog) ? (
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

        {shown === "mcp" && status?.installRoot ? <p className="bc-path">装到 <code>{status.installRoot}</code></p> : null}
        {shown === "mcp" ? <p className="bc-hint">安装默认走国内镜像（registry.npmmirror.com），依赖与原生绑定同理；镜像不可用时自动换源，无需你配置。</p> : null}
      </div>

      {note ? <p className="settings-status">{note}</p> : null}
    </div>
  );
}
