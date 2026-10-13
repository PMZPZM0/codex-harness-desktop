/**
 * 云端管理（10-13 二期）—— 账户菜单「云端管理」入口的**应用内**面板。
 *
 * 职责：把"这台机器与云端的关系"说清楚 + 给出动作：
 *   · 连接状态：闸是否开 / 绑定的账号 / 服务器可达性 / 本机配对码（未绑定时）
 *   · 设备（座位）列表：名称 + token 指纹 + 吊销（吊销后那台机器要重新认领）
 *   · 更新：cloud:update/check（探测云端 version.json）—— download/apply 尚未接线，**如实显示**
 *   · 断开连接：清空绑定与设备 token ⇒ 回到配对卡
 *
 * 数据源（两路，都有就都用，缺了就防御性降级）：
 *   · IPC（并行线的 cloud-reserve-ipc 域）：cloud:device/list / cloud:device/unbind / cloud:update/check
 *   · HTTP（headless 的 /api/cloud-state、/api/cloud-disconnect）：闸/账号/可达性/断开
 *
 * ⛔⛔ 必须 portal 到 `document.body`（同 CloseConfirmDialog：transform 祖先会让 fixed 退化）。
 * ⛔ **自包含**：状态与请求都在本组件内；挂载处一行。桌面版（无 __CHC_ACCOUNT_GATE__）
 *    账户菜单里**不会出现**这个入口 ⇒ 本组件也不会被挂载。
 */
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Cloud, RefreshCw, Unplug, X } from "lucide-react";

type CloudState = {
  gated: boolean;
  paired: boolean;
  machinePaired: boolean;
  machineAccounts: string[];
  account: string | null;
  seats: { owner: string; users: Record<string, string> };
  hasDeviceToken: boolean;
  serverReachable: boolean;
  webEntry: string;
  plan: string;
  cloudFeatures: { sessionIndex: boolean; cloudExec: boolean };
};
type DeviceRow = { name: string; createdAt: number; tokenFingerprint: string };
type UpdateInfo = { available: boolean; current?: string; latest?: string; url?: string; notes?: string; reason?: string };
/* ⛔ 云通道（cloud:device/*、cloud:update/check）只存在于**云助手仓**的 manifest ⇒
   桌面仓的生成类型里没有它们。组件只在云助手形态挂载，但 TS 对三仓统一编译
   ⇒ 这里走**防御性可选类型**，运行时有就有、没有就不调（绝不在桌面仓硬引）。 */
type CloudOnlyApi = {
  cloudDeviceList?: () => Promise<{ devices: DeviceRow[] }>;
  cloudDeviceUnbind?: (name: string) => Promise<{ ok: boolean; removed: string; remaining: number }>;
  cloudUpdateCheck?: () => Promise<UpdateInfo>;
};
const cloudApi = (): CloudOnlyApi => window.codex as unknown as CloudOnlyApi;

async function fetchCloudState(): Promise<CloudState | null> {
  try {
    const headers: Record<string, string> = {};
    const token = localStorage.getItem("chc-token");
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch("/api/cloud-state", { headers, cache: "no-store" });
    return r.ok ? ((await r.json()) as CloudState) : null;
  } catch {
    return null;   // 桌面版没有这个端点（页面只在云助手形态出现）——防御
  }
}

