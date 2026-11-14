/**
 * RuntimeUpdateRow（11-14）—— 开发工具里「按需下载型」卡片的统一更新行。
 *
 * 用户：「这些卡片界面里面好像都没有配套更新功能」⇒ 更新入口放进卡片本身，不再只丢一句
 * 「去控制台 → 组件更新」。检查/升级都走既有 `runtime:update-check` / `runtime:update`
 * （单一真相源：npm 包清单 UPDATEABLE_TOOLS + GitHub 直下清单 GITHUB_UPDATEABLE）。
 * ⛔ 不另造下载器/版本比较：主进程已经做了镜像序、pin、平台过滤与装后复核。
 * ⛔ 打开卡片自动查一次（只读），失败只在这一行显示，不弹窗、不影响其它行。
 */
import { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { Spinner } from "../../components/CardShell";

type UpdateRow = { id: string; name: string; pkg: string; current: string; latest: string; registry: string; hasUpdate: boolean; error: string };

export type RuntimeUpdateRowProps = {
  /** 工具 id（与 runtime:update-check / runtime:update 一致） */
  id: string;
  installed: boolean;
  /** 这一行的说明；例如「更新会重新下载并构建，课程数据保留」 */
  hint: string;
  /** 卡片打开时自动检查一次（默认 true） */
  autoCheck?: boolean;
  runtimeStage?: Record<string, string>;
  runtimePercent?: Record<string, number> | null;
  runtimeSpeed?: Record<string, string> | null;
  runtimeProgress?: Record<string, string> | null;
  cancelDevRuntime?: (id: string) => unknown;
  /** 更新结束后通知卡片刷新自己的状态（如安装版本号） */
  onUpdated?: () => void;
  /** 更新过程能否中途取消（默认 true）。pip 型（Laya 等）是一次 `pip install` 子进程，宿主没有
   *  中断钩子 ⇒ 传 false，界面显示「更新中（不可中断）」而不是一个点了没反应的取消键。 */
  cancellable?: boolean;
};

/** 一行「更新」：检查最新版 / 立即更新 / 更新中进度与取消。 */
export function RuntimeUpdateRow({
  id,
  installed,
  hint,
  autoCheck = true,
  runtimeStage,
  runtimePercent,
  runtimeSpeed,
  runtimeProgress,
  cancelDevRuntime,
  onUpdated,
  cancellable = true,
}: RuntimeUpdateRowProps) {
  const [row, setRow] = useState<UpdateRow | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");

  const check = useCallback(async () => {
    if (!installed) return;
    setChecking(true);
    setError("");
    try {
      const result = (await window.codex.checkRuntimeUpdate(id)) as UpdateRow | UpdateRow[];
      const single = (Array.isArray(result) ? result[0] : result) as UpdateRow | undefined;
      if (!single) throw new Error("没有返回版本信息");
      setRow(single);
      if (single.error) setError(single.error);
    } catch (err) {
      setError(String((err as { message?: unknown })?.message ?? err));
    } finally {
      setChecking(false);
    }
  }, [id, installed]);

  useEffect(() => {
    setRow(null);
    setError("");
    if (installed && autoCheck) {
      const timer = setTimeout(() => { void check(); }, 400);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [installed, autoCheck, check]);

  useEffect(() => {
    const off = window.codex.onRuntimeProgress((payload: { id?: string; done?: boolean }) => {
      if (payload?.id !== id || !payload.done) return;
      setUpdating(false);
      void check();
      onUpdated?.();
    });
    return off;
  }, [id, check, onUpdated]);

  const update = async () => {
    setUpdating(true);
    setError("");
    try {
      const result = await window.codex.updateRuntime(id);
      /* ⛔ 取消 / joined 不一定会再发 done 事件：不能只靠 onRuntimeProgress 收尾，
         否则「取消」后这一行会永远停在「正在更新」。 */
      if ((result as { cancelled?: boolean })?.cancelled) setError("已取消更新");
    } catch (err) {
      setError(String((err as { message?: unknown })?.message ?? err));
    } finally {
      setUpdating(false);
      void check();
      onUpdated?.();
    }
  };

  const percent = Math.round(Number(runtimePercent?.[id] ?? 0));
  const stage = runtimeStage?.[id] ?? "";
  const speed = runtimeSpeed?.[id] ?? "";
  const latestLine = runtimeProgress?.[id] ?? "";
  const busy = checking || updating;
  const upToDate = Boolean(row && !row.hasUpdate && row.latest && !error);

  return (
    <div className={`runtime-row ${installed ? "installed" : "missing"} ${busy ? "busy" : ""}`}>
      <span className="runtime-icon">
        {busy ? <Spinner /> : row?.hasUpdate ? <RefreshCw size={15} /> : <Check size={15} />}
      </span>
      <span className="runtime-copy">
        <strong>更新</strong>
        <small>
          {!installed
            ? "安装后可检查更新"
            : updating
              ? cancellable ? "正在更新（不要关闭应用；需要时点右侧取消）" : "正在更新（不要关闭应用；这一步不能中断，完成后自动刷新）"
              : checking
                ? "正在检查最新版本…"
                : error
                  ? `检查更新失败：${error.slice(0, 160)}`
                  : row?.hasUpdate
                    ? `有新版本 ${row.current || "未知"} → ${row.latest}`
                    : upToDate
                      ? `已是最新${row?.current ? `（${row.current}）` : ""}`
                      : hint}
        </small>
        {updating ? (
          <span className="runtime-install-state devtools-progress-row">
            <span className="runtime-progress-bar" role="progressbar" aria-label="更新进度" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ width: `${percent}%` }} />
            </span>
            <em className="runtime-progress">
              {stage || "正在准备更新…"}
              {percent ? ` · ${percent}%` : ""}
              {speed ? ` · ${speed}` : ""}
              {latestLine ? ` · ${latestLine}` : ""}
            </em>
          </span>
        ) : row?.hasUpdate && hint ? (
          <em className="runtime-hint">{hint}</em>
        ) : null}
      </span>
      <div className="runtime-actions">
        {!installed ? (
          <span className="runtime-badge">安装后可更新</span>
        ) : updating ? (
          cancellable ? (
            <button type="button" className="secondary-setting runtime-cancel" onClick={() => void cancelDevRuntime?.(id)}>取消</button>
          ) : (
            <span className="runtime-badge">更新中</span>
          )
        ) : row?.hasUpdate ? (
          <button type="button" className="primary-setting runtime-install" disabled={busy} onClick={() => void update()}>
            <RefreshCw size={13} />更新到 {row.latest}
          </button>
        ) : (
          <button type="button" className="secondary-setting runtime-install" disabled={busy} onClick={() => void check()}>
            {checking ? <><Spinner /> 检查中</> : <><RefreshCw size={13} />检查更新</>}
          </button>
        )}
      </div>
    </div>
  );
}
