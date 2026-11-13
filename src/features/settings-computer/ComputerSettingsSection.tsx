/**
 * 设置页 · 自动化 → 桌面自动化（11-06 重排，11-07 卡片化）。
 *
 * 用户 11-07：「把浏览器和电脑操作也做成卡片」——浏览器页已改成能力卡；
 * 本页也把两个后端从「一行开关」升级成两张后端卡：
 *   · 卡头：图标 + 名称 + 安装状态胶囊 + 开关（开关就在卡上，不再另起一行）；
 *   · 卡身：工具规模 / 调用方式 + 当前角色（主 / 辅，按系统排序）；
 *   · 卡尾：去开发工具（安装/查看）。
 * ⛔ 两个开关仍写同一份 app-settings（desktopBackendNuphus / desktopBackendComputerUse）。
 * ⛔ 链路口径不变：Windows Nuphus 主 · Computer Use 辅；mac 反过来。
 */
import { useEffect, useState } from "react";
import { ArrowUpRight, Cpu, Monitor, Scan } from "lucide-react";
import { ToggleSwitch } from "../../components/SettingsWidgets";

export type ComputerSettingsSectionProps = {
  toolsStatus: any;
  ToolCard?: any;
  setNotice?: (text: string) => void;
  /** 跳「设置 → 开发工具」（安装/查看后端）。 */
  onOpenDevtools?: () => void;
};

