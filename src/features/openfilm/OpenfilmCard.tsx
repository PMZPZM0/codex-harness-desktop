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
import { AlertTriangle, CheckCircle2, Download, ExternalLink, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";

type Status = {
  phase: "absent" | "installing" | "ready" | "broken";
  cli: { installed: boolean; version: string; path: string };
  node: { path: string; version: string; embedded: boolean };
  browser: { installed: boolean; cacheRoots: string[] };
  ffmpeg: { ok: boolean; path: string; version: string };
  settings: { autoUpdate: "off" | "startup" | "auto"; mirror: "auto" | "official" };
  attribution: { home: string; site: string; license: string; trademark: string };
};

type Progress = { step: "cli" | "chromium" | "verify"; label?: string; pct?: number; log?: string; error?: string; message?: string };

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
  const mounted = useRef(true);

  const refresh = async () => {
    try {
      const next = await window.codex.openfilmStatus();
      if (mounted.current) setStatus(next as Status);
    } catch (error: any) {
      if (mounted.current) setNotice({ tone: "err", text: `读取状态失败：${String(error?.message ?? error)}` });
    }
  };

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const off = window.codex.onEvent((event: any) => {
      if (event?.type !== "openfilm") return;
      const next = event as Progress & { phase?: string };
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
