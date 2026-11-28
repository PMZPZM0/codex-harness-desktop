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

/** 右栏「动效」页：状态条（下载/重装/卸载）+ Studio iframe；未装时给引导与体积说明。 */
export function OrenCutPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState("");
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
        <iframe className="orencut-frame" src={STUDIO_URL} title="OrenCut Studio" />
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
