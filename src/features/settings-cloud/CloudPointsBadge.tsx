/**
 * 输入框里的**云端积分徽标**（10-16 用户令）。
 *
 * 位置与形态对齐既有两枚（`RelayBalanceBadge` / `OpenaiBalanceBadge`）：都挂在
 * `.composer-right > .model-controls` 里、**在上下文环 `ContextUsageBadge` 左边**，
 * 都用 `.context-ring` 那一套图标外观。
 *
 * 用户定稿的交互：**平时只占一个图标位，鼠标移上去才展示积分余额**（不占正文宽度）。
 * ⛔ 所以这里用 CSS 悬停浮层（`:hover` / `:focus-within`），不用 click 弹窗 ——
 *    click 会与旁边别的图标抢交互，而积分是"扫一眼"的信息，不值得一次点击。
 * ⛔ 未登录 ⇒ 返回 null（**不占位**）：没云账号的人不该看到一个空格子。
 * ⛔ 读的是 `cloud-auth:points`（账户级），与设置页那张积分卡**同一个数据源**，不各取一份。
 */
import { useCallback, useEffect, useState } from "react";
import { Coins } from "lucide-react";
import { currentOffPeakWindow, useOffPeak, warmCloudCreditCatalog } from "../../lib/cloud-credit-store";
import type { OffPeakConfig, TurnCreditEstimate } from "../../lib/credit-estimate.mjs";

type PointTxn = { at?: number; delta?: number; kind?: string; note?: string };
type PointsReply = { ok: boolean; balance: number; signupGrant: number; txns: PointTxn[]; error?: string };

type PointsApi = { cloudAuthPoints?: () => Promise<PointsReply> };

/** 与「中转站余额徽标」同频：5 分钟。积分变动慢，再密只是白打网络。 */
const POLL_MS = 5 * 60_000;

const KIND_LABEL: Record<string, string> = {
  signup: "注册赠送",
  grant: "发放",
  consume: "调用消耗",
  entitlement: "开通权益",
  refund: "退还",
  admin: "管理员调整",
};

function fmt(value: number): string {
  const n = Number(value || 0);
  return Math.abs(n) >= 1000 ? n.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : String(Math.round(n * 100) / 100);
}

/** 闲时那一行的文案（10-18 用户令：管理员改了时段/系数，用户得能看见"现在算不算闲时"）。
 *  ⛔ 目录没拿到（未登录 / 网络失败）⇒ 返回 null ⇒ 整行不出现（不猜"未启用"，那是在说谎）。 */
function offPeakText(offPeak: OffPeakConfig | null, win: TurnCreditEstimate["window"]) {
  if (!offPeak || offPeak.enabled !== true || !win) return null;
  return { text: `闲时 ×${win.rate}`, hot: true };
}

/** @param active 云端模型是否为**当前供应商**。⛔ 10-17 用户令：停用/切走后必须隐藏，
 *  不再常驻（此前只判「已登录」⇒ 模型停用了徽标还在）。非活跃时**也不轮询**（省一次网络）。 */
export function CloudPointsBadge({ active }: { active: boolean }) {
  const [points, setPoints] = useState<PointsReply | null>(null);
  const offPeak = useOffPeak();

  const refresh = useCallback(() => {
    const api = window.codex as unknown as PointsApi;
    if (!api.cloudAuthPoints) return;
    api.cloudAuthPoints()
      .then((r) => setPoints(r.ok ? r : null)) // ⛔ 未登录/失败 ⇒ 隐藏，不显示"0 积分"骗人
      .catch(() => setPoints(null));
  }, []);

  useEffect(() => {
    if (!active) { setPoints(null); return; }
    refresh();
    /* 闲时快照走**同一处目录缓存**（TTL 5 分钟，与这里的轮询同频 ⇒ 不多打网络；
       目录已在 TTL 内时是纯本地读）。⛔ 不拉一次的话，徽标会一直停在"未启用"直到用户发出第一回合。 */
    warmCloudCreditCatalog();
    const timer = window.setInterval(() => { refresh(); warmCloudCreditCatalog(); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [active, refresh]);

  if (!active || !points) return null;
  const last = points.txns?.[0];
  const off = offPeakText(offPeak, currentOffPeakWindow(offPeak));
  return (
    <span className="cloud-points-badge" tabIndex={0} aria-label={`云端积分 ${fmt(points.balance)}`}>
      <Coins size={13} />
      <span className="cloud-points-tip" role="tooltip">
        <b>云端积分 {fmt(points.balance)}</b>
        {last ? (
          <small>
            {KIND_LABEL[last.kind || ""] || last.kind || "最近变动"} {(last.delta ?? 0) >= 0 ? "+" : ""}
            {fmt(last.delta ?? 0)}
          </small>
        ) : (
          <small>{points.signupGrant ? `注册赠送 ${fmt(points.signupGrant)}` : "暂无变动"}</small>
        )}
        {off?.hot ? <small className="cloud-points-offpeak">{off.text}</small> : null}
      </span>
    </span>
  );
}
