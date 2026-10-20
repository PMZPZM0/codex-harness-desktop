/**
 * 回合文件审阅 · 渲染层单例（基座，10-18）。
 *
 * 汇总卡（status 域）点文件 → `setTurnReview`（打开右栏）；
 * 最新回合的汇总卡渲染时 → `primeTurnReview`（只更新数据、不抢右栏，保证用户切到「审阅」就能看到）；
 * 右栏文件清单点文件 → `selectTurnReviewFile`（只切选中）。
 * ⛔ 放基座而不是某个域里：src/features/status（汇总卡）与 src/features/app-view（右栏）都要读，
 *    放域内会逼另一侧反向 import（守卫【130】）。
 */
const listeners = new Set();
let current = null;

function notify(reason) {
  for (const fn of listeners) {
    try { fn(current ? { ...current, reason } : null); } catch { /* 订阅者异常互不影响 */ }
  }
}

function buildState(next) {
  const selectedPath = String(next?.selectedPath ?? "").trim();
  if (!selectedPath) return null;
  const files = (Array.isArray(next?.files) ? next.files : [])
    .map((file) => ({
      path: String(file?.path ?? ""),
      added: Number(file?.added ?? 0) || 0,
      deleted: Number(file?.deleted ?? 0) || 0,
      diff: String(file?.diff ?? ""),
      deletedFile: Boolean(file?.deletedFile),
      newFile: Boolean(file?.newFile),
    }))
    .filter((file) => file.path);
  if (!files.length) return null;
  return { turnId: String(next?.turnId ?? ""), files, selectedPath, at: Date.now() };
}

function sameState(a, b) {
  if (!a || !b) return false;
  if (a.turnId !== b.turnId || a.selectedPath !== b.selectedPath || a.files.length !== b.files.length) return false;
  return a.files.every((file, index) => {
    const other = b.files[index];
    return other && file.path === other.path && file.added === other.added && file.deleted === other.deleted
      && file.diff === other.diff && file.deletedFile === other.deletedFile && file.newFile === other.newFile;
  });
}

/** 点汇总卡文件：更新并**打开**右栏（桥监听 "open"）。 */
export function setTurnReview(next) {
  const state = buildState(next);
  if (!state) { current = null; notify("clear"); return; }
  current = state;
  notify("open");
}

/** 最新回合自动带出：只更新数据，不打开右栏、不抢焦点（桥忽略 "prime"）。 */
export function primeTurnReview(next) {
  const state = buildState(next);
  if (!state || sameState(state, current)) return;
  current = state;
  notify("prime");
}

/** 当前会话没有最新回合文件时清空（避免右栏把上一轮当成「最新回合」）。 */
export function clearTurnReview() {
  if (!current) return;
  current = null;
  notify("clear");
}

/** 右栏文件清单里切换选中文件（不重新打开右栏）。 */
export function selectTurnReviewFile(path) {
  const target = String(path ?? "");
  if (!current || !target || !current.files.some((file) => file.path === target)) return;
  if (current.selectedPath === target) return;
  current = { ...current, selectedPath: target, at: Date.now() };
  notify("select");
}

export function getTurnReview() {
  return current;
}

export function subscribeTurnReview(fn) {
  if (typeof fn !== "function") return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}
