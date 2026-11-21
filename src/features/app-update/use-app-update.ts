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

const INITIAL: UpdateSnapshot = { phase: "idle", currentVersion: "" };

/** 订阅更新状态并提供三个动作（检查 / 下载 / 安装）。 */
export function useAppUpdate() {
  const [state, setState] = useState<UpdateSnapshot>(INITIAL);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const off = window.codex.updateOnState?.((next: unknown) => {
      setState((prev) => ({ ...prev, ...(next as UpdateSnapshot) }));
    });
    return () => { off?.(); };
  }, []);

  /** 查最新版本（只读，不下载）。 */
  const check = useCallback(async () => {
    setBusy(true);
    try {
      const r = (await window.codex.updateCheck?.()) as UpdateReply | undefined;
      if (r?.state) setState((prev) => ({ ...prev, ...r.state }));
      return r;
    } finally {
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

  return { state, busy, check, download, install };
}
