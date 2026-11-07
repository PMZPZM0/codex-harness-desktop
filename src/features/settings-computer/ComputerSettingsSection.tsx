/**
 * 设置页 · 自动化 → 桌面自动化（11-06 重排展示）。
 *
 * 用户三问的落点：
 *  ①「这里为啥没有显示出来 computer use」—— 根因在 `tools:status` 只回了一条 Nuphus；
 *     现在两个后端都会列（未安装也列，用户才知道有得装）。
 *  ②「这个界面也优化一下展示」—— 从「三段下拉 + 一行提示 + 一张小卡」改成卡片分区。
 *  ③「自动化界面这里不需要展示上面卡片」—— 顶部「默认策略」卡已撤掉：审批在「控制台」、
 *     沙箱在输入框的权限胶囊、风格在「模型/个性化」，这一页只留桌面自动化本身。
 */
import { useEffect, useState } from "react";
import { Monitor } from "lucide-react";
import { ToggleSwitch } from "../../components/SettingsWidgets";

export type ComputerSettingsSectionProps = { toolsStatus: any; ToolCard: any; setNotice?: (text: string) => void };

export function ComputerSettingsSection(props: ComputerSettingsSectionProps) {
  const { toolsStatus, ToolCard, setNotice } = props;
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
  const chain = isMac ? "Computer Use 主 · Nuphus 辅" : "Nuphus 主 · Computer Use 辅";
  const computerTools = (toolsStatus || []).filter((tool: any) => tool.scope === "computer");

  return (
    <section className="settings-section stack">
      <div className="settings-card">
        <div className="settings-card-head">
          <Monitor size={14} />桌面自动化
          <span className="settings-card-head-hint">两个后端可同时启用，按系统排优先级</span>
        </div>
        <div className="settings-card-body">
          <div className="auto-chain">当前生效链路：<b>{chain}</b><span>两者都装时先走主后端，主后端不可用再回落另一个</span></div>
          <div className="tool-card-grid">
            {computerTools.map((tool: any) => <ToolCard tool={tool} key={tool.id} />)}
            {!computerTools.length && <p className="muted">正在读取工具状态…</p>}
          </div>
          <div className="auto-backends">
            <label className="auto-backend">
              <span>Nuphus 后端<small>35 个桌面/浏览器工具，经 nuphus-call 按需调用</small></span>
              <ToggleSwitch checked={backends.nuphus} label="Nuphus 后端" onChange={(next) => void toggleBackend("nuphus", next)} />
            </label>
            <label className="auto-backend">
              <span>Computer Use 后端<small>9 个电脑操作工具，走系统无障碍控件清单</small></span>
              <ToggleSwitch checked={backends.computerUse} label="Computer Use 后端" onChange={(next) => void toggleBackend("computerUse", next)} />
            </label>
          </div>
          <p className="settings-card-hint">关掉一个后端只停用它那一组工具，另一个照常工作；改完重启应用生效。未安装的后端会显示「未安装」和安装入口，不会静默消失。</p>
        </div>
      </div>
    </section>
  );
}
