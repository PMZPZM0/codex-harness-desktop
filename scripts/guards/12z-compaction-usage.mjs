/**
 * 压缩后用量归零判据（10-18 立）
 *
 * 用户实测：「这个压缩完，跑一会又自动到 50% 了，有点奇怪」。
 *
 * 根因：自动压缩（当前引擎的真实形态）**不发** `thread/compacted` / 压缩 item，
 * 只由宿主 `compaction-watch` 广播 `thread-compacted-host`。10-17 只在引擎那两条事件上
 * 作废用量快照 ⇒ 自动压缩这条路没清：压缩请求自身那份 ~50 万 last 用量继续显示，
 * 并被重新落盘 ⇒ 面板停在压缩前的 50%。
 *
 * 判据：三条压缩完成路径都必须「作废盘上快照 + 清 total/derived 差值 + 清当前环」；
 * 宿主事件只对**新鲜**记录生效（resume 重播历史压缩不能清掉当前用量）。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【compaction-usage】${message}`);
  if (!condition) fails++;
};

const sysEvents = codeOnly(read("src/features/app-state/parts/part02/03-thread-switch-update/01-thread-switch-system-events.tsx"));
const part05 = codeOnly(read("src/features/app-state/parts/part05/01-seg.tsx"));
const status = codeOnly(read("src/features/status/Status.tsx"));

/* ── 一、宿主侦测路径（自动压缩的真实路径）──────────────────────────────── */
{
  ok(sysEvents.includes('payload?.type === "thread-compacted-host"'),
    "宿主压缩事件 thread-compacted-host 有处理分支");
  ok(sysEvents.includes("isLiveCompaction") && sysEvents.includes("Date.now() - compactAt < 2 * 60_000"),
    "⛔ 只对新鲜宿主事件生效（resume 重播的历史压缩记录不能清掉当前用量）");
  ok(sysEvents.includes("persistTokenUsageSnapshot(compactThreadId, null)"),
    "宿主压缩后作废盘上用量快照（否则重载会话又恢复压缩前的 50%）");
  ok(sysEvents.includes("tokenUsageTotalsRef.current.delete(compactThreadId)")
    && sysEvents.includes("derivedTokenUsageRef.current.delete(compactThreadId)"),
    "宿主压缩后清 total/derived 差值快照（压缩后 input 回落不被单调递增判据误伤）");
  ok(sysEvents.includes("bag.tokenUsageRef.current = null") && sysEvents.includes("bag.setTokenUsage(null)"),
    "宿主压缩后当前会话的上下文环立即清空（等下一轮 usage 重新统计）");
}

/* ── 二、引擎旧路径（发 item / thread.compacted 的版本）也清环 ─────────────── */
{
  ok(part05.includes("persistTokenUsageSnapshot(tid0, null)") && part05.includes("bag.tokenUsageRef.current = null"),
    "压缩 item completed 路径：作废快照 + 清当前环");
  ok(part05.includes("persistTokenUsageSnapshot(tid, null)") && part05.includes("bag.setTokenUsage(null)"),
    "thread/compacted 路径：作废快照 + 清当前环");
  ok((part05.match(/derivedTokenUsageRef\.current\.delete/g) || []).length >= 2
    && (part05.match(/tokenUsageTotalsRef\.current\.delete/g) || []).length >= 2,
    "两条引擎路径都清 total/derived 差值");
}

/* ── 三、面板口径：环只认 last；清空时给出解释 ─────────────────────────────── */
{
  ok(status.includes("const currentUsage = lastUsage") && status.includes("used = currentUsage?.totalTokens"),
    "上下文容量只认 last（total 是会话累计计费量，长会话必然超窗口）");
  ok(status.includes("压缩请求自身的用量不算当前占用") && status.includes("used == null && recentCompaction"),
    "压缩后环为空时明确解释「等下一轮重新统计」（不显示误导性的 50%）");
}

console.log(`\n【compaction-usage】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
