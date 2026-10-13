/**
 * 设置页 · automation（09-21 从 App.tsx 内联块搬出）。
 *
 * ⛔ 10-13 改版：原「工具链更新」区块升级为**「自动更新」卡片**（用户要求：桌面 / 浏览器 /
 *    Mac 电脑操作 / Codex 引擎四类各自一个自动更新开关，默认开启、持久化、互相独立）。
 *    与「开发工具」页的**修复安装**分工不同，界面文案必须分清：
 *      · 修复安装 = 从随包 zip 重解压 ⇒ 版本回到「包内版本」（离线，永远可用；相对已升级版本属**降级**）；
 *      · 在线更新 = 从 npm 国内镜像装 `<pkg>@latest` ⇒ 真升级（联网，版本跟着 npm 走）。
 *   ⛔⛔ 清单 / 包名 / 版本号 / 开关缺省值**全在主进程**（autoUpdate:status ← UPDATEABLE_TOOLS +
 *      UPDATEABLE 开关字段 + engine-updater）：本组件只渲染 + 触发，
 *      ⛔⛔ **绝不另抄一份工具清单或包名**（本项目反复栽在「两处各写一套」上）。
 *      ⇒ Mac 电脑操作那张卡在 Windows 上**根本不会返回**，无需本组件判断平台。
 *   ⛔ 进度复用既有 runtime:progress 事件与 `runtime-progress-bar` 样式（不新开通道、不新造样式）。
 *   ⛔ 后台自动更新在主进程跑（不开设置页也执行），本页只是**状态与开关的视图**。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, CircleCheck, Globe2, RefreshCw, ShieldCheck, Workflow } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { ToggleSwitch } from "../../components/SettingsWidgets";

export type AutomationSettingsSectionProps = { setSettingsPage: any };

type AutoUpdateRow = {
  id: string;
  kind: "tool" | "engine";
  label: string;
  pkg: string;
  enabled: boolean;
  current: string;
  latest: string;
  hasUpdate: boolean;
  error: string;
};

export function AutomationSettingsSection(props: AutomationSettingsSectionProps) {
  const { setSettingsPage } = props;
  // 只认本区块关心的工具：id 集合来自主进程返回的行，不硬编码第二份清单。
  const watched = useRef<Set<string>>(new Set());
  const [rows, setRows] = useState<AutoUpdateRow[]>([]);
  const [checking, setChecking] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [toggling, setToggling] = useState<Record<string, boolean>>({});
  const [percent, setPercent] = useState<Record<string, number>>({});
  const [stage, setStage] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<Record<string, string>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const checkAll = useCallback(async () => {
    setChecking(true);
    try {
      const list: AutoUpdateRow[] = await window.codex.readAutoUpdateStatus();
      const safe = Array.isArray(list) ? list : [];
      setRows(safe);
      watched.current = new Set(safe.map((row) => row.id));
      setRowError(Object.fromEntries(safe.filter((row) => row.error).map((row) => [row.id, row.error])));
    } catch (error: any) {
      setRowError({ all: `读取自动更新状态失败：${error?.message ?? error}` });
    } finally {
      setChecking(false);
    }
  }, []);

  // 打开页面即查一次（只读请求，代价是几次极小的 registry 查询）
  useEffect(() => { void checkAll(); }, [checkAll]);

  useEffect(() => {
    const off = window.codex.onRuntimeProgress?.((event: any) => {
      if (!event?.id || !watched.current.has(event.id)) return;
      if (typeof event.percent === "number") setPercent((current) => ({ ...current, [event.id]: event.percent }));
      if (event.stage) setStage((current) => ({ ...current, [event.id]: event.stage }));
      if (event.message) setMessage((current) => ({ ...current, [event.id]: event.message }));
      if (event.failed) setRowError((current) => ({ ...current, [event.id]: String(event.message ?? "更新失败") }));
    });
    return () => { try { off?.(); } catch { /* 忽略 */ } };
  }, []);

  /** 切换某一类的自动更新开关。⛔ 四类**各自一次调用、只写自己那个字段** ⇒ 互不影响。 */
  async function toggleAutoUpdate(id: string, enabled: boolean) {
    setToggling((current) => ({ ...current, [id]: true }));
    // 先本地乐观更新（开关手感），失败再回滚 —— 后台开关不该让用户等一次磁盘往返
    setRows((current) => current.map((row) => (row.id === id ? { ...row, enabled } : row)));
    try {
      const result: any = await window.codex.setAutoUpdate(id, enabled);
      setRows((current) => current.map((row) => (row.id === id ? { ...row, enabled: Boolean(result?.enabled) } : row)));
    } catch (error: any) {
      setRows((current) => current.map((row) => (row.id === id ? { ...row, enabled: !enabled } : row)));
      setRowError((current) => ({ ...current, [id]: `开关保存失败：${error?.message ?? error}` }));
    } finally {
      setToggling((current) => ({ ...current, [id]: false }));
    }
  }

  async function runUpdate(id: string) {
    setBusyId(id);
    setRowError((current) => ({ ...current, [id]: "" }));
    setPercent((current) => ({ ...current, [id]: 0 }));
    setStage((current) => ({ ...current, [id]: "准备更新" }));
    setMessage((current) => ({ ...current, [id]: "" }));
    try {
      const result: any = await window.codex.updateRuntime(id);
      if (result?.cancelled) {
        setMessage((current) => ({ ...current, [id]: "已取消，临时文件已清理" }));
      } else {
        setMessage((current) => ({ ...current, [id]: result?.to ? `已更新到 ${result.to}` : "更新完成" }));
        await checkAll();
      }
    } catch (error: any) {
      setRowError((current) => ({ ...current, [id]: `更新失败：${error?.message ?? error}` }));
    } finally {
      setBusyId("");
    }
  }

  async function cancelUpdate(id: string) {
    try {
      const result: any = await window.codex.cancelRuntime(id);
      if (!result?.ok) setMessage((current) => ({ ...current, [id]: "没有正在进行的更新" }));
    } catch { /* 忽略：取消失败不影响已完成的更新 */ }
  }

  /** 顶部三张自动化卡片上的版本号（桌面 / 浏览器）—— 数据来自同一份主进程状态，不另查。 */
  function versionOf(id: string): string {
    return rows.find((row) => row.id === id)?.current ?? "";
  }

  return (
    <>
                    <section className="settings-section stack">
                      <div className="settings-copy"><h2>自动化</h2><p>浏览器、桌面与 RPA 三类自动化能力的总入口。</p></div>
                      <div className="hub-card-grid">
                        <button className="hub-card" onClick={() => setSettingsPage("browser")}>
                          <span className="hub-card-icon"><Globe2 size={20} /></span>
                          <strong>浏览器自动化</strong>
                          <p>内置浏览器面板与 playwright-cli / CloakBrowser 工具链；默认起始页设置在这里。</p>
                          {versionOf("playwright-cli") ? <em className="hub-card-version">playwright-cli {versionOf("playwright-cli")}</em> : null}
                        </button>
                        <button className="hub-card" onClick={() => setSettingsPage("computer")}>
                          <span className="hub-card-icon"><ShieldCheck size={20} /></span>
                          <strong>桌面自动化</strong>
                          <p>审批与沙箱策略，nuphus MCP 桌面工具（截屏、键鼠、窗口、OCR）。</p>
                          {versionOf("nuphus") ? <em className="hub-card-version">nuphus {versionOf("nuphus")}</em> : null}
                        </button>
                        <button className="hub-card" onClick={() => setSettingsPage("rpa")}>
                          <span className="hub-card-icon"><Workflow size={20} /></span>
                          <strong>RPA 自动化</strong>
                          <p>Codex 自主沉淀流程配方，下次一句话直接复现；任务清单自主维护。</p>
                        </button>
                      </div>
                    </section>

                    <section className="settings-section stack">
                      <div className="settings-copy">
                        <h2>自动更新</h2>
                        <p>开启后主进程在后台静默检查并从国内镜像更新（启动后一次 + 每 6 小时一次），更新成功会发系统通知；四类开关互相独立，关掉哪一类都不影响其它。Mac 电脑操作只在 macOS 上出现（它由 mac 专属工具链提供，其它平台不列也不检查）。</p>
                      </div>
                      <div className="runtime-list">
                        {rows.map((row) => {
                          const busy = busyId === row.id;
                          const failed = rowError[row.id];
                          return <div className={`runtime-row ${busy ? "busy" : "installed"}`} key={row.id}>
                            <span className="runtime-icon">{busy ? <Spinner /> : row.hasUpdate ? <ArrowDown size={16} /> : <CircleCheck size={16} />}</span>
                            <span className="runtime-copy">
                              <strong>{row.label}</strong>
                              <small>
                                {row.current ? `已装 ${row.current}` : "未检测到已装版本"}
                                {row.latest ? ` · 最新 ${row.latest}` : ""}
                                {" · "}{row.pkg}
                              </small>
                              {busy ? <span className="runtime-install-state">
                                <span className="runtime-progress-bar" role="progressbar" aria-label={`${row.label} 更新进度`} aria-valuenow={percent[row.id] ?? 0} aria-valuemin={0} aria-valuemax={100}>
                                  <i style={{ width: `${percent[row.id] ?? 0}%` }} />
                                </span>
                                <em className="runtime-progress">
                                  {stage[row.id] ? `${stage[row.id]} · ` : ""}
                                  {typeof percent[row.id] === "number" ? `${percent[row.id]}%` : "准备中"}
                                  {message[row.id] ? ` · ${message[row.id]}` : ""}
                                </em>
                              </span>
                                : failed ? <em className="runtime-hint">{failed}</em>
                                : row.hasUpdate ? <em className="runtime-hint">{row.kind === "engine" ? "有新版本 · 后台会自动更新（也可到「通用」页手动更新）" : "有新版本 · 走国内镜像升级（装完自动刷新引擎）"}</em>
                                : message[row.id] ? <em className="runtime-hint">{message[row.id]}</em>
                                : <em className="runtime-hint">已是最新</em>}
                            </span>
                            <span className="runtime-actions">
                              <ToggleSwitch
                                checked={row.enabled}
                                disabled={Boolean(toggling[row.id])}
                                label="自动更新"
                                title={`${row.label}：开启后后台自动从国内镜像更新`}
                                onChange={(value: boolean) => void toggleAutoUpdate(row.id, value)}
                              />
                              {row.kind === "tool"
                                ? (busy
                                  ? <button className="secondary-setting runtime-cancel" onClick={() => void cancelUpdate(row.id)}>取消</button>
                                  : row.hasUpdate
                                    ? <button className="primary-setting runtime-install" disabled={Boolean(busyId)} onClick={() => void runUpdate(row.id)}><ArrowDown size={14} />更新到 {row.latest}</button>
                                    : <button className="secondary-setting runtime-install" disabled={checking} onClick={() => void checkAll()}><RefreshCw size={13} />{checking ? "检查中…" : "检查更新"}</button>)
                                : null}
                            </span>
                          </div>;
                        })}
                        {!rows.length && <div className="runtime-loading">{checking ? <><Spinner />正在读取自动更新状态…</> : "暂时取不到更新状态，点「检查更新」重试"}</div>}
                      </div>
                      {rowError.all ? <div className="settings-actions"><span>{rowError.all}</span></div> : null}
                    </section>
    </>
  );
}
