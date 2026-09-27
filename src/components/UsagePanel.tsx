import { useEffect, useMemo, useState } from "react";
import { Activity, Flame, Timer, Trash2, TrendingUp } from "lucide-react";
import { currentStreak, formatDuration, formatTokens, lastDays, totalTokens, type UsageStats } from "../lib/usage-stats";

type Props = {
  stats: UsageStats;
  currentInput: number;
  currentOutput: number;
  contextWindow: number;
  onReset: () => void;
};

const HEATMAP_WEEKS = 20;
const TREND_DAYS = 30;

function dayKeyOf(date: Date) {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** 最近 N 周的活动热力图：按周分列、每列 7 天（周日起） */
function buildHeatmap(stats: UsageStats, weeks: number) {
  const cells: { key: string; total: number; turns: number; future: boolean }[] = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - cursor.getDay() - (weeks - 1) * 7);
  const today = dayKeyOf(new Date());
  for (let i = 0; i < weeks * 7; i += 1) {
    const key = dayKeyOf(cursor);
    const day = stats.days?.[key];
    cells.push({ key, total: (day?.input ?? 0) + (day?.output ?? 0), turns: day?.turns ?? 0, future: key > today });
    cursor.setDate(cursor.getDate() + 1);
  }
  return { cells, max: Math.max(1, ...cells.map((cell) => cell.total)) };
}

function heatLevel(total: number, max: number) {
  if (!total) return 0;
  const ratio = total / max;
  if (ratio > 0.66) return 4;
  if (ratio > 0.4) return 3;
  if (ratio > 0.15) return 2;
  return 1;
}

/** 每日趋势折线：输入 / 输出两条线 */
function TrendChart({ points }: { points: { key: string; input: number; output: number }[] }) {
  const width = 620;
  const height = 150;
  const pad = { top: 10, right: 8, bottom: 18, left: 44 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...points.map((p) => Math.max(p.input, p.output)));
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const path = (pick: (p: { input: number; output: number }) => number) =>
    points.map((point, index) => {
      const x = pad.left + index * stepX;
      const y = pad.top + innerH - (pick(point) / max) * innerH;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ");
  return <svg className="usage-trend" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="每日 Token 趋势">
    {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
      const y = pad.top + innerH * ratio;
      return <g key={ratio}>
        <line x1={pad.left} y1={y} x2={width - pad.right} y2={y} className="usage-grid-line" />
        <text x={pad.left - 6} y={y + 3} className="usage-axis" textAnchor="end">{formatTokens(Math.round(max * (1 - ratio)))}</text>
      </g>;
    })}
    <path d={path((p) => p.input)} className="usage-line input" />
    <path d={path((p) => p.output)} className="usage-line output" />
    <line x1={pad.left} y1={pad.top + innerH} x2={width - pad.right} y2={pad.top + innerH} className="usage-axis-line" />
  </svg>;
}

/** 模型用量环形图：按 token 占比切分 */
function ModelDonut({ models }: { models: Record<string, number> }) {
  const entries = Object.entries(models ?? {}).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  const size = 132;
  const radius = 52;
  const stroke = 18;
  const circumference = 2 * Math.PI * radius;
  if (!total) return <p className="muted usage-empty-note">还没有按模型统计到消耗，完成几个回合后这里会出现占比。</p>;
  let offset = 0;
  return <div className="usage-donut-wrap">
    <svg viewBox={`0 0 ${size} ${size}`} className="usage-donut" role="img" aria-label="模型用量占比">
      <circle cx={size / 2} cy={size / 2} r={radius} className="usage-donut-track" strokeWidth={stroke} />
      {entries.map(([name, value], index) => {
        const length = (value / total) * circumference;
        const transform = `rotate(${(offset / circumference) * 360 - 90} ${size / 2} ${size / 2})`;
        offset += length;
        return <circle key={name} cx={size / 2} cy={size / 2} r={radius} className={`usage-donut-arc arc-${index % 6}`} strokeWidth={stroke} strokeDasharray={`${length} ${circumference - length}`} transform={transform} />;
      })}
      <text x={size / 2} y={size / 2 - 2} className="usage-donut-value" textAnchor="middle">{formatTokens(total)}</text>
      <text x={size / 2} y={size / 2 + 15} className="usage-donut-label" textAnchor="middle">总 Token</text>
    </svg>
    <ul className="usage-legend">
      {entries.slice(0, 6).map(([name, value], index) => <li key={name}>
        <span className={`usage-dot arc-${index % 6}`} />
        <b title={name}>{name}</b>
        <em>{((value / total) * 100).toFixed(1)}%</em>
        <small>{formatTokens(value)}</small>
      </li>)}
    </ul>
  </div>;
}

