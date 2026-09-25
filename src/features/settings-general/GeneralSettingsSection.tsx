/**
 * 设置页 · general（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX 与原块逐字一致（仅去掉外层缩进）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 *
 * 09-25 新增「配置目录可自定义」（DataDirEditor）：改的是 userData 指路牌
 * （默认目录下 data-dir.json），保存后经 app.relaunch 重启，迁移由主进程在
 * 引擎 spawn 之前完成（electron/data-dir.ts）。
 */
import { useEffect, useState } from "react";
import { Code2, Copy, FolderOpen, FolderTree, Globe2, Keyboard, Monitor, MonitorUp, PanelRightOpen, RefreshCw, Search, ShieldCheck, Zap } from "lucide-react";
import { copyTextToClipboard } from "../../lib/clipboard";
import { ToggleSwitch } from "../../components/SettingsWidgets";
import { Spinner } from "../../components/CardShell";

export type GeneralSettingsSectionProps = { globalPermApproval: any; applyGlobalPermissionMode: any; workspace: any; chooseWorkspace: any; userDataPath: any; setNotice: any; rightOpen: any; setRightOpen: any; capabilityHint: any; desktopAuto: any; groupBusy: any; toggleDesktopAuto: any; browserAuto: any; toggleBrowserAuto: any; ponytailOn: any; applyGroup: any; hardwareAccel: any; changeHardwareAccel: any; restartPending: any; SHORTCUT_GROUPS: any; setShortcutsOpen: any; engineVersion: any; engineCheck: any; engineUpdating: any; checkEngineUpdateNow: any; performEngineUpdateNow: any; engineUpdatePercent: any; engineUpdateStageText: any; engineUpdateLog: any; engineUpdateResult: any; relaunchCountdown: any };

/* ══ 配置目录自定义（09-25）═══════════════════════════════════════════════
 * 自持状态小组件（不占 bag）。写的是主进程指路牌（data-dir.json），
 * 实际目录切换与数据迁移发生在**下一次启动**（引擎 spawn 之前），所以必须重启生效。 */
