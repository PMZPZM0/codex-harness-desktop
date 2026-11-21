/**
 * 更新状态 hook（11-21 重写后前端唯一的数据来源）。
 *
 * ⛔ 只有一个来源：主进程推来的 `update:state` 快照（idle / available / downloading /
 *   ready / installing / failed）。⛔ 不许在渲染层再派生"是否已下载"之类的第二套状态 ——
 *   历史上就是因为这份派生状态没人置位，下载完徽标永远停在「更新」，点一次重下 669MB。
 */
import { useCallback, useEffect, useState } from "react";

/** 与主进程 `update-service.ts` 的 `UpdatePhase` 一一对应。 */
export type UpdatePhase = "idle" | "available" | "downloading" | "ready" | "installing" | "failed";

/** 主进程推来的状态快照。 */
export type UpdateSnapshot = {
  phase: UpdatePhase;
  currentVersion: string;
  version?: string;
  size?: number;
  percent?: number;
  receivedBytes?: number;
  totalBytes?: number;
  error?: string;
};

/** 主进程三个调用通道的回包形状（只声明前端用得到的字段）。 */
type UpdateReply = { ok: boolean; state?: UpdateSnapshot; error?: string };

/** 一次「检查更新」的结论（11-21 用户令：检查更新要有反馈）。
 *  ⛔ 不能靠 phase 反推：已是最新时 phase 仍是 idle，界面否则完全看不出刚检查过。 */
export type UpdateCheckResult = {
  ok: boolean;
  /** true = 已是最新（没有更新）；false 且无 error = 发现新版本 */
  latest: boolean;
  version?: string;
  current?: string;
  error?: string;
};

const INITIAL: UpdateSnapshot = { phase: "idle", currentVersion: "" };

/** 订阅更新状态并提供三个动作（检查 / 下载 / 安装）。 */
export function useAppUpdate() {
  const [state, setState] = useState<UpdateSnapshot>(INITIAL);
  const [busy, setBusy] = useState(false);
  /** 正在检查（按钮显示「检查中…」） */
  const [checking, setChecking] = useState(false);
  /** 上一次检查的结论（给界面一行可读反馈） */
  const [lastCheck, setLastCheck] = useState<UpdateCheckResult | null>(null);

  useEffect(() => {
    const off = window.codex.updateOnState?.((next: unknown) => {
      setState((prev) => ({ ...prev, ...(next as UpdateSnapshot) }));
    });
    return () => { off?.(); };
  }, []);

  /** 查最新版本（只读，不下载）。结论单独记一份给界面反馈（用户令：检查更新要能看到结果）。 */
  const check = useCallback(async () => {
    setBusy(true);
    setChecking(true);
    try {
      const r = (await window.codex.updateCheck?.()) as UpdateReply | undefined;
      if (r?.state) setState((prev) => ({ ...prev, ...r.state }));
      const nextState = r?.state;
      /* 三种结论：失败（网络/镜像）→ 有新版（带回 version）→ 已是最新（phase 回 idle）。 */
      const failed = !r?.ok || (nextState?.phase === "failed" && !nextState?.version);
      setLastCheck({
        ok: !failed,
        latest: !failed && !nextState?.version,
        version: nextState?.version,
        current: nextState?.currentVersion,
        error: failed ? (r?.error ?? nextState?.error) : undefined,
      });
      return r;
    } catch (error) {
      setLastCheck({ ok: false, latest: false, error: (error as Error)?.message ?? String(error) });
      throw error;
    } finally {
      setChecking(false);
      setBusy(false);
    }
  }, []);

  /** 下载安装包；已下好且校验通过时主进程直接返回 ready（不下字节）。 */
  const download = useCallback(async () => {
    const r = (await window.codex.updateDownload?.()) as UpdateReply | undefined;
    if (r?.state) setState((prev) => ({ ...prev, ...r.state }));
    return r;
  }, []);

  /** 退出并安装（成功后应用会自行退出，这里不需要收尾）。 */
  const install = useCallback(async () => {
    setBusy(true);
    try {
      return await window.codex.updateInstall?.();
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, busy, checking, lastCheck, check, download, install };
}