/** 账号级用量：引擎 `account/usage/read`（09-27 接的是 0.157 协议里的这份 RPC；它在 0.153 就有，
 *  所以不是"新版新增"，只是我们一直没接）。
 *
 *  ⛔ 与上面那套 `stats` 是**两个来源**，界面上必须分清、**不许混算**：
 *    · 上面的 stats = **本机**累计（本地记账，清空/换机即归零）；
 *    · 这里的 summary/buckets = **Codex 服务端**记账（跨设备、权威），只有登录 OpenAI / ChatGPT
 *      账号才拿得到 —— 用第三方 provider（自定义 base_url）时引擎侧没有账号态，请求会失败。
 *  ⛔ 拿不到时**整块不渲染**：不留空占位、不报错打扰（实测本机 auth.json 为空 ⇒ 走的就是这条路）。
 *  数值一律经 num() 归一：协议里是 u64（ts-rs 出 bigint），JSON 过桥后可能是 number 或字符串。 */
function AccountUsageBlock() {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    void window.codex.request("account/usage/read", {})
      .then((result: any) => { if (alive && result?.summary) setData(result); })
      .catch(() => undefined); // 未登录 / 第三方 provider / 网络失败 ⇒ 静默降级
    return () => { alive = false; };
  }, []);
  const summary = data?.summary;
  if (!summary) return null;
  const num = (value: unknown) => {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const buckets: { startDate: string; tokens: unknown }[] = Array.isArray(data.dailyUsageBuckets) ? data.dailyUsageBuckets.slice(-30) : [];
  const bucketMax = Math.max(1, ...buckets.map((bucket) => num(bucket.tokens)));
  return (
    <div className="usage-block">
      <header><h3>账号用量</h3><span>服务端记账（跨设备）· 需登录 OpenAI 账号</span></header>
      <div className="usage-stats-row tight">
        <div className="usage-stat"><span>账号累计 Token</span><strong>{summary.lifetimeTokens == null ? "—" : formatTokens(num(summary.lifetimeTokens))}</strong></div>
        <div className="usage-stat"><span>单日峰值</span><strong>{summary.peakDailyTokens == null ? "—" : formatTokens(num(summary.peakDailyTokens))}</strong></div>
        <div className="usage-stat"><span>连续活跃</span><strong>{summary.currentStreakDays == null ? "—" : `${num(summary.currentStreakDays)} 天`}</strong><small>{summary.longestStreakDays == null ? "" : `最长 ${num(summary.longestStreakDays)} 天`}</small></div>
        <div className="usage-stat"><span>最长单回合</span><strong>{summary.longestRunningTurnSec == null ? "—" : formatDuration(num(summary.longestRunningTurnSec) * 1000)}</strong></div>
      </div>
      {buckets.length > 0 && <div className="usage-heatmap" role="img" aria-label="账号每日用量">
        {buckets.map((bucket) => <i key={bucket.startDate} className={`usage-heat-cell level-${heatLevel(num(bucket.tokens), bucketMax)}`} title={`${bucket.startDate} · ${num(bucket.tokens).toLocaleString()} token`} />)}
      </div>}
      <p className="usage-foot">这块是 Codex 服务端的权威记账（含你在其它设备的消耗）；与上方「本机累计」是两套来源，不合并计算。</p>
    </div>
  );
}

