// 回合文件变更追踪（10-01 用户令：「修改/编辑/生成动了文件，汇总就要跟 ZCode 一样」+「触发条件齐全」）。
// 引擎只对 apply_patch 发 fileChange；模型走 shell / exec_command / MCP / 浏览器自动化写文件时引擎毫无感知。
// 宿主自己盯文件系统：
//   · turn/started|begin → 记工作目录快照（内容只收文本文件，双上限防大目录）；
//   · turn/(completed|aborted|failed|interrupted) → 算差异并广播 harness:event turn-file-changes；
//   · 没等到结束事件的回合：下一回合开始时先补算再开新快照（防漏报；boot 只在回合结束事件里调 emit）。
//   · 运行中实时喂（10-06 用户对照 WorkBuddy：「编辑文件板块要实时跳动 +N -M」）：快照存在期间每 2.5s
//     做一次**轻量重扫**（只 stat 不读全文，异步并发），对比原始快照把「当前累计改动」广播成
//     turn-file-changes-live；回合收尾发最终报告（10-06 夜二改：**不再发空 live 清场** —— 渲染层
//     收到 final 才清 live，编辑行由最终报告定格续命，见下条）。
//   · 最终报告**落盘 + 重播**（10-06 夜二改，用户实测「重启应用后已修改的文件板块不见了」）：
//     收尾报告按线程写 <storeDir>/<threadId>.json，codex-ipc 在 thread/resume 时把存量报告按
//     原事件形态重播 —— 重启/切回会话后卡片与冻结编辑行仍在（渲染层收件零改动）。
//     ⛔ 为什么必须宿主自报：本环境模型工具面没有 apply_patch（实测模型自己说「本会话没有这个工具」），
//        写文件走 shell / node_repl —— 引擎一个 fileChange 都不发，运行中只能靠宿主自己盯目录。
// ⛔ 两个 id 职责必须分清（10-06 修）：**快照键/结算键 = 线程 id**（一个线程同时只有一个活跃回合，
//   按线程键正好实现「新回合开始时补算上一回合」）；**广播的 turnId = 回合 id**——渲染层的汇总卡
//   是按 `turn.id`（回合 uuid，DOM 里 `#turn-<uuid>`）取报告的，广播线程 id 则永远对不上号 ⇒ 卡片空白。
// ⛔ 本模块是叶子：不 import 任何业务模块，广播函数由 boot 注入。
import fs from "node:fs";
import path from "node:path";

const IGNORE = new Set(["node_modules", ".git", ".codex", ".codex-harness", "dist", "dist-electron", "build", "out", ".next", ".cache", "coverage", "venv", "__pycache__", "release", "win-unpacked", "linux-unpacked", "mac-arm64", "mac-x64", "mac-universal", "DerivedData", "Pods", "target"]);
const TEXT_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".txt", ".css", ".scss", ".html", ".py", ".rs", ".go", ".java", ".toml", ".yml", ".yaml", ".sh", ".xml", ".svg", ".csv", ".mdx"]);
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const MAX_FILES = 4000;
/* ⛔ 单目录文件上限（10-07）：全局 4000 预算下，一个巨型子树（打包产物 / 工具链目录）会把它
   整段吃光 —— 排在它后面的目录（含模型真正在改的那几个）整段进不了快照，diff 变成
   「预算边界抖动」的噪声（实测症状：真写的文件看不见 + 深处文件被误报成「已删除」）。
   两级预算（每目录 600 + 全局 4000）保证再大的树也抢不完其他目录的份额。
   ⛔ walk 与 walkLight 的枚举顺序/预算必须同口径（截断点不同会让 live 把边界文件误报成「新增」）。 */
const MAX_PER_DIR = 600;
const MAX_REPORT = 60;

type Entry = { size: number; mtime: number; content?: string };
const snaps = new Map<string, { turnId: string; cwd: string; snap: Map<string, Entry> }>();
let broadcastFn: ((payload: unknown) => void) | null = null;

export function setTurnFileWatchBroadcast(fn: (payload: unknown) => void): void {
  broadcastFn = fn;
}

