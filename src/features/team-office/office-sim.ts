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
 *
 * ⭐ 2026-10-05 晚 追加四件事（用户点名）：
 *   ① **防穿模**：人物之间不再重叠（软分离 + 撞墙回退，见 `separate`）；
 *   ② **互相串门闲聊**：空闲时两个成员会凑到一起聊两句（`startChat`，气泡轮流冒）；
 *   ③ **任务派发动画**：委派 id 一变就播"任务卡飞过去"（`dispatchFx`，由画布绘制）；
 *   ④ **站位对着物件**：书架/饮水机的站立点是**正前方**（实测坐标，见 POI 注释）。
 */

import { GRID_COLS, GRID_ROWS, SEATS, TILE, type OfficeMemberState } from "./office-format";
import type { RunPhase } from "./office-screen";
import type { OfficeActivityKind } from "./office-activity";

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

/* ── 休息 POI（⛔ 坐标都是 PIL 在 `assets/bg.webp` 上量出来的，不是目测）──
 *
 * ⭐ 2026-10-05 晚 修站位：用户报「走到书架和饮水机**侧身站在一旁**，不是正前方」。
 *   实测（`.workbuddy/tmp/pv/measure.py`，带 32px 网格的放大图）：
 *     · 书架   x≈190-360 / 底 **y≈128**   ⇒ 正前方 = 中心 x≈272，站立 y≈146（格 8,4）
 *     · 饮水机 x≈770-815 / 底 **y≈130**   ⇒ 正前方 = 中心 x≈790，站立 y≈146（格 24,4）
 *   这两格都在「墙带（行 0-3）之下、桌面（行 6-8）之上」的可走带里（行 4-5）。
 *   ⛔ 旧值 (352,178)/(832,170) 都是**物件右侧**的可走点 —— 走得过去，但站着像"在旁边看"。
 *   ⛔ 站立点 y 取 146 而不是 128：脚底 = y+26 = 172，正好落在桌子前沿**之前**，
 *     人不会被画成"站在桌面上"。 */
const WATER_POI = { x: 790, y: 146, label: "接杯水 💧" };
const BOOK_POI = { x: 272, y: 146, label: "查点资料 📖" };

/* ── 10-04 新增三个 POI（用户要求「加一个卫生间，和跑步机，还有哑铃」）──
 * ⚠️ 素材只有 23 张图、**没有这三样设备本体**（用户选"用现有素材拼"）⇒
 *   本轮先用**地面标记 + 气泡文案**表达，不画设备；设备像素图下一轮补。 */
const TOILET_POI = { x: 96, y: 520, label: "去洗手间 🚻" };
const TREADMILL_POI = { x: 880, y: 250, label: "跑两步 🏃" };
const GYM_POI = { x: 880, y: 340, label: "举铁 🏋️" };

/** 一个 POI 前能**并排**站几个人（⭐ 防"几个人叠在同一个点上"）。
 *  ⛔ 偏移量 ± 22px 后必须仍在可走格内（书架 250/294 → 格 7/9；饮水机 768/812 → 格 24/25）。 */
const POI_SLOTS = [0, -22, 22];

/** 全部休息 POI（供事件驱动调度用）。 */
const ALL_POIS = [
  { poi: WATER_POI, act: "water" as const },
  { poi: BOOK_POI, act: "book" as const },
  { poi: TOILET_POI, act: "toilet" as const },
  { poi: TREADMILL_POI, act: "run" as const },
  { poi: GYM_POI, act: "gym" as const },
];

/** 闲聊台词池（**成对**：先说的 + 应的）。
 *  ⛔ 这是**纯装饰**内容（用户明确要"互相沟通与闲聊"）——
 *   所以它不引用任何"真实任务内容"，也就不存在"编造状态"的问题。
 *   要挂真实信息请走气泡以外的通道（名牌/屏面），别往这里塞假数据。 */
const CHAT_LINES: [string, string][] = [
  ["你那边顺吗？", "还行，刚跑通"],
  ["我先去接杯水", "帮我带一杯 🙂"],
  ["这条链路真长", "慢慢来，不急"],
  ["你那个结果我看了", "有哪里要改？"],
  ["它这一波想得挺久", "数据量大，正常"],
  ["要不要先歇会儿", "再跑一轮就歇"],
];

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
   *  tea = 原地举杯（不起身）；water/book = 走到 POI 站立片刻；null = 普通走动
   *  10-04 新增：toilet 卫生间 / run 跑步机 / gym 哑铃（都走到对应 POI） */
  activity: null | "tea" | "water" | "book" | "toilet" | "run" | "gym";
  /** 活动进行中的站立截止时刻（到点回工位） */
  activityUntil: number;
  /** 该 POI 前占的是第几个站位（防多人叠在同一点） */
  poiSlot: number;
  bubble: { text: string; until: number } | null;
  /* ── 10-04 事件驱动（用户选"跟真实事件挂钩"）：以下字段由真实会话状态灌进来，
     只影响**显示器画什么**，不驱动移动（移动是下面 activity 管的）。
     ⛔⛔ 10-05 晚改：原来这里是三个布尔 `thinking/waiting/reporting` ——
        它们**表达不了"有产出 / 已完成 / 已失败"**，而宿主只能编（`reporting` 被写成
        "关键词没命中" ⇒ 敲代码屏永远不出现，用户 10-05 报"事件状态反馈未接通"）。
        ⇒ 换成 **`phase`（真实运行阶段）+ 真实产出字数 + 阶段起始时刻**，
          由宿主按 run 记录推导（`TeamOfficePreview.phaseOfRun`）。
     ⛔ 别拿 running/turnActive 当 phase 用——那是回合级信号，一张卡亮一片屏就废了
        （与 4f7c610 思考浮层那个教训同族）。 */
  /** 真实运行阶段（none = 无运行信息 ⇒ 时钟屏保） */
  phase: RunPhase;
  /** 该阶段的**绝对起始时刻**（epoch ms；0 = 无）。用于屏面上的实时计时器。 */
  phaseSince: number;
  /** 完成/失败时给**总用时**（跑动中给 0 ⇒ 屏面按 now - phaseSince 实时算） */
  durationMs: number;
  /** 本轮**真实产出字数**（report 模式的进度条按它增长） */
  chars: number;
  /* ── 真实事件面（10-05 晚，见 office-activity.ts）──
     这几项是**过路状态**：sim 不解释它们，只是替画布按 4Hz 存一份"每人此刻在干什么"。
     ⛔ 为什么不每帧直接问宿主：宿主那侧要按 threadId 查表 + 建对象，60fps × 6 人
       是白烧（而且 `eventStateOf` 的返回体每次都是新对象）。 */
  /** 该成员**最近一条真实事件**的种类（null = 没有 / 已过期） */
  event: OfficeActivityKind | null;
  /** 该事件的真实细节（命令 / 文件名 / 查询词）⇒ 屏面底部滚动字幕 */
  eventDetail: string;
  /** 该事件的耗时毫秒（进行中 = 已跑多久；已完成 = 本次总耗时） */
  eventElapsedMs: number;
  /** 本次委派 id（**变化** = 有新任务派下来 ⇒ 播"任务派发"动画，见 dispatchFx） */
  runId: string;
  /* ── 串门闲聊（⭐ 10-05 晚）── */
  /** 正在聊的对象 id（null = 没在聊） */
  chatWith: string | null;
  /** 本轮闲聊的开始时刻（气泡按它轮流换台词；**由发起人**在站住那一刻起算） */
  chatAt: number;
  /** 这场闲聊的**主持人**（= 主动走过去的那位）。⭐ 只有主持人管计时/台词，
   *  ⛔ 两边各自计时会互相打架（被访者一坐下就把还没走到的发起人判成聊完了）。 */
  chatHost: boolean;
  /** 这次出行的**最终目的地**（卡住自愈时按它重新规划；null = 没有出行目标） */
  dest: Pt | null;
  /** 连续多少帧没能挪窝（>90 ≈ 1.5 秒 ⇒ 触发重新规划） */
  stuck: number;
  /** 这趟出行是什么时候出发的（0 = 没有在途出行）。用于"走太久就放弃回工位"兜底 */
  tripAt: number;
  /** 这趟出行是否已经重试过一次（超时 → 重规划 → 再给一段；再超时才回工位） */
  tripRetried: boolean;
};

