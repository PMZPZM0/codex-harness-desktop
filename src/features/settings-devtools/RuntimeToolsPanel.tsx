/**
 * 运行时与工具链面板（10-10 从 DevtoolsSettingsSection 原样搬出，内容零改写）。
 *
 * ⛔ 为什么拆出来：开发工具页改两级 IA —— 一级只放分类卡片，本面板的内容在**二级弹窗**里渲染
 *   （用户要求「点击卡片后通过二级弹窗展示，弹窗内容不得内嵌到主界面」）。搬出时不改任何
 *   文案 / 类名 / 判据：守卫【04】锚的 `runtime-cancel` / `cancelDevRuntime(runtime.id)` /
 *   `confirmUninstall === runtime.id` / `确认卸载` 仍逐字在这份文件里（守卫已同步改路径）。
 *
 * 自带的状态（检查工具结果 / 卸载二次确认）只服务于本面板 ⇒ 随面板一起搬，不占一级页面。
 */
import { useState } from "react";
import { Activity, AlertTriangle, ArrowDown, BookOpen, CircleCheck, Copy, Download, ExternalLink, Globe2, TerminalSquare, Wrench } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { copyTextToClipboard } from "../../lib/clipboard";

export type RuntimeToolsPanelProps = {
  devRuntimes: any;
  runtimeInstalling: any;
  runtimeUninstalling: any;
  runtimePercent: any;
  runtimeStage: any;
  runtimeSpeed: any;
  runtimeProgress: any;
  installDevRuntime: any;
  uninstallDevRuntime: any;
  cancelDevRuntime: any;
  setNotice: any;
  setRuntimeModal: any;
};

export function RuntimeToolsPanel(props: RuntimeToolsPanelProps) {
  const { devRuntimes, runtimeInstalling, runtimeUninstalling, runtimePercent, runtimeStage, runtimeSpeed, runtimeProgress, installDevRuntime, uninstallDevRuntime, cancelDevRuntime, setNotice, setRuntimeModal } = props;
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
    <div className="settings-section stack">
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
                   （`安装失败：<原因>`）。⛔ 前缀是**契约**：产出侧写死的字符串在
                   01-dev-runtimes-capability.tsx，守卫【287】两边一起钉。
                   10-11：完整报错改走「完整报错」弹窗，卡片只留一行摘要，点开重看（弹窗关了报错不丢）。 */
                const installFailed = String(runtimeProgress?.[runtime.id] ?? "").startsWith("安装失败");
                const uninstallFailed = String(runtimeProgress?.[runtime.id] ?? "").startsWith("卸载失败");
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
                  {/* 10-11 改版：失败不再内联一大块 —— 完整报错进「完整报错」弹窗（DevtoolsSettingsSection 渲染），
                      卡片只留一行摘要，点开重看。⛔ 失败判据与产出侧同一前缀（守卫 11y 两边同名钉）。 */}
                  {installFailed ? (
                    <button type="button" className="runtime-failed"
                      onClick={() => setRuntimeModal({ id: runtime.id, name: runtime.name, mode: "install", done: true, failed: true, error: String(runtimeProgress?.[runtime.id] ?? "").replace(/^安装失败：/, "") })}>
                      <AlertTriangle size={12} />安装失败 · 点开完整报错与备用方案
                    </button>
                  ) : uninstallFailed ? (
                    <button type="button" className="runtime-failed"
                      onClick={() => setRuntimeModal({ id: runtime.id, name: runtime.name, mode: "uninstall", done: true, failed: true, error: String(runtimeProgress?.[runtime.id] ?? "").replace(/^卸载失败：/, "") })}>
                      <AlertTriangle size={12} />卸载失败 · 点开完整报错
                    </button>
                  ) : null}
                  <span className="runtime-size">{runtime.size}</span>
                  <div className="runtime-actions">
                    {/* 10-11 用户令：**常驻**「复制安装提示词」图标 —— 不用等失败才出现，任何可下载工具
                        随时都能复制一段提示词发给 Codex、让它在这台机器上直接装（网差时的正路）。
                        ⛔ 提示词正文 = 主进程 runtime:list 下发的 fallbackPrompt，这里只复制（单一真相源）。
                        系统级安装（kind=guide，点按钮开官网）不走 Codex 安装，不出这个图标。 */}
                    {runtime.fallbackPrompt && !isGuide ? (
                      <button type="button" className="runtime-prompt-copy"
                        title={`复制「${runtime.name}」的安装提示词 —— 发到任意会话里，Codex 就能帮你装`}
                        aria-label={`复制 ${runtime.name} 的安装提示词`}
                        onClick={() => {
                          void copyTextToClipboard(runtime.fallbackPrompt);
                          setNotice(`已复制「${runtime.name}」的安装提示词 —— 到任意会话里发给 Codex 即可`);
                        }}>
                        <Copy size={14} />
                      </button>
                    ) : null}
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
    </div>
  );
}
