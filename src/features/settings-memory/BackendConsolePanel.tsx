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
 */
import { useCallback, useEffect, useState } from "react";
import { Database, Server, CircleDot, Check, Download, RefreshCw, Trash2, Copy } from "lucide-react";

type BackendStatus = {
  backend?: string;
  effective?: string;
  installed?: boolean;
  installRoot?: string;
  installCommand?: string;
  fallbackReason?: string;
  version?: string;
};

export function BackendConsolePanel({ workspace, workspaceEnabled }: {
  workspace: string;
  workspaceEnabled: boolean;
}) {
  /* ⛔ 工作区开关直接走 IPC（与记忆中心同一条通道）—— 不依赖 app 的 state setter。 */
  const [wsEnabled, setWsEnabled] = useState(workspaceEnabled);
  useEffect(() => { setWsEnabled(workspaceEnabled); }, [workspaceEnabled]);
  const toggleWorkspace = async (enabled: boolean) => {
    setWsEnabled(enabled);
    try { await (window as any).codex?.setWorkspaceMemoryEnabled?.({ workspace, enabled }); setNote(enabled ? "该项目记忆已开启" : "该项目记忆已关闭：背景、项目记忆、日志不会注入或捕获"); }
    catch (error: any) { setNote(`保存项目记忆开关失败：${String(error?.message ?? error).slice(0, 120)}`); }
  };
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const api = () => (window as any).codex;

  const refresh = useCallback(async () => {
    try {
      const raw = await api()?.readMemoryBackend?.();
      setStatus((raw ?? null) as BackendStatus | null);
    } catch { setStatus(null); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setNote("");
    try { await fn(); setNote(`${label}完成`); }
    catch (error: any) { setNote(`${label}失败：${String(error?.message ?? error).slice(0, 160)}`); }
    finally { setBusy(""); void refresh(); }
  };
  const pick = (backend: "builtin" | "mcp") => run("切换后端", () => api()?.setMemoryBackend?.(backend));

  const current = status?.effective ?? status?.backend ?? "builtin";
  const ready = status?.installed === true;
  /** 灯色：内置恒绿；MCP 看是否就绪（未装 = 琥珀，装了 = 绿） */
  const lampOf = (id: "builtin" | "mcp") => (id === "builtin" ? "ok" : ready ? "ok" : "warn");

  const DEVICES = [
    { id: "builtin" as const, name: "内置记忆金字塔", icon: <Database size={16} />, desc: "随包内置、离线可用；L0–L7 分层注入", tag: "默认" },
    { id: "mcp" as const, name: "MCP 记忆服务", icon: <Server size={16} />, desc: "@vheins/local-memory-mcp · 装到应用数据目录的独立目录", tag: ready ? "已就绪" : "未安装" },
  ];

  return (
    <div className="bc-root">
      {/* ── 状态灯条 ────────────────────────────────────────────────── */}
      <div className="bc-statusbar" data-backend={current}>
        <span className={`bc-lamp is-${ready || current === "builtin" ? "ok" : "warn"}`} />
        <span className="bc-statusbar-copy">
          <strong>当前生效：{current === "mcp" ? "MCP 记忆服务" : "内置记忆金字塔"}</strong>
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
            <button className="secondary-setting" disabled={Boolean(busy)} onClick={() => void run("安装", () => api()?.installMemoryMcp?.())}>
              <Download size={12} />{ready ? "重新安装" : "安装"}
            </button>
            <button className="secondary-setting" disabled={Boolean(busy) || !ready} onClick={() => void run("检测", () => api()?.verifyMemoryMcp?.())}>
              <CircleDot size={12} />检测连通性
            </button>
            <button className="secondary-setting" disabled={Boolean(busy) || !ready} onClick={() => void run("卸载", () => api()?.uninstallMemoryMcp?.())}>
              <Trash2 size={12} />卸载
            </button>
            {status?.installCommand ? (
              <button className="secondary-setting" onClick={() => { void navigator.clipboard.writeText(String(status.installCommand)); setNote("安装命令已复制"); }}>
                <Copy size={12} />复制命令
              </button>
            ) : null}
          </span>
        </div>
        {status?.installRoot ? <p className="bc-path">装到 <code>{status.installRoot}</code></p> : null}
        <p className="bc-hint">安装默认走国内镜像（registry.npmmirror.com），依赖与原生绑定同理；镜像不可用时自动换源，无需你配置。</p>
      </div>

      {busy ? <p className="settings-status">{busy}中…</p> : null}
      {note ? <p className="settings-status">{note}</p> : null}
    </div>
  );
}