/** 某成员当前阶段的已持续毫秒（屏面计时器唯一取数口）。 */
export function phaseElapsedMs(a: Pick<Agent, "phase" | "phaseSince" | "durationMs">, now = Date.now()): number {
  if (a.phase === "none" || !a.phaseSince) return 0;
  if ((a.phase === "done" || a.phase === "failed") && a.durationMs > 0) return a.durationMs;
  return Math.max(0, now - a.phaseSince);
}

/** 一次"任务派发"的动画记录（画布据此画飞过去的任务卡）。 */
export type DispatchFx = {
  /** 发起方座位（⭐ 约定：成员数组第 0 位就是派发方 —— 专家团=主理人，普通会话=「我」） */
  from: number;
  /** 接单方座位 */
  to: number;
  /** 开始时刻 */
  at: number;
};

const WALK_SPEED = 1.35;      // 逻辑像素 / tick(60fps)
const MIN_GAP = 30;           // ⭐ 彼此距离小于它 ⇒ 开始互相推开（防穿模）
const DISPATCH_FX_MS = 1600;  // 任务卡飞过去播多久
const CHAT_MS = 7200;         // 一次闲聊聊多久
const CHAT_LINE_MS = 2200;    // 一句台词显示多久

export class OfficeSim {
  readonly grid = buildCollision();
  agents: Agent[] = [];
  /** 正在播的"任务派发"动画（画布读它绘制；过期在 tick 里清）。 */
  dispatchFx: DispatchFx[] = [];

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
        /* 从门口进场（第一次打开浮层，全员依次走入 —— 比凭空出现自然）。
           ⛔⛔ 间距必须 ≥ MIN_GAP：原来 18px/10px ⇒ 六个人**一开始就叠在一起**，
             分离力又受"步速"限制推不开 ⇒ 真机采样最近距离只有 11px（等于全员穿模）。
             门龛是格 2-5 × 15-18（128×128px）⇒ 用 3×2、间距 40px 摆得下。 */
        x: 84 + (i % 3) * 40,
        y: 600 - Math.floor(i / 3) * 40,
        mode,
        action: "walk",
        facing: 2,
        flip: false,
        path: [],
        homePath: [],
        seatIndex,
        frameClock: Math.random() * 4,
        breakCooldown: 1800 + Math.floor(Math.random() * 3000),   // 30~80 秒（⛔ 原来 10~25 秒，太频繁）
        onBreak: false,
        activity: null,
        activityUntil: 0,
        poiSlot: 0,
        bubble: null,
        phase: "none",
        phaseSince: 0,
        durationMs: 0,
        chars: 0,
        event: null,
        eventDetail: "",
        eventElapsedMs: 0,
        runId: "",
        chatWith: null,
        chatAt: 0,
        chatHost: false,
        dest: null,
        stuck: 0,
        tripAt: 0,
        tripRetried: false,
      };
      // 状态迁移沿 ⇒ 气泡（⛔ 只在变化沿发，不刷屏）
      if (prev && prev.mode !== mode) {
        agent.bubble = mode === "work" ? { text: `开工：${m.profession || "干活"}`, until: now + 2600 } : { text: "任务完成 ✓", until: now + 2600 };
        // 从休息/POI 状态拉回工位（⛔ 清 path：在途的可能是去饮水机的路，走完会坐在没椅子的地上）
        agent.onBreak = false;
        agent.activity = null;
        agent.activityUntil = 0;
        agent.path = [];
        // 闲聊被打断（对方可能已经走了）—— 一并清掉，否则两人会隔着半个房间冒气泡
        this.endChat(agent.id, false);
      }
      agent.mode = mode;
      if (agent.seatIndex !== seatIndex) {
        agent.seatIndex = seatIndex;
        agent.onBreak = false;
        this.endChat(agent.id, false);
      }
      // 没有在途路径且还没坐下班 ⇒ 规划去工位
      if (agent.path.length === 0 && agent.action !== "sit" && !agent.onBreak) {
        const seat = SEATS[agent.seatIndex];
        const path = findPath(this.pathGrid(agent.seatIndex), agent, seat) ?? [];
        if (path.length > 0) path.push({ x: seat.x, y: seat.y });
        agent.path = path;
        agent.homePath = [...path];
        agent.dest = { x: seat.x, y: seat.y };
      }
      // 座位上的人：把坐标钉回座位（分离力/走位都不许把人从椅子上挤走）
      if (agent.action === "sit") {
        const seat = SEATS[agent.seatIndex];
        agent.x = seat.x;
        agent.y = seat.y;
      }
      next.push(agent);
    });
    /* ⛔ 被移出名单的人如果正在和别人聊天 ⇒ 让对面也散场（否则对面会对着空气说话） */
    for (const a of this.agents) {
      if (a.chatWith && !next.some((n) => n.id === a.chatWith)) this.endChat(a.id, false);
    }
    this.agents = next;
  }

  /**
   * 派某成员去做某事（**真实事件驱动**，见 OfficeCanvas 的 4Hz 派单）。
   *
   * ⛔⛔ 为什么必须独立于原来那套随机休息：原来 `step()` 里
   *   `if (a.mode === "work" || a.onBreak) return;` ⇒ **work 成员永不离席**
   *   ⇒ 用户看到的"查资料没走到书架前、喝水也是"，就是因为干活的角色根本不会起身。
   *   改法不是"删掉这行"（那会变成纯随机、无节操乱跑），而是**给事件一个显式入口**：
   *   随机那套继续管"空闲时的自作主张"，事件这套管"真的有事情发生"。
   *
   * @param kind  "book"查资料 / "water"喝水 / "toilet"洗手间 / "run"跑步机 / "gym"举哑铃
   * @returns 是否成功派出去（找不到人/在途/已在同活动/POI 站满 ⇒ false）
   */
  sendTo(memberId: string, kind: "book" | "water" | "toilet" | "run" | "gym", now = Date.now()): boolean {
    const a = this.agents.find((x) => x.id === memberId);
    if (!a) return false;
    /* ⛔⛔ 用户 10-05 明确「**有工作就不要闲逛**」：手上还在跑的成员不派出去。
       与 step 里那条 mode==="work" 提前 return 是**两道**防线
       （一道管随机起身、一道管外部派单）。 */
    if (a.mode === "work") return false;
    const hit = ALL_POIS.find((p) => p.act === kind);
    if (!hit) return false;
    /* ⛔⛔ **真事件优先于随机摸鱼**（10-05 晚 改）：
       老写法是「在途就拒、正在同一个 POI 也拒」，于是一次随机休息/串门就能把真实派单顶掉
       —— 离线真跑里 m4 连续 **4000 次**被拒（66 秒一次都没派出去）。
       ⇒ 只保留一条拒绝：**已经站在同一个 POI 前**（那才算"已经在做这件事"）；
         其余（在途中 / 在别的 POI / 在喝茶 / 在串门）一律**改派**。 */
    if (a.activity === kind && a.path.length === 0 && a.activityUntil > 0) return false;
    /* ⭐ 站位：同一个物件前能并排站 `POI_SLOTS.length` 个人，**占过的位不再给**
       （⛔ 否则两个人会叠在同一个点上 —— 用户报的"穿模"里最明显的一种）。 */
    const used = new Set(this.agents.filter((x) => x.id !== a.id && x.activity === kind).map((x) => x.poiSlot));
    const slot = POI_SLOTS.findIndex((_, i) => !used.has(i));
    if (slot < 0) return false;   // 站满了 ⇒ 这次就当没派（⛔ 别硬塞一个人进去叠着）
    const target = { x: hit.poi.x + POI_SLOTS[slot], y: hit.poi.y };
    const out = findPath(this.gridTo(a, target), a, target) ?? [];
    if (out.length <= 1) return false;
    // 终点补精确点（路径原生终点是格中心，最多偏 16px ⇒ "没走到跟前"）
    out.push({ x: target.x, y: target.y });
    this.endChat(a.id, true);
    a.onBreak = true;
    /* ⛔ 必须清掉 activityUntil（= 取消"正在某处站着"）：
       否则 step 的 ⓪ 分支会先把它拖满 6 秒、再按**旧**的 homePath 送回家
       ⇒ 新派的任务被静默吞掉（实测：派去接水的人最后站在书架前）。 */
    a.activityUntil = 0;
    a.activity = hit.act;
    a.poiSlot = slot;
    a.bubble = { text: hit.poi.label, until: now + 2600 };
    a.path = out;
    a.homePath = [...out].reverse();
    a.dest = { x: target.x, y: target.y };
    /* ⛔⛔ 绝不能在"出发"就设站立截止（老代码是 `now + 6000`）：
       step 的 ⓪ 分支只看 activityUntil，于是**走了 6 秒还没到就被判成"站完了"拽回家**
       —— 实测从工位去饮水机要约 8-10 秒 ⇒ 这趟出行必然半路中断，人永远到不了。
       ⇒ 站立时长的起点改到**到达那一刻**（见 step 的到达分支）。 */
    a.activityUntil = 0;
    a.tripAt = now;
    a.tripRetried = false;
    return true;
  }

  /**
   * 灌入某成员的**真实事件阶段**（只影响显示器画什么，不驱动移动）。
   *
   * ⛔ 每次同步都整个覆盖，不做"只在新值非 undefined 时写"——
   *   否则阶段结束时（宿主返 null）旧值会**留在 agent 上**，屏面卡在上一状态不动
   *   （与"三布尔"那版同一个坑：状态只进不出）。
   * @param ev.since 该阶段的绝对起始时刻；0/缺省 ⇒ 记当前时刻（首次观测到即开始计时）
   */
  setEventState(memberId: string, ev: {
    phase: RunPhase; since?: number; chars?: number; durationMs?: number;
    event?: OfficeActivityKind | null; eventDetail?: string; eventElapsedMs?: number;
    runId?: string;
  }) {
    const a = this.agents.find((x) => x.id === memberId);
    if (!a) return;
    const changed = a.phase !== ev.phase;
    a.phase = ev.phase;
    a.chars = Math.max(0, Math.floor(ev.chars ?? 0));
    a.durationMs = Math.max(0, Math.floor(ev.durationMs ?? 0));
    /* 事件面整体覆盖（含"变回 null"）—— 同 phase：状态只进不出 =
       屏面卡在上一件事上不动。 */
    a.event = ev.event ?? null;
    a.eventDetail = String(ev.eventDetail ?? "");
    a.eventElapsedMs = Math.max(0, Math.floor(ev.eventElapsedMs ?? 0));
    /* ⭐ 任务派发动画（10-05 晚）：委派 id 一变 ⇒ 说明**有新任务派下来了**。
       ⛔ 用"首次见到"而不是"phase 变 running"当判据 —— 后者在 4Hz 轮询下会重复触发；
         而且 `runId` 是主进程给的**真实委派号**（同一个成员连续两次委派 id 不同）。
       ⭐ 发起方座位固定取 0：两条成员来源都把派发方放在第 0 位
         （专家团 = 主理人；普通会话 = 「我」，见 TeamOfficePreview 的 members 构造）。
       ⚠️ 嵌套委派（子会话再派人）时发起方仍是 0 号位 —— 那是装饰性近似，不影响可读性。 */
    const runId = String(ev.runId ?? "");
    if (runId && runId !== a.runId) {
      a.runId = runId;
      /* ⛔ 派活优先于摸鱼：**先把人从休息/闲聊里拉回工位**，再播派发动画。
         原实现写成"onBreak 时不播"，结果是——正在接水/闲聊的人**收不到任何派发反馈**
         （真机采样 0 次触发），而"派活了"恰恰是最该被看见的一件事。 */
      if (a.onBreak || a.chatWith) this.endChat(a.id, false);
      a.onBreak = false;
      a.activity = null;
      a.activityUntil = 0;
      const seat = SEATS[a.seatIndex];
      if (a.action !== "sit") {
        const back = findPath(this.pathGrid(a.seatIndex), a, seat) ?? [];
        if (back.length > 0) back.push({ x: seat.x, y: seat.y });
        a.path = back;
        a.homePath = [...back];
        a.dest = { x: seat.x, y: seat.y };
        a.tripAt = 0;
      }
      this.dispatchFx.push({ from: 0, to: a.seatIndex, at: Date.now() });
      a.bubble = { text: "收到任务 📋", until: Date.now() + 2200 };
    }
    /* 计时基准只在**阶段变化**时重置：同一阶段内每 250ms 重灌一次，
       若每次都重置 ⇒ 屏面上的秒数永远停在 0（看着像"没反应"）。 */
    if (changed || !a.phaseSince) a.phaseSince = ev.since && ev.since > 0 ? ev.since : (ev.phase === "none" ? 0 : Date.now());
    if (a.phase === "none") { a.phaseSince = 0; a.durationMs = 0; }
  }

  /** 推进。 */
  tick(dtMs: number) {
    const steps = Math.max(1, Math.round(dtMs / 16.6));
    for (const a of this.agents) {
      a.frameClock += (dtMs / 1000) * (a.action === "walk" ? 2.2 : 1);
      if (a.bubble && Date.now() > a.bubble.until) a.bubble = null;
      for (let s = 0; s < steps; s += 1) this.step(a);
    }
    /* ⭐ 防穿模：所有人在动完之后统一分离一次。
       ⛔ 必须放在**所有人 step 之后**（逐人处理会因顺序不同产生偏袒/抖动）。 */
    this.separate();
    this.driveChats();
    const now = Date.now();
    if (this.dispatchFx.length) this.dispatchFx = this.dispatchFx.filter((fx) => now - fx.at < DISPATCH_FX_MS);
  }

  private step(a: Agent) {
    // ⓪ POI 活动站立中：站着不动到点（⛔ 提前 return，别让路径处理把人拽走）
    if (a.activityUntil > 0) {
      if (Date.now() < a.activityUntil) return;
      a.activityUntil = 0;
      a.activity = null;
      /* ⛔ 回工位终点必须**精确到座位像素**——homePath 的终点是「起身时所在格中心」，
         比实测 seat.x 偏 ~8px（10-01 用户实测「第二次坐上去就偏右了」的根因）。 */
      const seat = SEATS[a.seatIndex];
      a.path = [...a.homePath, { x: seat.x, y: seat.y }];
      a.dest = { x: seat.x, y: seat.y };
      return;
    }
    // ① 沿当前路径走（去工位 / 休息走动 / 回工位共用一条 path）
    if (a.path.length > 0) {
      /* ⛔ 卡住自愈（10-05 晚）：被分离力/让行推到路径外之后，直线冲向下一路点可能
         卡死或切角穿桌 ⇒ 连续 1.5 秒没挪窝就按**最终目的地**重新规划一条。 */
      /* ⛔ 出行超时兜底（10-05 晚）：不管什么原因走不到（被挤、被让行困住），
         30 秒后一律收场回工位 —— 否则那人会**永远挂在走路状态**
         ⇒ 后面派给他的任务全被拒（sendTo 要求"不在途"），屏面也永远停在上一件事。 */
      if (a.dest && a.tripAt && Date.now() - a.tripAt > 35000) {
        /* 第一次超时：**先重规划再走一程**（拥挤时"慢慢挪"是常态，一超时就放弃
           会让"派去查资料的人半路回家"——实测 50 秒预算里偶发一次）。
           第二次仍超时 ⇒ 收场回工位，保证不会永久挂在走路状态。 */
        if (!a.tripRetried) {
          a.tripRetried = true;
          a.tripAt = Date.now();
          const retry = findPath(this.gridTo(a, a.dest), a, a.dest) ?? [];
          if (retry.length > 0) { retry.push({ x: a.dest.x, y: a.dest.y }); a.path = retry; }
          return;
        }
        this.endChat(a.id, false);
        a.onBreak = false;
        a.activity = null;
        a.activityUntil = 0;
        a.tripAt = 0;
        a.tripRetried = false;
        const home = SEATS[a.seatIndex];
        const hp = findPath(this.pathGrid(a.seatIndex), a, home) ?? [];
        if (hp.length > 0) hp.push({ x: home.x, y: home.y });
        a.path = hp;
        a.homePath = [...hp];
        a.dest = { x: home.x, y: home.y };
        return;
      }
      if (a.stuck > 90 && a.dest) {
        const repath = findPath(this.gridTo(a, a.dest), a, a.dest) ?? [];
        if (repath.length > 0) { repath.push({ x: a.dest.x, y: a.dest.y }); a.path = repath; }
        a.stuck = 0;
      }
      a.action = "walk";
      const target = a.path[0];
      const dx = target.x - a.x;
      const dy = target.y - a.y;
      const dist = Math.hypot(dx, dy);
      /* ⭐ 拥挤减速（10-05 晚）：身边 34px 内有人时步速减半。
         ⛔ 这是把"分离力追不上接近速度"从**根上**解决的一招：
           两人相向而行时接近速度 = 2×步速（2.7px/帧），而分离力上限 1.6×2 = 3.2
           只勉强压住 ⇒ 采样到 14.4px（看着就是两人叠着走）。
           减半后接近速度 ≤ 1.35 < 3.2，分离力始终有余量。
         物理上也自然：走廊里有人，谁都会放慢。 */
      const crowded = this.agents.some((b) => b.id !== a.id && Math.hypot(a.x - b.x, (a.y - b.y) * 0.8) < 26);
      const spd = crowded ? WALK_SPEED * 0.5 : WALK_SPEED;
      if (dist <= spd) {
        a.x = target.x;
        a.y = target.y;
        a.path.shift();
        if (a.path.length === 0) {
          // 走完了：五种归宿
          /* ⭐ 串门到位（10-05 晚）：站住聊，**不许**落进下面的"休息走动完毕 ⇒ 回工位"
             —— 那会让刚走到的人立刻掉头，两人永远碰不上（chats 永远停在走路阶段）。 */
          if (a.chatWith) {
            a.action = "stand";
            // ⛔ onBreak 保持 true：step() ② 会因此提前 return，人不会自己走开
          } else if (!a.onBreak) {
            // 回工位 ⇒ 坐下（⛔ 同步清活动——mode 变 work 的沿已清，这里兜住 idle 直接坐）
            a.action = "sit";
            a.activity = null;
          } else if (a.activity) {
            // 到了饮水机 / 书架：**面朝物件**站一会儿（⭐ 站位对着物件，⛔ 不再侧身）
            a.action = "stand";
            a.facing = 1;          // 朝上 = 面向书架/饮水机所在的北墙
            a.flip = false;
            a.bubble = { text: a.activity === "water" ? WATER_POI.label : BOOK_POI.label, until: Date.now() + 2800 };
            // ⭐ 站立计时**从到达开始**（⛔ 在出发时设会被半路中断，见 sendTo 注释）
            a.activityUntil = Date.now() + 3000;
            a.tripAt = 0;
          } else {
            // 休息走动完毕：站一会儿再回去
            a.action = "stand";
            a.onBreak = false;
            a.breakCooldown = 3000 + Math.floor(Math.random() * 4800);   // 50~130 秒（拉长）
            const seat = SEATS[a.seatIndex];
            a.path = [...a.homePath, { x: seat.x, y: seat.y }];
            a.dest = { x: seat.x, y: seat.y };
          }
        }
      } else {
        const nx = a.x + (dx / dist) * spd;
        const ny = a.y + (dy / dist) * spd;
        /* ⭐ 防穿模第一道（10-05 晚）：**不往"不动的人"身上走**。
           ⛔ 只挡坐着/站着的（他们永远不会让开 ⇒ 不挡就必然穿模）；
             两个都在走的人**不互相挡** —— 那是死锁（走廊里一对一顶死），交给分离力错身。 */
        /* ⛔ 两条让行判据合并计数：
           ① 不往不动的人身上走（⛔ 只挡坐着/站着的，两个走路的互相挡会死锁）；
           ② 目标格不能被挡（被分离力推离路径后，直线冲下一路点会**切角穿桌** ——
              实测采样到人在桌面格里：`(535,275) 格(16,8)` 就是 2 号桌）。
           两种都算这一帧没挪窝 ⇒ 交给上面的卡住自愈。 */
        if (this.cellFree(nx, ny, a.seatIndex) && !this.peerAhead(a, nx, ny, dx, dy)) {
          a.x = nx;
          a.y = ny;
          a.stuck = 0;
        } else {
          /* ⛔ 侧移绕行（10-05 晚）：被堵住时**必须能绕**，不能原地干等 ——
             实测：座位行（格 14）是 BFS 最短路的一部分，而坐着的人就在那一行上，
             直线走不通 ⇒ 走路的人永远卡在工位附近（派去接水的人一直没离开座位）。
             俯视图里"往上/往下让一步"最自然；奇偶座位定先后，避免所有人同一侧绕。
             ⛔ 这一步既不能进阻挡格，也不能撞人，两者都验。 */
          const sideOrder = a.seatIndex % 2 === 0 ? [1, -1] : [-1, 1];
          let moved = false;
          for (const s of sideOrder) {
            const sx = a.x;
            const sy = a.y + s * spd;
            if (this.cellFree(sx, sy, a.seatIndex) && !this.peerAhead(a, sx, sy, 0, s)) { a.x = sx; a.y = sy; moved = true; break; }
          }
          if (moved) a.stuck = 0;
          else a.stuck += 1;
        }
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
      /* ⭐ 10-05 晚 用户要求「卡通人物闲逛概率降低一点」：
         到点**先掷一次"这次不动"**（45%）—— 到点 ≠ 一定起身，否则看起来像一直在溜达。
         ⛔ 「有工作就不要闲逛」这条由**上面那行 `if (a.mode === "work" ...) return`** 保证：
           在跑的成员根本进不到这里（另外 sendTo 也拒收在跑的成员，两道一起）。 */
      if (Math.random() < 0.45) {
        a.breakCooldown = 1800 + Math.floor(Math.random() * 3000);   // 30~80 秒后再掷
        return;
      }
      a.onBreak = true;
      const roll = Math.random();
      if (roll < 0.18) {
        // 原地喝茶（不起身）：手部动画切举杯（Canvas 按 activity==="tea" 渲染）
        a.activity = "tea";
        a.activityUntil = Date.now() + 2800;
        a.bubble = { text: "喝口水 ☕", until: Date.now() + 2600 };
        a.breakCooldown = 3000 + Math.floor(Math.random() * 4800);
        return;
      }
      if (roll < 0.38) {
        // ⭐ 串门闲聊（10-05 晚 用户要求「成员之间互相沟通与闲聊」）
        if (this.startChat(a)) return;
      }
      /* 去饮水机 / 书架：**统一走 `sendTo`** —— 站位（并排槽位）、面朝物件、
         到达后站立计时、出行超时兜底全在那一处，⛔ 别在这里再抄一份
         （抄一份的下场：两头修一头，另一头慢慢漂）。 */
      const want = roll < 0.60 ? "water" : roll < 0.80 ? "book" : null;
      if (want && this.sendTo(a.id, want)) return;
      // 否则：在工位附近走一小圈（不出远门）
      const target = this.randomFloorPointNear(a);
      const out = findPath(this.gridTo(a, target), a, target) ?? [];
      if (out.length > 1) {
        a.path = out;
        a.homePath = [...out].reverse();
        a.dest = { x: target.x, y: target.y };
        a.tripAt = Date.now();
        a.tripRetried = false;
      } else {
        a.onBreak = false;
        a.breakCooldown = 900;
      }
    }
  }

  /* ─────────────────────────────────────────────────────────────────────
   * ⭐ 防穿模（10-05 晚，用户报「卡通人物行走时穿模」）
   *
   * ⛔ 病根有两个，**都要治**：
   *   ① 两个人都按 BFS 格心走 ⇒ 同一条走廊上会**完全重叠**（画面上是一个人）；
   *   ② POI 只有一个固定站立点 ⇒ 先后去接水的人**叠在同一个像素点**上。
   *      ② 已由 `POI_SLOTS`（并排站位）解决；① 由这里的**软分离**解决。
   *
   * ⚠️ 三条纪律（缺一条就会变成"人被挤到墙里/被从椅子上挤走"）：
   *   · 坐着的人**不动**（坐姿锚点依赖 seat.x，被推走 = 整个人错位）；
   *   · 推开后如果落到**阻挡格**或**越界**，这一次分离作废（回退）；
   *   · 分离幅度**每帧有上限**（0.6px）—— 否则会看到"弹开"的瞬移。
   * ───────────────────────────────────────────────────────────────────── */
  private separate() {
    const list = this.agents;
    /* ⛔ 上限定 1.6px/帧：两个相向而行的人**相对**接近速度可达 2.7px/帧，
       分离上限低于它的一半（1.35）就永远追不上 ⇒ 会看到两人叠在一起走（实测 2.5px）。 */
    const LIMIT = 1.6;
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        const dx = b.x - a.x;
        const dy = (b.y - a.y) * 0.8;     // 纵向权重小一点：俯视图里上下相邻本来就会重叠
        const dist = Math.hypot(dx, dy);
        if (dist >= MIN_GAP) continue;
        const canA = a.action !== "sit";
        const canB = b.action !== "sit";
        if (!canA && !canB) continue;
        const push = Math.min(LIMIT, (MIN_GAP - dist) / 2);
        const ux = dist > 0.01 ? dx / dist : 1;
        const uy = dist > 0.01 ? dy / dist : 0;
        /* ⛔ 正面相遇时"推开"是沿运动轴的 ⇒ 两人会顶住不动。加一个**垂直分量**
           （方向由 id 比较决定，保证同 pair 每帧一致、不会左右抖）让他们错身而过。 */
        const side = a.id < b.id ? 1 : -1;
        const px = -uy * side * 0.7;
        const py = ux * side * 0.7;
        /* ⛔⛔ 推力**必须不对称**（10-05 晚 实测踩死一次）：两边各推 50% 时，
           推力上限（1.6×2 = 3.2px/帧）**大于步速**（1.35px/帧）⇒ 门口挤在一起的
           六个人互相顶住，20 秒模拟后还全在门口原地打转（路径长度纹丝不动）。
           ⇒ 按 id 定一个**稳定优先级**：小 id 基本不让（0.15），大 id 让路（0.85）。
             总和仍是 1（分离总量不变），但领头的能走出去，队就疏开了。 */
        const wA = canA && canB ? (a.id < b.id ? 0.15 : 0.85) : canA ? 1 : 0;
        const wB = canA && canB ? (b.id < a.id ? 0.15 : 0.85) : canB ? 1 : 0;
        if (wA > 0) this.nudge(a, -(ux + px) * push * wA * 2, -((uy + py) * push * wA * 2) / 0.8);
        if (wB > 0) this.nudge(b, (ux + px) * push * wB * 2, ((uy + py) * push * wB * 2) / 0.8);
      }
    }
  }

  /** 试探性位移：⛔ 主方向被墙/桌挡住时退化为**单轴**位移 ——
      否则人贴着桌子时就推不动，两个人会一直叠着走（真机采样到 2.5px）。 */
  private nudge(target: Agent, dx: number, dy: number) {
    /* ⛔ 分离用 `cellFree`（**不留边距**）而不是 `walkable`：
       `walkable` 要求距格边 ≥6px（那是给"站立点"用的，防身体半嵌进墙），
       但拿它当分离判据 ⇒ 人一贴到格边就再也推不动，对面的人直接走进来
       （实测最近距离 2px、采样出 `(312,186) × (314,186)` 两个重叠的走路人）。 */
    if (this.cellFree(target.x + dx, target.y + dy, target.seatIndex)) { target.x += dx; target.y += dy; return; }
    if (this.cellFree(target.x + dx, target.y, target.seatIndex)) { target.x += dx; return; }
    if (this.cellFree(target.x, target.y + dy, target.seatIndex)) { target.y += dy; }
  }

  /** 该点是否在**非阻挡格**内（无内部边距 —— 分离/移动用；⛔ 别拿它当站立点判据）。
   *  ⛔⛔ 第三参 = 调用者的座位号：**别人的座位格一律算挡**。
   *     为什么必须这么判（10-05 晚 实测）：座位格上永远坐着人，而"不往坐着的人身上走"
   *     只在**将要进入**那一下判一次，被分离力/侧移推着走的时候拦不住 ⇒
   *     真机采样到走路的人**站进了别人的座位格**（m3 walk「489,290」压在
   *     m2 sit「490,300」上，前后距离 8px = 穿模）。⇒ 改成**结构上就进不去**。 */
  private cellFree(x: number, y: number, forSeat = -1): boolean {
    const c = Math.floor(x / TILE);
    const r = Math.floor(y / TILE);
    if (c < 0 || r < 0 || c >= GRID_COLS || r >= GRID_ROWS) return false;
    if (this.grid[r * GRID_COLS + c] === 1) return false;
    for (let i = 0; i < SEATS.length; i += 1) {
      if (i === forSeat) continue;
      const seat = SEATS[i];
      if (Math.floor(seat.y / TILE) === r && Math.floor(seat.x / TILE) === c) return false;
    }
    return true;
  }

  /**
   * 寻路用网格：把**六个座位格**也标成阻挡。
   *
   * ⛔⛔ 为什么必须这样（10-05 晚 实测踩死一次）：座位行（上排格 9 / 下排格 14）天然是
   *   BFS 从房间这头到那头的**最短路径的一部分**，而座椅上永远坐着人 ⇒
   *   走路的人一路被"不往坐着的人身上走"挡住，只能靠侧移慢慢蹭 ——
   *   实测「派去接水的人在 50 秒后只走了 1/3 路程」。
   *   ⇒ 让**寻路**从一开始就绕开座位格（座椅本来就不该当走廊），
   *     只有"回自己工位"那一趟才把自己的座位放开。
   * ⛔ `cellFree`（分离/让行用）仍按**真实可走性**判 —— 两套网格用途不同，别混。
   */
  private pathGrids = new Map<number, Uint8Array>();
  private pathGrid(openSeat: number): Uint8Array {
    const cached = this.pathGrids.get(openSeat);
    if (cached) return cached;
    const g = new Uint8Array(this.grid);
    for (let i = 0; i < SEATS.length; i += 1) {
      const seat = SEATS[i];
      const idx = Math.floor(seat.y / TILE) * GRID_COLS + Math.floor(seat.x / TILE);
      g[idx] = i === openSeat ? 0 : 1;
    }
    this.pathGrids.set(openSeat, g);
    return g;
  }

  /** 去某点的寻路网格：目的地是**自己的座位** ⇒ 放开自己的座位格；否则一律绕开座位。 */
  private gridTo(a: Agent, dest: Pt): Uint8Array {
    const seat = SEATS[a.seatIndex];
    const own = Math.abs(dest.x - seat.x) < 2 && Math.abs(dest.y - seat.y) < 2;
    return this.pathGrid(own ? a.seatIndex : -1);
  }

  /**
   * 目标点上是否"有人挡着"。
   *
   * ⛔ 三类人的处理**刻意不同**（每一类都对应一次实测踩坑）：
   *   · 坐着的人（`sit`）：占位最大（椅子 + 桌沿），半径给到 `MIN_GAP*0.8`；
   *   · 站着的人（`stand`）：只挡贴身那一点，半径 16px；
   *   · **走路的人**：⚠️ 必须也挡，但**只让 id 大的一方让** ——
   *     两边都不挡 ⇒ 六个人从门口一个格子里挤出去时全叠成一条线
   *     （实测最近距离 15.6px，`(163,588) × (162,608)` 同一个格子）；
   *     两边都挡 ⇒ 走廊里一对一顶死。⇒ 用 id 定优先级：小 id **永不让**，
   *     所以队一定会疏开；大 id 等小 id 走远 26px 再走。
   */
  private peerAhead(a: Agent, nx: number, ny: number, mdx = 0, mdy = 0): boolean {
    for (const b of this.agents) {
      if (b.id === a.id) continue;
      const d = Math.hypot(nx - b.x, (ny - b.y) * 0.8);
      if (b.action === "walk") {
        /* ⛔ 走路的同伴只在**他挡在我前进方向上**时才让：
           判据 = 位移向量与"我到对方"向量的点积 > 0（在正前方）。
           ⛔⛔ 不能用"离得近就让"（第一版就是这么写的）：那样**谁在前谁在后都让**，
             从后面追上去的人不算"在正前方"⇒ 他照直撞上去（实测 18.3px），
             而两人面对面时又互相让 ⇒ 顶死。⇒ 前后关系 + id 定优先级，两头都解。 */
        const fx = b.x - a.x;
        const fy = b.y - a.y;
        const aheadOfMe = mdx * fx + mdy * fy > 0;
        if (!aheadOfMe) continue;
        const peerAheadOfMe = (-mdx) * -fx + (-mdy) * -fy > 0;   // 对称：我也在他前方（面对面）
        if (peerAheadOfMe && a.id < b.id) continue;               // 面对面对冲时小 id 先走
        /* 跟车距离：22（判据是**压缩后**的度量，22 ≈ 实际纵向 27px）——
           ⛔ 别再加到 30：走廊里前后一排队就成串，长途出行会被无限拖慢（实测 50 秒到不了）。 */
        if (d < 22) return true;
        continue;
      }
      /* 坐着的人：寻路已经绕开座位格 ⇒ 这里只需要挡"贴身"（20），不用挡住整条走廊
         （挡太宽会让走路的人被卡在工位附近 —— 实测 50 秒才走 1/3 路程）。
         ⛔⛔ **站着的人（含闲聊的一对）一律不挡**：单格宽的过道（如格 11，两侧都是桌子）
           没有侧移空间 ⇒ 挡了就永久卡死（实测 m4 在过道里 66 秒没挪窝、派单全部失败）。
           交给分离力错身：站着的人会被挤开一点，两人擦过去，不会叠住。 */
      if (b.action === "sit" && d < 20) return true;
    }
    return false;
  }

  /** 该点是否落在可走格内（留 8px 边距，避免身体半嵌进墙）。 */
  private walkable(x: number, y: number): boolean {
    const c = Math.floor(x / TILE);
    const r = Math.floor(y / TILE);
    if (c < 0 || r < 0 || c >= GRID_COLS || r >= GRID_ROWS) return false;
    if (this.grid[r * GRID_COLS + c] === 1) return false;
    const localX = x - c * TILE;
    const localY = y - r * TILE;
    if (localX < 6 || localX > TILE - 6 || localY < 6 || localY > TILE - 6) return false;
    return true;
  }

  /* ─────────────────────────────────────────────────────────────────────
   * ⭐ 串门闲聊（10-05 晚，用户要求「为成员之间增加互相沟通与闲聊功能」）
   *
   * 规则（都是"空闲时才发生"，⛔ 不在干活的人身上演）：
   *   · 发起人：刚结束一段休息冷却的 idle 成员，且自己没在忙/没在聊；
   *   · 对象：另一个 idle、坐着、不在路上、不在聊的成员（⛔ 不打扰在跑的成员）；
   *   · 走过去 → 站在**对方旁边的可走格**、转身面对对方 → 轮流冒气泡（`CHAT_MS`）→ 各自回工位。
   * ⛔ 台词是**纯装饰**（用户要的休闲表现），⛔ 不引用真实任务内容、不报任何数字。
   * ───────────────────────────────────────────────────────────────────── */
  private startChat(a: Agent): boolean {
    const partner = this.agents.find((b) => b.id !== a.id
      && b.mode === "idle" && b.action === "sit" && !b.onBreak && !b.chatWith && b.path.length === 0);
    if (!partner) return false;
    const spot = this.spotNear(partner);
    if (!spot) return false;
    const out = findPath(this.pathGrid(-1), a, spot) ?? [];
    if (out.length <= 1) return false;
    out.push({ x: spot.x, y: spot.y });
    a.onBreak = true;
    a.activity = null;
    a.bubble = { text: "过去聊两句 💬", until: Date.now() + 2200 };
    a.path = out;
    a.homePath = [...out].reverse();
    a.dest = { x: spot.x, y: spot.y };
    a.tripAt = Date.now();
    a.tripRetried = false;
    // 双方都记上：到了之后由 driveChats 轮流发台词
    a.chatWith = partner.id;
    a.chatAt = 0;
    a.chatHost = true;
    partner.chatWith = a.id;
    partner.chatAt = 0;
    partner.chatHost = false;
    return true;
  }

  /** 对方身边的可走站立点（优先左右两侧 —— 那才是走廊，⛔ 别站到桌子上）。 */
  private spotNear(other: Agent): Pt | null {
    const offsets: Pt[] = [{ x: 34, y: 4 }, { x: -34, y: 4 }, { x: 4, y: 30 }, { x: 4, y: -30 }];
    for (const off of offsets) {
      const x = other.x + off.x;
      const y = other.y + off.y;
      if (this.walkable(x, y)) return { x, y };
    }
    return null;
  }

  /** 闲聊推进：到了就轮流冒气泡；到点各自散场。 */
  private driveChats() {
    const now = Date.now();
    for (const a of this.agents) {
      if (!a.chatWith) continue;
      const partner = this.agents.find((b) => b.id === a.chatWith);
      if (!partner || !partner.chatWith) { this.endChat(a.id, true); continue; }
      /* 到位后才转身面对对方（在途时方向由走路逻辑管，⛔ 别在这儿改） */
      if (a.path.length === 0) {
        if (a.action === "walk") a.action = "stand";
        if (a.x < partner.x) { a.facing = 2; a.flip = false; }
        else if (a.x > partner.x) { a.facing = 2; a.flip = true; }
        else { a.facing = 0; a.flip = false; }
      }
      /* ⛔⛔ **只由发起人（chatHost）主持整场对话**：
         被访者一坐下就自己开始计时的话，7 秒后它会先把聊天判成"聊完了"
         —— 而发起人可能还在往过走的路上（实测两人永远聊不上）；
         而且两边各自驱动会各说各的（同一时刻两条气泡、台词对不上）。
         ⛔ 没到位不计时：把 chatAt 清 0，等**站住那一刻**再起算。 */
      if (!a.chatHost) continue;
      if (a.path.length > 0) { a.chatAt = 0; continue; }
      if (!a.chatAt) a.chatAt = now;
      if (now - a.chatAt > CHAT_MS) { this.endChat(a.id, true); continue; }
      const idx = Math.floor((now - a.chatAt) / CHAT_LINE_MS);
      const line = CHAT_LINES[idx % CHAT_LINES.length];
      const until = a.chatAt + (idx + 1) * CHAT_LINE_MS;
      a.bubble = { text: line[0], until };
      partner.bubble = { text: line[1], until };
    }
  }

  /** 结束闲聊（`home` = 让对方走回工位；否则只断关系、位置不动）。 */
  private endChat(id: string, home: boolean) {
    const a = this.agents.find((x) => x.id === id);
    if (!a) return;
    const partner = a.chatWith ? this.agents.find((x) => x.id === a.chatWith) : null;
    a.chatWith = null;
    a.chatAt = 0;
    a.chatHost = false;
    if (partner && partner.chatWith === id) {
      partner.chatWith = null;
      partner.chatAt = 0;
      partner.chatHost = false;
      if (partner.bubble) partner.bubble = null;
      if (home && partner.action !== "sit" && !partner.path.length) {
        partner.onBreak = false;
        const seat = SEATS[partner.seatIndex];
        const back = findPath(this.pathGrid(partner.seatIndex), partner, seat) ?? [];
        if (back.length > 0) back.push({ x: seat.x, y: seat.y });
        partner.path = back;
        partner.homePath = [...back];
        partner.dest = { x: seat.x, y: seat.y };
      }
    }
    if (home && a.action !== "sit" && !a.path.length) {
      a.onBreak = false;
      const seat = SEATS[a.seatIndex];
      const back = findPath(this.pathGrid(a.seatIndex), a, seat) ?? [];
      if (back.length > 0) back.push({ x: seat.x, y: seat.y });
      a.path = back;
      a.homePath = [...back];
      a.dest = { x: seat.x, y: seat.y };
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
