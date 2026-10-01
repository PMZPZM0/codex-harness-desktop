/**
 * 像素办公室 · 走动模拟（纯函数 + 轻量类，可离线断言）
 *
 * 走路与寻路参考了 gigantsc/pixel-office-openclaw 的**方法论**（碰撞网格 + BFS），
 * ⛔ 未复制其任何代码 —— 该仓库无 LICENSE（默认保留所有权利），本文为自有栈上的独立实现。
 *
 * 行为模型（09-30 用户纠错后定稿）：**人人有固定工位，坐班是常态**。
 *   running  → 坐自己工位敲键盘（不离席）
 *   非 running → 也坐自己工位，只是**偶尔起身**在附近走一小圈再回来（摸鱼式休息）
 *   ⛔ 旧版把"没任务的成员"映射成永久闲逛 ⇒ 用户看到的就是"乱走、坐不上去" —— 禁止回退。
 */

import { GRID_COLS, GRID_ROWS, SEATS, TILE, type OfficeMemberState } from "./office-format";

/** 碰撞图：0=可走 1=阻挡。⛔ 椅行（9/14）必须留空、门龛必须连通房间 —— 都实测踩过。 */
function buildCollision(): Uint8Array {
  const g = new Uint8Array(GRID_COLS * GRID_ROWS);
  const at = (cx: number, cy: number) => cy * GRID_COLS + cx;
  // 墙带（按 bg.webp 实测：上墙视觉到 y≈125、左墙到 x≈195 ⇒ 各挡 4 行 / 6 列）
  for (let x = 0; x < GRID_COLS; x += 1) {
    for (const y of [0, 1, 2, 3]) g[at(x, y)] = 1;
    g[at(x, GRID_ROWS - 1)] = 1;
  }
  for (let y = 0; y < GRID_ROWS; y += 1) {
    for (const x of [0, 1, 2, 3, 4, 5]) g[at(x, y)] = 1;
    g[at(GRID_COLS - 1, y)] = 1;
  }
  // 门凹龛（左下，视觉 x 55-195 / y 485-610 ⇒ 格 2-5 × 15-18 可走。
  // ⛔ 必须连通到房间（col 6 起）—— 只开 2-4 会被 col 5 的墙封死）
  for (let y = 15; y <= 18; y += 1) {
    for (const x of [2, 3, 4, 5]) g[at(x, y)] = 0;
  }
  // 两排桌子：桌面块（⛔ 不含椅子行 —— 座位格被挡 ⇒ findPath 返回 null，走不到工位）
  const desks = [
    { x0: 6, y0: 6, x1: 10, y1: 8 },
    { x0: 12, y0: 6, x1: 16, y1: 8 },
    { x0: 19, y0: 6, x1: 23, y1: 8 },
    { x0: 6, y0: 11, x1: 10, y1: 13 },
    { x0: 12, y0: 11, x1: 16, y1: 13 },
    { x0: 19, y0: 11, x1: 23, y1: 13 },
  ];
  for (const d of desks) {
    for (let y = d.y0; y <= d.y1; y += 1) {
      for (let x = d.x0; x <= d.x1; x += 1) g[at(x, y)] = 1;
    }
  }
  return g;
}

export type Pt = { x: number; y: number };

/** BFS 最短路（格坐标）。不可达返回 null。 */
export function findPath(grid: Uint8Array, from: Pt, to: Pt): Pt[] | null {
  const sc = Math.floor(from.x / TILE);
  const sr = Math.floor(from.y / TILE);
  const tc = Math.floor(to.x / TILE);
  const tr = Math.floor(to.y / TILE);
  if (sc < 0 || sr < 0 || sc >= GRID_COLS || sr >= GRID_ROWS) return null;
  if (tc < 0 || tr < 0 || tc >= GRID_COLS || tr >= GRID_ROWS) return null;
  if (grid[tr * GRID_COLS + tc] === 1) return null;
  const prev = new Int32Array(GRID_COLS * GRID_ROWS).fill(-1);
  const seen = new Uint8Array(GRID_COLS * GRID_ROWS);
  const queue: number[] = [sr * GRID_COLS + sc];
  seen[queue[0]] = 1;
  const target = tr * GRID_COLS + tc;
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head];
    head += 1;
    if (cur === target) break;
    const cx = cur % GRID_COLS;
    const cy = (cur - cx) / GRID_COLS;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= GRID_COLS || ny >= GRID_ROWS) continue;
      const ni = ny * GRID_COLS + nx;
      if (seen[ni] || grid[ni] === 1) continue;
      seen[ni] = 1;
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  if (!seen[target]) return null;
  const path: Pt[] = [];
  let cur = target;
  while (cur >= 0) {
    const cx = cur % GRID_COLS;
    const cy = (cur - cx) / GRID_COLS;
    path.unshift({ x: cx * TILE + TILE / 2, y: cy * TILE + TILE / 2 });
    cur = prev[cur];
  }
  return path;
}