export function UsagePanel({ stats, currentInput, currentOutput, contextWindow, onReset }: Props) {
  const streak = useMemo(() => currentStreak(stats), [stats]);
  const { cells, max } = useMemo(() => buildHeatmap(stats, HEATMAP_WEEKS), [stats]);
  const trend = useMemo(() => lastDays(stats, TREND_DAYS), [stats]);
  const total = totalTokens(stats);
  const peak = stats.peakTokens ?? 0;
  const longest = stats.longestTurnMs ?? 0;
  const usedRatio = contextWindow ? Math.min(1, (currentInput + currentOutput) / contextWindow) : 0;
  const monthTokens = useMemo(() => trend.reduce((sum, day) => sum + day.input + day.output, 0), [trend]);
  const activeDays = useMemo(() => Object.values(stats.days ?? {}).filter((day) => day.turns > 0).length, [stats]);

  return (
    <section className="settings-section stack">
      <div className="settings-copy channel-heading">
        <div><h2>使用统计</h2><p>本机累计消耗（随回合完成自动累加，保存在本机）。只保存聚合数字，不保存任何对话内容。</p></div>
        <div className="settings-heading-actions"><button className="secondary-setting" onClick={onReset}><Trash2 size={13} />清空累计</button></div>
      </div>

      <div className="usage-hero">
        <div className="usage-hero-main">
          <span>累计 Token</span>
          <strong>{total.toLocaleString()}</strong>
          <small>输入 {formatTokens(stats.inputTokens)} · 输出 {formatTokens(stats.outputTokens)}</small>
        </div>
        <div className="usage-hero-side">
          <div className="usage-hero-cell"><Activity size={13} /><span>近 {TREND_DAYS} 天</span><strong>{formatTokens(monthTokens)}</strong></div>
          <div className="usage-hero-cell"><Flame size={13} /><span>活跃天数</span><strong>{activeDays}</strong></div>
          <div className="usage-hero-cell"><TrendingUp size={13} /><span>累计回合</span><strong>{stats.turns.toLocaleString()}</strong></div>
        </div>
      </div>

      <div className="usage-stats-row">
        <div className="usage-stat"><span>峰值 Token</span><strong>{peak ? formatTokens(peak) : "—"}</strong><small>单回合上下文最高占用</small></div>
        <div className="usage-stat"><span>最长聊天时长</span><strong>{formatDuration(longest)}</strong><small>单个回合的最长持续时间</small></div>
        <div className="usage-stat"><span>连续活跃</span><strong>{streak} 天</strong><small>{streak ? "保持住" : "今天跑一个任务就能开始"}</small></div>
        <div className="usage-stat"><span>上下文占用</span><strong>{contextWindow ? `${Math.round(usedRatio * 100)}%` : "—"}</strong><small>{contextWindow ? `${formatTokens(currentInput + currentOutput)} / ${formatTokens(contextWindow)}` : "当前任务未提供窗口"}</small></div>
      </div>

      {contextWindow > 0 && <div className="usage-context-bar"><span style={{ width: `${Math.max(2, usedRatio * 100)}%` }} /></div>}

      <div className="usage-block">
        <header><h3>Token 活动</h3><span>最近 {HEATMAP_WEEKS} 周 · 每天输入 + 输出总量</span></header>
        <div className="usage-heatmap" role="img" aria-label="Token 活动热力图">
          {cells.map((cell) => <i
            key={cell.key}
            className={`usage-heat-cell level-${cell.future ? "future" : heatLevel(cell.total, max)}`}
            title={cell.future ? "" : `${cell.key} · ${cell.total.toLocaleString()} token · ${cell.turns} 回合`}
          />)}
        </div>
        <div className="usage-heatmap-legend">
          <span>少</span>
          {[0, 1, 2, 3, 4].map((level) => <i key={level} className={`usage-heat-cell level-${level}`} />)}
          <span>多</span>
        </div>
      </div>

      <div className="usage-block">
        <header><h3>每日趋势</h3><span>最近 {TREND_DAYS} 天</span></header>
        <TrendChart points={trend} />
        <div className="usage-chart-legend"><span className="usage-swatch input" />输入<span className="usage-swatch output" />输出</div>
      </div>

      <div className="usage-block">
        <header><h3>模型用量</h3><span>按累计 token 占比</span></header>
        <ModelDonut models={stats.models ?? {}} />
      </div>

      <div className="usage-block">
        <header><h3>当前任务</h3><span>本会话最近一次统计回传</span></header>
        <div className="usage-stats-row tight">
          <div className="usage-stat"><span>当前任务输入</span><strong>{currentInput.toLocaleString()}</strong></div>
          <div className="usage-stat"><span>当前任务输出</span><strong>{currentOutput.toLocaleString()}</strong></div>
          <div className="usage-stat"><span>上下文窗口</span><strong>{contextWindow ? contextWindow.toLocaleString() : "—"}</strong></div>
        </div>
        <p className="usage-foot"><Timer size={12} />清空本机会计的累计 token 与回合数（仅影响本机显示，不影响 Codex 服务端）。</p>
      </div>

      <AccountUsageBlock />
    </section>
  );
}

export default UsagePanel;
