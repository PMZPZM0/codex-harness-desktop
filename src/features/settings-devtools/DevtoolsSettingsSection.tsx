/**
 * 设置页 · devtools（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX 与原块逐字一致（仅去掉外层缩进）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 */
import { useState } from "react";
import { PageInfo } from "../../components/SettingsHead";
import { Activity, AlertTriangle, ArrowDown, BookOpen, CircleCheck, Copy, Download, ExternalLink, Globe2, TerminalSquare, Wrench } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { copyTextToClipboard } from "../../lib/clipboard";
import { PhoneHarnessCard } from "./PhoneHarnessCard";
import { LayaCard } from "./LayaCard";

export type DevtoolsSettingsSectionProps = { downloadSource?: any; capabilityRows: any; capabilityError: any; setNotice: any; devRuntimes: any; runtimeInstalling: any; runtimeUninstalling: any; runtimePercent: any; runtimeStage: any; runtimeSpeed: any; runtimeProgress: any; installDevRuntime: any; uninstallDevRuntime: any; cancelDevRuntime: any };

export function DevtoolsSettingsSection(props: DevtoolsSettingsSectionProps) {
  const { capabilityRows, capabilityError, setNotice, devRuntimes, runtimeInstalling, runtimeUninstalling, runtimePercent, runtimeStage, runtimeSpeed, runtimeProgress, installDevRuntime, uninstallDevRuntime, cancelDevRuntime } = props;
  // 「检查工具」（10-02 用户要的）：卡片上的「已安装」只证明**文件在**，不证明**能跑**。
  // 点一次让主进程逐个真跑版本命令，把不可用的挑出来显示 —— 结果只存本组件（打开页面即清空）。
  const [health, setHealth] = useState<any[] | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [healthError, setHealthError] = useState("");
  // 卸载二次确认（10-07 重构）：点「卸载」先出**行内确认**（沿用插件市场页的既有范式），再点才真删 ——
  // 卸载是真删本地文件，不可恢复，不该一击即中。
  const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null);
  const runHealth = async () => {
    setHealthBusy(true);
    setHealthError("");
    try {
      const rows = await (window as any).codex.runtimeHealth();
      setHealth(Array.isArray(rows) ? rows : []);
    } catch (error) {
      setHealthError(`自检失败：${String((error as any)?.message ?? error).slice(0, 200)}`);
    } finally {
      setHealthBusy(false);
    }
  };
  const healthInstalled = health ? health.filter((row: any) => row.installed) : [];
  const healthBad = healthInstalled.filter((row: any) => !row.ok);
  const healthMissing = health ? health.filter((row: any) => !row.installed).length : 0;
  return (
    <>
      <section className="settings-section stack">
                    <div className="settings-copy"><h2>开发工具<PageInfo text={<>桌面与浏览器自动化（Nuphus / Playwright CLI）与写代码模式插件随应用内置、开箱即用；CloakBrowser 指纹浏览器、两类浏览器内核与其余工具链按需下载（国内镜像优先，失败自动回落官方源），安装后自动加入 Codex 环境（不改系统 PATH）。</>} helpKey="devtools" label="开发工具" /></h2></div>
                    {/* 「当前能力链路」（09-21）：回答"现在实际走哪条" —— 原先这些规则散在技能文案与代码
                        注释里，用户只能看到零散的安装状态，出问题无法判断走的是哪条。判据的唯一来源见
                        electron/capability-registry.ts（⛔ 前端只渲染，不自己算）。 */}
                    <div className="devtools-capabilities" data-count={capabilityRows.length}>
                      <div className="settings-subhead">
                        <CircleCheck size={13} />当前能力链路
                        <span className="settings-subhead-hint">同一件事多个后端时，现在实际走哪条</span>
                      </div>
                      {capabilityRows.length === 0
                        ? <div className="settings-card-hint">{capabilityError || "读取中…（打开本页时自动刷新）"}</div>
                        : capabilityRows.map((cap: any) => (
                          <div className={`capability-row ${cap.activeId ? "" : "missing"}`} key={cap.id} data-capability={cap.id} data-active={cap.activeId ?? "none"}>
                            <span className="capability-copy"><strong>{cap.label}</strong><small>{cap.purpose}</small></span>
                            <span className="capability-active">{cap.activeId ? <CircleCheck size={14} /> : null}{cap.activeLabel}</span>
                            <span className="capability-why">{cap.activeWhy}</span>
                            {cap.alternatives.length > 0 && (
                              <span className="capability-alt">备选：{cap.alternatives.map((alt: any) => `${alt.label}${alt.available ? "（就绪）" : "（未就绪）"}`).join("、")}</span>
                            )}
                            {cap.note ? <span className="capability-note">{cap.note}</span> : null}
                          </div>
                        ))}
                    </div>
                    {/* 10-08 迁移：语音模型 / 音色克隆模型的选择项已搬到「设置 → 语音通话」——
                        用户要求语音相关的东西集中在一处（音色 / 模型 / 播报 / 语速同页）。
                        ⛔ 这里只留一句指路，不要再留第二份渲染（同一份状态两处渲染 = 双真相源）。 */}
                    <div className="settings-subhead"><Download size={13} />语音模型<span className="settings-subhead-hint">已移到「语音通话」页</span></div>
                    <div className="settings-card-hint">
                      语音模型（识别 + 合成）与音色克隆模型现在统一在<strong>设置 → 语音通话</strong>里管理
                      （下载 / 启用停用 / 删除），和音色、语速放在同一页。
                    </div>
                    {(() => {
                      // 09-16 用户「自动化工具拆开，拆详细一点」：不再一张「桌面与浏览器自动化」大卡，
                      // 拆成逐条能力卡（Nuphus / Playwright CLI / CloakBrowser / 两类内核 / ponytail）。
                      // bundled=true 的卡片显示「内置」（随包预装，无需安装；缺失时给「修复安装」）。
                      // 10-07 重构（用户「对工具合理分类整理」）：按用途细分五类，末组兜底 ——
                      // ⛔ 末组必须存在：将来新增工具忘了归类时落在「其它」而不是从界面上凭空消失。
                      const autoIds = ["nuphus", "playwright-cli", "cloakbrowser", "playwright-browsers", "cloak-browsers", "ponytail"];
                      const devChainIds = ["pwsh", "git", "conda", "mingw"];
                      const mediaIds = ["ffmpeg", "markitdown"];
                      const aiIds = ["kb-embedding"];
                      const notIn = (ids: string[]) => (r: any) => !ids.includes(r.id);
                      const groups = [
                        { key: "base", title: "基础运行时", hint: "随应用内置，离线可用", icon: <Wrench size={13} />, filter: (r: any) => r.builtIn },
                        { key: "auto", title: "桌面与浏览器自动化", hint: "Nuphus / Playwright CLI 随包内置，CloakBrowser 与浏览器内核按需下载", icon: <TerminalSquare size={13} />, filter: (r: any) => autoIds.includes(r.id) },
                        { key: "devchain", title: "开发工具链", hint: "Git / PowerShell 7 / Miniconda 等，按需下载（国内镜像优先）", icon: <Download size={13} />, filter: (r: any) => devChainIds.includes(r.id) },
                        { key: "media", title: "媒体与文档", hint: "音视频处理与文档格式转换", icon: <Activity size={13} />, filter: (r: any) => mediaIds.includes(r.id) },
                        { key: "ai", title: "本地智能", hint: "本地推理 / 语义检索，模型走国内镜像", icon: <BookOpen size={13} />, filter: (r: any) => aiIds.includes(r.id) },
                        { key: "system", title: "系统级安装", hint: "打开官网手动安装", icon: <Globe2 size={13} />, filter: (r: any) => r.kind === "guide" },
                        { key: "ondemand", title: "其它按需下载", hint: "联网下载安装（国内镜像优先）", icon: <Download size={13} />, filter: (r: any) => !r.builtIn && notIn(autoIds)(r) && notIn(devChainIds)(r) && notIn(mediaIds)(r) && notIn(aiIds)(r) && r.kind !== "guide" },
                      ];
                      return groups.map((g) => {
                        const items = devRuntimes.filter(g.filter);
                        if (!items.length) return null;
                        return <div className="devtools-group" key={g.key}>
                          <div className="settings-subhead">{g.icon}{g.title}<span className="settings-subhead-hint">{g.hint}</span></div>
                          <div className="runtime-list">
                            {items.filter((runtime: any) => !runtime.hidden).map((runtime: any) => {
                              const busy = runtimeInstalling === runtime.id || runtime.installing;
                              const isDone = runtime.installed || runtime.installedBySystem;
                              const isGuide = runtime.kind === "guide";
                              const builtinBadge = runtime.builtIn || (runtime.bundled && isDone);
                              /* 「这个工具刚装失败了」的判据 = app-state 写进 runtimeProgress 的那一行
                                 （`安装失败：<原因>`，同一份数据本来就显示给用户看）。⛔ 前缀是**契约**：
                                 另一侧写死的字符串在 01-dev-runtimes-capability.tsx，守卫【287】两边一起钉。 */
                              const installFailed = String(runtimeProgress?.[runtime.id] ?? "").startsWith("安装失败");
                              return <div className={`runtime-row ${isDone ? "installed" : "missing"} ${busy ? "busy" : ""}`} key={runtime.id}>
                                <span className="runtime-icon">{busy ? <Spinner /> : isDone ? <CircleCheck size={16} /> : <TerminalSquare size={16} />}</span>
                                <span className="runtime-copy"><strong>{runtime.name}</strong><small>{runtime.description}</small>
                                  {busy ? <span className="runtime-install-state">
                                    {/* 进度条（09-19 用户要求：安装过程不弹窗，用进度条可视化） */}
                                    <span className="runtime-progress-bar" role="progressbar" aria-label={`${runtime.name} 安装进度`} aria-valuenow={runtimePercent[runtime.id] ?? 0} aria-valuemin={0} aria-valuemax={100}>
                                      <i style={{ width: `${runtimePercent[runtime.id] ?? 0}%` }} />
                                    </span>
                                    <em className="runtime-progress">
                                      {runtimeStage[runtime.id] ? `${runtimeStage[runtime.id]} · ` : ""}
                                      {typeof runtimePercent[runtime.id] === "number" ? `${runtimePercent[runtime.id]}%` : "准备中"}
                                      {runtimeSpeed[runtime.id] ? ` · ${runtimeSpeed[runtime.id]}` : ""}
                                      {runtimeProgress[runtime.id] ? ` · ${runtimeProgress[runtime.id]}` : ""}
                                    </em>
                                  </span>
                                    : !isDone && runtime.bundled ? <em className="runtime-hint">随包内置能力缺失时可点「修复安装」从包内恢复</em>
                                    : !isDone && runtime.id === "cloakbrowser" ? <em className="runtime-hint">按需下载 · 不装也能用内置浏览器与 playwright-cli</em>
                                    : null}
                                </span>
                                {/* 装不上时的备用方案（10-08 用户要求）：网差的机器按需下载常常失败，
                                    给一段预置提示词，让用户复制到任意会话里交给 Codex 自己装。
                                    ⛔ 提示词正文由**主进程**生成（runtimeList 的 fallbackPrompt）——
                                      这里只展示 + 复制，不许再拼一份文案（否则又是两套口径）。 */}
                                {installFailed && runtime.fallbackPrompt ? (
                                  <span className="runtime-fallback">
                                    <em>download 失败也可以不折腾：把提示词复制给 Codex，让它在这台机器上直接装（网络差时更靠谱）。</em>
                                    <button
                                      className="secondary-setting runtime-fallback-copy"
                                      onClick={() => {
                                        void copyTextToClipboard(runtime.fallbackPrompt);
                                        setNotice(`已复制「${runtime.name}」的安装提示词 —— 到任意会话里发给 Codex 即可`);
                                      }}
                                    >
                                      <Copy size={13} />复制提示词，交给 Codex 装
                                    </button>
                                  </span>
                                ) : null}
                                <span className="runtime-size">{runtime.size}</span>
                                <div className="runtime-actions">
                                  {/* 忙碌态（10-07 重构）：安装 → 给「取消」；卸载 → 不可取消，只给状态徽章。
                                      ⛔ 两条路径都要有可见反馈，不允许按钮区空白（无响应状态）。 */}
                                  {busy ? (
                                    runtimeUninstalling === runtime.id
                                      ? <span className="runtime-badge busy">卸载中…</span>
                                      : <button className="secondary-setting runtime-cancel" onClick={() => void cancelDevRuntime(runtime.id)}>取消</button>
                                  ) : (<>
                                  {builtinBadge ? <span className="runtime-badge">内置</span>
                                    : runtime.bundled
                                      ? <button className="primary-setting runtime-install" disabled={Boolean(runtimeInstalling)} onClick={() => void installDevRuntime(runtime.id)}>{busy ? <Spinner /> : <ArrowDown size={14} />}修复安装</button>
                                      : isDone ? <>
                                          <span className="runtime-badge installed">{runtime.installedBySystem ? "系统已装" : "已安装"}</span>
                                          {/* 10-01 用户规则：**只有「内置」的不能卸载**，其余一律可真卸载
                                              （下载类工具 + npm 包 + pip 包都走 runtime:uninstall 真删；
                                               内置项走上面的 builtinBadge 分支，显示「内置」不给卸载键）
                                              10-07 重构：卸载先行内**二次确认**（真删本地文件，不可恢复）。 */}
                                          {!runtime.installedBySystem && (confirmUninstall === runtime.id ? (
                                            <span className="runtime-confirm">
                                              <em>删除本地文件，不可恢复？</em>
                                              <button className="danger-setting runtime-uninstall" disabled={Boolean(runtimeInstalling)} onClick={() => { setConfirmUninstall(null); void uninstallDevRuntime(runtime.id); }}>确认卸载</button>
                                              <button className="secondary-setting" onClick={() => setConfirmUninstall(null)}>取消</button>
                                            </span>
                                          ) : (
                                            <button className="secondary-setting runtime-uninstall" onClick={() => setConfirmUninstall(runtime.id)}>卸载</button>
                                          ))}
                                        </>
                                        : isGuide
                                          ? <button className="secondary-setting runtime-install" onClick={() => void installDevRuntime(runtime.id)}><ExternalLink size={13} />去官网安装</button>
                                          : <button className="primary-setting runtime-install" disabled={Boolean(runtimeInstalling)} onClick={() => void installDevRuntime(runtime.id)}>{busy ? <Spinner /> : <ArrowDown size={14} />}下载</button>}
                                  </>)}
                                </div>
                              </div>;
                            })}
                          </div>
                        </div>;
                      });
                    })()}
                    {!devRuntimes.length && <div className="runtime-loading"><Spinner />正在读取开发工具状态…</div>}
                    {/* 「检查工具」（10-02 用户要的）：卡片上的「已安装」只证明文件在，不证明能跑。
                        点一次让主进程**真的跑一遍**（版本命令 / pip 可用性），把不可用的挑出来。 */}
                    <div className="devtools-health">
                      <button className="secondary-setting runtime-check" disabled={healthBusy} onClick={() => void runHealth()}><Activity size={13} />{healthBusy ? "检查中…" : "检查工具"}</button>
                      {health
                        ? <span className="settings-card-hint">{healthBad.length === 0 ? "已安装的工具全部可运行" : `发现 ${healthBad.length} 项不可用`}（另有 {healthMissing} 项未安装）</span>
                        : <span className="settings-card-hint">点一下，逐个验证已装的工具能不能真跑起来</span>}
                    </div>
                    {healthError ? <div className="runtime-loading">{healthError}</div> : null}
                    {healthBad.length > 0 && (
                      <div className="runtime-list" data-health-bad={healthBad.length}>
                        {healthBad.map((row: any) => (
                          <div className="runtime-row missing" key={`health-${row.id}`}>
                            <span className="runtime-icon"><AlertTriangle size={16} /></span>
                            <span className="runtime-copy"><strong>{row.name}</strong><small>{row.detail}</small></span>
                          </div>
                        ))}
                      </div>
                    )}
                    <details className="devtools-manifest">
                      <summary><BookOpen size={13} />工具清单说明（Codex 引擎安装参考）<span className="settings-subhead-hint">点击展开 / 复制</span></summary>
                      <div className="devtools-manifest-body">
                        <pre>{devRuntimes.map((r: any) => `# ${r.name}\n${r.description}\n${r.installed || r.builtIn ? "状态：已就绪" : "状态：未安装"}\n`).join("\n")}</pre>
                        <button className="secondary-setting" onClick={() => { void copyTextToClipboard(devRuntimes.map((r: any) => `# ${r.name}\n${r.description}\n${r.installed || r.builtIn ? "状态：已就绪" : "状态：未安装"}\n`).join("\n")); setNotice("工具清单已复制"); }}><Copy size={13} />复制清单</button>
                      </div>
                    </details>
                    <p className="settings-card-hint">随应用内置（安装包自带、离线可用）：引擎、Node、VS Code CLI、Nuphus 桌面自动化、Playwright 浏览器自动化（CLI）、ponytail 写代码模式插件，以及下载体积 50MB 以内的小工具 —— Python（完整版，含 pip 与 Tkinter）、ripgrep、uv、CMake、7-Zip、jq、Ninja、yt-dlp、Android 平台工具（adb）；按需下载：Git、PowerShell 7（npmmirror / gh 加速，失败自动回落官方源，首次启动检测到缺 Git 会自动补装）、FFmpeg、Miniconda、MinGW、CloakBrowser 指纹浏览器（npm 国内镜像）、Playwright / Cloak 两类浏览器内核、文档转换（markitdown，pip 清华镜像）；Docker Desktop、OpenSSL 需系统级安装（点按钮打开官网）。除内置项外都可卸载（卸载是真删）。日常浏览用内置浏览器视图，CloakBrowser 只在需要过反爬站点时按需下载。安装后自动加入 Codex 环境（不修改系统 PATH 或注册表）；引擎在会话里自行安装工具时，此页状态也会自动刷新。</p>
                    {/* 手机控制（09-27）：上游 phone-harness 是 Python CLI 不是 MCP 服务，
                        所以不做连接器模板，做成工具卡：装机 + 关遥测 + 注册技能 + 权限引导。 */}
                    <PhoneHarnessCard setNotice={setNotice} installDevRuntime={installDevRuntime} runtimeInstalling={runtimeInstalling} runtimePercent={runtimePercent} runtimeStage={runtimeStage} />
                    {/* Laya 智能判断（10-01）：思考等级「自动」档的本地决策端（Python laya-serve）。 */}
                    <LayaCard setNotice={setNotice} />
                  </section>
    </>
  );
}