type AgentMode = "work" | "idle";

/** 休息活动 POI（⛔ 坐标是 POI 旁的**可走站立点**，PIL 实测贴到物件跟前：
 *  water = 饮水机（机身 x767-812 / 底 y≈127）**右侧贴身** (832,170)，格 25 可走；
 *  book = 书架（底 y≈140，正下方紧贴显示器顶——空间窄站不下）**右侧** (352,178)。
 *  之前定 (786,230)/(300,190) 离物件 50-100px，用户实测「没有到跟前」。 */
const WATER_POI = { x: 832, y: 170, label: "接杯水 💧" };
const BOOK_POI = { x: 352, y: 178, label: "查点资料 📖" };

/** 一个在办公室里的人的运行时状态（sim 内部）。 */
export type Agent = {
  id: string;
  name: string;
  charIndex: number;
  x: number;
  y: number;
  mode: AgentMode;
  /** 当前动作：sit 坐班 / walk 走（去工位或休息走动）/ stand 站立片刻 */
  action: "sit" | "walk" | "stand";
  facing: 0 | 1 | 2; // 行号：0 朝下 1 朝上 2 侧面
  flip: boolean;
  path: Pt[];
  /** 回工位的路径（休息走完按它回来） */
  homePath: Pt[];
  seatIndex: number;
  frameClock: number;
  /** 休息倒计时（tick）；work 成员永不离席 */
  breakCooldown: number;
  onBreak: boolean;
  /** 休息活动（10-01 用户：「加一点喝茶，倒水，查资料」）：
   *  tea = 原地举杯（不起身）；water/book = 走到 POI 站立片刻；null = 普通走动 */
  activity: null | "tea" | "water" | "book";
  /** 活动进行中的站立截止时刻（到点回工位） */
  activityUntil: number;
  bubble: { text: string; until: number } | null;
};

const WALK_SPEED = 1.35; // 逻辑像素 / tick(60fps)

export class OfficeSim {
  readonly grid = buildCollision();
  agents: Agent[] = [];

  /** 成员清单变化（含状态）⇒ 对齐 agents（沿用 id 保持位置/相位）。 */
  sync(members: OfficeMemberState[], now: number) {
    const next: Agent[] = [];
    members.forEach((m, i) => {
      const prev = this.agents.find((a) => a.id === m.id);
      const seatIndex = i % SEATS.length;
      const mode: AgentMode = m.running ? "work" : "idle";
      const agent: Agent = prev ?? {
        id: m.id,
        name: m.name,
        charIndex: i % 6,
        // 从门口进场（第一次打开浮层，全员依次走入 —— 比凭空出现自然）
        x: 64 + (i % 3) * 18,
        y: 596 - (i % 2) * 10,
        mode,
        action: "walk",
        facing: 2,
        flip: false,
        path: [],
        homePath: [],
        seatIndex,
        frameClock: Math.random() * 4,
        breakCooldown: 600 + Math.floor(Math.random() * 900),
        onBreak: false,
        activity: null,
        activityUntil: 0,
        bubble: null,
      };
      // 状态迁移沿 ⇒ 气泡（⛔ 只在变化沿发，不刷屏）
      if (prev && prev.mode !== mode) {
        agent.bubble = mode === "work" ? { text: `开工：${m.profession || "干活"}`, until: now + 2600 } : { text: "任务完成 ✓", until: now + 2600 };
        // 从休息/POI 状态拉回工位（⛔ 清 path：在途的可能是去饮水机的路，走完会坐在没椅子的地上）
        agent.onBreak = false;
        agent.activity = null;
        agent.activityUntil = 0;
        agent.path = [];
      }
      agent.mode = mode;
      if (agent.seatIndex !== seatIndex) {
        agent.seatIndex = seatIndex;
        agent.onBreak = false;
      }
      // 没有在途路径且还没坐下班 ⇒ 规划去工位
      if (agent.path.length === 0 && agent.action !== "sit" && !agent.onBreak) {
        const seat = SEATS[agent.seatIndex];
        const path = findPath(this.grid, agent, seat) ?? [];
        if (path.length > 0) path.push({ x: seat.x, y: seat.y });
        agent.path = path;
        agent.homePath = [...path];
      }
      next.push(agent);
    });
    this.agents = next;
  }

  /** 推进一帧。 */
  tick(dtMs: number) {
    const steps = Math.max(1, Math.round(dtMs / 16.6));
    for (const a of this.agents) {
      a.frameClock += (dtMs / 1000) * (a.action === "walk" ? 2.2 : 1);
      if (a.bubble && Date.now() > a.bubble.until) a.bubble = null;
      for (let s = 0; s < steps; s += 1) this.step(a);
    }
  }

