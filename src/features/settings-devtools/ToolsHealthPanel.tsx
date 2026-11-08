/**
 * 工具自检与清单面板（11-01 从 RuntimeToolsPanel 拆出；一级卡片「工具自检与清单」的内容）。
 *
 * 「已安装」只证明文件在，不证明能跑 —— 点一次让主进程逐个真跑版本命令，
 * 把不可用的挑出来；结果按顺序逐项点亮（弹窗 + 进度条）。
 * 清单说明可展开、可整段复制，交给 Codex 自己装工具时参考。
 */
import { useState } from "react";
import { Activity, AlertTriangle, BookOpen, Copy } from "lucide-react";
import { copyTextToClipboard } from "../../lib/clipboard";
import type { RuntimeRow } from "./runtime-groups";

type HealthRow = { id: string; name: string; installed: boolean; ok: boolean; detail: string };

/** 工具健康检查面板：一键体检并列出每项的状态与修复建议。 */
export function ToolsHealthPanel({ devRuntimes, setNotice }: { devRuntimes: RuntimeRow[]; setNotice: (text: string) => void }) {
  const [health, setHealth] = useState<HealthRow[] | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [healthError, setHealthError] = useState("");
  const [healthRows, setHealthRows] = useState<HealthRow[] | null>(null);
  const [healthDone, setHealthDone] = useState(0);

  const runHealth = async () => {
    setHealthBusy(true);
    setHealthError("");
    setHealthRows([]);
    setHealthDone(0);
    try {
      const rows = await window.codex.runtimeHealth();
      const list: HealthRow[] = Array.isArray(rows) ? rows : [];
      /* 结果由主进程一次返回（它内部是串行探测的）；这里按顺序逐项点亮，
         让用户看到「一个接一个变绿」，而不是最后一起蹦出来。 */
      for (let i = 0; i < list.length; i += 1) {
        setHealthRows(list.slice(0, i + 1));
        setHealthDone(i + 1);
        if (i < list.length - 1) await new Promise((r) => setTimeout(r, 90));
      }
      setHealth(list);
    } catch (error) {
      setHealthError(`自检失败：${String((error as { message?: string })?.message ?? error).slice(0, 200)}`);
    } finally {
      setHealthBusy(false);
    }
  };
  const healthBad = (health ?? []).filter((row) => row.installed && !row.ok);
  const healthMissing = health ? health.filter((row) => !row.installed).length : 0;
  const manifest = devRuntimes.map((r) => `# ${r.name}\n${r.description}\n${r.installed || r.builtIn ? "状态：已就绪" : "状态：未安装"}\n`).join("\n");

  return (
    <div className="settings-section stack">
      <div className="devtools-health devtools-health-hero">
        <span className="devtools-health-icon"><Activity size={17} /></span>
        <span className="devtools-health-copy">
          <strong>{health ? (healthBad.length ? `${healthBad.length} 项不可用` : "全部可运行") : "还没检查过"}</strong>
          <small>
            {health
              ? `另有 ${healthMissing} 项未安装；点右侧按钮可重新检查`
              : "点右侧按钮，逐个真跑版本命令，确认已装的工具真的能跑起来"}
          </small>
        </span>
        <button className="primary-setting runtime-check" disabled={healthBusy} onClick={() => void runHealth()}><Activity size={13} />{healthBusy ? "检查中…" : "检查工具"}</button>
      </div>
      {healthError ? <div className="runtime-loading">{healthError}</div> : null}
      {healthBad.length > 0 && (
        <div className="runtime-list" data-health-bad={healthBad.length}>
          {healthBad.map((row) => (
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
          <pre>{manifest}</pre>
          <button className="secondary-setting" onClick={() => { void copyTextToClipboard(manifest); setNotice("工具清单已复制"); }}><Copy size={13} />复制清单</button>
        </div>
      </details>
      {/* 1 1-06 用户（截图）：「工具自检的界面不好看」——大段说明改成三组带色标的清单卡。 */}
      <section className="devtools-manifest-note" aria-label="工具清单说明">
        <div className="devtools-manifest-group">
          <span className="devtools-manifest-tag is-builtin">随包内置</span>
          <p>引擎、Node、VS Code CLI、Nuphus 桌面自动化、ponytail 写代码模式插件；下载体积 50MB 以内的小工具：Python（含 pip / Tkinter）、ripgrep、uv、CMake、7-Zip、jq、Ninja、yt-dlp、Android 平台工具（adb）。开箱即用、离线可用。</p>
        </div>
        <div className="devtools-manifest-group">
          <span className="devtools-manifest-tag is-download">按需下载</span>
          <p>Git（首启缺失自动补装）、PowerShell 7（国内镜像优先，失败回落官方源）、FFmpeg、Miniconda、MinGW、文档转换 markitdown（pip 清华镜像）、Ego Lite 浏览器自动化（首选通道，跳官方安装器，不随包）。</p>
        </div>
        <div className="devtools-manifest-group">
          <span className="devtools-manifest-tag is-system">系统安装</span>
          <p>Docker Desktop、OpenSSL —— 点按钮打开官网，按系统安装器完成。</p>
        </div>
        <p className="devtools-manifest-foot">未装 Ego Lite 时回落 browse-skills（nuphus 默认浏览器）。除内置项外都可卸载（真删）；安装后自动加入 Codex 环境（不改系统 PATH / 注册表）；引擎在会话里自行安装工具时，此页状态也会自动刷新。</p>
      </section>

      {/* 自检弹窗：进度条 + 逐项结果（绿=可用，红=不可用） */}
      {healthRows ? (
        <div className="devtool-health-backdrop" onClick={() => { if (!healthBusy) setHealthRows(null); }}>
          <div className="devtool-health-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="devtool-health-head">
              <strong>工具自检{healthBusy ? (healthRows.length ? ` · ${healthDone}/${healthRows.length}` : " · 准备中") : ` · ${healthRows.length} 项`}</strong>
              <button className="secondary-setting" onClick={() => setHealthRows(null)} disabled={healthBusy}>关闭</button>
            </div>
            <div className="devtool-health-progress">
              <span style={{ width: healthRows.length ? Math.round((healthDone / Math.max(healthRows.length, 1)) * 100) + "%" : "6%" }} />
            </div>
            <div className="devtool-health-list">
              {healthRows.map((row) => (
                <div key={row.id} className={"devtool-health-row " + (row.ok ? "is-ok" : "is-bad")}>
                  <span className="devtool-health-badge">{row.ok ? "✓" : "✕"}</span>
                  <span className="devtool-health-name">{row.name}</span>
                  <span className="devtool-health-detail">{row.ok ? row.detail || "可运行" : row.detail}</span>
                </div>
              ))}
              {healthBusy && healthRows.length === 0 ? <div className="devtool-health-row is-plain">准备检查…</div> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}