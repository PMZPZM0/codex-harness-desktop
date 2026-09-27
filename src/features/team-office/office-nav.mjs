/**
 * 办公室地面寻路（team-office 域，09-27 v12）。
 *
 * 背景：走动人原来是 `from → to` **直线插值** —— 从自己工位走到饮水机会**直接穿过别人的桌子**
 *   （放大看就是"人从桌面里穿过去"）。参照 munder-difflin 的做法（作者博客：Tiled 地图 +
 *   **BFS 四方向寻路**，并明确说这个规模不需要 A*），我们在**归一化地板坐标 (u,v)** 上建一张
 *   小网格做 BFS：
 *     · 网格 32(横向) × 24(纵深)，格宽 ≈ 0.031 u —— 够细且足够快（768 格）；
 *     · 障碍 = 每个工位的「桌 + 椅」占地矩形；
 *     · 四方向、无对角：无权重网格上 BFS 直接给最短路径，不用启发式、不用优先队列。
 *
 * ⛔ 纯函数、无依赖、不 import Pixi / React —— 守卫能直接 import 跑真值表
 *   （与 src/lib/markdown-blocks.mjs、src/lib/thread-source.mjs 同款做法）。
 *   ⚠️ 这也是这个文件是 `.mjs` 而不是 `.ts` 的原因：`.ts` 守卫只能读文本、跑不了，
 *      而"路径必须绕开家具"这件事**必须真跑才算验证过**。
 * ⛔ 坐标系与 office-iso **同源**：u 0=最左 1=最右，v 0=贴后墙 1=贴观众。别在这里另立一套。
 * ⛔ 座位点本身落在自己的桌子里（人是"从桌后走出来"的），所以起终点都要**吸附到最近可走格**。
 */

export const NAV_COLS = 32;
export const NAV_ROWS = 24;

/**
 * 工位占地（相对座位点的 u/v 偏移）：桌子在座位点**后方**（v 更小），椅子在**前方**一小段。
 * ⛔ 数值贴着 office-iso 的工位阵列来：桌半宽 ≈ 0.115（列距 0.27 ⇒ 桌间必留缝），
 *   纵深 0.13 覆盖桌体、0.055 覆盖椅子 —— 两者加起来 0.185 < 行距 0.25，所以**行与行之间
 *   始终留得下一条横向通道**（否则人会被困在自家桌子后面走不出去）。
 */
const DESK_BLOCK = { halfU: 0.115, back: 0.13, front: 0.055 };

/** (u,v) → 网格坐标（就近取整 + 夹紧到边界内）。 */
export function cellOf(u, v, grid) {
  const cx = Math.min(grid.cols - 1, Math.max(0, Math.round(u * (grid.cols - 1))));
  const cy = Math.min(grid.rows - 1, Math.max(0, Math.round(v * (grid.rows - 1))));
  return { cx, cy };
}

/** 网格坐标 → (u,v)（取格心）。 */
export function uvOf(cx, cy, grid) {
  return { u: cx / (grid.cols - 1), v: cy / (grid.rows - 1) };
}

export function isBlocked(grid, cx, cy) {
  if (cx < 0 || cy < 0 || cx >= grid.cols || cy >= grid.rows) return true;
  return grid.blocked[cy * grid.cols + cx] === 1;
}

/** 按工位（含 CEO）的 (u,v) 建可行走网格：被桌/椅覆盖的格标为障碍。 */
export function buildWalkGrid(deskUV, cols = NAV_COLS, rows = NAV_ROWS) {
  const blocked = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    const v = cy / (rows - 1);
    for (let cx = 0; cx < cols; cx++) {
      const u = cx / (cols - 1);
      for (const desk of deskUV) {
        if (
          Math.abs(u - desk.u) <= DESK_BLOCK.halfU &&
          v >= desk.v - DESK_BLOCK.back &&
          v <= desk.v + DESK_BLOCK.front
        ) {
          blocked[cy * cols + cx] = 1;
          break;
        }
      }
    }
  }
  return { cols, rows, blocked };
}

/**
 * 把落在障碍里的格子吸到最近的**可走**格（工位座位点必然在障碍里）。
 * 逐圈扩大的环形搜索：一圈内找到就返回 ⇒ 保证"最近"，且不会像直线扫描那样偏到一侧。
 */
export function nearestFree(grid, cx, cy, maxRing = 10) {
  if (!isBlocked(grid, cx, cy)) return { cx, cy };
  for (let ring = 1; ring <= maxRing; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue; // 只看这一圈的外环
        const nx = cx + dx;
        const ny = cy + dy;
        if (!isBlocked(grid, nx, ny)) return { cx: nx, cy: ny };
      }
    }
  }
  return null;
}

/** 去掉共线中间点 —— 网格 BFS 出来的是逐格锯齿，把每格都当拐点会抖得很难看。 */
export function simplify(points) {
  if (points.length <= 2) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const cross = (b.u - a.u) * (c.v - a.v) - (b.v - a.v) * (c.u - a.u);
    if (Math.abs(cross) > 1e-9) out.push(b); // 方向变了才是拐点
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * BFS 找最短路径（四方向）。
 * @returns (u,v) 点列（已简化，含起点与终点）；找不到通路返回 null（调用方走直线兜底）。
 */
export function findPath(from, to, grid) {
  const start = nearestFree(grid, cellOf(from.u, from.v, grid).cx, cellOf(from.u, from.v, grid).cy);
  const goal = nearestFree(grid, cellOf(to.u, to.v, grid).cx, cellOf(to.u, to.v, grid).cy);
  if (!start || !goal) return null;

  const { cols } = grid;
  const key = (cx, cy) => cy * cols + cx;
  const startKey = key(start.cx, start.cy);
  const goalKey = key(goal.cx, goal.cy);
  if (startKey === goalKey) return [{ u: from.u, v: from.v }, { u: to.u, v: to.v }];

  const prev = new Int32Array(cols * grid.rows).fill(-1);
  const seen = new Uint8Array(cols * grid.rows);
  const queue = [startKey];
  seen[startKey] = 1;
  const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  let found = false;
  for (let head = 0; head < queue.length && !found; head++) {
    const cur = queue[head];
    const cx = cur % cols;
    const cy = Math.floor(cur / cols);
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (isBlocked(grid, nx, ny)) continue;
      const nk = key(nx, ny);
      if (seen[nk]) continue;
      seen[nk] = 1;
      prev[nk] = cur;
      if (nk === goalKey) { found = true; break; }
      queue.push(nk);
    }
  }
  if (!found) return null;

  // 回溯（终点 → 起点）再翻回正向
  const cells = [];
  for (let cur = goalKey; cur !== -1; cur = prev[cur]) {
    cells.push(uvOf(cur % cols, Math.floor(cur / cols), grid));
    if (cur === startKey) break;
  }
  cells.reverse();
  // ⛔ 起点/终点用**真实坐标**收尾（网格点是格心，直接用会让人停在离目标半步远的地方）
  cells[0] = { u: from.u, v: from.v };
  cells[cells.length - 1] = { u: to.u, v: to.v };
  return simplify(cells);
}

/** 路径的总长（屏幕/归一化距离通用 —— 调用方按自己的坐标系传点）。 */
export function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}
