/**
 * 设置页 · knowledge（2026-09-28 新增）：内置知识库服务（WeKnora Lite）的管理卡。
 *
 * 产品形态（用户 09-28 定稿）：WeKnora 本体**不随安装包分发**，这里提供「按需安装」
 * （从公开库 Release 下载预构建 zip，主进程 weknora 域负责下载/解压/校验）与启停、卸载。
 * 数据（SQLite + 上传文件）全部落 userData/weknora/，服务只绑 127.0.0.1。
 *
 * ⛔ 与 KnowledgePane（主区 webview 面板）共享 weknora IPC 面；本页不内嵌 webview。
 */
import { useCallback, useEffect, useState } from "react";
import { Database, ExternalLink, Power, RotateCcw, Trash2 } from "lucide-react";
import { PageInfo } from "../../components/SettingsHead";
import { Spinner } from "../../components/CardShell";

type WeknoraState = {
  installed: boolean;
  version: string;
  running: boolean;
  port: number | null;
  pid: number | null;
  installing: boolean;
  progress: { phase: string; percent: number } | null;
  error: string | null;
};

export function KnowledgeSettingsSection() {
  const [state, setState] = useState<WeknoraState | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmUninstall, setConfirmUninstall] = useState(false);

  const refresh = useCallback(async () => {
    const current = await window.codex.weknoraStatus();
    setState(current);
    setAddress(current.running && current.port ? `http://127.0.0.1:${current.port}` : null);
  }, []);

  useEffect(() => {
    void refresh();
    // 安装进度由主进程推送（下载/解压阶段，避免轮询拉状态）
    return window.codex.onWeknoraProgress(() => { void refresh(); });
  }, [refresh]);

  const act = async (action: () => Promise<WeknoraState>) => {
    setBusy(true);
    try { setState(await action()); } finally { setBusy(false); void refresh(); }
  };

  return (
    <section className="settings-section stack backup-page">
      <div className="settings-copy"><h2>知识库<PageInfo text={<>本地知识库服务（腾讯 WeKnora Lite）：上传文档后可在服务内问答、检索和交给 Agent。按需安装，数据全部留在本机。</>} /></h2></div>
      <div className="backup-grid">
        <article className="backup-card backup-card--current">
          <div className="backup-card-head"><span><Database size={16} /></span><div><strong>知识库服务</strong><small>{state?.installed ? `已安装 · WeKnora Lite v${state.version}` : "未安装 · 约 60-90 MB（下载后解压到本机用户数据目录）"}</small></div></div>
          <p>
            {state?.installed
              ? state.running
                ? `运行中：127.0.0.1:${state.port}（仅本机可访问）。管理界面里上传文档、建知识库；对话里把知识库内容交给 Codex 用 MCP 接入（服务内「MCP」页创建端点后，把地址填进本应用 MCP 设置）。`
                : "已安装未运行。启动后可在管理界面里上传文档、建知识库；停止不会丢失任何数据。"
              : "点击「安装」从应用发布源下载 WeKnora Lite 预构建包（Windows x64）。下载与解压进度会显示在这里；安装完成后可随时启动/停止。"}
          </p>
          {state?.installing && state.progress && (
            <div className="knowledge-progress" role="status">
              <span>{state.progress.phase} {state.progress.percent > 0 ? `${state.progress.percent}%` : "…"}</span>
              <div className="knowledge-progress-bar"><div style={{ width: `${state.progress.percent}%` }} /></div>
            </div>
          )}
          {state?.error && <div className="knowledge-error-line">{state.error}</div>}
          <div className="backup-card-actions">
            {!state?.installed && (
              <button className="primary-setting" disabled={busy || state?.installing} onClick={() => void act(() => window.codex.weknoraInstall())}>
                {busy || state?.installing ? <Spinner /> : <Database size={14} />}安装知识库服务
              </button>
            )}
            {state?.installed && !state.running && (
              <button className="primary-setting" disabled={busy} onClick={() => void act(() => window.codex.weknoraStart())}>
                {busy ? <Spinner /> : <Power size={14} />}启动服务
              </button>
            )}
            {state?.installed && state.running && (
              <>
                <button className="primary-setting" disabled={busy} onClick={() => void act(() => window.codex.weknoraStop())}>
                  {busy ? <Spinner /> : <Power size={14} />}停止服务
                </button>
                <button className="secondary-setting" disabled={busy || !address} onClick={() => { if (address) void window.codex.openExternal(address); }}>
                  <ExternalLink size={14} />打开管理界面
                </button>
              </>
            )}
            {state?.installed && (
              confirmUninstall ? (
                <button className="secondary-setting" disabled={busy} onClick={() => { void act(() => window.codex.weknoraUninstall()); setConfirmUninstall(false); }}>
                  <Trash2 size={14} />确认卸载（服务本体；上传的文档保留）
                </button>
              ) : (
                <button className="secondary-setting" disabled={busy || state.running} onClick={() => setConfirmUninstall(true)}>
                  <RotateCcw size={14} />卸载
                </button>
              )
            )}
          </div>
        </article>
        <article className="backup-card">
          <div className="backup-card-head"><span><ExternalLink size={16} /></span><div><strong>在对话里使用</strong><small>MCP 接入（知识库检索交给 Codex）</small></div></div>
          <p>
            服务运行后，在管理界面的「MCP」页创建一个端点（Streamable HTTP），把它的地址填进本应用「设置 → MCP」即可让 Codex 直接检索你的知识库。
            {address && <> 当前服务地址：<code>127.0.0.1:{state?.port}</code>（MCP 端点路径以管理界面里创建的为准）。</>}
          </p>
          <div className="backup-card-actions">
            <button className="secondary-setting" disabled={busy || state?.running} onClick={() => void act(() => window.codex.weknoraStart())}>
              {busy ? <Spinner /> : <Power size={14} />}启动服务
            </button>
          </div>
        </article>
      </div>
      <div className="backup-footnote"><Database size={14} /><span><strong>数据位置</strong>：知识库与服务数据保存在应用用户数据目录的 <code>weknora/</code> 下（SQLite 数据库 + 上传文件），卸载服务不会删除这些数据；服务只监听本机回环地址，不会暴露到局域网。</span></div>
    </section>
  );
}
