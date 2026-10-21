/**
 * 记忆后端三板块（10-21 用户要求）。
 *
 * 用户原话：「记忆中心要拆细一点，本地金字塔记忆、MCP 记忆、云端记忆，加一个开关，
 * 开那个生效那个，就不用再在记忆后端选了，拆成三个板块。」
 *
 * 设计：三块各自一张板（标题 + 状态 + 开关 + 管理入口），开关是**三选一**：
 *   · 只有就绪的后端才能打开（MCP 未安装 / 云端未开通时开关禁用，点「安装 / 开通」去处理）；
 *   · 关掉当前生效的 MCP / 云端 = 回到本地金字塔；本地金字塔本身不能关（全关请用顶部的「已启用」）；
 *   · 实际生效以后端回报的 `effective` 为准：MCP 未就绪自动回退时，开关跟着落在本地并在板上说明。
 *
 * ⛔ 切换/安装/开通的 IPC 与 BackendConsolePanel 同源（readMemoryBackend / setMemoryBackend /
 *    memory:mcp:* / cloudMemorySync），本组件只做三块板的展示与选择，不另造后端逻辑。
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Cloud, Database, LoaderCircle, Server, Settings2, CheckCircle2 } from "lucide-react";

export type MemoryBackendId = "builtin" | "mcp" | "cloud";

type CloudActivation = {
  state: "active" | "inactive" | "unknown";
  reason: string;
  entitled: boolean;
  applied: boolean;
  reasonText: string;
};

type BackendStatus = {
  backend?: MemoryBackendId;
  effective?: MemoryBackendId;
  installed?: boolean;
  fallbackReason?: string | null;
  cloudActivation?: CloudActivation;
};

const BOARDS: {
  id: MemoryBackendId;
  name: string;
  icon: typeof Database;
  tone: string;
  desc: string;
}[] = [
  { id: "builtin", name: "本地金字塔记忆", icon: Database, tone: "ic-blue", desc: "随包离线，L0–L7 分层；数据在本机，按项目和会话隔离。" },
  { id: "mcp", name: "MCP 记忆", icon: Server, tone: "ic-pink", desc: "独立 MCP 服务，memory.db 按 type 分类；需要先安装。" },
  { id: "cloud", name: "云端记忆", icon: Cloud, tone: "ic-violet", desc: "memapi 跨设备；对话自动注入与回写，按云账号隔离。" },
];

export function MemoryBackendBoards({ memoryEnabled, fallbackBackend, onManage, onNotice }: {
  memoryEnabled: boolean;
  fallbackBackend: MemoryBackendId;
  onManage: (backend: MemoryBackendId) => void;
  onNotice: (message: string) => void;
}) {
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [busy, setBusy] = useState<MemoryBackendId | "">("");
  const api = () => (window as any).codex;

  const refresh = useCallback(async () => {
    try {
      const raw = await api()?.readMemoryBackend?.();
      setStatus((raw ?? null) as BackendStatus | null);
    } catch (error: any) {
      onNotice(`读取记忆后端状态失败：${String(error?.message ?? error).slice(0, 140)}`);
    }
  }, [onNotice]);

  useEffect(() => {
    void refresh();
    const off = api()?.onMemoryBackendChanged?.(() => { void refresh(); });
    return typeof off === "function" ? off : undefined;
  }, [refresh]);

  const current: MemoryBackendId = (status?.effective as MemoryBackendId) ?? (status?.backend as MemoryBackendId) ?? fallbackBackend;
  const configured: MemoryBackendId = (status?.backend as MemoryBackendId) ?? fallbackBackend;
  const mcpReady = status?.installed === true;
  const act = status?.cloudActivation;
  const cloudReady = Boolean(act?.entitled && act?.applied);

  const ready = (id: MemoryBackendId) => id === "builtin" || (id === "mcp" ? mcpReady : cloudReady);

  const switchTo = async (id: MemoryBackendId) => {
    if (busy) return;
    setBusy(id);
    try {
      const result: any = await api()?.setMemoryBackend?.(id);
      if (result?.refused) {
        onNotice(`未切换：${String(result?.cloudActivation?.reasonText ?? result.refused)}`);
      } else if (id === "mcp" && result?.effective !== "mcp") {
        onNotice(`已记下选择，但 MCP 未就绪 —— 当前仍走本地金字塔${result?.fallbackReason ? `：${String(result.fallbackReason).slice(0, 120)}` : ""}`);
      } else {
        onNotice(id === "builtin" ? "已切回本地金字塔记忆" : id === "mcp" ? "已切到 MCP 记忆：重启应用后引擎侧生效" : "已切到云端记忆：记忆由 memapi 自动注入与回写");
      }
      await refresh();
    } catch (error: any) {
      onNotice(`切换记忆后端失败：${String(error?.message ?? error).slice(0, 140)}`);
    } finally {
      setBusy("");
    }
  };

  const select = (id: MemoryBackendId, checked: boolean) => {
    if (!memoryEnabled) {
      onNotice("记忆已停用：先在页面顶部打开「已启用」");
      return;
    }
    if (!checked) {
      // 本地是兜底，不能关成"没有任何后端"；要全关请用顶部总开关。
      if (id === "builtin") {
        onNotice("本地金字塔是兜底后端；要全部关闭记忆，请用页面顶部的「已启用」");
        return;
      }
      if (id === current) void switchTo("builtin");
      return;
    }
    if (id === current) return;
    if (!ready(id)) {
      onManage(id);
      onNotice(id === "mcp" ? "MCP 记忆服务还没安装，先安装再切换" : "云端记忆还没开通 / 接通，先处理再切换");
      return;
    }
    void switchTo(id);
  };

  const tagOf = (id: MemoryBackendId) => {
    if (!memoryEnabled) return "记忆已停用";
    if (busy === id) return "切换中…";
    if (current === id) return "使用中";
    if (id === "builtin") return "可用";
    if (id === "mcp") return mcpReady ? "已就绪" : "未安装";
    return cloudReady ? "已就绪" : act?.entitled ? "待接通" : act?.state === "unknown" ? "未确认" : "未开通";
  };

  const metaOf = (id: MemoryBackendId) => {
    if (id === "builtin") {
      return configured !== current && configured === "mcp" ? "MCP 未就绪，已回退到本地" : "写入本机分层文件";
    }
    if (id === "mcp") return mcpReady ? "服务已就绪，可直接切换" : "安装后才能切换";
    return cloudReady ? "账号已开通并接通" : String(act?.reasonText ?? "开通后才能切换");
  };

  const manageLabel = (id: MemoryBackendId) => {
    if (id === "builtin") return "设置";
    if (id === "mcp") return mcpReady ? "管理" : "安装";
    return cloudReady ? "管理" : act?.entitled ? "接通" : act?.state === "unknown" ? "确认" : "开通";
  };

  const configuredName = BOARDS.find((board) => board.id === configured)?.name ?? "本地金字塔记忆";
  const currentName = BOARDS.find((board) => board.id === current)?.name ?? "本地金字塔记忆";

  return (
    <section className="memory-backends" aria-label="记忆后端三选一">
      <div className="memory-backends-head">
        <div><strong>记忆存到哪里</strong><small>三选一：开关打开的那个生效；未就绪的后端先安装 / 开通。</small></div>
      </div>
      {configured !== current ? (
        <p className="memory-backends-fallback" role="status"><AlertTriangle size={13} />已选择「{configuredName}」，但当前实际走「{currentName}」{status?.fallbackReason ? `：${String(status.fallbackReason).slice(0, 160)}` : "。"}</p>
      ) : null}
      <div className="memory-backend-list">
        {BOARDS.map((board) => {
          const Icon = board.icon;
          const active = current === board.id;
          const isReady = ready(board.id);
          const disabled = !memoryEnabled || Boolean(busy) || (!isReady && !active);
          return (
            <div className={`memory-backend-board ${active ? "is-active" : ""} ${board.tone}`} key={board.id} data-backend={board.id}>
              <div className="memory-backend-main">
                <span className="memory-backend-icon" aria-hidden><Icon size={16} /></span>
                <span className="memory-backend-copy">
                  <span className="memory-backend-title">
                    <strong>{board.name}</strong>
                    <em className={`memory-backend-tag ${active ? "is-on" : isReady ? "is-ready" : "is-off"}`}>{tagOf(board.id)}</em>
                  </span>
                  <small>{board.desc}</small>
                  <span className="memory-backend-meta">{metaOf(board.id)}</span>
                </span>
                <label className="memory-backend-switch" title={!memoryEnabled ? "记忆已停用：先打开页面顶部的「已启用」" : !isReady ? "先安装 / 开通再切换" : undefined}>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={`启用${board.name}`}
                    checked={active}
                    disabled={disabled}
                    onChange={(event) => select(board.id, event.target.checked)}
                  />
                  <span className="memory-backend-switch-ui" aria-hidden />
                  <em>{active ? "生效中" : "启用"}</em>
                </label>
              </div>
              <div className="memory-backend-foot">
                <span className={`memory-backend-state ${active ? "is-on" : isReady ? "is-ready" : "is-off"}`}>
                  {active ? <CheckCircle2 size={12} /> : busy === board.id ? <LoaderCircle size={12} className="mui-spin" /> : <AlertTriangle size={12} />}
                  {active ? "当前生效" : isReady ? "可切换" : "未就绪"}
                </span>
                <button type="button" className="secondary-setting memory-backend-manage" onClick={() => onManage(board.id)} disabled={busy === board.id}>
                  <Settings2 size={12} />{manageLabel(board.id)}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
