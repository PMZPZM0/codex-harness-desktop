/** Laya 智能判断卡片（10-01 新增，嵌在「开发工具」页）。
 *
 * Laya = GitHub NandhaKishorM/laya（Apache-2.0）：非自回归决策引擎，单次前向 ~33ms
 * 输出结构化判断（choice/score/yes-no），零生成零幻觉，中文走 multilingual checkpoint。
 * 当前消费方：思考等级「自动」档（发送前判断 低/中/高/极高）；后续还会接
 * 危险命令护栏 / 消息分诊 / 专家路由（见 electron/features/laya-service.ts 头注）。
 * 状态与 electron/features/laya-service.ts 同源；这里只渲染，不自己判定。
 */
import { useCallback, useEffect, useState } from "react";
import { BrainCircuit, Download, CircleCheck, AlertTriangle, RefreshCw } from "lucide-react";
import { Spinner } from "../../components/CardShell";

type Status = {
  installed: boolean;
  version: string;
  running: boolean;
  ready: boolean;
  port: number;
  installing: boolean;
  starting: boolean;
  lastError: string;
};

export function LayaCard({ setNotice }: { setNotice: (text: string) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");

  const refresh = useCallback(async () => {
    try { setStatus(await window.codex.layaStatus()); } catch { setStatus(null); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const install = async () => {
    setBusy(true);
    setLog("正在通过清华镜像安装 laya[serve]（含 PyTorch，约 800MB，可能需要 10-20 分钟）…");
    try {
      const r = await window.codex.layaInstall();
      setLog(r.log ?? "");
      setNotice(r.ok ? "Laya 安装完成。首次使用时会自动下载判断模型权重（约 700MB，走国内镜像）" : "Laya 安装失败，详见下方日志");
    } catch (error: any) {
      setLog(String(error?.message ?? error));
      setNotice("Laya 安装失败");
    }
    await refresh();
    setBusy(false);
  };

  const stateText = !status ? "读取中…"
    : status.ready ? "就绪（权重已加载，可以判断）"
    : status.running || status.starting ? "服务启动中（首次会下载权重 ~700MB，走国内镜像）"
    : status.installing ? "正在安装…"
    : status.installed ? "已安装 · 服务未启动（首次使用时自动拉起并下载权重）"
    : "未安装";

  return (
    <div className="runtime-row laya-card">
      <span className="runtime-icon">{busy ? <Spinner /> : status?.ready ? <CircleCheck size={16} /> : <BrainCircuit size={16} />}</span>
      <span className="runtime-copy">
        <strong>Laya 智能判断{status?.version ? ` · v${status.version}` : ""}</strong>
        <small>本地决策模型（33ms）：思考等级「自动」档的判断端——发送前自动选 低/中/高/极高。
          不装也能用：自动档会回落到你手选的档位。</small>
        <em className="runtime-hint">{stateText}{status?.lastError ? ` · ${status.lastError}` : ""}</em>
      </span>
      <div className="runtime-actions">
        {status?.ready ? <span className="runtime-badge installed">就绪</span>
          : status?.installed ? <button className="secondary-setting" onClick={() => void refresh()}><RefreshCw size={13} />刷新</button>
          : <button className="primary-setting runtime-install" disabled={busy || Boolean(status?.installing)} onClick={() => void install()}>{busy ? <Spinner /> : <Download size={14} />}安装</button>}
      </div>
      {log && (
        <details className="laya-install-log">
          <summary><AlertTriangle size={12} />安装日志</summary>
          <pre>{log}</pre>
        </details>
      )}
    </div>
  );
}
