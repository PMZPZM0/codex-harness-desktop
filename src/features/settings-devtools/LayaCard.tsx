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

type Progress = { phase: string; current: string; percent: number; speed: string; detail: string } | null;

type Status = {
  installed: boolean;
  version: string;
  running: boolean;
  ready: boolean;
  port: number;
  installing: boolean;
  starting: boolean;
  lastError: string;
  installProgress: Progress;
  startProgress: Progress;
};

export function LayaCard({ setNotice }: { setNotice: (text: string) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");
  // 失败时自动展开日志（10-01 用户：「安装失败，点开安装日志也展示有问题」——
  //  失败信息要主动摊开，不该等用户想起来去点三角）
  const [logOpen, setLogOpen] = useState(false);

  const refresh = useCallback(async () => {
    try { setStatus(await window.codex.layaStatus()); } catch { setStatus(null); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /* 安装/首启期间每秒轮询状态（进度条的数据源）；空闲时停掉。 */
  const lively = busy || Boolean(status?.installing) || Boolean(status?.starting) || (Boolean(status?.running) && !status?.ready);
  useEffect(() => {
    if (!lively) return;
    const t = setInterval(() => void refresh(), 1000);
    return () => clearInterval(t);
  }, [lively, refresh]);

  const install = async () => {
    setBusy(true);
    setLogOpen(false);
    setLog("正在通过清华镜像安装 laya[serve]（含 PyTorch，约 800MB，可能需要 10-20 分钟）…");
    try {
      const r = await window.codex.layaInstall();
      setLog(r.log ?? "");
      setLogOpen(!r.ok);
      setNotice(r.ok ? "Laya 安装完成。首次使用时会自动下载判断模型权重（约 700MB，走国内镜像）" : "Laya 安装失败，详见下方日志");
    } catch (error: any) {
      setLog(String(error?.message ?? error));
      setLogOpen(true);
      setNotice("Laya 安装失败");
    }
    await refresh();
    setBusy(false);
  };

  const uninstall = async () => {
    setBusy(true);
    setLogOpen(false);
    setLog("正在卸载 laya（先停服务，再 pip uninstall）…");
    try {
      const r = await window.codex.layaUninstall();
      setLog(r.log ?? "");
      setLogOpen(!r.ok);
      setNotice(r.ok ? "Laya 已卸载（模型权重缓存在用户 HF 目录，未随之删除）" : "Laya 卸载失败，详见下方日志");
    } catch (error: any) {
      setLog(String(error?.message ?? error));
      setLogOpen(true);
      setNotice("Laya 卸载失败");
    }
    await refresh();
    setBusy(false);
  };

  const prog = status?.installProgress ?? status?.startProgress ?? null;
  const progLabel = status?.installing
    ? `安装 ${prog?.current || "laya[serve]"}${prog?.detail ? ` · ${prog.detail}` : ""}${prog?.speed ? ` · ${prog.speed}` : ""}`
    : status?.starting
      ? `下载权重 ${prog?.current || "…"}${prog?.detail ? ` · ${prog.detail}` : ""}${prog?.speed ? ` · ${prog.speed}` : ""}`
      : "";

  const stateText = !status ? "读取中…"
    : status.ready ? "就绪（权重已加载，可以判断）"
    : status.installing ? "正在安装…"
    : status.starting ? "服务启动中（首次会下载权重 ~700MB）"
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
        {/* 实时进度条（pip 安装 / 权重下载共用）：无百分比时显示不定条 */}
        {progLabel && (
          <span className="laya-progress">
            <span className="laya-progress-track">
              <i style={{ width: prog?.percent ? `${Math.max(3, Math.min(100, prog.percent))}%` : "35%" }} className={prog?.percent ? "" : "indeterminate"} />
            </span>
            <small>{progLabel}</small>
          </span>
        )}
      </span>
      <div className="runtime-actions">
        {status?.ready ? <span className="runtime-badge installed">就绪</span>
          : status?.installed ? <button className="secondary-setting" onClick={() => void refresh()}><RefreshCw size={13} />刷新</button>
          : <button className="primary-setting runtime-install" disabled={busy || Boolean(status?.installing)} onClick={() => void install()}>{busy ? <Spinner /> : <Download size={14} />}安装</button>}
        {/* 10-01 用户：「Laya 的卸载按键呢」—— 装上就必须能真卸载（先停服务再 pip uninstall） */}
        {status?.installed && (
          <button className="secondary-setting runtime-uninstall" disabled={busy || Boolean(status?.installing)} onClick={() => void uninstall()}>卸载</button>
        )}
      </div>
      {log && (
        <details className="laya-install-log" open={logOpen || undefined}>
          <summary><AlertTriangle size={12} />安装日志</summary>
          <pre>{log}</pre>
        </details>
      )}
    </div>
  );
}
