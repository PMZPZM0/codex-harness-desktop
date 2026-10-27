/**
 * OpenFilm 卡片（10-27）：开发工具页里的**按需下载入口**。
 *
 * 用户令：「在工具界面提供按需下载入口，配置国内镜像源以加速下载；在控制台中提供自动更新功能的开关」
 *       「在界面和文档中标注开源项目地址及相关声明」。
 *
 * ⛔ 本组件**自包含**：状态/安装/设置全部走 `window.codex.openfilm*` 通道，不经 SettingsSection 的 props
 *    （那条链已经 40+ 个 props，再塞就是把一个域塞进另一个域）。
 * ⛔ 声明文案来自主进程（`status.attribution`），⛔ 前端不另写一份 —— 两处文案必然漂移。
 * ⛔ 不内置、不分发上游二进制：这里只显示"从 npm/GitHub 获取"的入口与许可声明。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, ExternalLink, Globe2, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";

type Status = {
  phase: "absent" | "installing" | "ready" | "broken";
  cli: { installed: boolean; version: string; path: string };
  node: { path: string; version: string; embedded: boolean };
  browser: { installed: boolean; cacheRoots: string[] };
  ffmpeg: { ok: boolean; path: string; version: string };
  settings: { autoUpdate: "off" | "startup" | "auto"; mirror: "auto" | "official"; lastCheckedAt?: number };
  /** Studio 现状（批次二）：是不是连上了、在看哪部片 */
  studio: { alive: boolean; url: string; origin: string; projectPath: string; pid: number; version: string; app: boolean; checkedAt: number };
  attribution: { home: string; site: string; license: string; trademark: string };
};

/** 桌面端状态（上游官方安装包；⛔ 我们不重打包、不代删系统目录） */
type Desktop = {
  supported: boolean;
  reason: string;
  platform: string;
  installed: { installed: boolean; path: string; version: string };
  version: string;
  error: string;
  asset: { name: string; size: number } | null;
  local: { path: string; size: number } | null;
  localOutdated: boolean;
  runningApp: boolean;
  notes: string[];
};

type Progress = { step?: "cli" | "chromium" | "verify"; label?: string; pct?: number; log?: string; error?: string; message?: string; phase?: string };
/** 启动检查/手动检查的版本事件（主进程 autoUpdateOnStartup 广播） */
type UpdateEvent = { phase: "update"; current: string; latest: string; source: string; hasUpdate: boolean };

const AUTO_UPDATE_OPTIONS: { value: Status["settings"]["autoUpdate"]; label: string; hint: string }[] = [
  { value: "off", label: "关闭", hint: "不检查更新（手动点「检查更新」仍可用）" },
  { value: "startup", label: "启动时检查", hint: "每次启动查一次，有新版只提示不自动装" },
  { value: "auto", label: "自动安装", hint: "发现新版直接后台更新运行时（推荐）" },
];

