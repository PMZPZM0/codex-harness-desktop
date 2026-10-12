/**
 * 设置页 · automation（09-21 从 App.tsx 内联块搬出）。
 *
 * ⛔ 10-12 新增「工具链更新」区块（用户要求：「nuphus 和 browser 能不能留好国内镜像源更新入口」）。
 *   与「开发工具」页的**修复安装**分工不同，界面文案必须分清：
 *     · 修复安装 = 从随包 zip 重解压 ⇒ 版本回到「包内版本」（离线，永远可用；相对已升级版本属**降级**）；
 *     · 在线更新 = 从 npm 国内镜像装 `<pkg>@latest` ⇒ 真升级（联网，版本跟着 npm 走）。
 *   ⛔ 清单 / 包名 / 版本判据**全在主进程**（runtime:update-check ← UPDATEABLE_TOOLS + npmGlobalRootCandidates）：
 *     本组件只渲染 + 触发，绝不另抄一份工具清单（本项目反复栽在「两处各写一套」上）。
 *   ⛔ 进度复用既有 runtime:progress 事件与 `runtime-progress-bar` 样式（不新开通道、不新造样式）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, CircleCheck, Globe2, RefreshCw, ShieldCheck, Workflow } from "lucide-react";
import { Spinner } from "../../components/CardShell";

export type AutomationSettingsSectionProps = { setSettingsPage: any };

type UpdateRow = { id: string; name: string; pkg: string; current: string; latest: string; registry: string; hasUpdate: boolean; error: string };

export function AutomationSettingsSection(props: AutomationSettingsSectionProps) {
  const { setSettingsPage } = props;
  // 只认本区块关心的工具：id 集合来自主进程返回的行，不硬编码第二份清单。
  const watched = useRef<Set<string>>(new Set());
  const [rows, setRows] = useState<UpdateRow[]>([]);
  const [checking, setChecking] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [percent, setPercent] = useState<Record<string, number>>({});
  const [stage, setStage] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<Record<string, string>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const checkAll = useCallback(async () => {
    setChecking(true);
    try {
      const result: any = await window.codex.checkRuntimeUpdate();
      const list: UpdateRow[] = Array.isArray(result) ? result : [result];
      setRows(list);
      watched.current = new Set(list.map((row) => row.id));
      setRowError(Object.fromEntries(list.filter((row) => row.error).map((row) => [row.id, row.error])));
    } catch (error: any) {
      setRowError({ all: `检查更新失败：${error?.message ?? error}` });
    } finally {
      setChecking(false);
    }
  }, []);

  // 打开页面即查一次（只读请求，代价是一次极小的 registry 查询）
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

  return (
    <>
                    <section className="settings-section stack">
                      <div className="settings-copy"><h2>自动化</h2><p>浏览器、桌面与 RPA 三类自动化能力的总入口。</p></div>
                      <div className="hub-card-grid">
                        <button className="hub-card" onClick={() => setSettingsPage("browser")}>
                          <span className="hub-card-icon"><Globe2 size={20} /></span>
                          <strong>浏览器自动化</strong>
                          <p>内置浏览器面板与 playwright-cli / CloakBrowser 工具链；默认起始页设置在这里。</p>
                        </button>
                        <button className="hub-card" onClick={() => setSettingsPage("computer")}>
                          <span className="hub-card-icon"><ShieldCheck size={20} /></span>
                          <strong>桌面自动化</strong>
                          <p>审批与沙箱策略，nuphus MCP 桌面工具（截屏、键鼠、窗口、OCR）。</p>
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
                        <h2>工具链更新</h2>
                        <p>桌面（nuphus）与浏览器（playwright-cli）两条工具链的在线升级：从 npm 国内镜像拉取最新版，装完会自动刷新引擎。</p>
                      </div>
                      <div className="runtime-list">
                        {rows.map((row) => {
                          const busy = busyId === row.id;
                          const failed = rowError[row.id];
                          return <div className={`runtime-row ${busy ? "busy" : "installed"}`} key={row.id}>
                            <span className="runtime-icon">{busy ? <Spinner /> : row.hasUpdate ? <ArrowDown size={16} /> : <CircleCheck size={16} />}</span>
                            <span className="runtime-copy">
                              <strong>{row.name}</strong>
                              <small>
                                {row.current ? `已装 ${row.current}` : "未检测到已装版本"}
                                {row.latest ? ` · 最新 ${row.latest}` : ""}
                                {row.registry ? ` · 源 ${row.registry.replace(/^https?:\/\//, "")}` : ""}
                              </small>
                              {busy ? <span className="runtime-install-state">
                                <span className="runtime-progress-bar" role="progressbar" aria-label={`${row.name} 更新进度`} aria-valuenow={percent[row.id] ?? 0} aria-valuemin={0} aria-valuemax={100}>
                                  <i style={{ width: `${percent[row.id] ?? 0}%` }} />
                                </span>
                                <em className="runtime-progress">
                                  {stage[row.id] ? `${stage[row.id]} · ` : ""}
                                  {typeof percent[row.id] === "number" ? `${percent[row.id]}%` : "准备中"}
                                  {message[row.id] ? ` · ${message[row.id]}` : ""}
                                </em>
                              </span>
                                : failed ? <em className="runtime-hint">{failed}</em>
                                : row.hasUpdate ? <em className="runtime-hint">有新版本 · 走国内镜像升级（装完自动刷新引擎）</em>
                                : message[row.id] ? <em className="runtime-hint">{message[row.id]}</em>
                                : <em className="runtime-hint">已是最新</em>}
                            </span>
                            <span className="runtime-size">{row.pkg}</span>
                            <div className="runtime-actions">
                              {busy
                                ? <button className="secondary-setting runtime-cancel" onClick={() => void cancelUpdate(row.id)}>取消</button>
                                : row.hasUpdate
                                  ? <button className="primary-setting runtime-install" disabled={Boolean(busyId)} onClick={() => void runUpdate(row.id)}><ArrowDown size={14} />更新到 {row.latest}</button>
                                  : <button className="secondary-setting runtime-install" disabled={checking} onClick={() => void checkAll()}><RefreshCw size={13} />{checking ? "检查中…" : "检查更新"}</button>}
                            </div>
                          </div>;
                        })}
                        {!rows.length && <div className="runtime-loading">{checking ? <><Spinner />正在检查工具链版本…</> : "暂时取不到工具链信息，点右下角「检查更新」重试"}</div>}
                      </div>
                      {rowError.all ? <div className="settings-actions"><span>{rowError.all}</span></div> : null}
                    </section>
    </>
  );
}
