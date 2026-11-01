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
      <div className="devtools-health">
        <button className="secondary-setting runtime-check" disabled={healthBusy} onClick={() => void runHealth()}><Activity size={13} />{healthBusy ? "检查中…" : "检查工具"}</button>
        {health
          ? <span className="settings-card-hint">{healthBad.length === 0 ? "已安装的工具全部可运行" : `发现 ${healthBad.length} 项不可用`}（另有 {healthMissing} 项未安装）</span>
          : <span className="settings-card-hint">点一下，逐个验证已装的工具能不能真跑起来</span>}
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
      <p className="settings-card-hint">随应用内置（安装包自带、离线可用）：引擎、Node、VS Code CLI、Nuphus 桌面自动化、ponytail 写代码模式插件，以及下载体积 50MB 以内的小工具 —— Python（完整版，含 pip 与 Tkinter）、ripgrep、uv、CMake、7-Zip、jq、Ninja、yt-dlp、Android 平台工具（adb）；按需下载：Git、PowerShell 7（npmmirror / gh 加速，失败自动回落官方源，首次启动检测到缺 Git 会自动补装）、FFmpeg、Miniconda、MinGW、文档转换（markitdown，pip 清华镜像）；Docker Desktop、OpenSSL 需系统级安装（点按钮打开官网）。Ego Lite 浏览器自动化是**首选**通道，在卡片里跳官方安装器（不随包内置 611MB 浏览器）；未安装时回落 browse-skills（nuphus 默认浏览器）。除内置项外都可卸载（卸载是真删）。日常浏览用内置浏览器视图；浏览器自动化由每个会话自己的 Ego Lite Space 执行。安装后自动加入 Codex 环境（不修改系统 PATH 或注册表）；引擎在会话里自行安装工具时，此页状态也会自动刷新。</p>

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