/**
 * OrenCut 动效工坊页（11-28 用户令：「orencut 开源项目…做成按需下载，跟开发工具里面的飞书 cli 界面一样，
 * 然后看看能不能接到侧边栏」）。
 *
 * 三层职责分得清：
 *  · 上游（OrenFang/orencut，MIT）= 33 个可编辑的静音 Remotion 动效组件 + Studio 界面；
 *  · 主进程（features/orencut/ipc.ts）= 下载 zip / 解压 / 卸载，协议 `orencut://` 指向安装目录；
 *  · 本页 = 只做状态与入口（下载 / 重装 / 卸载 / 打开 Studio），Studio 本体用 iframe 铺满。
 * ⛔ 不自己画组件墙、不镜像上游资源 —— 那样会与上游更新脱节。
 */
import { useCallback, useEffect, useState } from "react";

type Status = { installed: boolean; installedAt: string; files: number; error: string };

const STUDIO_URL = "orencut://app/studio.html";
/* ⛔ 11-28 用户实测「这没有返回按键」：上游 studio.html 里没有回组件库的入口（它是独立页），
   所以在**我们的**顶栏补一个视图切换，⛔ 不改上游文件（改了下次重新下载就没了）。 */
const LIBRARY_URL = "orencut://app/index.html";

/** 右栏「动效」页：状态条（下载/重装/卸载）+ Studio iframe；未装时给引导与体积说明。
 *  targetId 来自模型调 orencut(action=open) 的推送（主进程 orencut:open → 本页 iframe 带 ?id=）。 */
export function OrenCutPage({ targetId = "" }: { targetId?: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState("");
  const [view, setView] = useState<"library" | "studio">("studio");
  /* 工具推过来的组件 id ⇒ 强制回 studio 视图（opened 之后才看得到具体组件）。 */
  useEffect(() => { if (targetId) setView("studio"); }, [targetId]);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    window.codex.orencutStatus?.()
      .then((next: Status) => { setStatus(next ?? null); setError(""); })
      .catch((e: unknown) => setError(String((e as { message?: unknown } | null)?.message ?? e)));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const install = async () => {
    setBusy("正在下载 OrenCut（约 57 MB，首次会慢一点）…");
    setError("");
    try {
      const next = await window.codex.orencutInstall?.();
      if (next) setStatus(next);
      if (next && !next.installed) setError(next.error || "下载完成但安装校验没通过");
    } catch (e) {
      setError(String((e as { message?: unknown } | null)?.message ?? e));
    } finally {
      setBusy("");
    }
  };

  const remove = async () => {
    setBusy("正在删除…");
    try {
      const next = await window.codex.orencutRemove?.();
      if (next) setStatus(next);
    } catch (e) {
      setError(String((e as { message?: unknown } | null)?.message ?? e));
    } finally {
      setBusy("");
    }
  };

  const installed = Boolean(status?.installed);
  const summary = busy || (installed
    ? `已安装 · ${status?.files ?? 0} 个文件${status?.installedAt ? ` · ${status.installedAt.slice(0, 10)}` : ""}`
    : "未安装 · 需要先下载（MIT，OrenFang/orencut）");

  return (
    <div className="orencut-page">
      <div className="orencut-bar">
        <span className={`orencut-state${error ? " is-error" : ""}`} title={error || summary}>
          <strong>OrenCut</strong> · {error || summary}
        </span>
        {installed ? (
          <>
            <div className="orencut-switch" role="group" aria-label="视图">
              <button type="button" className={view === "library" ? "is-active" : ""} onClick={() => setView("library")}>组件库</button>
              <button type="button" className={view === "studio" ? "is-active" : ""} onClick={() => setView("studio")}>Studio</button>
            </div>
            <button type="button" className="secondary-setting" disabled={Boolean(busy)} onClick={() => void install()}>重新下载</button>
            <button type="button" className="secondary-setting" disabled={Boolean(busy)} onClick={() => void remove()}>卸载</button>
          </>
        ) : (
          <button type="button" className="primary-setting" disabled={Boolean(busy)} onClick={() => void install()}>
            {busy ? "下载中…" : "下载并安装"}
          </button>
        )}
      </div>
      {installed ? (
        <iframe
          className="orencut-frame"
          src={view === "library"
            ? LIBRARY_URL
            : (targetId ? STUDIO_URL + "?id=" + encodeURIComponent(targetId) : STUDIO_URL)}
          key={view + (targetId || "")}
          title="OrenCut Studio"
        />
      ) : (
        <div className="orencut-empty">
          <strong>33 个可编辑的静音动效组件</strong>
          <p>点上面的「下载并安装」把 OrenCut Studio 取到本机（纯静态站，约 57 MB）。装好后这里就是它的工作台：按编号挑组件、改标题、导出 MP4。</p>
          <p className="orencut-meta">上游：github.com/OrenFang/orencut · MIT · 下载后离线可用</p>
        </div>
      )}
    </div>
  );
}