/* 诊断落盘（10-07，mac「已编辑文件不展示」排查）：链路两侧全平台同构、无平台分支，断点只可能
   落在几个**静默跳过点**上；打包版 mac 应用 stdout 不可见 ⇒ 关键事实必须落盘（boot 注入
   debugTurnFiles → userData/turn-files-diag.log）。⛔ 诊断写失败绝不影响主流程。 */
let diagFn: ((entry: Record<string, unknown>) => void) | null = null;
export function setTurnFileWatchDiag(fn: (entry: Record<string, unknown>) => void): void {
  diagFn = fn;
}
function diag(entry: Record<string, unknown>): void {
  try { diagFn?.(entry); } catch { /* 诊断失败不影响主流程 */ }
}

/* ── 最终报告的**落盘**（10-06 夜二改：用户实测「重启应用，那个下面已修改的文件那个板块不见了」）──
   <storeDir>/<threadId>.json = { v: 1, turns: { [turnId]: { at, files } } }；由 boot 注入目录
   （userData 下的 turn-file-changes/，⛔ 不许在本模块顶层求值 app.getPath——import 早于 setPath）。
   裁剪都是防呆上限：每线程最多 40 个回合；单文件超 1.5MB 从最老回合起丢。落盘失败静默（不影响广播链）。 */
const MAX_TURNS_PER_THREAD = 40;
const MAX_STORE_BYTES = 1_500_000;
type StoredTurn = { at: number; files: unknown[] };
let storeDir: string | null = null;
const storeCache = new Map<string, Record<string, StoredTurn>>();

export function setTurnFileWatchStore(dir: string): void {
  storeDir = dir ? String(dir) : null;
}

function storeFileFor(threadId: string): string | null {
  if (!storeDir) return null;
  return path.join(storeDir, threadId.replace(/[^A-Za-z0-9_-]/g, "_") + ".json");
}

function readStore(threadId: string): Record<string, StoredTurn> {
  const cached = storeCache.get(threadId);
  if (cached) return cached;
  let turns: Record<string, StoredTurn> = {};
  const file = storeFileFor(threadId);
  if (file) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed && typeof parsed === "object" && parsed.turns && typeof parsed.turns === "object") turns = parsed.turns as Record<string, StoredTurn>;
    } catch { /* 不存在 / 损坏：按空库起 */ }
  }
  storeCache.set(threadId, turns);
  return turns;
}

function pruneAndPersistTurn(threadId: string, turns: Record<string, StoredTurn>): void {
  const file = storeFileFor(threadId);
  if (!file) return;
  try {
    const ids = Object.keys(turns).sort((a, b) => (turns[a]?.at ?? 0) - (turns[b]?.at ?? 0));
    while (ids.length > MAX_TURNS_PER_THREAD) delete turns[ids.shift() as string];
    while (ids.length > 1 && JSON.stringify(turns).length > MAX_STORE_BYTES) delete turns[ids.shift() as string];
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ v: 1, turns }), "utf8");
  } catch { /* 落盘失败不影响广播链路 */ }
}

/** 本线程的存量报告（按时间升序）——codex-ipc 在 thread/resume 时按原事件形态重播给渲染层。 */
export function storedReportsForThread(threadId: string): { turnId: string; files: unknown[] }[] {
  const id = String(threadId ?? "");
  if (!id) return [];
  const turns = readStore(id);
  return Object.entries(turns)
    .sort((a, b) => (a[1]?.at ?? 0) - (b[1]?.at ?? 0))
    .map(([turnId, entry]) => ({ turnId, files: Array.isArray(entry?.files) ? entry.files : [] }));
}

/** 会话被删 ⇒ 落盘报告跟着走（两个删除入口都调用：boot 的 thread/deleted 通知 + codex-ipc 的
    渲染层删除——与 delegateRegistry.forget 同点，那两处注释点名"两处都要有"）。 */
export function dropStoredReports(threadId: string): void {
  const id = String(threadId ?? "");
  if (!id) return;
  storeCache.delete(id);
  const file = storeFileFor(id);
  if (file) { try { fs.rmSync(file, { force: true }); } catch { /* 尽力而为 */ } }
}

