/**
 * 云端资源「联动同步」桥（10-22）—— 服务器云管理改了权益/凭据，本机自动跟上。
 *
 * 为什么放渲染层：KB / 记忆的同步入口在各自的域里，主进程的 10 分钟轮询只做模型；
 * 渲染层已经有全部 `cloud-*` 通道，用一个返回 null 的桥组件做**低频刷新**，
 * 比把三个域的核心函数抽到基座再拼一个调度器改动面小得多（域↔域仍不深链）。
 *
 * ⛔ 只刷新**已经接通**的资源：
 *   · 知识库：连接器 enabled 才刷新（用户手动切回本地时 connector 会被停用）；
 *   · 记忆：用户后端仍是 cloud 才刷新 —— ⛔ 不把用户手动切走的记忆又悄悄切回云端。
 * ⛔ 静默：轮询失败不弹错、不挡操作；真需要用户知道的失败由云账号页的状态与手动按钮呈现。
 */
import { useEffect } from "react";

type CloudBridgeApi = {
  cloudAuthStatus?: () => Promise<{ loggedIn: boolean }>;
  cloudKbStatus?: () => Promise<{ enabled: boolean } | null>;
  cloudKbSync?: () => Promise<unknown>;
  cloudMemoryStatus?: () => Promise<{ activation?: { applied?: boolean } } | null>;
  cloudMemorySync?: () => Promise<unknown>;
  readMemoryBackend?: () => Promise<{ backend?: string; effective?: string }>;
};

const REFRESH_MS = 10 * 60_000;

export function CloudAccountSyncBridge() {
  useEffect(() => {
    const api = window.codex as unknown as CloudBridgeApi;
    let disposed = false;
    let lastRun = 0;

    const tick = async () => {
      if (disposed || !api.cloudAuthStatus) return;
      const status = await api.cloudAuthStatus().catch(() => null);
      if (!status?.loggedIn) return;
      const [kb, mem, backend] = await Promise.all([
        api.cloudKbStatus?.().catch(() => null) ?? Promise.resolve(null),
        api.cloudMemoryStatus?.().catch(() => null) ?? Promise.resolve(null),
        api.readMemoryBackend?.().catch(() => null) ?? Promise.resolve(null),
      ]);
      if (kb?.enabled) await api.cloudKbSync?.().catch(() => undefined);
      const memoryChosen = backend?.backend === "cloud" || backend?.effective === "cloud";
      if (mem?.activation?.applied && memoryChosen) await api.cloudMemorySync?.().catch(() => undefined);
      lastRun = Date.now();
    };

    void tick();
    const timer = window.setInterval(() => { void tick(); }, REFRESH_MS);
    /* 切回应用时补一次（≥60s 节流）：窗口在后台挂了很久，没必要等下一个整 10 分钟。 */
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRun > 60_000) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