export function CloudManageDialog({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<CloudState | null>(null);
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [note, setNote] = useState("");

  const refresh = useCallback(() => {
    void fetchCloudState().then((s) => setState(s));
    void cloudApi().cloudDeviceList?.().then((r) => setDevices(r.devices)).catch(() => setDevices(null));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runUpdateCheck = () => {
    setChecking(true);
    void cloudApi().cloudUpdateCheck?.()
      .then((r) => setUpdate(r))
      .catch(() => setUpdate({ available: false, reason: "检查失败" }))
      .finally(() => setChecking(false));
  };

  const unbind = (name: string) => {
    void cloudApi().cloudDeviceUnbind?.(name).then(() => refresh()).catch(() => undefined);
  };

  const disconnect = () => {
    setDisconnecting(true);
    void fetch("/api/cloud-disconnect", { method: "POST" })
      .then(() => {
        try { localStorage.removeItem("chc-token"); } catch { /* 忽略 */ }
        /* ⛔ 必须**整页重载**：界面内存里还揣着旧令牌/旧状态，只关弹窗会让各处加载
           陆续 401（收藏读取失败…）甚至反复自刷卡在启动页（用户实测）。
           重载 = 走全新未配对启动的同一条路径 ⇒ 配对卡正常出现。 */
        setTimeout(() => location.reload(), 300);
      })
      .catch(() => setDisconnecting(false));
  };

  if (typeof document === "undefined") return null;

  const paired = state?.machinePaired === true;
  const accounts = state?.machineAccounts ?? [];

  return createPortal(
    <div className="cloud-manage-backdrop" role="dialog" aria-modal="true" aria-label="云端管理">
      <div className="cloud-manage-card">
        <div className="cloud-manage-head">
          <span className="cloud-manage-title"><Cloud size={15} /> 云端管理</span>
          <button type="button" className="cloud-manage-x" onClick={onClose} aria-label="关闭"><X size={15} /></button>
        </div>

        <section className="cloud-manage-sec">
          <div className="cloud-manage-label">连接状态</div>
          {!state ? (
            <div className="cloud-manage-muted">读取中…</div>
          ) : (
            <div className="cloud-manage-kv">
              <div><span>配对闸</span><b>{state.gated ? "开（需网页账号）" : "关（独立模式）"}</b></div>
              <div><span>绑定账号</span><b>{accounts.length ? accounts.join("、") : "未绑定"}</b></div>
              <div><span>服务器</span><b>{state.serverReachable ? "可达" : "不可达"}</b></div>
              <div><span>设备凭据</span><b>{state.hasDeviceToken ? "已就绪" : "无"}</b></div>
              {!paired && state.gated ? (
                <div>
                  <span>本机配对码</span>
                  <b className="cloud-manage-code">
                    {(window as unknown as { __CHC_PAIR_CODE__?: string }).__CHC_PAIR_CODE__ || "刷新本页获取（5 分钟有效）"}
                  </b>
                </div>
              ) : null}
            </div>
          )}
        </section>

        <section className="cloud-manage-sec">
          <div className="cloud-manage-label">设备 / 座位</div>
          {devices === null ? (
            <div className="cloud-manage-muted">读取中…</div>
          ) : devices.length === 0 ? (
            <div className="cloud-manage-muted">暂无（配对后出现在这里）</div>
          ) : (
            <div className="cloud-manage-devices">
              {devices.map((d) => (
                <div key={d.name} className="cloud-manage-device">
                  <span className="nm">{d.name}</span>
                  <span className="fp">{d.tokenFingerprint}…</span>
                  <button type="button" onClick={() => unbind(d.name)}>解绑</button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="cloud-manage-sec">
          <div className="cloud-manage-label">应用更新</div>
          <div className="cloud-manage-actions">
            <button type="button" className="cloud-manage-btn" onClick={runUpdateCheck} disabled={checking}>
              <RefreshCw size={13} className={checking ? "spin" : ""} />
              {checking ? "检查中…" : "检查云端更新"}
            </button>
          </div>
          {update ? (
            update.available ? (
              <div className="cloud-manage-note ok">
                发现新版本 v{update.latest}（当前 v{update.current}）。{update.notes}
                <br />下载与生效通道尚未接线（预留位），请用「检查更新」页完成安装。
              </div>
            ) : (
              <div className="cloud-manage-note">{update.reason ? `未探测到新版本：${update.reason}` : "已是最新版本"}</div>
            )
          ) : null}
        </section>

        <section className="cloud-manage-sec">
          <div className="cloud-manage-label">危险区</div>
          <button type="button" className="cloud-manage-btn danger" onClick={disconnect} disabled={disconnecting || !paired}>
            <Unplug size={13} />
            {disconnecting ? "正在断开…" : "断开云端连接（清空绑定，回到配对）"}
          </button>
          <div className="cloud-manage-muted">断开后本机仍可离线使用独立功能，但云端管理与自动更新需要重新认领。</div>
        </section>

        {note ? <div className="cloud-manage-note">{note}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
