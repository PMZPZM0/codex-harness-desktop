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
import { Download, ExternalLink, FolderOpen, LoaderCircle, Mic, Power, Trash2, X } from "lucide-react";

type Status = {
  ready: number;
  total: number;
  bytes: number;
  root: string;
  repos: { id: string; lastSegment: string }[];
  /** 音色克隆模型（ZipVoice）就绪状态——主进程新增字段必须在这里带出来，否则 UI 永远显示未安装 */
  zipvoice?: { ready: boolean; enabled?: boolean; bytes?: number; dir?: string };
  /** 语音唤醒关键词模型（KWS） */
  kws?: { ready: boolean; enabled?: boolean; bytes?: number; dir?: string };
  /** 基础模型是否启用（10-03 三态；缺省 true = 启用，兼容老主进程） */
  baseEnabled?: boolean;
};
type DownloadState = { percent: number; message: string; mode: "download" | "import" } | null;

/** 可三态管理的资源种类（与主进程 VOICE_RESOURCE_KINDS 对齐）。 */
type ResourceKind = "base" | "zipvoice" | "kws";

/**
 * 单个资源的四态（10-03）。
 *
 * ⛔ 为什么是四态而不是「启用/停用」两态：**「是否启用」与「是否已下载」是两个正交维度**，
 *    组合出四种有意义的情况，UI 必须都能区分：
 *      未安装        = 没下载过（谈不上启用/停用）
 *      已停用        = 装着但不加载（文件在磁盘，启用后立即可用）
 *      已就绪        = 装着且加载中
 *      部分就绪      = 基础模型这种多文件资源只下了一部分（base 专属）
 */
type ResourceState = "not-installed" | "disabled" | "ready" | "partial";

/** 由「已下载」+「启用」两个正交事实推出展示态。`enabled` 缺省 true = 启用（兼容老主进程）。 */
function stateOf(installed: boolean, enabled: boolean, partial = false): ResourceState {
  if (!installed) return "not-installed";
  if (!enabled) return "disabled";
  return partial ? "partial" : "ready";
}

const STATE_TEXT: Record<ResourceState, string> = {
  "not-installed": "未安装",
  disabled: "已停用",
  ready: "已就绪",
  partial: "未装全",
};

/** 徽标配色：ok=绿（可用）/ warn=琥珀（停用，不可用但文件在）/ missing=灰（没装） */
const STATE_BADGE: Record<ResourceState, string> = {
  "not-installed": "missing",
  disabled: "warn",
  ready: "ok",
  partial: "warn",
};

