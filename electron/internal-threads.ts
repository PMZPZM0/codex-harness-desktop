/**
 * 内部会话登记表（10-31 用户：「开个中枢新会话，一直自动新建这个，有病吗」）。
 *
 * 背景：宿主的**内省 / 蒸馏 / 复盘**（`distillSummarize`）每次干活都要 `thread/start` 起一条
 * 一次性会话 —— 引擎只给了"会话 + 回合"这一种执行模式。这些会话**不是用户建的**，
 * 却和真实会话混在同一个 `thread/list` 里，标题就是提示词首句
 * （「你是这个桌面助手的…」），一轮一条，看着像应用在自我繁殖。
 *
 * ⛔ 三道闸（缺一条就漏）：
 *   ① `runtime-refs.internalThreads` —— 内存集合，事件转发用它挡（原有行为）；
 *   ② 本模块 —— 把它**持久化**（重启后仍认得），列表出口（codex-ipc 的 thread/list）据此剔除；
 *   ③ `task-monitor.noteEngineEvent` —— 内部会话的回合**不参与复盘**（否则：复盘建会话 →
 *      会话跑完又触发复盘 → 每 3~5 秒新建一条，10-31 实测 30 秒刷出 9 条）。
 *
 * ⚠️ 只"隐藏"不删除：这些 rollout 仍在磁盘上（回滚/排查要看得到），只是不出现在侧栏。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { internalThreads } from "./runtime-refs";

/** 内省提示词的首句（`task-monitor.generateSuggestion` 用的就是它）—— 只用于**老数据**一次性认领。 */
const LEGACY_MARKER = "你是这个桌面助手的内省模块";
const KEEP = 500;

let file = "";
let loading: Promise<void> | null = null;

export function initInternalThreads(userData: string): void {
  if (file) return;
  file = path.join(userData, "internal-threads.json");
}

async function persist(): Promise<void> {
  if (!file) return;
  try {
    const ids = [...internalThreads].slice(-KEEP);
    await fs.writeFile(file, JSON.stringify(ids, null, 2), "utf8");
  } catch { /* 写失败不影响运行（只是重启后少一条豁免） */ }
}

/** 登记一条内部会话（`distillSummarize` 建完立刻调）——内存 + 落盘。 */
export function rememberInternalThread(id: string): void {
  const key = String(id ?? "").trim();
  if (!key) return;
  if (!internalThreads.has(key)) internalThreads.add(key);
  void persist();
}

/**
 * 读取登记表；**首次**（文件不存在）顺便认领历史遗留：扫最近几天的 rollout，
 * 首段里有内省提示词的那种就是旧的内部会话。失败一律静默（最坏情况=侧栏多几行）。
 */
export async function loadInternalThreads(codexHome: string): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    let existed = false;
    try {
      const raw = JSON.parse(await fs.readFile(file, "utf8"));
      existed = true;
      if (Array.isArray(raw)) for (const id of raw) {
        const key = String(id ?? "").trim();
        if (key) internalThreads.add(key);
      }
    } catch { /* 没有文件 = 首次；损坏也当首次（重新认领一遍，无副作用） */ }
    if (!existed) await adoptLegacy(codexHome);
  })().catch(() => undefined);
  return loading;
}

/** 一次性认领：最近 3 天的 rollout 里，开头一段含内省提示词的算内部会话。
 *  ⚠️ 读窗口必须够大：这些 rollout 前 ~100KB 是宿主注入的 developer message（AGENTS.md 等），
 *     内省提示词排在其后。3KB 窗口实测一条都认不出来。
 *  ⚠️ 只跑一次（没有登记表时），并限条数：单次最多看 80 个文件 × 200KB。 */
async function adoptLegacy(codexHome: string): Promise<void> {
  try {
    const root = path.join(codexHome, "sessions");
    const days = await recentDayDirs(root, 3);
    const files: { full: string; size: number }[] = [];
    for (const dir of days) {
      let names: string[] = [];
      try { names = await fs.readdir(dir); } catch { continue; }
      for (const name of names) {
        if (!name.startsWith("rollout-") || !name.endsWith(".jsonl")) continue;
        const full = path.join(dir, name);
        try {
          const stat = await fs.stat(full);
          if (stat.size > 2 * 1024 * 1024 || stat.size < 4096) continue;   // 大文件是真实会话
          files.push({ full, size: stat.size });
        } catch { /* 单条读不到就算了 */ }
      }
    }
    files.sort((a, b) => b.size - a.size);          // 兜底排序，条数上限内尽量覆盖
    let adopted = 0;
    for (const entry of files.slice(0, 80)) {
      try {
        const handle = await fs.open(entry.full, "r");
        const buf = Buffer.alloc(Math.min(entry.size, 204_800));
        const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
        await handle.close();
        if (!buf.subarray(0, bytesRead).toString("utf8").includes(LEGACY_MARKER)) continue;
        // 文件名尾部就是会话 id：rollout-<时间戳 20 字符>-<uuid>.jsonl
        const id = path.basename(entry.full).replace(/^rollout-/, "").replace(/\.jsonl$/, "").slice(20);
        if (id) { internalThreads.add(id); adopted += 1; }
      } catch { /* 单条读失败不影响其它 */ }
    }
    if (adopted) {
      await persist();
      console.log(`[internal-threads] 认领历史内部会话 ${adopted} 条（不再出现在侧栏）`);
    }
  } catch { /* 认领失败只是侧栏多几行，不阻塞启动 */ }
}

async function recentDayDirs(root: string, days: number): Promise<string[]> {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < days; i += 1) {
    const d = new Date(now.getTime() - i * 86_400_000);
    const y = String(d.getFullYear());
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    out.push(path.join(root, y, m, dd));
  }
  return out;
}