  private step(a: Agent) {
    // ⓪ POI 活动站立中：站着不动到点（⛔ 提前 return，别让路径处理把人拽走）
    if (a.activityUntil > 0) {
      if (Date.now() < a.activityUntil) return;
      a.activityUntil = 0;
      a.activity = null;
      // ⛔ 回工位终点必须**精确到座位像素**——homePath 的终点是「起身时所在格中心」，
      //    比实测 seat.x 偏 ~8px（10-01 用户实测「第二次坐上去就偏右了」的根因）。
      const seat = SEATS[a.seatIndex];
      a.path = [...a.homePath, { x: seat.x, y: seat.y }];
      return;
    }
    // ① 沿当前路径走（去工位 / 休息走动 / 回工位共用一条 path）
    if (a.path.length > 0) {
      a.action = "walk";
      const target = a.path[0];
      const dx = target.x - a.x;
      const dy = target.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= WALK_SPEED) {
        a.x = target.x;
        a.y = target.y;
        a.path.shift();
        if (a.path.length === 0) {
          // 走完了：三种归宿
          if (!a.onBreak) {
            // 回工位 ⇒ 坐下（⛔ 同步清活动——mode 变 work 的沿已清，这里兜住 idle 直接坐）
            a.action = "sit";
            a.activity = null;
          } else if (a.activity) {
            // 到了饮水机 / 书架：站一会儿（bubble 已在起身时发过，这里再提示一次动作中）
            a.action = "stand";
            a.bubble = { text: a.activity === "water" ? WATER_POI.label : BOOK_POI.label, until: Date.now() + 2800 };
            a.activityUntil = Date.now() + 3000;
          } else {
            // 休息走动完毕：站一会儿再回去
            a.action = "stand";
            a.onBreak = false;
            a.breakCooldown = 1500 + Math.floor(Math.random() * 2400);
            const seat = SEATS[a.seatIndex];
            a.path = [...a.homePath, { x: seat.x, y: seat.y }];
          }
        }
      } else {
        a.x += (dx / dist) * WALK_SPEED;
        a.y += (dy / dist) * WALK_SPEED;
        if (Math.abs(dy) > Math.abs(dx) * 1.2) {
          a.facing = dy < 0 ? 1 : 0;
          a.flip = false;
        } else {
          a.facing = 2;
          a.flip = dx < 0;
        }
      }
      return;
    }
    // ② 已在工位：坐班；work 不离席，idle 到点起身休息
    if (a.action === "walk") a.action = "sit";
    if (a.mode === "work" || a.onBreak) return;
    a.breakCooldown -= 1;
    if (a.breakCooldown <= 0) {
      a.onBreak = true;
      const roll = Math.random();
      if (roll < 0.22) {
        // 原地喝茶（不起身）：手部动画切举杯（Canvas 按 activity==="tea" 渲染）
        a.activity = "tea";
        a.activityUntil = Date.now() + 2800;
        a.bubble = { text: "喝口水 ☕", until: Date.now() + 2600 };
        a.breakCooldown = 1800 + Math.floor(Math.random() * 2400);
        return;
      }
      const poi = roll < 0.48 ? WATER_POI : roll < 0.74 ? BOOK_POI : null;
      const target = poi ?? this.randomFloorPointNear(a);
      const out = findPath(this.grid, a, target) ?? [];
      if (out.length > 1) {
        if (poi) {
          a.activity = poi === WATER_POI ? "water" : "book";
          a.bubble = { text: poi.label, until: Date.now() + 2600 };
          // ⛔ 终点追加 POI 精确点（路径原生终点是**格中心**，最多偏 16px——
          //    不追加就是「走到附近但没到跟前」，10-01 用户实测）
          out.push({ x: target.x, y: target.y });
        }
        a.path = out;
        a.homePath = [...out].reverse();
      } else {
        a.onBreak = false;
        a.breakCooldown = 900;
      }
    }
  }

  /** 工位附近 2-4 格的随机点（休息走动不出远门）。 */
  private randomFloorPointNear(a: Agent): Pt {
    const sc = Math.floor(a.x / TILE);
    const sr = Math.floor(a.y / TILE);
    for (let tries = 0; tries < 40; tries += 1) {
      const cx = sc + Math.floor(Math.random() * 9) - 4;
      const cy = sr + Math.floor(Math.random() * 7) - 3;
      if (cx < 0 || cy < 0 || cx >= GRID_COLS || cy >= GRID_ROWS) continue;
      if (this.grid[cy * GRID_COLS + cx] === 0) return { x: cx * TILE + TILE / 2, y: cy * TILE + TILE / 2 };
    }
    return { x: a.x, y: a.y };
  }
}
