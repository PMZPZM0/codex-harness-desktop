/**
 * 开发工具 → 语音模型管理。
 *
 * 三件事：
 *  1) 显示状态（就绪 / 未下载 / 大小 / 路径）
 *  2) 内置下载（生产/通用）：走 voice:models-install（之前已实现 + 加速 + 取消）
 *  3) 本地导入（**开发版专用**）：开发者在机子上手下了模型后，
 *     点"从本地文件夹导入"，选那个目录 → 主进程按 repo 复制 + 校验 SHA → 落到 userData/voice-models
 *
 * 生产构建**不会**把模型打进安装包（已确认：sherpa-onnx 原生 addon 在 asarUnpack，
 * 模型数据走 `<userData>/voice-models/` 按需下载），所以这个工具在生产环境等价于
 * "下载面板"；在开发环境多一个"本地导入"按钮。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, ExternalLink, FolderOpen, LoaderCircle, X } from "lucide-react";

type Status = {
  ready: number;
  total: number;
  bytes: number;
  root: string;
};

type DownloadState = {
  percent: number;
  message: string;
  /** 区分是"下载"还是"导入"——按钮文案 / 取消语义都不同 */
  mode?: "download" | "import";
} | null;

export default function VoiceDevToolsSection({ onNotice }: { onNotice: (m: string) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [downloading, setDownloading] = useState<DownloadState>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(() => {
    window.codex.voiceModelsStatus()
      .then((s: any) => setStatus({ ready: s.ready ?? 0, total: s.total ?? 0, bytes: s.bytes ?? 0, root: s.root }))
      .catch((e: any) => onNotice(`读取语音模型状态失败：${e?.message ?? e}`));
  }, [onNotice]);

  useEffect(() => {
    refresh();
    // 订阅下载/导入进度事件——失败/成功都停掉指示器
    const unsub = window.codex.onVoiceEvent((event: any) => {
      if (event?.type === "download") {
        setDownloading({ percent: Number(event.percent ?? -1), message: String(event.message ?? ""), mode: downloading?.mode });
      }
      if (event?.type === "downloadDone") {
        setDownloading(null);
        refresh();
        if (event.ok) onNotice("语音模型就绪");
        else onNotice(`语音模型失败：${event.error ?? "未知"}`);
      }
    });
    unsubRef.current = unsub;
    return () => { unsub?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startInstall = useCallback(() => {
    setDownloading({ percent: 0, message: "准备下载…", mode: "download" });
    window.codex.voiceModelsInstall().catch((e: any) => {
      setDownloading(null);
      onNotice(`下载失败：${e?.message ?? e}`);
    });
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
    const result = await window.codex.voiceModelsImport({ sourceDir: dir }).catch((e: any) => ({ ok: false, failures: [String(e?.message ?? e)] }));
    setDownloading(null);
    refresh();
    if (result.ok) onNotice(`导入完成`);
    else onNotice(`导入失败：${result.failures.slice(0, 3).join("；")}`);
  }, [onNotice, refresh]);

  const reveal = useCallback(() => {
    window.codex.voiceModelsReveal().catch((e: any) => onNotice(`打开失败：${e?.message ?? e}`));
  }, [onNotice]);

  const ready = status ? status.ready === status.total && status.total > 0 : false;

  return (
    <div className="runtime-list voice-devtools">
      <div className={`runtime-row ${ready ? "installed" : "missing"} ${downloading ? "busy" : ""}`}>
        <span className="runtime-icon">
          {downloading ? <LoaderCircle className="spin" size={16} /> : ready ? <span aria-hidden>✓</span> : <Download size={16} />}
        </span>
        <span className="runtime-copy">
          <strong>语音模型</strong>
          <small>
            sherpa-onnx 三件套：识别（zipformer-ctc）+ 端点检测（silero-vad）+ 合成（vits-zh-ll）。
            总大小约 <strong>270MB</strong>，<strong>生产构建不打包</strong>——首次使用按需下载，或从本地目录导入。
          </small>
          {downloading && <em className="runtime-progress">{downloading.message}（{downloading.percent >= 0 ? downloading.percent + "%" : "…"}）</em>}
        </span>
        <span className="runtime-size">
          {status ? `${Math.round(status.bytes / 1024 / 1024)} MB · ${status.ready}/${status.total}` : "读取中…"}
        </span>
        {downloading ? (
          <button className="secondary-setting runtime-install" onClick={cancel}>
            <X size={13} />取消{downloading.mode === "import" ? "导入" : "下载"}
          </button>
        ) : ready ? (
          <button className="secondary-setting runtime-install" onClick={reveal} title="在文件管理器中打开">
            <FolderOpen size={13} />打开目录
          </button>
        ) : (
          <>
            <button className="secondary-setting runtime-install" onClick={startInstall}>
              <Download size={13} />下载模型
            </button>
            <button className="secondary-setting runtime-install" onClick={importFromLocal} title="开发版专用：选择已下载好的目录批量导入">
              <ExternalLink size={13} />本地导入
            </button>
          </>
        )}
      </div>
      {status && (
        <small className="voice-devtools-path" title="模型存放路径">
          路径：<code>{status.root}</code>
        </small>
      )}
    </div>
  );
}