function DataDirEditor({ currentPath, setNotice }: { currentPath: string; setNotice: (s: string) => void }) {
  const [info, setInfo] = useState<{ current: string; defaultDir: string; custom: string | null; migratePending: boolean } | null>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let alive = true;
    void window.codex.readDataDir().then((v) => { if (alive) setInfo(v); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const shown = info?.current ?? currentPath;
  const browse = async () => {
    const dir = await window.codex.chooseDirectory();
    if (dir) setValue(dir);
  };
  const save = async () => {
    setBusy(true);
    setMsg("");
    try {
      const r = await window.codex.prepareDataDir(value);
      const info2 = await window.codex.readDataDir();
      setInfo(info2);
      setEditing(false);
      setSaved(true);
      setMsg(r.restoreDefault
        ? "已恢复默认目录，重启应用后生效。"
        : (r.note ?? (r.migrate ? "已保存。重启应用后将自动把现有数据迁移到新目录（旧目录保留作备份）。" : "已保存，重启应用后生效。")));
      setNotice("数据目录已更新，重启后生效");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const restore = async () => {
    setBusy(true);
    try {
      await window.codex.prepareDataDir(info?.defaultDir ?? "");
      const info2 = await window.codex.readDataDir();
      setInfo(info2);
      setEditing(false);
      setSaved(true);
      setMsg("已恢复默认目录，重启应用后生效。");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const restart = async () => {
    setBusy(true);
    await window.codex.relaunchApp();
  };

  return (
    <>
      <div className="path-row">
        <span className="path-row-label">配置目录</span>
        <span className="path-row-input"><span className="path-row-value" title={shown || "读取中…"}>{shown || "读取中…"}</span>
          <span className="path-row-actions">
            <button className="secondary-setting" onClick={() => { setEditing((v) => !v); setSaved(false); setMsg(""); setValue(info?.custom ?? ""); }}><FolderOpen size={14} />{info?.custom ? "更改 / 恢复默认" : "更改…"}</button>
            <button className="icon-button" title="复制路径" onClick={() => { void copyTextToClipboard(shown || ""); setNotice("配置目录已复制"); }}><Copy size={14} /></button>
            <button className="icon-button" title="在文件管理器中打开" disabled={!shown} onClick={() => { if (shown) void window.codex.shellReveal(shown); }}><FolderTree size={15} /></button>
          </span>
        </span>
      </div>
      {editing && (
        <div className="path-row">
          <span className="path-row-label">新目录</span>
          <span className="path-row-input">
            <input className="path-row-value datadir-input" value={value} placeholder={info?.defaultDir} disabled={busy} onChange={(e) => setValue(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
            <span className="path-row-actions">
              <button className="secondary-setting" disabled={busy} onClick={() => void browse()}>浏览…</button>
              <button className="primary-setting" disabled={busy || !value.trim()} onClick={() => void save()}>保存</button>
              {info?.custom && <button className="secondary-setting" disabled={busy} onClick={() => void restore()}>恢复默认</button>}
            </span>
          </span>
        </div>
      )}
      {msg && <p className="settings-card-hint">{msg}{saved && <button className="secondary-setting" style={{ marginLeft: 10 }} disabled={busy} onClick={() => void restart()}><RefreshCw size={13} />立即重启</button>}</p>}
      {info?.migratePending && !msg && <p className="settings-card-hint">数据迁移待执行：下次启动时自动把现有数据迁到自定义目录。</p>}
    </>
  );
}

export function GeneralSettingsSection(props: GeneralSettingsSectionProps) {
  const { globalPermApproval, applyGlobalPermissionMode, workspace, chooseWorkspace, userDataPath, setNotice, rightOpen, setRightOpen, capabilityHint, desktopAuto, groupBusy, toggleDesktopAuto, browserAuto, toggleBrowserAuto, ponytailOn, applyGroup, hardwareAccel, changeHardwareAccel, restartPending, SHORTCUT_GROUPS, setShortcutsOpen, engineVersion, engineCheck, engineUpdating, checkEngineUpdateNow, performEngineUpdateNow, engineUpdatePercent, engineUpdateStageText, engineUpdateLog, engineUpdateResult, relaunchCountdown } = props;
  return (
    <>
      <section className="settings-section stack general-page">
                    <div className="settings-copy"><h2>控制台</h2><p>管理工作区、数据目录与应用行为。</p></div>

                    {/* 全局审批权限：控制台一级入口。选择立即生效（当前会话马上推送引擎，
                        其余未手动改过权限的会话打开时跟随，新会话默认使用），无需重启。 */}
                    <div className="settings-card">
                      <div className="settings-card-head"><ShieldCheck size={15} /><strong>全局审批权限</strong><span className="settings-subhead-hint">选择立即生效，无需重启</span></div>
                      <div className="settings-card-body">
                        <div className="perm-seg">
                          {[{ v: "never", t: "完全访问", d: "自动执行，减少确认次数" }, { v: "on-request", t: "变更前确认", d: "改文件前先问我" }, { v: "untrusted", t: "自动编辑", d: "自动编辑文件" }].map((opt) => (
                            <button key={opt.v} type="button" className={`perm-seg-btn ${globalPermApproval === opt.v ? "on" : ""}`} onClick={() => applyGlobalPermissionMode(opt.v)}>
                              <strong>{opt.t}</strong>
                              <small>{opt.d}</small>
                              {globalPermApproval === opt.v && <em>当前</em>}
                            </button>
                          ))}
                        </div>
                        <p className="settings-card-hint">所有未手动改过权限的会话与新会话都使用此档位；在对话里手动改过权限的对话框保留自己的选择，不跟随。重启后保持不变。</p>
                      </div>
                    </div>

                    <div className="settings-card">
                      <div className="settings-card-head"><FolderOpen size={15} /><strong>工作区与数据</strong></div>
                      <div className="settings-card-body">
                        <div className="path-row">
                          <span className="path-row-label">当前工作区</span>
                          <span className="path-row-input"><span className="path-row-value" title={workspace || "未选择"}>{workspace || "未选择工作区"}</span>
                            <span className="path-row-actions">
                              <button className="secondary-setting" onClick={() => void chooseWorkspace()}><FolderOpen size={14} />更换目录</button>
                              <button className="icon-button" title="在文件管理器中打开" disabled={!workspace} onClick={() => { if (workspace) void window.codex.shellReveal(workspace); }}><FolderTree size={15} /></button>
                            </span>
                          </span>
                        </div>
                        <DataDirEditor currentPath={userDataPath} setNotice={setNotice} />
                        <p className="settings-card-hint">模型、任务记录、记忆都保存在配置目录里。支持自定义到其他磁盘/目录：更改并重启后，现有数据会自动迁移过去（旧目录保留作备份）。如果换了个启动方式后配置「消失」，多半是两个启动方式用了不同目录。</p>
                      </div>
                    </div>

                    <div className="settings-card">
                      <div className="settings-card-head"><Monitor size={15} /><strong>启动与行为</strong></div>
                      <div className="settings-card-body settings-toggle-list">
                        <div className="settings-toggle-row">
                          <span className="settings-toggle-icon"><PanelRightOpen size={16} /></span>
                          <span className="settings-toggle-text"><strong>启动时打开右侧面板</strong><small>打开应用后自动显示上下文面板</small></span>
                          <ToggleSwitch checked={rightOpen} label="启动时打开右侧面板" onChange={(next) => { setRightOpen(next); localStorage.setItem("right-panel-open", String(next)); }} />
                        </div>
                        <div className="settings-toggle-row">
                          <span className="settings-toggle-icon"><Monitor size={16} /></span>
                          <span className="settings-toggle-text"><strong>桌面自动化</strong><small>{capabilityHint("desktop-automation") ?? "加载 nuphus 桌面工具（屏幕、窗口、键鼠、剪贴板、OCR）。关闭后 nuphus MCP 不注册、desktop-automation 技能停用，约 10K 工具 schema 不再进上下文，能减少 token 占用、加快回复"}</small></span>
                          <ToggleSwitch checked={desktopAuto} disabled={groupBusy === "desktop-automation"} label="桌面自动化" onChange={toggleDesktopAuto} />
                        </div>
                        <div className="settings-toggle-row">
                          <span className="settings-toggle-icon"><Globe2 size={16} /></span>
                          <span className="settings-toggle-text"><strong>浏览器自动化</strong><small>{capabilityHint("browser-automation") ?? "提供 playwright-cli / cloakbrowser 浏览器操作能力。关闭后移除浏览器调用说明与 browser_use feature、停用 browser-automation 技能，模型不再被引导使用浏览器工具，能减少上下文占用"}</small></span>
                          <ToggleSwitch checked={browserAuto} disabled={groupBusy === "browser-automation"} label="浏览器自动化" onChange={toggleBrowserAuto} />
                        </div>
                        <div className="settings-toggle-row">
                          <span className="settings-toggle-icon"><Code2 size={16} /></span>
                          <span className="settings-toggle-text"><strong>写代码模式（代码钩子）</strong><small>{capabilityHint("writing-code") ?? "开启时启用 ponytail 注入开关、ponytail 插件及其 6 个子技能（audit / debt / gain / help / review 等），钩子生效、注入精简工程规则；关闭后钩子静默跳过，回复更快。日常聊天建议关闭。默认开启。"}</small></span>
                          <ToggleSwitch checked={ponytailOn} disabled={groupBusy === "writing-code"} label="写代码模式（代码钩子）" onChange={(next) => void applyGroup("writing-code", next)} />
                        </div>
                        <p className="settings-card-hint">这两个是能力总闸：开关直接决定 Codex 引擎能不能用对应能力，并联动其下的 MCP、技能与插件（例如桌面自动化会一并启停 nuphus MCP 与 desktop-automation 技能）。在技能 / MCP / 插件页点关这些子项时会提示你回到这里操作，保证状态一致。</p>
                      </div>
                    </div>

                    <div className="settings-card">
                      <div className="settings-card-head"><Zap size={15} /><strong>显示与性能</strong></div>
                      <div className="settings-card-body">
                        <div className="settings-toggle-row">
                          <span className="settings-toggle-icon"><MonitorUp size={16} /></span>
                          <span className="settings-toggle-text"><strong>硬件加速</strong><small>控制应用渲染走 GPU 还是 CPU 软件渲染。<br />· 自动：由 Chromium 判断（健康显卡自动硬件加速，弱核显/旧显卡默认软件渲染）<br />· 强制开启：忽略显卡黑名单走 GPU——低配机/集成显卡上界面卡顿时建议选这个<br />· 关闭：完全用 CPU 渲染（个别显卡与 GPU 通道冲突导致花屏/闪烁时用）<br />修改后需重启应用生效。</small></span>
                          <select className="accel-select" value={hardwareAccel} onChange={(event) => changeHardwareAccel(event.target.value as "auto" | "force" | "off")}>
                            <option value="auto">自动</option>
                            <option value="force">强制开启</option>
                            <option value="off">关闭</option>
                          </select>
                        </div>
                        {restartPending && <p className="settings-card-hint accel-restart-hint">⚡ 硬件加速设置已保存，重启应用后生效。</p>}
                      </div>
                    </div>

                    <div className="settings-card">
                      <div className="settings-card-head"><Keyboard size={15} /><strong>键盘快捷键</strong></div>
                      <div className="settings-card-body">
                        <div className="shortcut-preview">
                          {SHORTCUT_GROUPS.slice(0, 2).flatMap((group: any) => group.shortcuts).slice(0, 6).map((item: any) => (
                            <div className="shortcut-preview-row" key={item.keys.join("+")}><span>{item.desc}</span><span className="shortcut-keys">{item.keys.slice(0, 1).map((key: any, index: any) => <kbd key={index}>{key}</kbd>)}</span></div>
                          ))}
                        </div>
                        <button className="secondary-setting shortcut-manage-btn" onClick={() => { setShortcutsOpen(true); }}><Keyboard size={14} />查看全部快捷键</button>
                      </div>
                    </div>

                    <div className="settings-card">
                      <div className="settings-card-head"><RefreshCw size={15} /><strong>Codex 引擎更新</strong></div>
                      <div className="settings-card-body">
                        <div className="engine-status-row">
                          <span className="engine-ver-chip" title={engineVersion}>{(engineVersion.match(/[\d][\d.]*/) || ["—"])[0]}</span>
                          <span className="engine-status-text">
                            {engineCheck.state === "idle" && "检查更新会访问 npm 仓库（默认国内镜像直连，无需代理）"}
                            {engineCheck.state === "checking" && "正在查询最新稳定版…"}
                            {engineCheck.state === "latest" && "已是最新版本"}
                            {engineCheck.state === "available" && `官方已发布新版 ${engineCheck.latest}`}
                            {engineCheck.state === "error" && `检查失败：${engineCheck.message}`}
                          </span>
                          <button className="secondary-setting engine-check-btn" disabled={engineCheck.state === "checking" || engineUpdating} onClick={() => void checkEngineUpdateNow()}>
                            {engineCheck.state === "checking" ? <Spinner /> : <Search size={14} />}{engineCheck.state === "checking" ? "检查中…" : "检查更新"}
                          </button>
                        </div>
                        {engineCheck.state === "available" && !engineUpdating && (
                          <div className="engine-update-strip">
                            <div className="engine-update-strip-copy">
                              <strong>更新到 {engineCheck.latest}</strong>
                              <small>自动备份旧引擎 · 失败自动回滚 · 完成后自动重启应用</small>
                            </div>
                            <button className="primary-setting engine-update-btn" onClick={() => void performEngineUpdateNow()}>
                              <RefreshCw size={14} />一键更新
                            </button>
                          </div>
                        )}
                        {engineUpdating && (
                          <div className="engine-update-strip running">
                            <div className="engine-update-progress">
                              <div className="engine-update-progress-bar">
                                <i style={{ width: `${Math.round((engineUpdatePercent ?? 0.06) * 100)}%` }} className={engineUpdatePercent == null ? "indeterminate" : ""} />
                              </div>
                              <span className="engine-update-busy">{engineUpdateStageText}·请勿关闭应用</span>
                            </div>
                          </div>
                        )}
                        {engineUpdateLog.length > 0 && (
                          <div className="engine-update-log">
                            {engineUpdateLog.map((line: any, index: any) => <p key={index}>{line}</p>)}
                          </div>
                        )}
                        {engineUpdateResult && !engineUpdateResult.ok && <p className="settings-card-hint engine-update-error">更新失败：{engineUpdateResult.message}（旧引擎已回滚，应用不受影响，可重试）</p>}
                        {relaunchCountdown != null && <p className="settings-card-hint engine-update-ok">✅ 引擎更新完成，{relaunchCountdown} 秒后自动重启应用生效…</p>}
                        <p className="settings-card-hint">下载默认跟随本地网络：优先国内镜像直连，检测到系统代理时自动走代理，无需手动配置。</p>
                      </div>
                    </div>
                  </section>
    </>
  );
}
