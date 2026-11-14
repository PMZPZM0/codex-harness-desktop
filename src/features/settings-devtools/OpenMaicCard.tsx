/**
 * OpenMAIC 互动课堂卡片（11-14，嵌在「设置 → 开发工具」，结构照 ApkStartCard）。
 *
 * 三步：装（源码 + pnpm 依赖 + 便携 PostgreSQL 本机构建，约 1.3GB 下载 / 5GB 安装后）→
 * 打开网页配模型 → 交给 Codex 用 openmaic 工具生成课堂。
 * ⛔ 模型 Key 只能用户在 OpenMAIC 网页设置里填（存在本地库、用实例 secret 加密）；本卡不收集 Key。
 * ⛔ 服务只监听 127.0.0.1；卸载只删程序，课程库/数据库在 userData/openmaic-data，可勾选一起删。
 */
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, BookOpenCheck, Brain, Check, Download, ExternalLink, GraduationCap, Layers, Play, Square,
  RefreshCw, SlidersHorizontal, Sparkles, Trash2, Users,
} from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { SettingsDialog } from "../../components/SettingsDialog";

/** 「能做什么」清单：按 OpenMAIC 的产品能力归类。 */
const CAPABILITIES = [
  { icon: GraduationCap, title: "一句话生成课堂", desc: "给主题或资料，AI 生成大纲、幻灯片、测验与讲解" },
  { icon: Users, title: "多智能体课堂", desc: "AI 老师与 AI 同学同堂：讲解、提问、讨论、白板画图" },
  { icon: Layers, title: "丰富场景", desc: "幻灯片 / 测验 / 互动 HTML 模拟 / 项目式学习（PBL）" },
  { icon: BookOpenCheck, title: "知识库与资料", desc: "上传 PDF / 文本做素材，按 @ 引用进课堂" },
  { icon: Sparkles, title: "导出带走", desc: "整堂课导出 PPTX、单文件离线 HTML 或课堂 ZIP" },
  { icon: SlidersHorizontal, title: "模型可换", desc: "OpenAI / Anthropic / Gemini / DeepSeek / Kimi / 豆包 / 本地 Ollama 等" },
];

/** 示例说法：给用户「照着说」的模板。 */
const EXAMPLES = [
  "帮我做一个「光合作用」的高中生物互动课堂，带测验",
  "把这个 PDF 变成一堂 20 分钟的课，要有讨论环节",
  "做一门 Python 入门的项目式课程，每节课一个可运行的小项目",
  "生成一节关于唐朝经济的课，帮我看看进度，好了把链接发我",
  "用三张幻灯片讲清楚什么是大语言模型",
];

type Status = {
  installed: boolean;
  version: string;
  appDir: string;
  dataDir: string;
  port: number;
  url: string;
  running: boolean;
  healthy: boolean;
  pgRunning: boolean;
  capabilities: { webSearch?: boolean; imageGeneration?: boolean; videoGeneration?: boolean; tts?: boolean } | null;
  healthError: string;
  attribution: { license: string; home: string };
};

