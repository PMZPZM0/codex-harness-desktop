/**
 * ApkStart 安卓运行器卡片（11-14，嵌在「设置 → 开发工具」，结构照 FileeCard）。
 *
 * 两步：装 ApkStart（GitHub release 直下型 119MB，镜像序 + SHA256）→ 交给 Codex 用 apkstart 工具测试 APK。
 * ⛔ 首启运行时（adb / emulator / 系统镜像，约 1GB）由 ApkStart 自己下载到 %APPDATA%\apkstart\runtime，
 *    本卡只显示它备没备齐（主进程 apkstart:status 的 runtimeReady），不替它下载。
 * ⛔ 卸载只删程序（tools/apkstart）；运行时数据另给一个显式勾选项（%APPDATA%\apkstart 可能数 GB）。
 * ⛔ 状态以主进程 apkstart:status 为准（读 apps.json + adb 探测，3s 缓存）。
 */
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, Camera, Check, Download, ExternalLink, Gamepad2, Power, RefreshCw, ScrollText, Terminal, Trash2,
} from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { SettingsDialog } from "../../components/SettingsDialog";
import { RuntimeUpdateRow } from "./RuntimeUpdateRow";

/** 「能做什么」清单：按 ApkStart 的能力归类。 */
const CAPABILITIES = [
  { icon: Download, title: "安装 APK", desc: "双击或交给 Codex 安装 .apk / .xapk / .apks，应用清单自动维护" },
  { icon: Gamepad2, title: "独立窗口运行", desc: "每个应用一个窗口，原生鼠标键盘：左键点击、右键返回、平滑滚轮" },
  { icon: Camera, title: "截屏验证", desc: "Codex 用 apkstart screenshot 截当前画面，拿本地 PNG 回来看" },
  { icon: ScrollText, title: "日志与崩溃", desc: "读 logcat（可按包名 / 关键字过滤），FATAL EXCEPTION 与 ANR 行保留" },
  { icon: Terminal, title: "adb 透传", desc: "点按、输入、授权、dumpsys 等命令直接交给模拟器的 adb" },
  { icon: Power, title: "启停与数据", desc: "打开主界面手动操作；卸载时可选择连运行时数据一起删" },
];

/** 示例说法：给用户「照着说」的模板。 */
const EXAMPLES = [
  "把这个 apk 装进模拟器，打开看看首页有没有崩",
  "装好后截一张图给我看效果",
  "应用一启动就闪退，帮我读日志找原因",
  "在模拟器里点一下登录按钮，再输入测试账号",
  "把这个包名重新启动一次，确认改的东西生效了",
];

type Status = {
  installed: boolean;
  exePath: string;
  version: string;
  running: boolean;
  runtimeReady: boolean;
  runtimeRoot: string;
  adbPath: string;
  device: { serial: string; state: string; model: string; api: string; release: string } | null;
  apps: { package?: string; label?: string; versionName?: string; lastLaunchAt?: number }[];
  dataDir: string;
  attribution: { license: string; home: string };
};

