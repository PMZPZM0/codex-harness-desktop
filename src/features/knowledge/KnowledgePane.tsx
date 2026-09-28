/**
 * 知识库面板（2026-09-28 新增域）：与「AI 画布工作流」同档位的**整屏浮层**，
 * 用 webview 内嵌 WeKnora Lite 的管理界面（服务由主进程 spawn，只绑 127.0.0.1）。
 *
 * 行为：打开时若服务未运行 → 自动 start（healthCheck 在主进程）；失败 → 错误卡 + 「去设置」。
 * ⛔ webview guest 只读 http(s)（window-factory 的 will-attach-webview 已全局校验）。
 */
import { useEffect, useState, type FC } from "react";
import { Database, ExternalLink, RefreshCw, Settings2, X } from "lucide-react";

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

/* 与 components/BrowserPane 同款：React 对 <webview> 无内置 JSX 类型，用字符串组件绕开 */
const WebviewTag = "webview" as unknown as FC<Record<string, unknown>>;

export function KnowledgePane({ onClose, onOpenSettings }: {
  onClose: () => void;
  /** 服务未就绪时引导去「设置 → 知识库」（安装 / 启动在那边操作） */
  onOpenSettings: () => void;
}) {
  const [address, setAddress] = useState<string | null>(null);
  const [state, setState] = useState<WeknoraState | null>(null);
  const [busy, setBusy] = useState(false);

  const ensureRunning = async () => {
    setBusy(true);
    try {
      const after = await window.codex.weknoraStart();
      setState(after);
      setAddress(after.running && after.port ? `http://127.0.0.1:${after.port}` : null);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void (async () => {
      const current = await window.codex.weknoraStatus();
      setState(current);
      if (current.running && current.port) { setAddress(`http://127.0.0.1:${current.port}`); return; }
      await ensureRunning();
    })();
  }, []);

  return (
    <div className="drama-canvas-backdrop" role="dialog" aria-modal="true" aria-label="知识库">
      <section className="drama-canvas-shell knowledge-shell">
        <header className="drama-canvas-head">
          <div className="drama-canvas-head-left">
            <span className="drama-canvas-head-icon"><Database size={17} /></span>
            <div>
              <b>知识库</b>
              <small>{state?.running ? `WeKnora Lite v${state.version} · 本机 127.0.0.1:${state.port} · 数据全部留在本地` : "本地知识库服务（WeKnora Lite）"}</small>
            </div>
          </div>
          <div className="knowledge-head-actions">
            {address && <button className="secondary-setting" onClick={() => void window.codex.weknoraAddress().then((addr) => { if (addr) void window.codex.openExternal(addr); })}><ExternalLink size={13} />系统浏览器打开</button>}
            <button className="secondary-setting" onClick={() => { onOpenSettings(); onClose(); }}><Settings2 size={13} />设置</button>
            <button className="icon-button" title="关闭" onClick={onClose}><X size={16} /></button>
          </div>
        </header>
        <div className="knowledge-body">
          {address ? (
            <WebviewTag key={address} src={address} className="knowledge-webview" />
          ) : (
            <div className="knowledge-placeholder">
              <Database size={28} />
              {busy || state?.installing ? (
                <>
                  <b>正在启动知识库服务…</b>
                  <small>首次启动健康检查最长 30 秒</small>
                </>
              ) : (
                <>
                  <b>{state?.error ? "知识库服务未能启动" : "知识库服务未运行"}</b>
                  {state?.error && <small className="knowledge-error">{state.error}</small>}
                  <div className="knowledge-placeholder-actions">
                    {state?.installed ? (
                      <button className="primary-setting" onClick={() => void ensureRunning()}><RefreshCw size={13} />重试启动</button>
                    ) : (
                      <button className="primary-setting" onClick={() => { onOpenSettings(); onClose(); }}>去设置安装</button>
                    )}
                    <button className="secondary-setting" onClick={() => { onOpenSettings(); onClose(); }}><Settings2 size={13} />打开设置</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
