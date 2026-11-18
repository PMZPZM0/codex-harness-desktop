/**
 * 自媒体工作台（11-09）：**开源 dsh-media-desk 原样嵌入**（MIT）。
 *
 * 界面与流程由它的原版客户端在本地服务里渲染（主进程 media-desk/embed.ts），
 * 这里只负责拿到地址并铺满设置页 —— ⛔ 不再自己画一套界面。
 * 数据与 Codex 工具共用同一份（`<userData>/media-desk-host/media-desk/state.json`）。
 *
 * 11-16 用户令：**控制台/工作台里能更新**（查上游最新版 → 下载安装到 userData → 重启本地服务），
 * 更新完自适应现有布局（iframe 跟随当前容器铺满，不出现内嵌滚动条）。
 * ⛔ 更新只动 `<userData>/media-desk-vendor/`，不动随包资源（删指针即回退）。
 */
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw, Download } from "lucide-react";

const SOURCE_URL = "https://github.com/woniuniuniu/dsh-media-desk";

type VersionInfo = { current: string; bundled: string; overridden: boolean };

/** 工作台页面：iframe 打开主进程起的原版界面（同源本地服务，只监听 127.0.0.1）。 */
export function MediaDeskPage() {
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  const [frameKey, setFrameKey] = useState(0);
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [latest, setLatest] = useState("");
  const [hasUpdate, setHasUpdate] = useState(false);
  const [notice, setNotice] = useState("");
  const [updating, setUpdating] = useState(false);

  const openWorkbench = useCallback(() => {
    window.codex.mediaDeskEndpoint?.()
      .then((url: string) => { setSrc(String(url ?? "")); setFrameKey((k) => k + 1); })
      .catch((e: unknown) => setError(String((e as { message?: unknown } | null)?.message ?? e)));
  }, []);

  const refreshVersion = useCallback(() => {
    window.codex.mediaDeskVersion?.()
      .then((v) => setInfo(v ?? null))
      .catch(() => setInfo(null));
  }, []);

  useEffect(() => {
    openWorkbench();
    refreshVersion();
  }, [openWorkbench, refreshVersion]);

  const check = async () => {
    setChecking(true);
    setNotice("");
    try {
      const r = await window.codex.mediaDeskCheckUpdate?.();
      if (!r) return;
      setLatest(r.latest);
      setHasUpdate(Boolean(r.hasUpdate));
      setNotice(r.error ? `查询失败：${r.error}` : r.hasUpdate ? `有新版本 ${r.latest}` : "已是最新版本");
    } catch (e) {
      setNotice(`查询失败：${String((e as { message?: unknown } | null)?.message ?? e)}`);
    } finally {
      setChecking(false);
    }
  };

  const update = async () => {
    setUpdating(true);
    setNotice(`正在下载 ${latest || "最新版"}…`);
    try {
      const r = await window.codex.mediaDeskUpdate?.({ version: latest || undefined });
      if (r?.ok) {
        /* 新服务地址（新令牌前缀）⇒ 换 src 并强制重载 iframe；版本条同步刷新。 */
        if (r.endpoint) { setSrc(r.endpoint); setFrameKey((k) => k + 1); }
        setNotice(`已更新到 ${r.version ?? latest}`);
        setHasUpdate(false);
        refreshVersion();
      } else {
        setNotice(`更新失败：${r?.error ?? "未知错误"}`);
      }
    } catch (e) {
      setNotice(`更新失败：${String((e as { message?: unknown } | null)?.message ?? e)}`);
    } finally {
      setUpdating(false);
    }
  };

  /* 11-18（自媒体深度联动）：成稿出口三连 —— 交群评审 / 派剪承团 / 按设计参考改。
     ⛔ 只把提示词**预填**进主窗口输入框（不自动发送、不代替发布）；工作台窗口里没有输入框，
     所以走主进程 app:prefill 通道；取件口径在主进程（最近一条已出稿，其次最近一条内容）。 */
  const handoff = async (kind: "group" | "video" | "design") => {
    try {
      const r = await window.codex.handoffMediaDesk({ kind });
      setNotice(r?.ok ? `已把「${r.title ?? "这条内容"}」填进主窗口输入框（可先改再发）` : String(r?.error ?? "没取到内容"));
    } catch (e) {
      setNotice(`出口失败：${String((e as { message?: unknown } | null)?.message ?? e)}`);
    }
  };

  if (error) return <p className="media-desk-error" role="status">工作台启动失败：{error}</p>;
  if (!src) return <p className="media-desk-loading" role="status">正在打开工作台…</p>;

  return (
    <div className="media-desk-page">
      <div className="media-desk-bar">
        <span className="media-desk-ver" title={`随包基线 ${info?.bundled ?? "-"}；当前生效 ${info?.current ?? "-"}`}>
          版本 {info?.current ?? "…"}
          {info?.overridden ? <em>已更新</em> : null}
        </span>
        <span className="media-desk-exits">
          <button type="button" className="media-desk-btn" title="把这条内容交给主窗口做发布前评审" onClick={() => void handoff("group")}>交群评审</button>
          <button type="button" className="media-desk-btn" title="把这条内容拆成 60 秒口播分镜（剪承团）" onClick={() => void handoff("video")}>派剪承团</button>
          <button type="button" className="media-desk-btn" title="挑一套设计参考，出配图方向" onClick={() => void handoff("design")}>按参考改视觉</button>
        </span>
        <span className="media-desk-spacer" />
        {notice ? <span className="media-desk-notice" role="status">{notice}</span> : null}
        <button type="button" className="media-desk-btn" onClick={() => void check()} disabled={checking || updating}>
          <RefreshCw size={12} className={checking ? "spin" : ""} />
          {checking ? "检查中…" : "检查更新"}
        </button>
        {hasUpdate ? (
          <button type="button" className="media-desk-btn is-primary" onClick={() => void update()} disabled={updating}>
            <Download size={12} />
            {updating ? "更新中…" : `更新到 ${latest}`}
          </button>
        ) : null}
        <button type="button" className="media-desk-btn" onClick={openWorkbench} disabled={updating} title="重新加载工作台页面">
          <RefreshCw size={12} />
          重载
        </button>
      </div>
      <iframe key={frameKey} className="media-desk-frame" src={src} title="自媒体工作台" />
      <div className="media-desk-note">
        <span>界面与流程来自开源项目 dsh-media-desk（MIT）；数据只存本机，排期不会自动发布。</span>
        <button type="button" className="media-desk-link" onClick={() => void window.codex.openExternal(SOURCE_URL)}>
          <ExternalLink size={12} />
          开源项目
        </button>
      </div>
    </div>
  );
}