/** OpenMAIC 卡片：安装/启停/打开/卸载（课程数据可选保留）。 */
export function OpenMaicCard({ setNotice, installDevRuntime, runtimeInstalling, uninstallDevRuntime, runtimeUninstalling, runtimeStage, runtimePercent, runtimeSpeed, runtimeProgress, cancelDevRuntime, setRuntimeModal }: {
  setNotice: (text: string, detail?: string) => void;
  installDevRuntime?: (id: string) => void;
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
  const [busy, setBusy] = useState<"" | "start" | "stop" | "open">("");
  const [uninstallOpen, setUninstallOpen] = useState(false);
  const [purgeData, setPurgeData] = useState(false);

  const refresh = useCallback(async () => {
    try { setStatus((await window.codex.openmaicStatus()) as Status); } catch { /* 主进程没接上就保持现状 */ }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const uninstall = async () => {
    try {
      setNotice?.("正在卸载 OpenMAIC…");
      await Promise.resolve(uninstallDevRuntime?.("openmaic"));
      if (purgeData) {
        const result = await window.codex.openmaicPurge(true).catch((error: unknown) => ({ ok: false, error: String((error as { message?: unknown })?.message ?? error) }));
        setNotice?.(result?.ok ? "OpenMAIC 已卸载，课程库与数据库已删除" : "OpenMAIC 已卸载，但课程数据没删掉", result?.ok ? "需要时随时可以再装回来" : String(result?.error ?? ""));
      } else {
        setNotice?.("OpenMAIC 已卸载", "课程库与数据库保留在 userData/openmaic-data");
      }
    } catch (err) {
      setNotice?.("卸载失败", String((err as { message?: unknown })?.message ?? err));
    }
    setUninstallOpen(false);
    setPurgeData(false);
    void refresh();
  };

  const run = async (kind: "start" | "stop" | "open") => {
    setBusy(kind);
    try {
      const method = kind === "start" ? window.codex.openmaicStart : kind === "stop" ? window.codex.openmaicStop : window.codex.openmaicOpen;
      const result = await method();
      if (kind === "open") {
        setNotice?.(result?.ok ? "已在浏览器打开 OpenMAIC" : "打开失败", result?.ok ? "第一次先到网页设置里配置模型" : String((result as { error?: string })?.error ?? ""));
      } else {
        setNotice?.(result?.ok ? (kind === "start" ? "OpenMAIC 已启动" : "OpenMAIC 已停止") : `${kind === "start" ? "启动" : "停止"}失败`, result?.ok ? "" : String((result as { error?: string })?.error ?? ""));
      }
    } catch (err) {
      setNotice?.("操作失败", String((err as { message?: unknown })?.message ?? err));
    } finally {
      setBusy("");
      void refresh();
    }
  };

  const installing = runtimeInstalling === "openmaic";
  const otherBusy = Boolean(runtimeInstalling) && !installing;
  const uninstalling = runtimeUninstalling === "openmaic";
  const percent = Math.round(Number(runtimePercent?.["openmaic"] ?? 0));
  const speed = runtimeSpeed?.["openmaic"] ?? "";
  const latest = runtimeProgress?.["openmaic"] ?? "";
  const installFailed = latest.startsWith("安装失败");
  const caps = status?.capabilities ?? {};

  useEffect(() => {
    const off = window.codex.onRuntimeProgress((payload: { id?: string; done?: boolean }) => {
      if (payload?.id !== "openmaic" || !payload.done) return;
      void refresh();
    });
    return off;
  }, [refresh]);

  return (
    <>
      <section className="settings-section stack feishu-cli-card">
        <div className="feishu-cli-list">
          <div className={`runtime-row ${status?.installed ? "installed" : "missing"} ${installing ? "busy" : ""}`}>
            <span className="runtime-icon">{installing ? <Spinner /> : status?.installed ? <Check size={15} /> : <Download size={15} />}</span>
            <span className="runtime-copy">
              <strong>安装 OpenMAIC</strong>
              <small>{installing ? "正在安装（源码 + 依赖 + PostgreSQL 构建，约 5–10 分钟）…" : status?.installed ? `已安装${status.version ? ` v${status.version}` : ""}；卸载只删程序，课程库与数据库可保留` : "约 1.3GB 下载 / 安装后约 5GB：源码 + pnpm 依赖 + 便携 PostgreSQL，本机构建；仅 Windows 10/11 x64"}</small>
              {installing ? (
                <span className="runtime-install-state devtools-progress-row">
                  <span className="runtime-progress-bar" role="progressbar" aria-label="OpenMAIC 安装进度" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                    <i style={{ width: `${percent}%` }} />
                  </span>
                  <em className="runtime-progress">
                    {runtimeStage?.["openmaic"] || "正在准备下载源码…"}
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
                  onClick={() => setRuntimeModal?.({ id: "openmaic", name: "OpenMAIC 互动课堂", mode: "install", done: true, failed: true, error: latest.replace(/^安装失败：/, "") })}
                >
                  <AlertTriangle size={12} />安装失败 · 点开完整报错与备用方案
                </button>
              ) : null}
            </span>
            <div className="runtime-actions">
              {status?.installed ? <>
                  <span className="runtime-badge installed">已安装</span>
                  <button type="button" className="runtime-install feishu-cli-uninstall" disabled={uninstalling} title="卸载 OpenMAIC（程序约 5GB；课程数据可保留）" onClick={() => setUninstallOpen(true)}>
                    {uninstalling ? <><Spinner /> 卸载中</> : <><Trash2 size={13} />卸载</>}
                  </button>
                </>
                : installing ? (
                  <button type="button" className="secondary-setting runtime-cancel" onClick={() => void cancelDevRuntime?.("openmaic")}>取消</button>
                ) : <button type="button" className="primary-setting runtime-install" disabled={otherBusy} onClick={() => installDevRuntime?.("openmaic")}>
                    <Download size={14} />安装
                  </button>}
            </div>
          </div>

          <div className={`runtime-row ${status?.installed ? "installed" : "missing"}`}>
            <span className="runtime-icon">{status?.healthy ? <Check size={15} /> : <RefreshCw size={15} />}</span>
            <span className="runtime-copy">
              <strong>本地服务</strong>
              <small>
                {!status?.installed
                  ? "装好后在这里启停；服务只监听本机 127.0.0.1，不对外网开放"
                  : status.healthy
                    ? `运行中：${status.url} · PostgreSQL ${status.pgRunning ? "已连接" : "未运行"}${status.healthError ? "" : ""}`
                    : `未运行${status.healthError ? `（${status.healthError}）` : ""}；点「启动」约 10–30 秒，第一次稍慢`}
              </small>
            </span>
            <div className="runtime-actions">
              {status?.installed ? (
                status.healthy ? <>
                    <button type="button" className="primary-setting runtime-install" disabled={busy !== ""} onClick={() => void run("open")}>{busy === "open" ? <><Spinner /> 打开中</> : "打开 OpenMAIC"}</button>
                    <button type="button" className="secondary-setting runtime-install" disabled={busy !== ""} onClick={() => void run("stop")}>{busy === "stop" ? <><Spinner /> 停止中</> : <><Square size={12} />停止</>}</button>
                  </>
                  : <button type="button" className="primary-setting runtime-install" disabled={busy !== ""} onClick={() => void run("start")}>{busy === "start" ? <><Spinner /> 启动中</> : <><Play size={13} />启动</>}</button>
              ) : <span className="runtime-badge">安装后可用</span>}
            </div>
          </div>

          <div className={`runtime-row ${status?.installed ? "installed" : "missing"}`}>
            <span className="runtime-icon"><Brain size={15} /></span>
            <span className="runtime-copy">
              <strong>模型配置</strong>
              <small>首次使用：打开 OpenMAIC → 设置 → 模型，填一个可用的 API Key（存在本机、加密保存；Codex 不读取）。生成任务由 OpenMAIC 服务端模型执行</small>
            </span>
            <div className="runtime-actions">
              <span className={`runtime-badge ${status?.healthy ? "installed" : ""}`}>联网 {caps.webSearch ? "✓" : "—"} · 生图 {caps.imageGeneration ? "✓" : "—"} · 语音 {caps.tts ? "✓" : "—"}</span>
            </div>
          </div>

          <div className={`runtime-row ${status?.installed ? "installed" : "missing"}`}>
            <span className="runtime-icon"><Sparkles size={15} /></span>
            <span className="runtime-copy">
              <strong>配套工具</strong>
              <small>装好后 Codex 自动多一个 openmaic 工具：查状态 / 启停 / 生成课堂 / 查进度；更新 = 重新安装（会重建）</small>
            </span>
            <div className="runtime-actions">
              <span className={`runtime-badge ${status?.installed ? "installed" : ""}`}>{status?.installed ? "openmaic 已可用" : "安装后可用"}</span>
            </div>
          </div>
        </div>

        <section className="feishu-cli-guide">
          <div className="feishu-cli-guide-head">
            <strong>能做什么</strong>
            <small>从主题到一堂能上的课：幻灯片、测验、互动模拟、AI 老师与同学；全部在你本机运行</small>
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
            <small>装好、配好模型后，直接在对话里说人话；课堂会生成在本机，链接可直接打开</small>
          </div>
          <ol className="feishu-cli-guide-steps">
            <li><b>先装一次</b><span>下载源码与依赖 + 本地 PostgreSQL，构建 5–10 分钟；只装一次，之后启动是秒级到十几秒。</span></li>
            <li><b>在网页里配模型</b><span>「打开 OpenMAIC」→ 设置 → 模型，填一个 API Key；需要联网检索/生图/语音再配对应能力。</span></li>
            <li><b>让 Codex 生成</b><span>说「帮我做一堂关于…的课」即可；Codex 会提交任务，稍后查进度并把课堂链接给你。</span></li>
          </ol>

          <div className="feishu-cli-examples">
            {EXAMPLES.map((text) => <span className="feishu-cli-example" key={text}>{text}</span>)}
          </div>

          <ul className="feishu-cli-notes">
            <li>数据全在本机：课程库在 PostgreSQL（userData/openmaic-data），不对外网开放。</li>
            <li>卸载默认只删程序（约 5GB）；课程库与数据库可勾选一起删，不勾就保留，重装后还在。</li>
            <li>升级 = 重新安装（会重新下载与构建）；运行期间关掉本应用会一并停掉本地服务。</li>
          </ul>
        </section>

        {status?.attribution && (
          <p className="openfilm-attribution">
            第三方开源项目 OpenMAIC · 许可 <b>{status.attribution.license}</b> · 清华大学 MAIC 团队（THU-MAIC）与贡献者开发 ·
            <button type="button" className="openfilm-link" onClick={() => void window.codex.openExternal(status.attribution.home)}>
              {status.attribution.home.replace(/^https?:\/\/(www\.)?/, "")} <ExternalLink size={10} />
            </button>
            <br />
            <span className="openfilm-fineprint">本应用只负责下载官方源码、在本机构建与启停服务；模型调用与课程内容由 OpenMAIC 与你配置的模型供应商完成，与 OpenMAIC 项目无隶属关系。</span>
          </p>
        )}
      </section>

      {uninstallOpen && (
        <SettingsDialog title="卸载 OpenMAIC" icon={<Trash2 size={15} />} hint="程序与课程数据分开处理" size="sm" onClose={() => setUninstallOpen(false)}>
          <div className="settings-section stack feishu-uninstall-confirm">
            <p className="settings-card-hint">
              会删除本机安装的 OpenMAIC 程序（源码 + 依赖 + PostgreSQL 运行时，约 5GB）。模型 Key 若保存在网页设置里，也会随程序一起消失。
            </p>
            <label className="settings-card-hint apkstart-purge-row">
              <input type="checkbox" checked={purgeData} onChange={(event) => setPurgeData(event.target.checked)} />
              <span>同时删除课程库与数据库（userData/openmaic-data，删了就找不回来；不勾选则保留，重装后课程还在）</span>
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
