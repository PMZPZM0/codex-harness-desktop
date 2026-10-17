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

export function CloudPointsBadge() {
  const [points, setPoints] = useState<PointsReply | null>(null);

  const refresh = useCallback(() => {
    const api = window.codex as unknown as PointsApi;
    if (!api.cloudAuthPoints) return;
    api.cloudAuthPoints()
      .then((r) => setPoints(r.ok ? r : null)) // ⛔ 未登录/失败 ⇒ 隐藏，不显示"0 积分"骗人
      .catch(() => setPoints(null));
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (!points) return null;
  const last = points.txns?.[0];
  return (
    <span className="cloud-points-badge" tabIndex={0} aria-label={`云端积分 ${fmt(points.balance)}`}>
      <Coins size={13} />
      <span className="cloud-points-tip" role="tooltip">
        <b>云端积分 {fmt(points.balance)}</b>
        {last ? (
          <small>
            {KIND_LABEL[last.kind || ""] || last.kind || "最近变动"} {(last.delta ?? 0) >= 0 ? "+" : ""}
            {fmt(last.delta ?? 0)}
            {last.note ? ` · ${last.note}` : ""}
          </small>
        ) : (
          <small>{points.signupGrant ? `注册赠送 ${fmt(points.signupGrant)} 积分` : "暂无变动记录"}</small>
        )}
        <small className="cloud-points-tip-foot">设置 → 云账号 可查看完整明细</small>
      </span>
    </span>
  );
}
