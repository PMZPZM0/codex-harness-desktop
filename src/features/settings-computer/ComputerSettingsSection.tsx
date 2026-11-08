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
import { ArrowUpRight, Cpu, Monitor } from "lucide-react";
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
  /* 两个桌面后端开关与「控制台 → 桌面自动化」读写同一份 app-settings（单一真相源，别各存一份） */
  const [backends, setBackends] = useState<{ nuphus: boolean; computerUse: boolean }>({ nuphus: true, computerUse: true });
  useEffect(() => {
    void window.codex.readAppSettings()
      .then((s) => setBackends({ nuphus: s.desktopBackendNuphus !== false, computerUse: s.desktopBackendComputerUse !== false }))
      .catch(() => undefined);
  }, []);
  const toggleBackend = async (key: "nuphus" | "computerUse", next: boolean) => {
    const saved = await window.codex.saveAppSettings(key === "nuphus" ? { desktopBackendNuphus: next } : { desktopBackendComputerUse: next }).catch(() => null);
    if (!saved) { setNotice?.("保存失败：主进程未响应"); return; }
    setBackends({ nuphus: saved.desktopBackendNuphus !== false, computerUse: saved.desktopBackendComputerUse !== false });
    setNotice?.(`${key === "nuphus" ? "Nuphus" : "Computer Use"} 后端已${next ? "启用" : "停用"}（重启应用后生效）`);
  };
  const isMac = /Mac|iPhone|iPad/i.test(String(navigator.platform || navigator.userAgent));
  const primary = isMac ? "computerUse" : "nuphus";
  const other = primary === "nuphus" ? "computerUse" : "nuphus";
  /* 链路跟着开关走：主后端被关掉 ⇒ 另一个接管；两个都关 ⇒ 都不点亮。 */
  const active = backends[primary] ? primary : backends[other] ? other : "";
  const roleOf = (key: "nuphus" | "computerUse") => (!backends[key] ? "停用" : key === active ? "主" : "辅");
  const statusOf = (id: string) => (toolsStatus || []).find((tool: any) => tool.id === id);
  const nuphus = statusOf("nuphus-mcp");
  const computerUse = statusOf("computer-use");
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
          <span className="settings-card-head-hint">两个后端可同时启用，按系统排优先级</span>
        </div>
        <div className="settings-card-body">
          <div className="browser-chain" aria-label="当前桌面自动化链路">
            <span className="browser-chain-label">当前链路</span>
            <span className={`browser-chain-node${active === "nuphus" ? " is-on" : ""}`}>Nuphus<span className="browser-chain-tag">{roleOf("nuphus")}</span></span>
            <span className="browser-chain-arrow">›</span>
            <span className={`browser-chain-node${active === "computerUse" ? " is-on" : ""}`}>Computer Use<span className="browser-chain-tag">{roleOf("computerUse")}</span></span>
          </div>

          <div className="browser-cap-grid auto-backend-cards">
            <article className={`browser-cap-card${backends.nuphus ? " is-on" : ""}`}>
              <div className="browser-cap-head">
                <span className="browser-cap-icon is-violet"><Monitor size={15} /></span>
                <strong>Nuphus 后端</strong>
                <em className={`browser-cap-tag${toneOf(nuphus, backends.nuphus)}`}>{tagOf(nuphus, backends.nuphus)}</em>
                <ToggleSwitch checked={backends.nuphus} label="Nuphus 后端" onChange={(next) => void toggleBackend("nuphus", next)} />
              </div>
              <p>35 个桌面 / 浏览器工具，经 <code>nuphus-call</code> 按需调用；当前{roleOf("nuphus")}后端。</p>
              {onOpenDevtools && <button type="button" className="browser-cap-action" onClick={onOpenDevtools}>去开发工具查看<ArrowUpRight size={12} /></button>}
            </article>

            <article className={`browser-cap-card${backends.computerUse ? " is-on" : ""}`}>
              <div className="browser-cap-head">
                <span className="browser-cap-icon is-blue"><Cpu size={15} /></span>
                <strong>Computer Use 后端</strong>
                <em className={`browser-cap-tag${toneOf(computerUse, backends.computerUse)}`}>{tagOf(computerUse, backends.computerUse)}</em>
                <ToggleSwitch checked={backends.computerUse} label="Computer Use 后端" onChange={(next) => void toggleBackend("computerUse", next)} />
              </div>
              <p>9 个电脑操作工具，走系统无障碍控件清单；当前{roleOf("computerUse")}后端。</p>
              {onOpenDevtools && <button type="button" className="browser-cap-action" onClick={onOpenDevtools}>去开发工具查看<ArrowUpRight size={12} /></button>}
            </article>
          </div>

          <p className="settings-card-hint">关掉一个后端只停用它那一组工具，另一个照常工作；改完重启应用生效。未安装的后端会显示「未安装」和安装入口，不会静默消失。</p>
        </div>
      </div>
    </section>
  );
}
