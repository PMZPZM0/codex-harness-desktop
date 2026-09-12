/**
 * 开发工具 → 语音模型管理。
 *
 * 三件事：
 *  1) 显示状态（就绪 / 未下载 + 大小 + 路径）
 *  2) 内置下载（生产/通用）：走 voice:models-install（4 段并发 + 取消）
 *  3) 本地导入（**开发版专用**）：开发者手下的模型文件 → 复制 + SHA256 校验
 *
 * 生产构建**不会**把模型打进安装包（已确认：sherpa-onnx 原生 addon 在 asarUnpack，
 * 模型数据走 `<userData>/voice-models/` 按需下载）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, ExternalLink, FolderOpen, LoaderCircle, Mic, X } from "lucide-react";

type Status = {
  ready: number;
  total: number;
  bytes: number;
  root: string;
  repos: { id: string; lastSegment: string }[];
};
type DownloadState = { percent: number; message: string; mode: "download" | "import" } | null;

export default function VoiceDevToolsSection({ onNotice }: { onNotice: (m: string) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [downloading, setDownloading] = useState<DownloadState>(null);
  // 音色克隆模型（ZipVoice）独立下载状态：与基础语音模型分开显示/取消
  const [zipDownloading, setZipDownloading] = useState<DownloadState>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(() => {
    window.codex.voiceModelsStatus()
      .then((s: any) => setStatus({
        ready: s.readyFiles ?? s.ready ?? 0,
        total: s.totalFiles ?? s.total ?? 0,
        bytes: s.bytes ?? 0,
        root: s.root,
        repos: Array.isArray(s.repos) ? s.repos : [],
      }))
      .catch((e: any) => onNotice(`读取语音模型状态失败：${e?.message ?? e}`));
  }, [onNotice]);

  useEffect(() => {
    refresh();
    const unsub = window.codex.onVoiceEvent((event: any) => {
      if (event?.type === "download") {
        if (event.target === "zipvoice") {
          setZipDownloading((d) => ({ percent: Number(event.percent ?? -1), message: String(event.message ?? ""), mode: d?.mode ?? "download" }));
          return;
        }
        setDownloading((d) => ({ percent: Number(event.percent ?? -1), message: String(event.message ?? ""), mode: d?.mode ?? "download" }));
      }
      if (event?.type === "downloadDone") {
        if (event.target === "zipvoice") {
          setZipDownloading(null);
          refresh();
          if (event.ok) onNotice("音色克隆模型就绪，可在语音设置里导入/录制你的专属音色");
          else onNotice(`音色克隆模型安装失败：${event.error ?? "未知"}`);
          return;
        }
        setDownloading(null);
        refresh();
        if (event.ok) onNotice("语音模型就绪");
        else onNotice(`语音模型失败：${event.error ?? "未知"}`);
      }
    });
    unsubRef.current = unsub;
    return () => unsub?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startInstall = useCallback(() => {
    setDownloading({ percent: 0, message: "准备下载…", mode: "download" });
    window.codex.voiceModelsInstall().catch((e: any) => { setDownloading(null); onNotice(`下载失败：${e?.message ?? e}`); });
  }, [onNotice]);

  const cancel = useCallback(() => {
    window.codex.voiceModelsCancel();
    setDownloading(null);
  }, []);

  const importFromLocal = useCallback(async () => {
    let dir: string | null = null;
    try { dir = await window.codex.chooseDirectory(); } catch { /* 用户取消 */ }
    if (!dir) return;
    setDownloading({ percent: 0, message: `正在从 ${dir} 导入…`, mode: "import" });
    const result = await window.codex.voiceModelsImport({ sourceDir: dir })
      .catch((e: any) => ({ ok: false, failures: [String(e?.message ?? e)] }));
    setDownloading(null);
    refresh();
    if (result.ok) onNotice("导入完成");
    else onNotice(`导入失败：\n${result.failures.slice(0, 5).join("\n")}`);
  }, [onNotice, refresh]);

  const reveal = useCallback(() => {
    window.codex.voiceModelsReveal().catch((e: any) => onNotice(`打开失败：${e?.message ?? e}`));
  }, [onNotice]);

  const uninstall = useCallback(() => {
    // 不再 window.confirm——浏览器原生确认框会抢焦点、打断输入框；直接开始卸载
    // （卸载瞬间完成、不可逆的操作让用户主动在按钮上点就行；卸载本身也只是删本地文件）
    window.codex.voiceModelsUninstall()
      .then((r: any) => { if (r.ok) onNotice("语音模型已卸载"); else onNotice("卸载失败"); refresh(); })
      .catch((e: any) => onNotice(`卸载失败：${e?.message ?? e}`));
  }, [onNotice, refresh]);

  const ready = status ? status.ready === status.total && status.total > 0 : false;
  const sizeMB = status ? Math.round(status.bytes / 1024 / 1024) : null;
  const zipReady = Boolean((status as any)?.zipvoice?.ready);

  const installZipvoice = useCallback(() => {
    setZipDownloading({ percent: 0, message: "准备下载音色克隆模型…", mode: "download" });
    window.codex.voiceZipvoiceInstall().catch((e: any) => { setZipDownloading(null); onNotice(`下载失败：${e?.message ?? e}`); });
  }, [onNotice]);

  const cancelZipvoice = useCallback(() => {
    window.codex.voiceZipvoiceCancel();
    setZipDownloading(null);
  }, []);

  return (
    <>
    <div className="voice-devtools-card">
      <div className="voice-devtools-card-head">
        <div className="voice-devtools-icon">
          {downloading ? <LoaderCircle className="spin" size={20} /> : ready ? <Mic size={20} /> : <Download size={20} />}
        </div>
        <div className="voice-devtools-title">
          <strong>语音模型</strong>
          <span className="voice-devtools-sub">sherpa-onnx（识别 zipformer + 端点检测 silero + 合成 vits-zh-ll）</span>
          {status && (
            <code className="voice-devtools-path-inline" title={status.root}>{status.root}</code>
          )}
        </div>
        <span className={`voice-devtools-badge ${ready ? "ok" : "missing"}`}>
          {status ? (ready ? "已就绪" : `${sizeMB} MB · ${status.ready}/${status.total}`) : "读取中…"}
        </span>
      </div>

      <div className="voice-devtools-body">
        <div className="voice-devtools-desc">
          <strong>总大小约 270MB</strong>——首次使用按需下载（HF / hf-mirror 镜像自动测速），或从本地目录导入。
        </div>
        {status && !ready && status.repos.length > 0 && (
          <details className="voice-devtools-import-hint">
            <summary>本地导入会识别哪些目录结构？</summary>
            <div className="voice-devtools-import-hint-body">
              <p>支持三种常见布局（任选其一即可）：</p>
              <ol>
                <li><strong>HF 标准快照</strong>：选包含三个仓库子目录的父目录</li>
                <li><strong>单独某个仓库</strong>：选 <code>{status.repos[0]?.lastSegment}</code> / <code>{status.repos[1]?.lastSegment}</code> / <code>{status.repos[2]?.lastSegment}</code> 任一目录</li>
                <li><strong>仓库根</strong>：直接选仓库根目录（里面应有模型文件）</li>
              </ol>
              <p className="voice-devtools-import-repos-title">需要的三个仓库（任一来源皆可）：</p>
              <ul>
                {status.repos.map((r) => (
                  <li key={r.id}><code>{r.lastSegment}</code> <small>（完整 id：<code>{r.id}</code>）</small></li>
                ))}
              </ul>
            </div>
          </details>
        )}
        {downloading && (
          <div className="voice-devtools-progress">
            <div className="voice-devtools-progress-bar"><span style={{ width: `${downloading.percent >= 0 ? downloading.percent : 6}%` }} /></div>
            <small>{downloading.message}（{downloading.percent >= 0 ? downloading.percent + "%" : "…"}）</small>
          </div>
        )}
      </div>

      <div className="voice-devtools-actions">
        {downloading ? (
          <button className="secondary-setting" onClick={cancel}>
            <X size={13} />取消{downloading.mode === "import" ? "导入" : "下载"}
          </button>
        ) : ready ? (
          <>
            <button className="secondary-setting" onClick={reveal}>
              <FolderOpen size={13} />打开目录
            </button>
            <button className="secondary-setting voice-uninstall" onClick={uninstall}>
              <X size={13} />卸载
            </button>
          </>
        ) : (
          <>
            <button className="primary-setting" onClick={startInstall}>
              <Download size={13} />下载模型
            </button>
            <button className="secondary-setting" onClick={importFromLocal} title="选择已下载好的目录批量导入（识别三种常见布局）">
              <ExternalLink size={13} />本地导入
            </button>
          </>
        )}
      </div>
    </div>

    {/* 音色克隆模型（ZipVoice）：zero-shot 克隆，导入/录制一段参考音频即可拥有专属音色。
        按需下载、不进安装包；与基础语音模型（识别+合成）独立安装、独立卸载。 */}
    <div className="voice-devtools-card" style={{ marginTop: 12 }}>
      <div className="voice-devtools-card-head">
        <div className="voice-devtools-icon">
          {zipDownloading ? <LoaderCircle className="spin" size={20} /> : zipReady ? <Mic size={20} /> : <Download size={20} />}
        </div>
        <div className="voice-devtools-title">
          <strong>音色克隆模型</strong>
          <span className="voice-devtools-sub">ZipVoice zero-shot 克隆（中英双语 · 约 156MB）——导入或录制一段参考音频，就能用那个嗓音朗读任意文本；现有 5 个内置音色不受影响</span>
        </div>
        <span className={`voice-devtools-badge ${zipReady ? "ok" : "missing"}`}>
          {status ? (zipReady ? "已就绪" : "未安装") : "读取中…"}
        </span>
      </div>

      <div className="voice-devtools-body">
        {zipDownloading && (
          <div className="voice-devtools-progress">
            <div className="voice-devtools-progress-bar"><span style={{ width: `${zipDownloading.percent >= 0 ? zipDownloading.percent : 6}%` }} /></div>
            <small>{zipDownloading.message}（{zipDownloading.percent >= 0 ? zipDownloading.percent + "%" : "…"}）</small>
          </div>
        )}
      </div>

      <div className="voice-devtools-actions">
        {zipDownloading ? (
          <button className="secondary-setting" onClick={cancelZipvoice}>
            <X size={13} />取消下载
          </button>
        ) : zipReady ? (
          <button className="secondary-setting" onClick={reveal}>
            <FolderOpen size={13} />打开模型目录
          </button>
        ) : (
          <button className="primary-setting" onClick={installZipvoice}>
            <Download size={13} />下载音色克隆模型
          </button>
        )}
      </div>
    </div>
    </>
  );
}