/** ApkStart 卡片：安装状态、运行时状态、打开主界面、卸载（可勾选清数据）。 */
export function ApkStartCard({ setNotice, installDevRuntime, runtimeInstalling, uninstallDevRuntime, runtimeUninstalling, runtimeStage, runtimePercent, runtimeSpeed, runtimeProgress, cancelDevRuntime, setRuntimeModal }: {
  setNotice: (text: string, detail?: string) => void;
  installDevRuntime?: (id: string) => void;
  /** ⛔ 真实类型是「正在安装的工具 id」（单个字符串），不是 map（飞书 CLI 卡同款教训）。 */
  runtimeInstalling?: string | null;
  uninstallDevRuntime?: (id: string) => unknown;
  runtimeUninstalling?: string | null;
  runtimeStage?: Record<string, string>;
  runtimePercent?: Record<string, number> | null;
  runtimeSpeed?: Record<string, string> | null;
  runtimeProgress?: Record<string, string> | null;
  cancelDevRuntime?: (id: string) => unknown;
  setRuntimeModal?: (value: { id?: string; name?: string; mode?: string; done?: boolean; failed?: boolean; error?: string } | null) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [uninstallOpen, setUninstallOpen] = useState(false);
  const [purgeData, setPurgeData] = useState(false);
  const [opening, setOpening] = useState(false);

  const refresh = useCallback(async () => {
    try { setStatus((await window.codex.apkstartStatus()) as Status); } catch { /* 主进程没接上就保持现状 */ }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const uninstall = async () => {
    try {
      setNotice?.("正在卸载 ApkStart…");
      await Promise.resolve(uninstallDevRuntime?.("apkstart"));
      if (purgeData) {
        const result = await window.codex.apkstartPurge(true).catch((error: unknown) => ({ ok: false, error: String((error as { message?: unknown })?.message ?? error) }));
        setNotice?.(result?.ok ? "ApkStart 已卸载，运行时数据已删除" : "ApkStart 已卸载，但运行时数据没删掉", result?.ok ? "需要时随时可以再装回来" : String(result?.error ?? ""));
      } else {
        setNotice?.("ApkStart 已卸载", "运行时与已装应用数据保留在 %APPDATA%\\apkstart");
      }
    } catch (err) {
      setNotice?.("卸载失败", String((err as { message?: unknown })?.message ?? err));
    }
    setUninstallOpen(false);
    setPurgeData(false);
    void refresh();
  };

  const openApp = async () => {
    setOpening(true);
    try {
      const result = await window.codex.apkstartOpen();
      setNotice?.(result?.ok ? "已打开 ApkStart" : "打开失败", result?.ok ? "首次启动会先下载 Android 运行时" : String(result?.error ?? ""));
    } catch (err) {
      setNotice?.("打开失败", String((err as { message?: unknown })?.message ?? err));
    } finally {
      setOpening(false);
      void refresh();
    }
  };

  const installing = runtimeInstalling === "apkstart";
  const otherBusy = Boolean(runtimeInstalling) && !installing;
  const uninstalling = runtimeUninstalling === "apkstart";
  const percent = Math.round(Number(runtimePercent?.["apkstart"] ?? 0));
  const speed = runtimeSpeed?.["apkstart"] ?? "";
  const latest = runtimeProgress?.["apkstart"] ?? "";
  const installFailed = latest.startsWith("安装失败");

  useEffect(() => {
    const off = window.codex.onRuntimeProgress((payload: { id?: string; done?: boolean }) => {
      if (payload?.id !== "apkstart" || !payload.done) return;
      void refresh();
    });
    return off;
  }, [refresh]);

  const device = status?.device;
  const apps = status?.apps ?? [];

  return (
    <>
      <section className="settings-section stack feishu-cli-card">
        <div className="feishu-cli-list">
          <div className={`runtime-row ${status?.installed ? "installed" : "missing"} ${installing ? "busy" : ""}`}>
            <span className="runtime-icon">{installing ? <Spinner /> : status?.installed ? <Check size={15} /> : <Download size={15} />}</span>
            <span className="runtime-copy">
              <strong>安装 ApkStart</strong>
              <small>{installing ? "正在准备下载（约 119 MB，自动选最快的国内镜像）…" : status?.installed ? `已安装${status.version ? ` ${status.version}` : ""}；卸载只删程序，不动你的 APK 与运行时数据` : "约 119 MB，GitHub release 自动选最快镜像 + SHA256 校验；仅 Windows 10/11 x64"}</small>
              {installing ? (
                <span className="runtime-install-state devtools-progress-row">
                  <span className="runtime-progress-bar" role="progressbar" aria-label="ApkStart 安装进度" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                    <i style={{ width: `${percent}%` }} />
                  </span>
                  <em className="runtime-progress">
                    {runtimeStage?.["apkstart"] || "正在选择最快的下载源…"}
                    {percent ? ` · ${percent}%` : ""}
                    {speed ? ` · ${speed}` : ""}
                    {latest && !installFailed ? ` · ${latest}` : ""}
                  </em>
                </span>
              ) : null}
              {installFailed ? (
                <button
                  type="button"
                  className="runtime-failed"
                  onClick={() => setRuntimeModal?.({ id: "apkstart", name: "ApkStart 安卓运行器", mode: "install", done: true, failed: true, error: latest.replace(/^安装失败：/, "") })}
                >
                  <AlertTriangle size={12} />安装失败 · 点开完整报错与备用方案
                </button>
              ) : null}
            </span>
            <div className="runtime-actions">
              {status?.installed ? <>
                  <span className="runtime-badge installed">已安装</span>
                  <button
                    type="button"
                    className="runtime-install feishu-cli-uninstall"
                    disabled={uninstalling}
                    title="卸载 ApkStart（弹窗确认；可选是否连运行时数据一起删）"
                    onClick={() => setUninstallOpen(true)}
                  >
                    {uninstalling ? <><Spinner /> 卸载中</> : <><Trash2 size={13} />卸载</>}
                  </button>
                </>
                : installing ? (
                  <button type="button" className="secondary-setting runtime-cancel" onClick={() => void cancelDevRuntime?.("apkstart")}>取消</button>
                ) : <button type="button" className="primary-setting runtime-install" disabled={otherBusy} onClick={() => installDevRuntime?.("apkstart")}>
                    <Download size={14} />安装
                  </button>}
            </div>
          </div>

          <div className={`runtime-row ${status?.installed ? "installed" : "missing"}`}>
            <span className="runtime-icon">{status?.runtimeReady ? <Check size={15} /> : <RefreshCw size={15} />}</span>
            <span className="runtime-copy">
              <strong>Android 运行时</strong>
              <small>
                {status?.runtimeReady
                  ? `已备齐（adb / emulator / 系统镜像）${device ? ` · 当前模拟器 ${device.serial}${device.model ? `（${device.model}${device.release ? ` · Android ${device.release}` : ""}）` : ""}` : " · 模拟器还没启动"}`
                  : "未就绪：首次启动 ApkStart 时由它自己下载约 1GB（dl.google.com，分块 + 断点续传）"}
              </small>
            </span>
            <div className="runtime-actions">
              <span className={`runtime-badge ${status?.runtimeReady ? "installed" : ""}`}>{status?.runtimeReady ? "就绪" : "首启下载"}</span>
              {status?.installed ? <button type="button" className="secondary-setting runtime-install" disabled={opening} onClick={() => void openApp()}>{opening ? <><Spinner /> 打开中</> : "打开 ApkStart"}</button> : null}
            </div>
          </div>

          <RuntimeUpdateRow
            id="apkstart"
            installed={Boolean(status?.installed)}
            hint="从 GitHub release 镜像序拉新版并 SHA256 校验；只换程序，Android 运行时与已装应用保留"
            runtimeStage={runtimeStage}
            runtimePercent={runtimePercent}
            runtimeSpeed={runtimeSpeed}
            runtimeProgress={runtimeProgress}
            cancelDevRuntime={cancelDevRuntime}
            onUpdated={refresh}
          />

          <div className={`runtime-row ${status?.installed ? "installed" : "missing"}`}>
            <span className="runtime-icon"><Terminal size={15} /></span>
            <span className="runtime-copy">
              <strong>配套工具</strong>
              <small>装好后 Codex 自动多一个 apkstart 工具：装 APK / 启动 / 截屏 / 读日志 / 执行 adb</small>
            </span>
            <div className="runtime-actions">
              <span className={`runtime-badge ${status?.installed ? "installed" : ""}`}>{status?.installed ? `已装 ${apps.length} 个应用` : "安装后可用"}</span>
            </div>
          </div>
        </div>

        <section className="feishu-cli-guide">
          <div className="feishu-cli-guide-head">
            <strong>能做什么</strong>
            <small>本机安卓运行器：adb / emulator / 系统镜像都由它自己管理，不需要 Android Studio 或独立模拟器</small>
          </div>
          <div className="feishu-cli-cap-grid">
            {CAPABILITIES.map(({ icon: Icon, title, desc }) => (
              <div className="feishu-cli-cap" key={title}>
                <span className="feishu-cli-cap-icon"><Icon size={15} /></span>
                <span className="feishu-cli-cap-copy"><strong>{title}</strong><small>{desc}</small></span>
              </div>
            ))}
          </div>

          <div className="feishu-cli-guide-head">
            <strong>怎么用</strong>
            <small>装好后直接在对话里说人话；应用会以独立窗口运行，Codex 可以截图与读日志</small>
          </div>
          <ol className="feishu-cli-guide-steps">
            <li><b>给 APK 路径</b><span>例如「把 D:\build\app-release.apk 装进模拟器」；也可以直接双击 APK。</span></li>
            <li><b>说清要验证什么</b><span>「打开首页截个图」「冷启动有没有闪退」「点登录按钮试试」——Codex 会自己装、启、截、读日志。</span></li>
            <li><b>首次启动要等运行时</b><span>第一次点「打开 ApkStart」会下载约 1GB Android 运行时；下完之前安装会显示未完成，别急着重试。</span></li>
          </ol>

          <div className="feishu-cli-examples">
            {EXAMPLES.map((text) => <span className="feishu-cli-example" key={text}>{text}</span>)}
          </div>

          <ul className="feishu-cli-notes">
            <li>仅 Windows 10/11 x64；需要本机开启虚拟化（没开时 ApkStart 会提示）。</li>
            <li>已装应用清单在 ApkStart 自己的 apps.json 里；Codex 判断「装没装成」读的就是它，不靠猜。</li>
            <li>卸载只删程序（约 119 MB）；运行时与已装应用数据在 %APPDATA%\apkstart，卸载弹窗里可勾选一起删。</li>
          </ul>
        </section>

        {status?.attribution && (
          <p className="openfilm-attribution">
            第三方开源项目 ApkStart · 许可 <b>{status.attribution.license}</b> · 由 RoutineMiku 与 ApkStart 贡献者开发 ·
            <button type="button" className="openfilm-link" onClick={() => void window.codex.openExternal(status.attribution.home)}>
              {status.attribution.home.replace(/^https?:\/\/(www\.)?/, "")} <ExternalLink size={10} />
            </button>
            <br />
            <span className="openfilm-fineprint">本应用只做 ApkStart 官方发布包的下载与调用；模拟器与数据都在你本机，与 ApkStart 项目无隶属关系，问题反馈请到其 GitHub 仓库。</span>
          </p>
        )}
      </section>

      {uninstallOpen && (
        <SettingsDialog title="卸载 ApkStart" icon={<Trash2 size={15} />} hint="程序与运行时数据分开处理" size="sm" onClose={() => setUninstallOpen(false)}>
          <div className="settings-section stack feishu-uninstall-confirm">
            <p className="settings-card-hint">
              会删除本机安装的 ApkStart 程序（约 119 MB）。模型侧的 <code>apkstart</code> 工具也会随之消失，需要时再装回来即可。
            </p>
            <label className="settings-card-hint apkstart-purge-row">
              <input type="checkbox" checked={purgeData} onChange={(event) => setPurgeData(event.target.checked)} />
              <span>同时删除 Android 运行时与已装应用数据（%APPDATA%\apkstart，可能数 GB；删了就找不回来）</span>
            </label>
            <div className="feishu-uninstall-actions">
              <button type="button" className="secondary-setting" onClick={() => setUninstallOpen(false)}>取消</button>
              <button type="button" className="primary-setting danger" onClick={() => void uninstall()}><Trash2 size={13} />卸载</button>
            </div>
          </div>
        </SettingsDialog>
      )}
    </>
  );
}
