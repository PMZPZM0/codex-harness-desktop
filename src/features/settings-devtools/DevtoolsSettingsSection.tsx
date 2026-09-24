/**
 * 设置页 · devtools（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX 与原块逐字一致（仅去掉外层缩进）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 */
import { PageInfo } from "../../components/SettingsHead";
import { ArrowDown, BookOpen, CircleCheck, Copy, Download, ExternalLink, Globe2, TerminalSquare, Wrench } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { copyTextToClipboard } from "../../lib/clipboard";

export type DevtoolsSettingsSectionProps = { downloadSource: any; changeDownloadSource: any; capabilityRows: any; capabilityError: any; VoiceDevToolsSection: any; setNotice: any; devRuntimes: any; runtimeInstalling: any; runtimePercent: any; runtimeStage: any; runtimeSpeed: any; runtimeProgress: any; installDevRuntime: any; uninstallDevRuntime: any };

export function DevtoolsSettingsSection(props: DevtoolsSettingsSectionProps) {
  const { downloadSource, changeDownloadSource, capabilityRows, capabilityError, VoiceDevToolsSection, setNotice, devRuntimes, runtimeInstalling, runtimePercent, runtimeStage, runtimeSpeed, runtimeProgress, installDevRuntime, uninstallDevRuntime } = props;
  return (
    <>
      <section className="settings-section stack">
                    <div className="settings-copy"><h2>开发工具<PageInfo text={<>桌面与浏览器自动化（Nuphus / Playwright CLI）与写代码模式插件随应用内置、开箱即用；CloakBrowser 指纹浏览器、两类浏览器内核与其余工具链按需下载（下载源可自选，失败自动回落官方源），安装后自动加入 Codex 环境（不改系统 PATH）。</>} helpKey="devtools" label="开发工具" /></h2></div>
                    {/* 下载源选择（09-20 用户「下载太慢，所有工具下载加下载源选择」）：对本页所有按需下载生效，
                        runtime:install 每次现读 app-settings —— 切完源下一次下载立即生效，无需重启。 */}
                    <div className="devtools-source-row" role="group" aria-label="下载源选择">
                      <span className="settings-subhead"><Download size={13} />下载源</span>
                      <select className="accel-select" value={downloadSource} onChange={(event) => changeDownloadSource(event.target.value as typeof downloadSource)} aria-label="选择下载源">
                        <option value="auto">自动（国内优先：镜像/加速在前，直连兜底）</option>
                        <option value="mirror">国内镜像优先（npmmirror / gh 加速）</option>
                        <option value="ghproxy">GitHub 加速 · gh-proxy</option>
                        <option value="ghfast">GitHub 加速 · ghfast</option>
                        <option value="direct">官方直连</option>
                        <option value="proxy">本机代理优先</option>
                      </select>
                      <span className="settings-card-hint">下载慢就换个源，下一次下载立即生效；带「回落」的选项失败后会自动改走官方源。浏览器内核只认「自动 / 国内镜像 / 官方直连」，其余按自动处理。</span>
                    </div>
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
                    <div className="settings-subhead"><Download size={13} />语音模型<span className="settings-subhead-hint">sherpa-onnx · 本机推理 · 按需下载</span></div>
                    <VoiceDevToolsSection onNotice={setNotice} />
                    {(() => {
                      // 09-16 用户「自动化工具拆开，拆详细一点」：不再一张「桌面与浏览器自动化」大卡，
                      // 拆成逐条能力卡（Nuphus / Playwright CLI / CloakBrowser / 两类内核 / ponytail）。
                      // bundled=true 的卡片显示「内置」（随包预装，无需安装；缺失时给「修复安装」）。
                      const autoIds = ["nuphus", "playwright-cli", "cloakbrowser", "playwright-browsers", "cloak-browsers", "ponytail"];
                      const groups = [
                        { key: "base", title: "基础运行时", hint: "随应用内置，离线可用", icon: <Wrench size={13} />, filter: (r: any) => r.builtIn },
                        { key: "auto", title: "桌面与浏览器自动化", hint: "Nuphus / Playwright CLI 随包内置，CloakBrowser 与浏览器内核按需下载", icon: <TerminalSquare size={13} />, filter: (r: any) => autoIds.includes(r.id) },
                        { key: "ondemand", title: "按需下载", hint: "联网下载安装", icon: <Download size={13} />, filter: (r: any) => !r.builtIn && r.kind !== "guide" && !autoIds.includes(r.id) },
                        { key: "system", title: "系统级安装", hint: "打开官网手动安装", icon: <Globe2 size={13} />, filter: (r: any) => r.kind === "guide" },
                      ];
                      return groups.map((g) => {
                        const items = devRuntimes.filter(g.filter);
                        if (!items.length) return null;
                        return <div className="devtools-group" key={g.key}>
                          <div className="settings-subhead">{g.icon}{g.title}<span className="settings-subhead-hint">{g.hint}</span></div>
                          <div className="runtime-list">
                            {items.map((runtime: any) => {
                              const busy = runtimeInstalling === runtime.id || runtime.installing;
                              const isDone = runtime.installed || runtime.installedBySystem;
                              const isGuide = runtime.kind === "guide";
                              const builtinBadge = runtime.builtIn || (runtime.bundled && isDone);
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
                                <span className="runtime-size">{runtime.size}</span>
                                <div className="runtime-actions">
                                  {builtinBadge ? <span className="runtime-badge">内置</span>
                                    : runtime.bundled
                                      ? <button className="primary-setting runtime-install" disabled={Boolean(runtimeInstalling)} onClick={() => void installDevRuntime(runtime.id)}>{busy ? <Spinner /> : <ArrowDown size={14} />}修复安装</button>
                                      : isDone ? <>
                                          <span className="runtime-badge installed">{runtime.installedBySystem ? "系统已装" : "已安装"}</span>
                                          {/* 随包内置资源（zip / 插件目录）不支持卸载——删了没有可靠重取途径 */}
                                          {!runtime.installedBySystem && !runtime.noUninstall && (
                                            <button className="secondary-setting runtime-uninstall" disabled={Boolean(runtimeInstalling)} onClick={() => void uninstallDevRuntime(runtime.id)}>卸载</button>
                                          )}
                                        </>
                                        : isGuide
                                          ? <button className="secondary-setting runtime-install" onClick={() => void installDevRuntime(runtime.id)}><ExternalLink size={13} />去官网安装</button>
                                          : <button className="primary-setting runtime-install" disabled={Boolean(runtimeInstalling)} onClick={() => void installDevRuntime(runtime.id)}>{busy ? <Spinner /> : <ArrowDown size={14} />}下载</button>}
                                </div>
                              </div>;
                            })}
                          </div>
                        </div>;
                      });
                    })()}
                    {!devRuntimes.length && <div className="runtime-loading"><Spinner />正在读取开发工具状态…</div>}
                    <details className="devtools-manifest">
                      <summary><BookOpen size={13} />工具清单说明（Codex 引擎安装参考）<span className="settings-subhead-hint">点击展开 / 复制</span></summary>
                      <div className="devtools-manifest-body">
                        <pre>{devRuntimes.map((r: any) => `# ${r.name}\n${r.description}\n${r.installed || r.builtIn ? "状态：已就绪" : "状态：未安装"}\n`).join("\n")}</pre>
                        <button className="secondary-setting" onClick={() => { void copyTextToClipboard(devRuntimes.map((r: any) => `# ${r.name}\n${r.description}\n${r.installed || r.builtIn ? "状态：已就绪" : "状态：未安装"}\n`).join("\n")); setNotice("工具清单已复制"); }}><Copy size={13} />复制清单</button>
                      </div>
                    </details>
                    <p className="settings-card-hint">随应用内置：引擎、Node、VS Code CLI、Nuphus 桌面自动化、Playwright 浏览器自动化（CLI）、ponytail 写代码模式插件；按需下载：CloakBrowser 指纹浏览器（npm 国内镜像）、Playwright / Cloak 两类浏览器内核，以及 Python、Git、PowerShell、ripgrep、uv、CMake、7-Zip、jq、Ninja（npmmirror / gh 加速，失败自动回落官方源），首次启动检测到缺 Git 会自动补装；Docker Desktop、OpenSSL 需系统级安装（点按钮打开官网）。日常浏览用内置浏览器视图，CloakBrowser 只在需要过反爬站点时按需下载。安装后自动加入 Codex 环境（不修改系统 PATH 或注册表）；引擎在会话里自行安装工具时，此页状态也会自动刷新。</p>
                  </section>
    </>
  );
}