function walk(cwd: string): { snap: Map<string, Entry>; rootError: string; truncated: boolean } {
  const snap = new Map<string, Entry>();
  let total = 0;
  let rootError = "";
  let truncated = false;
  // ⛔ 两趟遍历：**先收本层文件、再下潜子目录**。深度优先（10-01 原实现）在限流预算
  //   （MAX_FILES/MAX_TOTAL_BYTES）下会被排在前面的大型子目录整段烧光（10-06 实证：
  //   家目录工作区里 AppData 先被 DFS 走完，根级新文件永远进不了快照 ⇒ diff 恒 0、卡片空白）。
  //   文件优先保证「模型最常写的根层/浅层文件」一定在预算内。
  // ⛔ 根目录读取失败（mac TCC 权限 EPERM/EACCES 等）必须**带出来**（10-07）：原先 catch 一律
  //   静默 ⇒ 快照恒空、diff 恒空，与「工作区本来就没有文件」不可区分。rootError 交给调用方落盘。
  // ⛔ truncated（10-07 二次修）：命中任一预算而**跳过了文件** ⇒ 前后两次遍历的截断点会随
  //   「本轮新增/删除的文件数」漂移（实测：本仓 release 被忽略后仍有 resources 图标集的深文件
  //   被边界抖动误报成「已删除」）⇒ **截断时不做删除判定**（删除只能由"明确扫过却消失"证明）。
  const visit = (dir: string, depth: number): void => {
    if (depth > 8 || snap.size >= MAX_FILES) { if (snap.size >= MAX_FILES) truncated = true; return; }
    let list: fs.Dirent[];
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (error) {
      if (depth === 0) rootError = String((error as NodeJS.ErrnoException)?.code ?? (error as Error)?.message ?? error);
      return;
    }
    const dirs: string[] = [];
    let takenInDir = 0;
    for (const e of list) {
      if (IGNORE.has(e.name) || (e.name.startsWith(".") && e.name !== ".codex" && e.name !== ".env")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { dirs.push(p); continue; }
      if (snap.size >= MAX_FILES) { truncated = true; return; }
      if (takenInDir >= MAX_PER_DIR) { truncated = true; continue; }   // 单目录上限：巨型子树不许吃光全局预算（见 MAX_PER_DIR 注释）
      takenInDir += 1;
      try {
        const st = fs.statSync(p);
        const ext = path.extname(e.name).toLowerCase();
        if (st.size <= MAX_FILE_BYTES && TEXT_EXT.has(ext) && total + st.size <= MAX_TOTAL_BYTES) {
          const content = fs.readFileSync(p, "utf8");
          total += st.size;
          snap.set(p, { size: st.size, mtime: st.mtimeMs, content });
        } else {
          snap.set(p, { size: st.size, mtime: st.mtimeMs });
        }
      } catch { /* 无权限等：跳过 */ }
    }
    for (const d of dirs) visit(d, depth + 1);
  };
  visit(cwd, 0);
  return { snap, rootError, truncated };
}

/** 行级 ± 估算（多重集差）：added = 新有旧无的行数，deleted = 旧有新无的行数；
 *  另产出可读的伪 diff（共同前后缀裁剪，中间 -旧/+新），供审查弹窗展示。 */
function lineDelta(oldText: string, newText: string) {
  const count = (text: string) => {
    const m = new Map<string, number>();
    for (const l of text.split(/\r?\n/)) if (l.trim()) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const a = count(oldText);
  const b = count(newText);
  let added = 0;
  let deleted = 0;
  for (const [line, n] of b) added += Math.max(0, n - (a.get(line) ?? 0));
  for (const [line, n] of a) deleted += Math.max(0, n - (b.get(line) ?? 0));
  const oldLines = oldText.split(/\r?\n/);
  const newLines = newText.split(/\r?\n/);
  let head = 0;
  while (head < oldLines.length && head < newLines.length && oldLines[head] === newLines[head]) head++;
  let tail = 0;
  while (tail < oldLines.length - head && tail < newLines.length - head && oldLines[oldLines.length - 1 - tail] === newLines[newLines.length - 1 - tail]) tail++;
  const removed = oldLines.slice(head, oldLines.length - tail);
  const addedLines = newLines.slice(head, newLines.length - tail);
  const diff = [
    `@@ -${head + 1},${removed.length} +${head + 1},${addedLines.length} @@`,
    ...removed.slice(0, 400).map((l) => "-" + l),
    ...addedLines.slice(0, 400).map((l) => "+" + l),
  ].join("\n");
  return { added, deleted, diff };
}

/** 轻量重扫（只 stat、不读全文；异步并发，别阻塞主进程）——运行中实时广播的数据源。
 *  枚举顺序与同步 walk 对齐（同层文件优先、按 readdir 顺序、预算同口径），保证「可见集合」一致：
 *  否则 4000 上限的截断点不同，边界文件会被 live 误报成「新增」（回合收尾的最终报告是同步 walk，
 *  两边一致 ⇒ 最终卡永远是对的，live 只是过程视图）。 */
async function walkLight(cwd: string): Promise<{ map: Map<string, { size: number; mtime: number }>; truncated: boolean }> {
  const out = new Map<string, { size: number; mtime: number }>();
  let truncated = false;
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8 || out.size >= MAX_FILES) { if (out.size >= MAX_FILES) truncated = true; return; }
    let list: fs.Dirent[];
    try { list = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (error) {
      if (depth === 0) {
        // 根目录失败去重落盘（轮询每 2.5s 一拍，不去重会把日志刷爆）。
        const key = `${dir}|${String((error as NodeJS.ErrnoException)?.code ?? (error as Error)?.message ?? error)}`;
        if (key !== lightRootErrorLogged) {
          lightRootErrorLogged = key;
          diag({ point: "walk-root-error-live", cwd: dir, error: String((error as NodeJS.ErrnoException)?.code ?? (error as Error)?.message ?? error) });
        }
      }
      return;
    }
    const dirs: string[] = [];
    const batch: Promise<void>[] = [];
    let inflight = 0;
    let takenInDir = 0;
    for (const e of list) {
      if (IGNORE.has(e.name) || (e.name.startsWith(".") && e.name !== ".codex" && e.name !== ".env")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { dirs.push(p); continue; }
      if (out.size + inflight >= MAX_FILES) { truncated = true; break; }
      if (takenInDir >= MAX_PER_DIR) { truncated = true; continue; }   // 与同步 walk 同口径（见 MAX_PER_DIR 注释）
      takenInDir += 1;
      inflight += 1;
      batch.push(fs.promises.stat(p).then((st) => { out.set(p, { size: st.size, mtime: st.mtimeMs }); }).catch(() => undefined));
    }
    await Promise.all(batch);
    for (const d of dirs) await visit(d, depth + 1);
  };
  await visit(cwd, 0);
  return { map: out, truncated };
}

/** 轻量重扫根目录失败的**去重**记忆（见 walkLight）。 */
let lightRootErrorLogged = "";

const LIVE_POLL_MS = 2500;
let liveTimer: ReturnType<typeof setInterval> | null = null;
let liveBusy = false;
const liveLastSent = new Map<string, string>();

function ensureLiveTimer(): void {
  if (liveTimer) return;
  liveTimer = setInterval(() => { void pollLiveOnce(); }, LIVE_POLL_MS);
  (liveTimer as unknown as { unref?: () => void }).unref?.();
}

function stopLiveTimerIfIdle(): void {
  if (liveTimer && snaps.size === 0) { clearInterval(liveTimer); liveTimer = null; }
}

async function readLiveText(filePath: string): Promise<string | null> {
  try {
    const st = await fs.promises.stat(filePath);
    if (st.size > MAX_FILE_BYTES || !TEXT_EXT.has(path.extname(filePath).toLowerCase())) return null;
    return await fs.promises.readFile(filePath, "utf8");
  } catch { return null; }
}

/** 一轮实时扫描：对每个活跃快照算出「自回合开始以来的累计改动」，变了才广播。 */
async function pollLiveOnce(): Promise<void> {
  if (liveBusy || snaps.size === 0) return;
  liveBusy = true;
  try {
    for (const [threadId, entry] of [...snaps]) {
      if (!entry.turnId) continue;
      const { map: next, truncated } = await walkLight(entry.cwd);
      const files: { path: string; status: string; added: number; deleted: number }[] = [];
      for (const [p, after] of next) {
        const before = entry.snap.get(p);
        if (!before) {
          const text = await readLiveText(p);
          const d = text != null ? lineDelta("", text) : { added: 0, deleted: 0 };
          files.push({ path: p, status: "added", added: d.added, deleted: 0 });
        } else if (before.size !== after.size || before.mtime !== after.mtime) {
          const text = await readLiveText(p);
          const d = before.content != null && text != null ? lineDelta(before.content, text) : { added: 0, deleted: 0 };
          files.push({ path: p, status: "modified", added: d.added, deleted: d.deleted });
        }
      }
      // 截断时不做删除判定（10-07）：前后遍历的截断点会随本轮文件数漂移，边界文件会被
      // 误报成「已删除」—— 删除只能由"明确扫过却消失"证明（见 walk 的 truncated 注释）。
      if (!truncated) {
        for (const [p, before] of entry.snap) {
          if (next.has(p)) continue;
          const d = before.content != null ? lineDelta(before.content, "") : { added: 0, deleted: 0 };
          files.push({ path: p, status: "deleted", added: 0, deleted: d.deleted });
        }
      }
      files.sort((x, y) => y.added + y.deleted - (x.added + x.deleted));
      const report = files.slice(0, MAX_REPORT);
      const sig = report.map((f) => `${f.path}|${f.status}|${f.added}|${f.deleted}`).join("\n");
      if (sig === liveLastSent.get(threadId)) continue;
      liveLastSent.set(threadId, sig);
      if (broadcastFn) broadcastFn({ type: "turn-file-changes-live", turnId: entry.turnId, files: report });
    }
  } catch { /* 扫描失败下一拍再试（轮询不抛） */ } finally {
    liveBusy = false;
  }
}

export function snapshotTurnWorkspace(threadId: string, turnId: string, cwd: string): void {
  const id = String(threadId ?? "");
  const dir = String(cwd ?? "").trim();
  if (!id || !dir) { diag({ point: "snapshot-skip", reason: "empty-id-or-dir", threadId: id, cwd: dir }); return; }
  if (!fs.existsSync(dir)) { diag({ point: "snapshot-skip", reason: "cwd-not-exists", threadId: id, cwd: dir }); return; }
  // 触发条件补全：上一轮没等到 completed（事件丢失/中断未报）⇒ 先补算再开新快照
  if (snaps.has(id)) emitTurnFileChanges(id);
  // ⛔ 诊断（10-07，mac「已编辑文件不展示」排查）：快照记不到回合 id ⇒ 最终报告按
  //    turnId="" 广播，渲染层按 turn.id 对不上号 ⇒ 汇总卡空白。静默跳过点之三。
  if (!String(turnId ?? "").trim()) {
    console.warn("[turn-files-diag] 快照缺少回合 id：threadId=", id);
    diag({ point: "snapshot-skip", reason: "no-turn-id", threadId: id, cwd: dir });
  }
  const { snap, rootError } = walk(dir);
  if (rootError) diag({ point: "walk-root-error", threadId: id, cwd: dir, error: rootError });
  snaps.set(id, { turnId: String(turnId ?? ""), cwd: dir, snap });
  // 快照为空 = 空工作区或**读不到目录**（TCC/权限）——与「改了但没检测到」必须能区分（10-07）。
  if (snap.size === 0) diag({ point: "snapshot-empty", threadId: id, cwd: dir });
  liveLastSent.delete(id);
  ensureLiveTimer();
}

export function emitTurnFileChanges(threadId: string): void {
  const id = String(threadId ?? "");
  const entry = snaps.get(id);
  if (!entry) {
    // 收尾时连快照都没有 = 开局就没记上（cwd 未登记 / 回合 id 缺失）——这条日志直接回答
    // 「链路跑没跑」（10-07 mac 排查：有它无它即可二分到「主进程侧」还是「渲染层侧」）。
    diag({ point: "emit-no-snapshot", threadId: id });
    return;
  }
  snaps.delete(id);
  liveLastSent.delete(id);
  stopLiveTimerIfIdle();
  const { snap: next, rootError, truncated } = walk(entry.cwd);
  if (rootError) diag({ point: "walk-root-error", threadId: id, cwd: entry.cwd, error: rootError });
  const files: { path: string; status: string; added: number; deleted: number; diff: string }[] = [];
  for (const [p, after] of next) {
    const before = entry.snap.get(p);
    if (!before) {
      const d = after.content != null ? lineDelta("", after.content) : { added: 0, deleted: 0, diff: "" };
      files.push({ path: p, status: "added", added: d.added, deleted: 0, diff: d.diff });
      continue;
    }
    if (before.content != null && after.content != null && before.content !== after.content) {
      const d = lineDelta(before.content, after.content);
      files.push({ path: p, status: "modified", added: d.added, deleted: d.deleted, diff: d.diff });
    } else if (before.size !== after.size || before.mtime !== after.mtime) {
      files.push({ path: p, status: "modified", added: 0, deleted: 0, diff: "" });
    }
  }
  // 截断时不做删除判定（10-07）：前后的截断点随本轮文件数漂移，边界文件会被误报「已删除」
  // （实测：图标集深文件 +0 -22 排进汇总卡前列，真写的文件反被顶下去）。删除必须"明确扫过才消失"。
  if (!truncated) {
    for (const [p, before] of entry.snap) {
      if (!next.has(p)) {
        const d = before.content != null ? lineDelta(before.content, "") : { added: 0, deleted: 0, diff: "" };
        files.push({ path: p, status: "deleted", added: 0, deleted: d.deleted, diff: d.diff });
      }
    }
  }
  files.sort((x, y) => y.added + y.deleted - (x.added + x.deleted));
  const report = files.slice(0, MAX_REPORT);
  // 收尾心跳（10-07）：每次结算都记一行 —— mac 上「没有这行」= 主进程侧链路断了；
  // 「有这行但 files:0」= 检测正常但没发现改动（工作区之外写的 / 本来就没改）。
  // truncated=true 表示工作区大到预算截断（本仓 workspace 就如此：resources 图标集）——此时
  // 删除判定被抑制，files 数偏小属预期，不算异常。
  diag({ point: "emit", threadId: id, turnId: entry.turnId, files: report.length, changed: files.length, truncated });
  // 落盘（10-06 夜二改）：重启/切回会话后卡片与冻结编辑行还在（thread/resume 时重播）
  if (report.length && entry.turnId) {
    const store = readStore(id);
    store[String(entry.turnId)] = { at: Date.now(), files: report };
    pruneAndPersistTurn(id, store);
  }
  // ⛔ turnId 必须用**快照时记下的回合 id**（渲染层按 turn.id 取报告）；线程键只用于本模块内部结算。
  // ⛔ 最终报告**无条件广播**（10-06 夜二改）：渲染层收到 final 才清 `turn-file-changes-live` ——
  //    若对空报告静默跳过，残留的 live 数据会让「编辑行」卡在屏幕上不走（冻结语义下更明显）。
  if (broadcastFn) broadcastFn({ type: "turn-file-changes", turnId: entry.turnId, files: report });
}

/** 收尾兜底（10-06 夜，新机器实测「运行中行有、收尾汇总卡没有」）：部分引擎版本的结束事件
 *  可能不带 threadId（宽容解析只拿到 turnId）⇒ 按线程键找不到快照、收尾静默漏结算。
 *  快照条目里本来就存了 turnId（广播用）——这里按 **turnId 反查**并按其线程键结算。
 *  ⛔ 双保险语义：正常路径 emitTurnFileChanges(threadIdOf) 先跑（命中即已删快照），
 *  本函数随后 find 不到 = no-op；只有前者落空时才由这里兜住。不会重复结算。 */
export function settleTurnByTurnId(turnId: string): void {
  const id = String(turnId ?? "");
  if (!id) return;
  for (const [threadId, entry] of [...snaps]) {
    if (entry.turnId === id) { emitTurnFileChanges(threadId); return; }
  }
}
