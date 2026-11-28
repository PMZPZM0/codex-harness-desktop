/**
 * OrenCut 卡片（11-28，嵌在「设置 → 开发工具」）。
 *
 * 用户原话：「做成按需下载，跟开发工具里面的飞书 CLI 界面一样」—— 飞书 CLI 那张卡在开发工具页里，
 * 所以这里也必须有一张，否则"开发工具界面里看不到入口"（用户实测反馈）。
 * ⛔ 三行用 `runtime-row` 结构与开发工具列表同款（图标 / 标题+说明 / 右侧动作）——
 *   自造一套类名又没有对应 CSS，出来就是原生排版（飞书 CLI 卡片 10-29 踩过）。
 * ⛔ 状态以主进程 orencut:status 为准（它真去数安装目录里的文件），不在这里猜。
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Download, Trash2 } from "lucide-react";
import { Spinner } from "../../components/CardShell";

type Status = { installed: boolean; installedAt: string; files: number; error: string };

/** 开发工具页里的 OrenCut 卡片：安装状态 + 下载 / 重新下载 / 卸载（状态以主进程 orencut:status 为准）。 */
export function OrenCutCard({ setNotice }: { setNotice?: (text: string) => void }) {
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
    setBusy("下载中（约 57 MB）…");
    try {
      const next = await window.codex.orencutInstall?.();
      if (next) setStatus(next);
      if (next?.installed) setNotice?.(`OrenCut 已安装（${next.files} 个文件）。右侧栏「动效」页可直接用。`);
      else if (next?.error) setError(next.error);
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
      setNotice?.("OrenCut 已卸载（右侧栏「动效」页会显示未安装）。");
    } catch (e) {
      setError(String((e as { message?: unknown } | null)?.message ?? e));
    } finally {
      setBusy("");
    }
  };

  const installed = Boolean(status?.installed);
  return (
    <div className="settings-card orencut-card">
      <div className="settings-card-head">
        <strong>OrenCut 动效组件库</strong>
        <span className="settings-hint">
          33 个可编辑的静音 Remotion 动效组件（MIT，github.com/OrenFang/orencut）。下载后离线可用，
          在右侧栏「动效」页预览与导出 MP4。
        </span>
      </div>
      <div className={`runtime-row ${installed ? "installed" : "missing"} ${busy ? "busy" : ""}`}>
        <span className="runtime-icon">{busy ? <Spinner /> : installed ? <Check size={15} /> : <Download size={15} />}</span>
        <span className="runtime-copy">
          <strong>组件库本体</strong>
          <span>
            {busy || (installed
              ? `已安装 · ${status?.files ?? 0} 个文件${status?.installedAt ? ` · ${status.installedAt.slice(0, 10)}` : ""}`
              : error || "未安装 · 纯静态站，不需要 Docker / Bun")}
          </span>
        </span>
        {installed ? (
          <button type="button" className="secondary-setting" disabled={Boolean(busy)} onClick={() => void remove()}>
            <Trash2 size={13} />卸载
          </button>
        ) : (
          <button type="button" className="primary-setting" disabled={Boolean(busy)} onClick={() => void install()}>
            <Download size={13} />{busy ? "下载中…" : "下载安装"}
          </button>
        )}
      </div>
      {installed ? (
        <div className="runtime-row installed">
          <span className="runtime-icon"><Check size={15} /></span>
          <span className="runtime-copy">
            <strong>下载范围</strong>
            <span>整仓 zip（含 Studio、33 个组件、预览 mp4 与 SKILL.md），落在 userData/orencut。</span>
          </span>
          <button type="button" className="secondary-setting" disabled={Boolean(busy)} onClick={() => void install()}>
            重新下载
          </button>
        </div>
      ) : null}
      {error && installed ? <p className="settings-hint is-error">{error}</p> : null}
    </div>
  );
}