/** 电脑操作设置：两个桌面后端开关，与控制台读写**同一份**设置（⛔ 不各存一份）。 */
export function ComputerSettingsSection(props: ComputerSettingsSectionProps) {
  const { toolsStatus, setNotice, onOpenDevtools } = props;
  /* 三个桌面后端开关与「控制台 → 桌面自动化」读写同一份 app-settings（单一真相源，别各存一份） */
  const [backends, setBackends] = useState<{ nuphus: boolean; computerUse: boolean; agentDesktop: boolean }>({ nuphus: false, computerUse: false, agentDesktop: true });
  /** 安装后刷新工具状态：props 不会自己变，装完必须重新拉 tools:status。 */
  const [rows, setRows] = useState<any[]>(Array.isArray(toolsStatus) ? toolsStatus : []);
  const [installingAgent, setInstallingAgent] = useState(false);
  useEffect(() => { setRows(Array.isArray(toolsStatus) ? toolsStatus : []); }, [toolsStatus]);
  useEffect(() => {
    void window.codex.readAppSettings()
      .then((s) => setBackends({
        nuphus: s.desktopBackendNuphus === true,
        computerUse: s.desktopBackendComputerUse === true,
        agentDesktop: s.desktopBackendAgentDesktop !== false,
      }))
      .catch(() => undefined);
  }, []);
  const toggleBackend = async (key: "nuphus" | "computerUse" | "agentDesktop", next: boolean) => {
    const patch = key === "nuphus" ? { desktopBackendNuphus: next }
      : key === "computerUse" ? { desktopBackendComputerUse: next }
        : { desktopBackendAgentDesktop: next };
    const saved = await window.codex.saveAppSettings(patch).catch(() => null);
    if (!saved) { setNotice?.("保存失败：主进程未响应"); return; }
    setBackends({
      nuphus: saved.desktopBackendNuphus === true,
      computerUse: saved.desktopBackendComputerUse === true,
      agentDesktop: saved.desktopBackendAgentDesktop !== false,
    });
    const label = key === "nuphus" ? "Nuphus" : key === "computerUse" ? "Computer Use" : "Agent Desktop";
    setNotice?.(`${label} 后端已${next ? "启用" : "停用"}（重启应用后生效）`);
  };
  /** agent-desktop 走既有 npm 在线更新链（国内镜像）；装完复核磁盘版本并重启引擎。 */
  const installAgentDesktop = async () => {
    setInstallingAgent(true);
    try {
      const r: any = await window.codex.updateRuntime("agent-desktop").catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
      if (r?.ok === false) { setNotice?.(r?.error ?? "安装失败"); return; }
      const fresh = await window.codex.toolStatus().catch(() => null);
      if (Array.isArray(fresh)) setRows(fresh);
      setNotice?.("Agent Desktop 已安装（引擎已重启，新会话可用）");
    } finally {
      setInstallingAgent(false);
    }
  };
  /* 优先级固定：agent-desktop（无障碍树 · 首选）→ computer-use（第二清单通道）→ nuphus（截屏/OCR 兜底）。
     ⛔ 默认只开 agent-desktop；另两个由用户显式开启后才参与兜底。 */
  const active = backends.agentDesktop ? "agentDesktop" : backends.computerUse ? "computerUse" : backends.nuphus ? "nuphus" : "";
  const roleOf = (key: "nuphus" | "computerUse" | "agentDesktop") => (!backends[key] ? "停用" : key === active ? "主" : "辅");
  const statusOf = (id: string) => (rows || []).find((tool: any) => tool.id === id);
  const nuphus = statusOf("nuphus-mcp");
  const computerUse = statusOf("computer-use");
  const agentDesktop = statusOf("agent-desktop");
  const tagOf = (row: any, enabled: boolean) => {
    if (!enabled) return "已停用";
    if (!row) return "读取中";
    if (!row.installed) return "未安装";
    return row.version ? `已安装 · ${row.version}` : "已安装";
  };
  const toneOf = (row: any, enabled: boolean) => {
    if (!enabled) return " is-warn";
    if (!row) return "";
    return row.installed ? " is-ok" : " is-warn";
  };

  return (
    <section className="settings-section stack">
      <div className="settings-card">
        <div className="settings-card-head">
          <Monitor size={14} />桌面自动化
          <span className="settings-card-head-hint">三个后端可同时启用；默认只开 Agent Desktop</span>
        </div>
        <div className="settings-card-body">
          <div className="browser-chain" aria-label="当前桌面自动化链路">
            <span className="browser-chain-label">当前链路</span>
            <span className={`browser-chain-node${active === "agentDesktop" ? " is-on" : ""}`}>Agent Desktop<span className="browser-chain-tag">{roleOf("agentDesktop")}</span></span>
            <span className="browser-chain-arrow">›</span>
            <span className={`browser-chain-node${active === "computerUse" ? " is-on" : ""}`}>Computer Use<span className="browser-chain-tag">{roleOf("computerUse")}</span></span>
            <span className="browser-chain-arrow">›</span>
            <span className={`browser-chain-node${active === "nuphus" ? " is-on" : ""}`}>Nuphus<span className="browser-chain-tag">{roleOf("nuphus")}</span></span>
          </div>

          <div className="browser-cap-grid auto-backend-cards">
            <article className={`browser-cap-card${backends.agentDesktop ? " is-on" : ""}`}>
              <div className="browser-cap-head">
                <span className="browser-cap-icon is-cyan"><Scan size={15} /></span>
                <strong>Agent Desktop 后端</strong>
                <em className={`browser-cap-tag${toneOf(agentDesktop, backends.agentDesktop)}`}>{tagOf(agentDesktop, backends.agentDesktop)}</em>
                <ToggleSwitch checked={backends.agentDesktop} label="Agent Desktop 后端" onChange={(next) => void toggleBackend("agentDesktop", next)} />
              </div>
              <p>Vercel Labs 无障碍树（Apache-2.0）：核心 12 个工具，按 @ref 快照/查找/点击/输入，不猜坐标；默认主后端。</p>
              <button type="button" className="browser-cap-action" disabled={installingAgent} onClick={() => void installAgentDesktop()}>
                {installingAgent ? "更新中…" : agentDesktop?.installed ? "检查更新" : "安装"}<ArrowUpRight size={12} />
              </button>
            </article>

            <article className={`browser-cap-card${backends.computerUse ? " is-on" : ""}`}>
              <div className="browser-cap-head">
                <span className="browser-cap-icon is-blue"><Cpu size={15} /></span>
                <strong>Computer Use 后端</strong>
                <em className={`browser-cap-tag${toneOf(computerUse, backends.computerUse)}`}>{tagOf(computerUse, backends.computerUse)}</em>
                <ToggleSwitch checked={backends.computerUse} label="Computer Use 后端" onChange={(next) => void toggleBackend("computerUse", next)} />
              </div>
              <p>9 个电脑操作工具，走系统无障碍控件清单；agent-desktop 不可用时的第二清单通道。</p>
              {onOpenDevtools && <button type="button" className="browser-cap-action" onClick={onOpenDevtools}>去开发工具查看<ArrowUpRight size={12} /></button>}
            </article>

            <article className={`browser-cap-card${backends.nuphus ? " is-on" : ""}`}>
              <div className="browser-cap-head">
                <span className="browser-cap-icon is-violet"><Monitor size={15} /></span>
                <strong>Nuphus 后端</strong>
                <em className={`browser-cap-tag${toneOf(nuphus, backends.nuphus)}`}>{tagOf(nuphus, backends.nuphus)}</em>
                <ToggleSwitch checked={backends.nuphus} label="Nuphus 后端" onChange={(next) => void toggleBackend("nuphus", next)} />
              </div>
              <p>截屏 + 本地 OCR + 像素坐标；无障碍树不可用（画布/自绘界面）时兜底，浏览器回落通道也由它提供。</p>
              {onOpenDevtools && <button type="button" className="browser-cap-action" onClick={onOpenDevtools}>去开发工具查看<ArrowUpRight size={12} /></button>}
            </article>
          </div>

          <p className="settings-card-hint">默认只启用 Agent Desktop；另两个需要时再开。同时开启时按「Agent Desktop 主 → Computer Use 辅 → Nuphus 兜底」分工，Codex 的常驻指令会按开启组合下发对应的调用顺序。改完重启应用生效。</p>
        </div>
      </div>
    </section>
  );
}