export function OpenfilmCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);
  const [update, setUpdate] = useState<{ latest: string; hasUpdate: boolean; source: string } | null>(null);
  const [desktop, setDesktop] = useState<Desktop | null>(null);
  const [desktopBusy, setDesktopBusy] = useState(false);
  const mounted = useRef(true);

  const refresh = async () => {
    try {
      const next = await window.codex.openfilmStatus();
      if (mounted.current) setStatus(next as Status);
      /* 桌面端信息独立拉：它要打 GitHub API（慢/可能失败），⛔ 不能把整张卡的状态拖住 */
      void window.codex.openfilmDesktopInfo()
        .then((info) => { if (mounted.current) setDesktop(info as Desktop); })
        .catch(() => undefined);
    } catch (error: any) {
      if (mounted.current) setNotice({ tone: "err", text: `读取状态失败：${String(error?.message ?? error)}` });
    }
  };

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const off = window.codex.onEvent((event: any) => {
      if (event?.type !== "openfilm") return;
      const next = event as Progress & Partial<UpdateEvent>;
      /* 启动检查 / 手动检查的版本事件：只提示，不弹进度条（⛔ 别把"有新版"画成"正在装"） */
      if (next.phase === "update") {
        if (!next.latest) return;
        setUpdate({ latest: String(next.latest), hasUpdate: Boolean(next.hasUpdate), source: String(next.source ?? "") });
        setNotice(next.hasUpdate
          ? { tone: "warn", text: `OpenFilm 有新版本 ${next.latest}（当前 ${next.current || "未安装"}）` }
          : { tone: "ok", text: `OpenFilm 已是最新（${next.current}）` });
        return;
      }
      if (next.phase === "studio") { void refresh(); return; }
      setProgress(next);
      if (next.phase === "install" && next.error) setNotice({ tone: "err", text: String(next.message ?? next.error) });
      if (next.step === "verify" && next.pct === 100) setNotice({ tone: "ok", text: "OpenFilm 安装完成" });
    });
    return () => { mounted.current = false; off?.(); };
  }, []);

  const runInstall = async (step?: "cli" | "chromium" | "verify") => {
    setBusy(true); setNotice(null);
    try {
      const result: any = await window.codex.openfilmInstall(step ?? undefined);
      setStatus(result?.status ?? null);
      if (!result?.ok) setNotice({ tone: "err", text: `${result?.code ?? ""} ${result?.error ?? "安装失败"}`.trim() });
      else setNotice({ tone: "ok", text: "安装完成" });
    } catch (error: any) {
      setNotice({ tone: "err", text: String(error?.message ?? error) });
    } finally { setBusy(false); setProgress(null); }
  };

  const uninstall = async () => {
    setBusy(true); setNotice(null);
    try {
      const result: any = await window.codex.openfilmUninstall();
      if (result?.ok) setNotice({ tone: "ok", text: `已卸载运行时（保留你的影片目录）` });
      else setNotice({ tone: "err", text: String(result?.error ?? "卸载失败") });
      await refresh();
    } finally { setBusy(false); }
  };

  const checkUpdate = async () => {
    setBusy(true); setNotice(null);
    try {
      const result: any = await window.codex.openfilmUpdateCheck();
      if (result?.error) setNotice({ tone: "warn", text: `检查失败：${result.error}` });
      else {
        setUpdate({ latest: result.latest, hasUpdate: Boolean(result.hasUpdate), source: result.source });
        setNotice({
          tone: result.hasUpdate ? "warn" : "ok",
          text: result.hasUpdate ? `有新版本 ${result.latest}（当前 ${result.current || "未安装"}）` : `已是最新（${result.current || "未安装"}）`,
        });
      }
    } finally { setBusy(false); }
  };

  /* 「打开 Studio」= 连接与配对：主进程跑 open（幂等），事件回来时 OpenfilmBridge 会开进内置浏览器。
     ⛔ 不传 filmDir：不带参数是上游定义的"打开上次那部 / 当前目录那部"，正是卡片按钮的语义。 */
  const openStudio = async () => {
    setBusy(true); setNotice(null);
    try {
      const result: any = await window.codex.openfilmStudioOpen();
      if (!result?.ok) setNotice({ tone: "err", text: `${result?.code ?? ""} ${result?.error ?? "Studio 打开失败"}`.trim() });
      else setNotice({ tone: "ok", text: result.projectPath ? `Studio 已连上：${result.projectPath}` : "Studio 已连上（还没选影片）" });
      await refresh();
    } catch (error: any) {
      setNotice({ tone: "err", text: String(error?.message ?? error) });
    } finally { setBusy(false); }
  };

  /* 桌面端三件事：下载（含校验）/ 运行安装器 / 卸载引导。
     ⛔ 下载与安装**分两步**：265MB 下完就自动弹安装向导，用户会不知道刚才点了什么。 */
  const desktopAction = async (action: "download" | "install" | "silent" | "reveal" | "uninstall") => {
    setDesktopBusy(true); setNotice(null);
    try {
      const result: any = action === "download"
        ? await window.codex.openfilmDesktopDownload()
        : await window.codex.openfilmDesktopRun(action);
      if (!result?.ok) setNotice({ tone: "err", text: `${result?.error ?? "操作失败"}`.trim() });
      else setNotice({ tone: "ok", text: result?.note || (action === "download" ? "安装包已下载并校验" : "完成") });
      const fresh = await window.codex.openfilmDesktopInfo().catch(() => null);
      if (mounted.current && fresh) setDesktop(fresh as Desktop);
    } catch (error: any) {
      setNotice({ tone: "err", text: String(error?.message ?? error) });
    } finally { setDesktopBusy(false); setProgress(null); }
  };

  const saveSettings = async (patch: Partial<Status["settings"]>) => {
    try {
      const next = await window.codex.openfilmSettingsSet(patch);
      setStatus((current) => (current ? { ...current, settings: next as Status["settings"] } : current));
    } catch (error: any) {
      setNotice({ tone: "err", text: `保存设置失败：${String(error?.message ?? error)}` });
    }
  };

  const phaseText = useMemo(() => {
    if (!status) return "正在读取状态…";
    if (status.phase === "ready") return `已就绪 · CLI ${status.cli.version}`;
    if (status.phase === "installing") return "安装中…";
    if (status.phase === "broken") return "已装一半：还缺渲染引擎或 ffmpeg";
    return "未安装 · 点「下载并安装」按需获取（约 100MB 渲染引擎）";
  }, [status]);

  const tone = status?.phase === "ready" ? "ok" : status?.phase === "broken" ? "warn" : "muted";

  return (
    <div className="openfilm-card" data-phase={status?.phase ?? "loading"}>
      <header className="openfilm-head">
        <div>
          <strong>OpenFilm 视频剪辑</strong>
          <small>让 Codex 直接剪片 / 生成动效片：影片按网页写，Studio 里手改，CLI 渲染导出</small>
        </div>
        <span className={`openfilm-badge tone-${tone}`}>
          {status?.phase === "ready" ? <CheckCircle2 size={12} /> : status?.phase === "broken" ? <AlertTriangle size={12} /> : <Download size={12} />}
          {phaseText}
        </span>
      </header>

      {/* 开源声明（用户要求：界面必须标注地址与许可；文案由主进程下发，⛔ 前端不复制） */}
      {status && (
        <p className="openfilm-attribution">
          第三方开源项目 · 许可 <b>{status.attribution.license}</b> ·
          <button type="button" className="openfilm-link" onClick={() => void window.codex.openExternal(status.attribution.home)}>
            {status.attribution.home.replace(/^https?:\/\//, "")} <ExternalLink size={10} />
          </button>
          · <button type="button" className="openfilm-link" onClick={() => void window.codex.openExternal(status.attribution.site)}>
            官网 <ExternalLink size={10} />
          </button>
          <br />
          <span className="openfilm-fineprint">{status.attribution.trademark}</span>
        </p>
      )}

      {/* 依赖三灯：缺哪一项直接指出来（比"安装失败"有用） */}
      {status && (
        <div className="openfilm-deps">
          <span data-ok={status.node.version ? "1" : "0"}>Node {status.node.version || "缺失"}{status.node.embedded ? "（内置）" : ""}</span>
          <span data-ok={status.browser.installed ? "1" : "0"}>渲染引擎 {status.browser.installed ? "就绪" : "未下载"}</span>
          <span data-ok={status.ffmpeg.ok ? "1" : "0"}>ffmpeg {status.ffmpeg.ok ? status.ffmpeg.version : "缺失"}</span>
          <span data-ok={status.cli.installed ? "1" : "0"}>CLI {status.cli.version || "未安装"}</span>
          <span data-ok={status.studio.alive ? "1" : "0"}>Studio {status.studio.alive ? "已连接" : "未连接"}</span>
        </div>
      )}

      {progress && (
        <div className="openfilm-progress">
          <LoaderCircle size={12} className="spin" />
          <span>{progress.label ?? progress.step}</span>
          <div className="openfilm-bar"><i style={{ width: `${Math.max(4, Math.min(100, progress.pct ?? 5))}%` }} /></div>
          {progress.log && <code>{progress.log}</code>}
        </div>
      )}

      <div className="openfilm-actions">
        <button type="button" className="primary-setting" disabled={busy} onClick={() => void runInstall()}>
          {busy ? <LoaderCircle size={13} className="spin" /> : <Download size={13} />}
          {status?.cli.installed ? "重新安装 / 修复" : "下载并安装"}
        </button>
        {status?.cli.installed && (
          <button type="button" className="secondary-setting" disabled={busy} onClick={() => void openStudio()}
            title={status.studio.alive ? "在内置浏览器里打开 Studio（幂等：已有页面只切项目）" : "启动 Studio 并在内置浏览器连上它"}>
            <Globe2 size={13} />{status.studio.alive ? "打开 Studio" : "连接 Studio"}
          </button>
        )}
        {status?.cli.installed && (
          <button type="button" className="secondary-setting" disabled={busy} onClick={() => void checkUpdate()}>
            <RefreshCw size={13} />检查更新
          </button>
        )}
        {status?.cli.installed && (
          <button type="button" className="secondary-setting danger-lite" disabled={busy} onClick={() => void uninstall()}>
            <Trash2 size={13} />卸载运行时
          </button>
        )}
        {update?.hasUpdate && (
          <button type="button" className="primary-setting" disabled={busy} onClick={() => void runInstall()}>
            更新到 {update.latest}
          </button>
        )}
      </div>

      {notice && <p className={`openfilm-notice tone-${notice.tone}`}>{notice.text}</p>}
      {/* 缺 ffmpeg 时给可执行的去处（look / render 依赖它；我们不自带，避免 GPL 二进制随包分发） */}
      {status && !status.ffmpeg.ok && (
        <p className="openfilm-notice tone-warn">
          没有可用的 ffmpeg：剪辑校验与导出都会失败。到「开发工具 → 运行时与工具链」安装 FFmpeg（装一次即可）。
        </p>
      )}

      {/* 连接状态：谁在看这部片（Studio 里手改会直接写回影片文件，模型下一轮 check 就能看到） */}
      {status?.studio.alive && (
        <p className="openfilm-notice tone-ok">
          Studio 已连接：{status.studio.projectPath ? status.studio.projectPath : "还没选影片"}
          {status.studio.app ? "（上游桌面 App 的实例）" : ""}
          {status.studio.version ? ` · ${status.studio.version}` : ""}
        </p>
      )}

      {/* ── 桌面端（可选）：用户「有桌面端会更方便」─────────────────────────────
          上游的图形界面版：自带 ffmpeg + 浏览器、双击即用，与这里的剪辑共用同一套项目库。
          ⛔ 我们只做三件事：下载官方安装包（校验 sha256）、启动它的安装器、卸载引导。
             不重打包、不代删 /Applications 或 Program Files、不代跑它的 electron-updater。 */}
      <section className="openfilm-desktop" data-installed={desktop?.installed.installed ? "1" : "0"}>
        <div className="openfilm-desktop-head">
          <strong>桌面端（可选，更方便）</strong>
          <span className={`openfilm-badge tone-${desktop?.installed.installed ? "ok" : desktop?.local ? "warn" : "muted"}`}>
            {desktop?.installed.installed ? "已安装" : desktop?.local ? "已下载，待安装" : "未安装"}
          </span>
        </div>
        <p className="openfilm-fineprint">
          上游的图形界面版：自带 ffmpeg 与渲染浏览器、双击即用，和这里的剪辑共用同一个项目库（改哪边都同步）。
        </p>
        {desktop && !desktop.supported && <p className="openfilm-notice tone-warn">{desktop.reason}</p>}
        {/* 平台检测结论（版本 / 架构）：⛔ 只告知，不替用户决定能不能装 */}
        {(desktop?.notes ?? []).map((note) => <p className="openfilm-notice tone-warn" key={note}>{note}</p>)}
        {desktop?.supported && desktop.error && <p className="openfilm-notice tone-warn">{desktop.error}</p>}
        {desktop?.supported && (
          <div className="openfilm-actions">
            {!desktop.local && (
              <button type="button" className="primary-setting" disabled={desktopBusy} onClick={() => void desktopAction("download")}>
                {desktopBusy ? <LoaderCircle size={13} className="spin" /> : <Download size={13} />}
                下载桌面端{desktop.asset ? `（${Math.round(desktop.asset.size / 1048576)}MB）` : ""}
              </button>
            )}
            {desktop.local && !desktop.installed.installed && (
              <>
                <button type="button" className="primary-setting" disabled={desktopBusy} onClick={() => void desktopAction("install")}>
                  {desktopBusy ? <LoaderCircle size={13} className="spin" /> : <Download size={13} />}
                  {desktop.platform === "darwin" ? "安装到「应用程序」" : "运行安装程序"}
                </button>
                <button type="button" className="secondary-setting" disabled={desktopBusy} onClick={() => void desktopAction("reveal")}>打开安装包</button>
                {desktop.platform === "win32" && (
                  <button type="button" className="secondary-setting" disabled={desktopBusy} title="NSIS /S：不弹界面直接装（首次可能弹 UAC）"
                    onClick={() => void desktopAction("silent")}>静默安装</button>
                )}
              </>
            )}
            {desktop.installed.installed && (
              <>
                <button type="button" className="secondary-setting" disabled={desktopBusy} onClick={() => void desktopAction("reveal")}>打开安装位置</button>
                <button type="button" className="secondary-setting danger-lite" disabled={desktopBusy} onClick={() => void desktopAction("uninstall")}>卸载引导</button>
              </>
            )}
            {desktop.local && (
              <button type="button" className="secondary-setting" disabled={desktopBusy} onClick={() => void desktopAction("download")}>重新下载</button>
            )}
          </div>
        )}
        <p className="openfilm-fineprint">
          {desktop?.platform === "darwin"
            ? "macOS：上游包未公证，首次启动若被系统拦下，去「系统设置 → 隐私与安全性」点「仍要打开」。"
            : "Windows：只有 x64 安装包；首次安装可能弹一次 UAC 授权。"}
          {desktop?.version ? ` 上游最新 ${desktop.version}。` : ""}
          {desktop?.localOutdated ? " 本地包不是最新版，建议重新下载。" : ""}
          {desktop?.runningApp ? " 当前 Studio 就是桌面端起的。" : ""}
          卸载请用它自带的卸载程序 —— 我们不会替你删系统目录。
        </p>
      </section>

      {/* 控制台开关：自动更新三档 + 镜像策略 */}
      <div className="openfilm-settings">
        <div className="openfilm-setting-row">
          <span>自动更新</span>
          <div className="openfilm-seg">
            {AUTO_UPDATE_OPTIONS.map((option) => (
              <button key={option.value} type="button" title={option.hint}
                className={status?.settings.autoUpdate === option.value ? "active" : ""}
                onClick={() => void saveSettings({ autoUpdate: option.value })}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="openfilm-setting-row">
          <span>下载源</span>
          <div className="openfilm-seg">
            <button type="button" className={status?.settings.mirror !== "official" ? "active" : ""}
              title="npm 走 registry.npmmirror.com、渲染引擎走 cdn.npmmirror.com，失败自动回官方源"
              onClick={() => void saveSettings({ mirror: "auto" })}>国内镜像优先</button>
            <button type="button" className={status?.settings.mirror === "official" ? "active" : ""}
              title="只用官方源（国内可能很慢）"
              onClick={() => void saveSettings({ mirror: "official" })}>仅官方</button>
          </div>
        </div>
        <p className="openfilm-fineprint">
          运行时装在数据目录的 <code>openfilm/runtime</code>（覆盖安装保留）；卸载只删运行时，不会删你的影片。
          剪辑与导出不需要任何账号；配音/配乐等生成能力需你在 Studio 内自行连接服务并提供密钥。
        </p>
      </div>
    </div>
  );
}