export default function VoiceDevToolsSection({ onNotice }: { onNotice: (m: string) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [downloading, setDownloading] = useState<DownloadState>(null);
  // 音色克隆模型（ZipVoice）独立下载状态：与基础语音模型分开显示/取消
  const [zipDownloading, setZipDownloading] = useState<DownloadState>(null);
  /**
   * ⛔ 10-03 恢复卸载二次确认（此前被显式移除，理由是"window.confirm 抢焦点"+"只是删本地文件"）。
   *   这两条理由对 156MB 的**按需下载**模型都不成立：删了要重新走网络才能恢复，而 GitHub
   *   直连在国内不稳（已走 ghfast/gh-proxy 镜像，但仍是 156MB 的往返）。用户反馈「删了就没了」。
   *   做法沿用本项目惯例（`DramaProjectsPanel` 删除 / `MemoryPanels` 清理动作 / 删订阅账号）：
   *   **第一次点只展开确认条，第二次才真删** —— 既不抢焦点，也不是一击生效。
   */
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  /**
   * 10-03 三态管理：每个资源一个待确认的删除动作（`null` = 不在确认态）。
   * ⛔ 用 `kind` 而不是布尔量：三个资源各有各的确认态，一个 `confirmUninstall` 会让
   *    「音色克隆」点删除时把「基础模型」的确认条也弹出来（同款"共享槽位两态"坑，09-23 返工过）。
   */
  const [confirmDelete, setConfirmDelete] = useState<ResourceKind | null>(null);
  /** 正在切换启用状态的资源（按钮转圈 + 防连点） */
  const [toggling, setToggling] = useState<ResourceKind | null>(null);
  /** 正在删除的资源 */
  const [deleting, setDeleting] = useState<ResourceKind | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(() => {
    window.codex.voiceModelsStatus()
      .then((s: any) => setStatus({
        ready: s.readyFiles ?? s.ready ?? 0,
        total: s.totalFiles ?? s.total ?? 0,
        bytes: s.bytes ?? 0,
        root: s.root,
        repos: Array.isArray(s.repos) ? s.repos : [],
        // ⚠️ 这里是**显式字段映射**，主进程新增的字段必须在这里带出来，
        // 否则表现为「装完了状态一直显示未安装」（09-12 用户实测踩过：zipvoice 被丢掉）。
        // 10-03 同款坑第二次：enabled 漏了会让「已停用」显示成「已就绪」。
        zipvoice: s.zipvoice ? { ...s.zipvoice, enabled: s.zipvoice.enabled !== false } : undefined,
        kws: s.kws ? { ...s.kws, enabled: s.kws.enabled !== false } : undefined,
        baseEnabled: s.baseEnabled !== false,
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
    // ⛔ 10-03：二次确认改在按钮上做（见 confirmUninstall），这里只负责真正执行。
    //    卸载删的是**整个 voice-models 目录**（含音色克隆模型 156MB 与唤醒模型），
    //    但**不碰 <userData>/voice-profiles** ⇒ 用户导入/录制的音色（参考音频）安全。
    setConfirmUninstall(false);
    window.codex.voiceModelsUninstall()
      .then((r: any) => { if (r.ok) onNotice("语音模型已卸载（音色参考音频已保留）"); else onNotice("卸载失败"); refresh(); })
      .catch((e: any) => onNotice(`卸载失败：${e?.message ?? e}`));
  }, [onNotice, refresh]);

  const ready = status ? status.ready === status.total && status.total > 0 : false;
  const sizeMB = status ? Math.round(status.bytes / 1024 / 1024) : null;
  const zipReady = Boolean((status as any)?.zipvoice?.ready);
  /** 音色克隆模型体积（主包 + 声码器，10-03 约 156MB）—— 确认文案要写准，别让用户以为"只是删个小文件" */
  const zipBytesMB = (status as any)?.zipvoice?.bytes ? Math.round((status as any).zipvoice.bytes / 1024 / 1024) : null;

  // ── 四态（启用 × 已下载 正交）──
  const baseInstalled = Boolean(status && status.total > 0 && status.ready > 0);
  const baseState: ResourceState = stateOf(baseInstalled, status?.baseEnabled !== false, status ? status.ready < status.total : false);
  const zipState: ResourceState = stateOf(zipReady, status?.zipvoice?.enabled !== false);
  const baseDisabled = baseState === "disabled";
  const zipDisabled = zipState === "disabled";

  /**
   * 启用 / 停用：可逆、不碰磁盘文件。
   *
   * ⛔ 文案必须说清「停用不省空间」——用户看到文件还在 270MB 就会以为没生效。
   *    停用省的是加载开销（不占内存/CPU），不是磁盘。这点不说清，下一条反馈
   *    就是「停用了但还是占 270MB」。
   */
  const setEnabled = useCallback(async (kind: ResourceKind, enabled: boolean, label: string) => {
    setToggling(kind);
    try {
      const r: any = await window.codex.voiceResourceSetEnabled({ kind, enabled });
      if (!r?.ok) onNotice(r?.error ?? "操作失败");
      else onNotice(enabled ? `${label}已启用` : `${label}已停用（文件仍保留在本机，重新启用即可恢复，无需重新下载）`);
      refresh();
    } catch (e: any) {
      onNotice(`操作失败：${e?.message ?? e}`);
    } finally {
      setToggling(null);
    }
  }, [onNotice, refresh]);

  /** 删除：物理删除，走项目惯例的二次确认（第一次点只展开确认条）。 */
  const doDelete = useCallback(async (kind: ResourceKind, label: string) => {
    setConfirmDelete(null);
    setDeleting(kind);
    try {
      const r: any = await window.codex.voiceResourceDelete({ kind });
      if (!r?.ok) onNotice(r?.error ?? "删除失败");
      else onNotice(`${label}已删除，需要时可重新下载`);
      refresh();
    } catch (e: any) {
      onNotice(`删除失败：${e?.message ?? e}`);
    } finally {
      setDeleting(null);
    }
  }, [onNotice, refresh]);

  /** 停用中的资源主进程会拒绝删除；这里提前拦一层并解释原因，别让用户点了才吃报错。 */
  const requestDelete = useCallback((kind: ResourceKind, label: string) => {
    if (kind === "base" ? baseDisabled : kind === "zipvoice" ? zipDisabled : false) {
      onNotice(`「${label}」处于停用状态，请先重新启用再删除`);
      return;
    }
    setConfirmDelete(kind);
  }, [baseDisabled, zipDisabled, onNotice]);

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
        <span className={`voice-devtools-badge ${STATE_BADGE[baseState]}`}>
          {status ? (baseState === "ready" ? "已就绪" : baseState === "disabled" ? "已停用" : baseState === "partial" ? `未装全 ${status.ready}/${status.total}` : `${sizeMB} MB · ${status.ready}/${status.total}`) : "读取中…"}
        </span>
      </div>

      <div className="voice-devtools-body">
        <div className="voice-devtools-desc">
          <strong>总大小约 270MB</strong>——首次使用按需下载（HF / hf-mirror 镜像自动测速），或从本地目录导入。
          {baseDisabled && (
            <div className="voice-resource-note">
              该模型已<strong>停用</strong>：文件仍保留在本机（不占额外空间，也不需要重新下载），
              但语音功能不会加载它。重新启用后立即恢复。
            </div>
          )}
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
        ) : baseInstalled ? (
          <>
            <button className="secondary-setting" onClick={reveal}>
              <FolderOpen size={13} />打开目录
            </button>
            {/* 停用 ↔ 启用：可逆、不删文件。停用态下仍保留"打开目录"和"启用"，
                免得用户停用后界面变成死路（只能刷新或重装）。 */}
            {baseDisabled ? (
              <button
                className="primary-setting"
                disabled={toggling === "base"}
                onClick={() => setEnabled("base", true, "语音基础模型")}
              >
                {toggling === "base" ? <LoaderCircle className="spin" size={13} /> : <Power size={13} />}启用
              </button>
            ) : (
              <button
                className="secondary-setting"
                disabled={toggling === "base"}
                onClick={() => setEnabled("base", false, "语音基础模型")}
                title="停用后不加载该模型（省内存/CPU），文件仍保留在本机，可随时重新启用"
              >
                {toggling === "base" ? <LoaderCircle className="spin" size={13} /> : <Power size={13} />}停用
              </button>
            )}
            {confirmDelete === "base" ? (
              <>
                <span className="voice-uninstall-hint">
                  将删除语音基础模型{sizeMB ? `（约 ${sizeMB} MB` : ""}，<strong>需重新下载才能恢复</strong>。
                  若只是想暂时不用，请改用「停用」。
                </span>
                <button className="secondary-setting voice-uninstall" onClick={() => doDelete("base", "语音基础模型")}>
                  <X size={13} />确认删除
                </button>
                <button className="secondary-setting" onClick={() => setConfirmDelete(null)}>取消</button>
              </>
            ) : (
              <button className="secondary-setting voice-uninstall" onClick={() => requestDelete("base", "语音基础模型")}>
                <Trash2 size={13} />删除
              </button>
            )}
            {/* 全部清空（含音色克隆与唤醒模型）——与「删除」区分：那个只删本卡片这一个资源 */}
            {confirmUninstall ? (
              <>
                <span className="voice-uninstall-hint">
                  将删除<strong>全部</strong>语音模型
                  {sizeMB ? `（基础约 ${sizeMB} MB` : ""}
                  {zipBytesMB ? ` + 音色克隆约 ${zipBytesMB} MB` : ""}
                  ，需重新下载才能恢复。<strong>你的音色（参考音频）不会被删除。</strong>
                </span>
                <button className="secondary-setting voice-uninstall" onClick={uninstall}>
                  <X size={13} />确认全部清空
                </button>
                <button className="secondary-setting" onClick={() => setConfirmUninstall(false)}>取消</button>
              </>
            ) : (
              <button className="secondary-setting voice-uninstall" onClick={() => setConfirmUninstall(true)}>
                <X size={13} />全部清空
              </button>
            )}
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
        <span className={`voice-devtools-badge ${STATE_BADGE[zipState]}`}>
          {status ? STATE_TEXT[zipState] : "读取中…"}
        </span>
      </div>

      <div className="voice-devtools-body">
        {zipDisabled && (
          <div className="voice-resource-note">
            该模型已<strong>停用</strong>：156MB 文件仍保留在本机（无需重新下载），但语音合成不会使用它 ——
            选择「我的音色」时会回退到内置音色。重新启用后立即恢复。
          </div>
        )}
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
          <>
            <button className="secondary-setting" onClick={reveal}>
              <FolderOpen size={13} />打开模型目录
            </button>
            {zipDisabled ? (
              <button
                className="primary-setting"
                disabled={toggling === "zipvoice"}
                onClick={() => setEnabled("zipvoice", true, "音色克隆模型")}
              >
                {toggling === "zipvoice" ? <LoaderCircle className="spin" size={13} /> : <Power size={13} />}启用
              </button>
            ) : (
              <button
                className="secondary-setting"
                disabled={toggling === "zipvoice"}
                onClick={() => setEnabled("zipvoice", false, "音色克隆模型")}
                title="停用后合成会回退到内置音色，156MB 文件仍保留在本机，可随时重新启用"
              >
                {toggling === "zipvoice" ? <LoaderCircle className="spin" size={13} /> : <Power size={13} />}停用
              </button>
            )}
            {confirmDelete === "zipvoice" ? (
              <>
                <span className="voice-uninstall-hint">
                  将删除音色克隆模型{zipBytesMB ? `（约 ${zipBytesMB} MB` : ""}，<strong>需重新下载才能恢复</strong>。
                  若只是想暂时不用，请改用「停用」。<strong>你已导入/录制的音色（参考音频）不会被删除。</strong>
                </span>
                <button className="secondary-setting voice-uninstall" onClick={() => doDelete("zipvoice", "音色克隆模型")}>
                  <X size={13} />确认删除
                </button>
                <button className="secondary-setting" onClick={() => setConfirmDelete(null)}>取消</button>
              </>
            ) : (
              <button className="secondary-setting voice-uninstall" onClick={() => requestDelete("zipvoice", "音色克隆模型")}>
                <Trash2 size={13} />删除
              </button>
            )}
          </>
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