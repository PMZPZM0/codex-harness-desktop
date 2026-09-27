/**
 * PixiJS 渲染层（team-office 域 09-27 v10「角色 = 黑色动物剪影」）。
 *
 * ⛔ v10 为什么又改（用户 09-27：「看看这种布局效果」「每个角色都是不同的动物」）：
 *    ① **构图**照参考 —— 镜头在工位正前方略高，自远而近 = 显示器 → 桌 → 人 → 椅子；
 *       椅子必须在人物**之后**画（zIndex 更大），椅背正好挡住角色下半身。
 *    ② **角色**照参考 —— 纯黑**动物剪影**（无描边、无五官）+ 脖子一圈饱和彩项圈；
 *       每个成员一个**不同的物种**（猫 / 狐狸 / 狗 / 兔 / 熊 / 熊猫 / 考拉 / 鼠 / 鹿 / 刺猬 / 猪，
 *       CEO 是狮子），物种靠耳朵外形认、个体靠项圈色认。
 *
 * ⛔ 深度用 zIndex，不靠「图层先后」：世界层 sortableChildren = true，每个对象按
 *     **地面基线 y** 排序 ⇒ 桌子、椅子、人、走动的人前后关系自动正确。
 *
 * ⛔ 姿势变化才重建人物、同一姿势**不重建** —— 重建会把动画相位打回随机起点，
 *     表现成「打字打着突然跳一下」。
 *
 * ⛔ 域组件收显式 props（规则第 4 条，禁收 app / 禁深链 useHarnessApp）。
 * ⛔ 类名是接口：accept.mjs 的 CDP 选择器依赖 DOM 类名，不可改（.office-scene）。
 */
import { useEffect, useRef, useState } from "react";
// ⛔ 顺序要紧：`pixi.js/unsafe-eval` 装的是**不用 eval 的 polyfill**（并关掉 Pixi 的
//    "环境不支持 unsafe-eval" 抛错检查）。本应用的 CSP 是 `script-src 'self' 'unsafe-inline'`
//    （index.html 里有意收紧，见那段注释）⇒ 不引这一行，Pixi 初始化即抛
//    「Current environment does not allow unsafe-eval」：画布挂进 DOM 却什么都不画（09-27 实测）。
//    ⛔ 名字有误导性：它是「在没有 unsafe-eval 的环境里跑」的入口，不是「启用 eval」。
import "pixi.js/unsafe-eval";
import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import {
  OFC, SILHOUETTE,
  animalOf, collarColor, collarDark, type AnimalKind,
} from "./office-palette";
import { deskSlots, floorPoint, SCENE_W, SCENE_H, type FloorSpot } from "./office-iso";
import type { DirectorSnapshot, OfficePose, OfficeHandoff, ErrandSpot } from "./office-director";
import type { OfficeMember } from "./OfficeScene";

import {
  drawRoom as paintRoom, drawBackWall, drawSideProps, drawDeskStation, drawChair,
  drawAmenities, screenKindOf, softShadow, CHAIR_DV, DESK_DV, type PropTicker,
} from "./office-render";

/**
 * 人物整体缩放。⛔ 与工位几何是一组：把人放大会让耳朵顶到显示器上、
 *    椅子盖不住下半身（两侧都实测过），改这里必须同时看 SEAT_LIFT。
 */
const PERSON_K = 0.76;
/** 人物容器相对座位地面点的抬升（屏幕像素，再乘纵深缩放）。 */
const SEAT_LIFT = 56;
/**
 * 头顶标签的抬升（屏幕像素，再乘纵深缩放）。⛔ 这个值被两件事同时夹住（改前先算）：
 *   **下限** = 角色耳朵顶（最高的狐狸约在座面点上方 129k）；**上限** = 显示器下沿（154.8k）。
 *   标签高 19 ⇒ 抬 145 刚好落在中间：下缘 135.5k（离耳尖 6k）、上缘 154.5k（离屏沿 0.3k）。
 *   调低会被耳朵戳穿（v10 第二版实测），调高会压住屏幕。
 */
const TAG_LIFT = 145;
/** 交接锚点：卡片在两人**头侧**飞。⛔ 别取头顶正中 —— 起点标记会正好盖在脑袋上，
 *  放大看像头顶长了个包（v10 实测）。锚点高度取头位（在耳顶与头顶之间）。 */
const HANDOFF_LIFT = 96;
const HANDOFF_SIDE = 38;

const HANDOFF_TINT: Record<OfficeHandoff["kind"], number> = {
  task: 0xdbeafe,
  report: 0xd9f3e3,
  doc: 0xfff0d0,
  chat: 0xeee0fb,
};

/**
 * 跑腿目的地（地面归一化坐标）：**设施锚点**。
 * ⛔ 必须与 office-render.drawAmenities 里画设施的那组坐标**逐字同源** ——
 *    「去接水」的人要真的站在饮水机旁。改一处必须同时改另一处。
 */
const ERRAND_SPOT_UV: Record<ErrandSpot, { u: number; v: number }> = {
  water: { u: 0.955, v: 0.62 },    // 饮水机
  printer: { u: 0.90, v: 0.13 },   // 打印机
  shelf: { u: 0.055, v: 0.21 },    // 资料架
  restroom: { u: 0.055, v: 0.90 }, // 卫生间隔间
};

/** 小人**站**的位置：设施锚点往观众侧挪一点（站进设施里穿帮，站在设施前才对）。 */
const ERRAND_STAND_UV: Record<ErrandSpot, { u: number; v: number }> = {
  water: { u: 0.90, v: 0.68 },
  printer: { u: 0.82, v: 0.20 },
  shelf: { u: 0.08, v: 0.30 },
  restroom: { u: 0.10, v: 0.96 },
};

/** 角色身份：物种（外形）+ 项圈色（颜色）—— ⛔ 两者都由序号稳定派生，不是每拍随机。 */
type Cosplay = { animal: AnimalKind; collar: string };

type Slot = FloorSpot & { u: number; v: number } & {
  key: string;
  /** 稳定序号（0 = CEO）—— 屏幕内容变体也按它派生 */
  idx: number;
  name: string;
  profession: string;
  running: boolean;
  hasThread: boolean;
  pose: OfficePose | null;
  isCeo: boolean;
  memberId: string | null;
  cosplay: Cosplay;
};

/** 落座人物的可动画部件（重建只在姿势/朝向变化时发生）。 */
interface SeatedParts {
  body: Container;
  armBack: Graphics;
  armFront: Graphics;
  headwrap: Container;
  /** 左右耳各一支（pivot 在耳根）—— 动画层做"单边抽动"的抓手 */
  ears: Graphics[];
  /** 打盹时头顶浮起的 z（平时不可见） */
  doze: Container;
  pose: OfficePose;
}

/** 工位视图：容器 + 当前内容签名 + 动画相位（相位跨重建保留，动画才连贯）。 */
interface SeatView {
  container: Container;
  sig: string;
  parts: SeatedParts | null;
  clock: number;
}

/** 走动小人：位置由 ticker 在「工位 ↔ 目标」之间按帧插值，⛔ 不是瞬移。 */
interface WalkerParts {
  container: Container;
  body: Container;
  legBack: Graphics;
  legFront: Graphics;
  armBack: Graphics;
  armFront: Graphics;
  headwrap: Container;
  /** 左右耳（pivot 在耳根）—— 走路时耳朵跟着颠 */
  ears: Graphics[];
  /** 0 = 还在工位，1 = 已走到目标 */
  t: number;
  from: { x: number; y: number; scale: number };
  to: { x: number; y: number; scale: number };
  clock: number;
}

interface TagView {
  container: Container;
  sig: string;
}

interface HandoffView {
  container: Container;
  card: Container;
  pulse: Graphics;
  sig: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  t: number;
  clock: number;
}

interface SceneRefs {
  statics: Map<string, Container[]>;
  staticsKey: string;
  seats: Map<string, SeatView>;
  walkers: Map<string, WalkerParts>;
  tags: Map<string, TagView>;
  handoffs: Map<string, HandoffView>;
  /** 设施动画部件（饮水机水泡 / 打印机吐纸 / 挂钟走针 / 隔间指示灯 / 咖啡蒸汽） */
  props: PropTicker[];
  /** 每台显示器的屏幕动画（⛔ 工位重建时整批换掉，别和 props 混在一个数组里） */
  screens: PropTicker[];
  clock: number;
}

function emptyScene(): SceneRefs {
  return { statics: new Map(), staticsKey: "", seats: new Map(), walkers: new Map(), tags: new Map(), handoffs: new Map(), props: [], screens: [], clock: 0 };
}

export type OfficeCanvasProps = {
  ceoName: string;
  ceoProfession: string;
  members: OfficeMember[];
  snapshot: DirectorSnapshot;
  onOpenThread?: (memberId: string) => void;
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** 起步慢、中段快、落位慢（线性平移看着像滑轨，不像走路）。 */
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function OfficeCanvas({ ceoName, ceoProfession, members, snapshot, onOpenThread }: OfficeCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const sceneRef = useRef<SceneRefs>(emptyScene());
  const layersRef = useRef<{ world: Container; tags: Container; handoffs: Container } | null>(null);
  const openThreadRef = useRef(onOpenThread);
  openThreadRef.current = onOpenThread;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = sceneRef.current;
    const app = new Application();
    appRef.current = app;
    let cleaned = false;
    let inited = false;

    const tick = (ticker: { deltaTime: number }) => {
      animateScene(scene, ticker.deltaTime);
    };

    const setup = async () => {
      await app.init({
        width: SCENE_W,
        height: SCENE_H,
        background: 0xf7f8fa,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });
      if (cleaned) {
        try { app.destroy(true, { children: true, texture: true }); } catch { /* 已卸载 */ }
        return;
      }
      inited = true;

      host.appendChild(app.canvas);
      app.canvas.style.width = "100%";
      app.canvas.style.height = "auto";
      app.canvas.style.display = "block";

      const world = new Container();
      world.sortableChildren = true;
      const tags = new Container();
      tags.eventMode = "none";
      const handoffs = new Container();
      handoffs.eventMode = "none";

      app.stage.addChild(world, tags, handoffs);
      layersRef.current = { world, tags, handoffs };

      // 程序化绘制（⛔ 零贴图：参考项目的 3D 素材有版权标注，我们只复刻风格）
      paintRoom(world);
      drawBackWall(world);
      drawSideProps(world);
      scene.props = drawAmenities(world);
      app.ticker.add(tick);
      setReady(true);
    };

    void setup();

    return () => {
      cleaned = true;
      if (inited) {
        try { app.ticker.remove(tick); } catch { /* ticker 已停 */ }
        try { app.destroy(true, { children: true, texture: true }); } catch { /* 已销毁 */ }
      }
      appRef.current = null;
      layersRef.current = null;
      sceneRef.current = emptyScene();
    };
  }, []);

  useEffect(() => {
    const layers = layersRef.current;
    if (!ready || !layers) return;

    const slots = buildSlots(ceoName, ceoProfession, members, snapshot);
    syncStatics(layers.world, slots, sceneRef.current);
    syncPeople(layers.world, slots, sceneRef.current, openThreadRef);
    syncTags(layers.tags, slots, sceneRef.current);
    syncHandoffs(layers.handoffs, slots, snapshot, sceneRef.current);
  }, [ready, ceoName, ceoProfession, members, snapshot]);

  return <div ref={hostRef} className="office-scene" />;
}

/* ── 工位与人物 ─────────────────────────────────────────────────────────── */

function buildSlots(
  ceoName: string,
  ceoProfession: string,
  members: OfficeMember[],
  snapshot: DirectorSnapshot,
): Slot[] {
  const total = members.length + 1;
  const geo = deskSlots(total);
  const out: Slot[] = [];
  out.push({
    ...geo[0],
    key: "ceo",
    idx: 0,
    name: ceoName || "CEO",
    profession: ceoProfession || "统筹",
    running: members.some((m) => m.running),
    hasThread: true,
    pose: snapshot.ceo,
    isCeo: true,
    memberId: null,
    cosplay: { animal: animalOf(0, true), collar: collarColor(0, true) },
  });
  members.forEach((member, i) => {
    const g = geo[i + 1];
    if (!g) return;
    out.push({
      ...g,
      key: member.id,
      /** 只给屏幕内容变体用（1..n，与物种池的序号是两套独立编号，别混用） */
      idx: i + 1,
      name: member.name || "员工",
      profession: member.profession || "通用",
      running: member.running,
      hasThread: member.hasThread,
      pose: member.hasThread ? snapshot.poses[i] ?? null : null,
      isCeo: false,
      memberId: member.id,
      // ⛔ 序号从 **0** 起（不是 i + 1）：物种池是 [cat, fox, …]，从 1 起会让**猫永远轮不到**
      //    （≤10 人的团队里第一种动物根本不出场）。CEO 走 isCeo 分支，不占用池子。
      cosplay: { animal: animalOf(i), collar: collarColor(i) },
    });
  });
  return out;
}

/**
 * 每个工位画**两件**静态家具，各自按自己的地面基线排序（sortableChildren 自动排前后）：
 *   · 桌子组（桌 + 显示器 + 侧柜）—— 在人物**之前**（人的头肩要叠在桌面上）
 *   · 椅子组 —— 在人物**之后**（椅背挡住角色下半身，只留头 / 项圈 / 爪子）
 * ⛔ 合成一件就会丢掉这个顺序：要么人被桌子挡住只露头顶，要么椅子被整个人盖住（两版都实测过）。
 */
function syncStatics(world: Container, slots: Slot[], scene: SceneRefs) {
  // ⛔ key 必须覆盖**屏幕内容的全部输入**：成员序号（决定显示代码/表格/图表…）、运行态、是否打盹。
  //    漏掉 running 的后果实测过：成员从「空闲」变成「工作中」，显示器还停在空闲时的画面
  //    （syncStatics 提前 return，永不重画）。
  const key = slots
    .map((s) => `${s.key}@${s.x.toFixed(1)},${s.y.toFixed(1)}:${s.idx}:${s.running ? 1 : 0}:${s.pose?.kind === "doze" ? 1 : 0}`)
    .join("|");
  if (key === scene.staticsKey) return;
  scene.staticsKey = key;
  for (const groups of scene.statics.values()) {
    for (const g of groups) {
      world.removeChild(g);
      g.destroy({ children: true });
    }
  }
  scene.statics.clear();
  scene.screens = [];

  for (const slot of slots) {
    const screen = screenKindOf(slot.idx, slot.running, slot.pose?.kind === "doze");

    const desk = new Graphics();
    const deskBox = new Container();
    // 桌面占地的**中心**地面 y —— 比人物容器更小 = 更靠后
    deskBox.zIndex = floorPoint(slot.u, slot.v - DESK_DV / 2).y;
    // ⛔ 桌子先挂进 box，再让 drawDeskStation 把"会动的屏幕"挂上去 —— 顺序反了屏幕会被外壳盖住
    deskBox.addChild(desk);
    const screenAnim = drawDeskStation(desk, slot.u, slot.v, screen, deskBox);
    if (screenAnim) scene.screens.push(screenAnim);

    const chair = new Graphics();
    drawChair(chair, slot.u, slot.v);
    const chairBox = new Container();
    // 椅子的地面 y 比座位点更靠观众 ⇒ 自动排在人物之后
    chairBox.zIndex = floorPoint(slot.u, slot.v + CHAIR_DV).y;
    chairBox.addChild(chair);

    world.addChild(deskBox, chairBox);
    scene.statics.set(slot.key, [deskBox, chairBox]);
  }
}

/**
 * 人物（落座 / 空工位 / 走动）按快照同步。
 * ⛔ 姿势没变就不重建 —— 重建会把 animation clock 打回随机相位，动画会"跳一下"。
 */
function syncPeople(
  world: Container,
  slots: Slot[],
  scene: SceneRefs,
  openThreadRef: { current: ((memberId: string) => void) | undefined },
) {
  const live = new Set(slots.map((s) => s.key));
  for (const [key, view] of scene.seats) {
    if (live.has(key)) continue;
    world.removeChild(view.container);
    view.container.destroy({ children: true });
    scene.seats.delete(key);
    const walker = scene.walkers.get(key);
    if (walker) {
      world.removeChild(walker.container);
      walker.container.destroy({ children: true });
      scene.walkers.delete(key);
    }
  }

  slots.forEach((slot) => {
    const state: "running" | "idle" | "never" = slot.running ? "running" : slot.hasThread ? "idle" : "never";
    const pose = slot.pose;
    const away = pose?.kind === "visit" || pose?.kind === "errand";
    // ⛔ 坐姿**一律背对观众**（09-27 用户定）：屏幕统一朝观众、人背对观众面向屏幕，
    //    一眼能看出「谁在干活、屏幕上跑的是什么」。⛔ 只有走动的人朝行进方向。
    const back = true;

    let view = scene.seats.get(slot.key);
    if (!view) {
      const container = new Container();
      container.eventMode = slot.memberId ? "static" : "none";
      container.cursor = "pointer";
      if (slot.memberId) {
        const memberId = slot.memberId;
        container.on("pointertap", () => openThreadRef.current?.(memberId));
      }
      world.addChild(container);
      // clock 用 key 播种：不同成员的动画相位错开（否则全员同步抽耳/呼吸，一眼假）
      const seed = slot.key;
      view = { container, sig: "", parts: null, clock: ((seed.length * 37 + seed.charCodeAt(seed.length - 1) * 13) % 628) / 100 };
      scene.seats.set(slot.key, view);
    }
    view.container.position.set(slot.x, slot.y - SEAT_LIFT * slot.scale);
    view.container.scale.set(slot.scale * PERSON_K);
    // ⛔ 人物排在自己的**座位地面 y** 上：桌子（更小的 y）自动在其后、椅子（更大的 y）在其前。
    view.container.zIndex = slot.y;

    const sig = state === "never" ? "never" : away ? "away" : `${pose?.kind}:${back ? 1 : 0}:${slot.cosplay.animal}`;
    if (view.sig !== sig) {
      view.container.removeChildren().forEach((c) => c.destroy({ children: true }));
      view.parts = null;
      view.sig = sig;
      if (state === "never") {
        view.container.addChild(buildVacant(slot.scale));
        view.container.eventMode = "none";
      } else if (!away && pose) {
        const { container: person, parts } = createWorkerGraphics(pose, slot.cosplay, back);
        view.container.addChild(person);
        view.parts = parts;
        view.container.eventMode = slot.memberId ? "static" : "none";
      }
    }

    /* 走动：visit/errand 时把人换成走动小人，位置由 ticker 插值 */
    const ground = { x: slot.x, y: slot.y - 12, scale: slot.scale };
    let walker = scene.walkers.get(slot.key);
    if (away && pose) {
      if (!walker) {
        walker = createWalker(slot.cosplay, ground);
        world.addChild(walker.container);
        scene.walkers.set(slot.key, walker);
      }
      walker.to = walkTarget(pose, slots);
      walker.from = ground;
    } else if (walker) {
      walker.to = ground;
      if (walker.t <= 0) {
        world.removeChild(walker.container);
        walker.container.destroy({ children: true });
        scene.walkers.delete(slot.key);
        walker = undefined;
      }
    }
    // 走动小人还在路上（t > 0）时不显示落座人物，否则会出现「两个人」
    view.container.visible = !away && (!walker || walker.t <= 0.001);
  });
}

function buildVacant(scale: number): Container {
  const c = new Container();
  const g = new Graphics();
  g.roundRect(-42, -96 * scale - 15, 84, 30, 15).fill({ color: 0xffffff, alpha: 0.92 }).stroke({ color: 0xc6d0dc, width: 2 });
  const text = new Text({ text: "空工位", style: new TextStyle({ fill: 0x8a95a3, fontSize: 11.5 }) });
  text.anchor.set(0.5);
  text.position.set(0, -96 * scale);
  c.addChild(g, text);
  return c;
}

function walkTarget(pose: OfficePose, slots: Slot[]): { x: number; y: number; scale: number } {
  if (pose.kind === "visit" && pose.visitIndex !== undefined) {
    const host = slots[pose.visitIndex + 1];
    if (host) {
      const p = floorPoint(clamp01(host.u + 0.19), clamp01(host.v + 0.02));
      return { x: p.x, y: p.y, scale: p.scale };
    }
  }
  const spot: ErrandSpot = pose.kind === "errand" ? pose.spot ?? "water" : "water";
  const uv = ERRAND_STAND_UV[spot];
  const p = floorPoint(uv.u, uv.v);
  return { x: p.x, y: p.y, scale: p.scale };
}

/* ── 标签与交接 ─────────────────────────────────────────────────────────── */

function syncTags(layer: Container, slots: Slot[], scene: SceneRefs) {
  const live = new Set(slots.map((s) => s.key));
  for (const [key, view] of scene.tags) {
    if (live.has(key)) continue;
    layer.removeChild(view.container);
    view.container.destroy({ children: true });
    scene.tags.delete(key);
  }

  slots.forEach((slot) => {
    const state: "running" | "idle" | "never" = slot.running ? "running" : slot.hasThread ? "idle" : "never";
    const task = slot.pose?.label || (state === "never" ? "未开工" : slot.running ? "处理中" : "待命");
    const sig = `${slot.name}|${task}|${state}`;

    let view = scene.tags.get(slot.key);
    if (!view) {
      const container = new Container();
      container.eventMode = "none";
      layer.addChild(container);
      view = { container, sig: "" };
      scene.tags.set(slot.key, view);
    }
    view.container.position.set(slot.x, slot.y - TAG_LIFT * slot.scale);
    if (view.sig === sig) return;
    view.sig = sig;
    view.container.removeChildren().forEach((c) => c.destroy({ children: true }));

    // ⛔ 表达方式（09-27 用户：「头上那个黑框框太丑」）——
    //    改成**无描边的浮起小胶囊**：白底 + 柔阴影 + 状态点 + 单行「名字 · 动作」。
    //    参考画面里也没有黑边：标签靠浅阴影"浮"在房间上方，不靠线框框住。
    const nameText = new Text({ text: slot.name, style: new TextStyle({ fill: 0x1f2733, fontSize: 11.5, fontWeight: "700" }) });
    const taskText = new Text({ text: task, style: new TextStyle({ fill: 0x8a94a0, fontSize: 10, fontWeight: "600" }) });
    const dotR = 2.8;
    const padX = 9;
    const gap = 5;
    const leadW = dotR * 2 + 5;                       // 圆点 + 与名字的间距
    const w = padX * 2 + leadW + nameText.width + gap + taskText.width;
    const h = 19;
    const g = new Graphics();
    // 柔阴影（无描边）：偏移 2.5px 的低透明度暗色，让胶囊"浮"起来
    g.roundRect(-w / 2, -h / 2 + 2.5, w, h, h / 2).fill({ color: 0x2a3542, alpha: 0.1 });
    g.roundRect(-w / 2, -h / 2, w, h, h / 2).fill({ color: 0xffffff, alpha: 0.95 });
    const dotX = -w / 2 + padX + dotR;
    // 状态点用**该成员的项圈色**（画面里靠它认人，标签上也保持一致）
    const tint = parseInt(slot.cosplay.collar.replace("#", ""), 16);
    g.circle(dotX, 0, dotR).fill(slot.running ? tint : 0xb9c0c8);
    if (slot.running) g.circle(dotX, 0, dotR + 2.6).stroke({ color: tint, width: 1.3, alpha: 0.32 });
    view.container.addChild(g);
    nameText.anchor.set(0, 0.5);
    nameText.position.set(dotX + dotR + 5, 0);
    view.container.addChild(nameText);
    taskText.anchor.set(0, 0.5);
    taskText.position.set(dotX + dotR + 5 + nameText.width + gap, 0.5);
    view.container.addChild(taskText);
  });
}

function syncHandoffs(layer: Container, slots: Slot[], snapshot: DirectorSnapshot, scene: SceneRefs) {
  const live = new Set(snapshot.handoffs.map((h) => h.id));
  for (const [id, view] of scene.handoffs) {
    if (live.has(id)) continue;
    layer.removeChild(view.container);
    view.container.destroy({ children: true });
    scene.handoffs.delete(id);
  }

  snapshot.handoffs.forEach((handoff) => {
    // 起点偏左、终点偏右：标记点让开脑袋（见 HANDOFF_SIDE 的注释）
    const from = headOf(handoff.from, slots, -1);
    const to = headOf(handoff.to, slots, 1);
    const sig = `${from.x.toFixed(1)},${from.y.toFixed(1)}>${to.x.toFixed(1)},${to.y.toFixed(1)}:${handoff.kind}`;

    let view = scene.handoffs.get(handoff.id);
    if (!view) {
      const container = new Container();
      container.eventMode = "none";
      layer.addChild(container);
      view = { container, card: new Container(), pulse: new Graphics(), sig: "", from, to, t: 0, clock: 0 };
      scene.handoffs.set(handoff.id, view);
    }
    if (view.sig !== sig) {
      view.sig = sig;
      view.from = from;
      view.to = to;
      view.t = 0;
      view.container.removeChildren().forEach((c) => c.destroy({ children: true }));

      const tint = HANDOFF_TINT[handoff.kind];
      const g = new Graphics();
      // 起点：实心点（发起方）；终点：白底 + 绿环的"落点"（⛔ 只画空心环会像桌上的随机圆圈）
      g.circle(from.x, from.y, 5.5).fill(tint).stroke({ color: 0xffffff, width: 2, alpha: 0.85 });
      g.circle(to.x, to.y, 8).fill({ color: 0xffffff, alpha: 0.92 }).stroke({ color: OFC.ok, width: 2.6 });
      view.container.addChild(g);

      const pulse = new Graphics();
      pulse.circle(to.x, to.y, 16).stroke({ color: OFC.ok, width: 3, alpha: 0.8 });
      pulse.alpha = 0;
      view.pulse = pulse;
      view.container.addChild(pulse);

      const card = new Container();
      const body = new Graphics();
      body.roundRect(-15, -11, 30, 22, 3.4).fill(tint).stroke({ color: OFC.ink, width: 2.4 });
      body.moveTo(5, 8).lineTo(20, 8).stroke({ color: OFC.ink, width: 2, alpha: 0.65 });
      body.moveTo(5, 13).lineTo(20, 13).stroke({ color: OFC.ink, width: 2, alpha: 0.65 });
      card.addChild(body);
      view.card = card;
      view.container.addChild(card);

      const label = new Text({ text: handoff.label, style: new TextStyle({ fill: 0x5b6a7d, fontSize: 10.5, fontWeight: "600" }) });
      // ⛔ 标签挂在锚点**下方**：挂上方会正好压到头顶的名字胶囊（实测两处文字叠在一起看不清）
      label.anchor.set(0.5, 0);
      label.position.set(to.x, to.y + 17);
      view.container.addChild(label);
    } else {
      view.from = from;
      view.to = to;
    }
  });
}

function headOf(index: number, slots: Slot[], side: -1 | 1): { x: number; y: number } {
  const slot = index < 0 ? slots[0] : slots[index + 1];
  if (!slot) return { x: SCENE_W / 2, y: 200 };
  return { x: slot.x + side * HANDOFF_SIDE * slot.scale, y: slot.y - HANDOFF_LIFT * slot.scale };
}

/* ── 角色绘制（黑色动物剪影 + 彩色项圈）───────────────────────────────────
   ⛔ 参考画面的角色是**纯黑动物剪影**：圆头 + 两只耳朵 + 两侧伸出的爪子 +
   脖子上一圈饱和彩项圈，**没有任何五官 / 描边**。所以：
     · 物种只能靠**耳朵外形**区分（drawEars）；
     · 个体只能靠**项圈颜色**区分（office-palette.collarColor）；
     · ⛔ 不许给角色加眼睛 / 嘴 / 衣服色 —— 一加就退回 v4 那种"卡通小人"，与参考违和。 */

/** 局部坐标：脖子在 (0, 0)，头心 (0, HEAD_CY)，身体往下铺。 */
const HEAD_CY = -44;
/** 项圈矩形（脖子那一圈）。⛔ 宽度**必须明显窄于肩宽**（参考里项圈 ≈ 肩宽 × 0.57）——
 *  项圈做宽了会把两只爪子整段盖住，角色就只剩"一个头 + 一条色带"（第三版实测）。 */
const COLLAR = { x: -25, y: -17, w: 50, h: 21, r: 10.5 };
/**
 * 手臂：枢轴在**肩**（不是爪子）—— 动画转的是"抬爪"这个动作；枢轴放爪子上就变成
 * 爪子不动、袖子在甩（看着像抽筋）。
 * ⛔ 爪心**不能太高**：顶到头的下半部就会和头糊成一件"斗篷"（v10 第二版实测，放大才看得出来）。
 *    现在的几何：爪心落在局部 (−29.5, −9)，爪顶 −20，刚好在头的下沿之下。
 */
const ARM_SHOULDER = { x: 19, y: 10 };
const ARM_REACH = 22;
const ARM_SPREAD = 0.5;

function tri(g: Graphics, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
  g.poly([x1, y1, x2, y2, x3, y3]).fill(SILHOUETTE);
}

/**
 * 耳朵 / 头顶特征 —— **物种唯一的外形差异**（剪影没有五官）。
 * ⛔ 三条硬约束（改之前先读）：
 *    ① **缩到 30px 宽还要认得出来**：耳朵必须比头明显大（耳高 ≥ 头顶上方 25 局部单位），
 *       小耳朵配大圆头 ⇒ 全场 11 个角色读成同一只熊（v10 第二版实测）；
 *    ② **不许顶进显示器**：耳朵最高点 = HEAD_CY − ry − 34 就是上限；
 *    ③ **两个物种不许长得像**：熊猫被换成了绵羊，就因为"跟熊只差耳径 3px"。
 */
/**
 * 头顶**对称**特征（羊毛圈 / 刺猬刺 / 狮鬃）—— 画在头**之前**，头再压上去。
 * ⛔ 这些是整圈的东西，拆不成左右两支，所以不能参与"单边抽动"（见 drawEarSide）。
 */
function drawHeadBackdrop(g: Graphics, animal: AnimalKind, rx: number, ry: number): void {
  const t = HEAD_CY - ry;
  if (animal === "sheep") {
    // 绵羊：一圈小球堆成的"羊毛头"，整个轮廓都是锯齿
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.circle(Math.cos(a) * (rx + 5), HEAD_CY + 1 + Math.sin(a) * (ry + 5), 8.5).fill(SILHOUETTE);
    }
    g.circle(0, t - 4, 10).fill(SILHOUETTE);
  } else if (animal === "hedgehog") {
    // 刺猬：一圈尖刺（半圆铺开）
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = Math.PI + ((i + 0.5) / n) * Math.PI;
      const b = Math.PI + ((i - 0.5) / n) * Math.PI;
      tri(
        g,
        Math.cos(a) * rx * 0.96, HEAD_CY + Math.sin(a) * ry * 0.96,
        Math.cos(b) * rx * 0.96, HEAD_CY + Math.sin(b) * ry * 0.96,
        Math.cos(a) * (rx + 18), HEAD_CY + Math.sin(a) * (ry + 18),
      );
    }
  } else if (animal === "lion") {
    // 狮子：一圈大锯齿圆当鬃毛
    const R = rx + 11;
    for (let i = 0; i < 15; i++) {
      const a = (i / 15) * Math.PI * 2;
      g.circle(Math.cos(a) * R, HEAD_CY + 2 + Math.sin(a) * R, 9.5).fill(SILHOUETTE);
    }
    g.circle(0, HEAD_CY + 2, R).fill(SILHOUETTE);
  }
}

/**
 * **单侧**耳朵（side：-1 左 / +1 右）—— 拆成左右两支是为了**单边抽动**（动画的抓手）。
 * 坐标以**左耳**为基准写，右耳用 `M()` 镜像（多边形 / 圆 / 椭圆 / 二次曲线镜像都成立）。
 *
 * ⛔ 三条硬约束（改之前先读）：
 *    ① **缩到 30px 宽还要认得出来**：耳朵必须明显大于头（耳高 ≥ 头顶上方 25 局部单位），
 *       小耳朵配大圆头 ⇒ 全场 11 个角色读成同一只熊（v10 第二版实测）；
 *    ② **不许顶进显示器**：耳尖 = HEAD_CY − ry − 34 就是上限（见 TAG_LIFT 的算式）；
 *    ③ **两个物种不许长得像**：熊猫被换成绵羊，就因为"跟熊只差耳径 3px"。
 */
function drawEarSide(g: Graphics, animal: AnimalKind, rx: number, ry: number, side: -1 | 1): void {
  const t = HEAD_CY - ry;                 // 头顶
  const M = (v: number) => -side * v;     // 左耳坐标为基准，右耳镜像
  switch (animal) {
    case "cat":
      tri(g, M(-rx + 2), HEAD_CY - 5, M(-rx + 19), HEAD_CY - 10, M(-rx - 2), t - 31);
      break;
    case "fox":
      tri(g, M(-rx + 2), HEAD_CY - 4, M(-rx + 20), HEAD_CY - 11, M(-rx - 6), t - 34);
      break;
    case "dog":
      // 垂耳：从头顶两侧垂到接近头心高度（唯一"往下垂"的物种，最好认）
      g.moveTo(M(-rx + 3), HEAD_CY - 12)
        .quadraticCurveTo(M(-rx - 21), HEAD_CY - 4, M(-rx - 10), HEAD_CY + 27)
        .quadraticCurveTo(M(-rx + 4), HEAD_CY + 6, M(-rx + 13), HEAD_CY - 9)
        .closePath().fill(SILHOUETTE);
      break;
    case "rabbit":
      // ⛔ 兔耳不能按真比例画长：顶到显示器下沿会把屏幕糊掉（上限 = 头顶上方 34 局部单位）
      g.ellipse(M(-8), t - 15, 6.5, 19).fill(SILHOUETTE);
      break;
    case "bear":
      // ⛔ 别做成"大圆耳"：r 超过 15 就会变成米老鼠，与考拉撞脸（实测）
      g.circle(M(-18), t + 5, 13).fill(SILHOUETTE);
      break;
    case "koala":
      // 考拉：**大而外扩**的毛耳（与熊的小圆耳拉开距离）
      g.circle(M(-rx - 4), t + 20, 17).fill(SILHOUETTE);
      break;
    case "mouse":
      g.circle(M(-21), t + 4, 13.5).fill(SILHOUETTE);
      break;
    case "deer":
      g.ellipse(M(-17), t + 7, 6, 12).fill(SILHOUETTE);
      // 分叉角：往上长，与兔耳的区别是"细枝"而不是"叶子"
      g.moveTo(M(-10), t + 6).lineTo(M(-15), t - 20).stroke({ color: SILHOUETTE, width: 4.4 });
      g.moveTo(M(-15), t - 20).lineTo(M(-24), t - 30).stroke({ color: SILHOUETTE, width: 3.6 });
      g.moveTo(M(-14), t - 12).lineTo(M(-23), t - 16).stroke({ color: SILHOUETTE, width: 3.6 });
      break;
    case "pig":
      tri(g, M(-rx + 1), HEAD_CY - 4, M(-rx + 16), t + 10, M(-rx - 7), t - 12);
      break;
    case "lion":
      // 鬃毛是整圈（在 drawHeadBackdrop），这里只补两只小圆耳
      g.circle(M(-18), t + 10, 9).fill(SILHOUETTE);
      break;
    default:
      break;                              // sheep / hedgehog 没有单侧耳朵
  }
}

/**
 * 头部尺寸（rx, ry）—— 物种之间也要有差别。
 * ⛔ 两条实测约束：
 *    ① **rx 明显大于 ry**（宽扁头）—— 正圆头配上小耳朵会读成"熊"，物种全糊成一个样；
 *    ② 头 + 耳朵的总高不能顶进显示器里（顶进去就把屏幕内容糊掉了）。
 *       算之前先量 seatY 到显示器下沿还剩多少像素（MONITOR_LIFT 就是为这条抬的）。
 */
const HEAD_SIZE: Record<AnimalKind, [number, number]> = {
  cat: [27, 21],
  fox: [26, 20],
  dog: [28, 22],
  rabbit: [23, 21],
  bear: [30, 24],
  sheep: [26, 21],
  koala: [28, 22],
  mouse: [25, 22],
  deer: [26, 22],
  hedgehog: [29, 23],
  pig: [30, 21],
  lion: [28, 22],
};

/** 头部件：`ears` 单独暴露出来，动画层才能做**单边抽动**。 */
type HeadParts = { wrap: Container; ears: Graphics[] };

/** 脖子以上：对称特征 → 左右耳 → 头（头压在最上层）。⛔ 剪影是**平的纯黑**（参考就是这样）——
 *  不要给头加"高光/腮红"之类：在 40px 尺寸下会看着像一块洗不掉的污渍（实测过一版）。 */
function buildAnimalHead(cosplay: Cosplay): HeadParts {
  const wrap = new Container();
  const [rx, ry] = HEAD_SIZE[cosplay.animal];

  const back = new Graphics();
  drawHeadBackdrop(back, cosplay.animal, rx, ry);
  wrap.addChild(back);

  // 左右耳各自一支 Graphics：pivot = position = 耳根 ⇒ 抽动时绕耳根转、**不产生位移**
  const ears: Graphics[] = [];
  for (const side of [-1, 1] as const) {
    const e = new Graphics();
    drawEarSide(e, cosplay.animal, rx, ry, side);
    const px = side * rx * 0.62;
    const py = HEAD_CY - ry * 0.42;
    e.pivot.set(px, py);
    e.position.set(px, py);
    wrap.addChild(e);
    ears.push(e);
  }

  const head = new Graphics();
  head.ellipse(0, HEAD_CY, rx, ry).fill(SILHOUETTE);
  wrap.addChild(head);

  return { wrap, ears };
}

/**
 * 坐姿角色：黑色剪影（身体 + 两只爪子）+ 头 + 项圈。
 * ⛔ 顺序固定：身体 → 头 → 项圈（项圈压在头 / 身交界上，脖子才不会"断"）。
 */
function createWorkerGraphics(pose: OfficePose, cosplay: Cosplay, back: boolean): { container: Container; parts: SeatedParts } {
  const c = new Container();

  const shadow = new Graphics();
  softShadow(shadow, 0, 76, 42, 10, 0.16);
  c.addChild(shadow);

  const body = new Container();

  // 躯干（黑一坨，下缘会被椅子挡住）。⛔ 比头**窄**：头必须比肩宽，剪影才有"大头动物"的比例。
  //    ⛔ 长度也有上限：躯干画到 +78 时下缘会从**椅座下面漏出来**，看着像"人挂在椅子下面"
  //       （放大实测）。+58 刚好落在椅座范围内，被座面盖住。
  const torso = new Graphics();
  torso.roundRect(-23, -8, 46, 58, 20).fill(SILHOUETTE);
  body.addChild(torso);

  // 两只爪子：局部原点 = **肩**，爪在肩的上方 ARM_REACH 处；基准张角让爪子往外上方伸
  // （像"抱在桌前"）。⛔ 别画成两根竖直柱子 —— 参考里的爪子是外张的。
  const armBack = new Graphics();
  armBack.roundRect(-9, -ARM_REACH, 18, ARM_REACH + 8, 9).fill(SILHOUETTE);
  armBack.circle(0, -ARM_REACH, 11).fill(SILHOUETTE);
  armBack.pivot.set(0, 0);
  armBack.position.set(-ARM_SHOULDER.x, ARM_SHOULDER.y);
  armBack.rotation = -ARM_SPREAD;
  body.addChild(armBack);

  const armFront = new Graphics();
  armFront.roundRect(-9, -ARM_REACH, 18, ARM_REACH + 8, 9).fill(SILHOUETTE);
  armFront.circle(0, -ARM_REACH, 11).fill(SILHOUETTE);
  armFront.pivot.set(0, 0);
  armFront.position.set(ARM_SHOULDER.x, ARM_SHOULDER.y);
  armFront.rotation = ARM_SPREAD;
  body.addChild(armFront);

  c.addChild(body);

  // 头（含耳朵）—— ears 拿出来给动画层抽动
  const headwrap = new Container();
  const { wrap: headWrap, ears } = buildAnimalHead(cosplay);
  headwrap.addChild(headWrap);
  c.addChild(headwrap);

  // 项圈（脖子那一圈 —— 全身唯一的颜色）
  const collar = new Graphics();
  collar.roundRect(COLLAR.x, COLLAR.y, COLLAR.w, COLLAR.h, COLLAR.r).fill(cosplay.collar);
  collar.roundRect(COLLAR.x, COLLAR.y, COLLAR.w, 6, COLLAR.r * 0.6).fill({ color: 0xffffff, alpha: 0.24 });
  collar.roundRect(COLLAR.x + 6, COLLAR.y + COLLAR.h - 5, COLLAR.w - 12, 5, 3).fill(collarDark(cosplay.collar));
  c.addChild(collar);

  // 姿势道具（咖啡杯 / 手机 / 资料），一律**白色 + 细描边**，在黑剪影上读得出来。
  // ⛔ 坐标跟着爪心走（爪心 ≈ (±29.5, −9)）：离开爪子太远会像"浮在身边的道具"。
  if (pose.kind === "coffee") {
    const mug = new Graphics();
    mug.roundRect(-7, -9, 14, 14, 3.2).fill(0xffffff).stroke({ color: 0x2b3038, width: 2.2 });
    mug.moveTo(7, -6).quadraticCurveTo(13.5, -2, 7, 3.5).stroke({ color: 0x2b3038, width: 2.2 });
    mug.position.set(-33, -20);
    c.addChild(mug);
  }
  if (pose.kind === "phone") {
    const phone = new Graphics();
    phone.roundRect(-7, -11, 14, 22, 3.6).fill(0xffffff).stroke({ color: 0x2b3038, width: 2.2 });
    phone.roundRect(-4.4, -7.8, 8.8, 15.6, 2).fill({ color: 0xbfe0ff, alpha: 0.95 });
    phone.position.set(32, -17);
    c.addChild(phone);
  }
  if (pose.kind === "note") {
    const paper = new Graphics();
    paper.roundRect(-10, -13, 20, 26, 2.4).fill(0xffffff).stroke({ color: 0x2b3038, width: 2.2 });
    paper.rect(-6, -7, 12, 1.8).fill(0xc7d0da);
    paper.rect(-6, -2, 9, 1.8).fill(0xc7d0da);
    paper.position.set(-33, -19);
    c.addChild(paper);
  }

  // 打盹：头顶浮起的 z（动画在 animateScene，平时不可见）
  const doze = new Container();
  const z1 = new Text({ text: "z", style: new TextStyle({ fill: 0x5b6a7d, fontSize: 15, fontWeight: "700" }) });
  const z2 = new Text({ text: "Z", style: new TextStyle({ fill: 0x5b6a7d, fontSize: 20, fontWeight: "700" }) });
  z1.position.set(17, -84);
  z2.position.set(31, -104);
  doze.addChild(z1, z2);
  doze.visible = pose.kind === "doze";
  c.addChild(doze);

  return {
    container: c,
    parts: { body, armBack, armFront, headwrap, ears, doze, pose },
  };
}

/** 走动小人：站立姿势，脚底在 (0,0) —— zIndex 取脚底 y 才能跟地面纵深对齐。 */
function createWalker(cosplay: Cosplay, ground: { x: number; y: number; scale: number }): WalkerParts {
  const container = new Container();
  container.position.set(ground.x, ground.y);
  container.scale.set(ground.scale * PERSON_K);
  container.zIndex = ground.y;

  const body = new Container();

  const legBack = new Graphics();
  legBack.roundRect(-5.5, 0, 11, 34, 5.5).fill(SILHOUETTE);
  legBack.ellipse(3, 32, 8, 4.2).fill(SILHOUETTE);
  legBack.position.set(-7, -36);
  body.addChild(legBack);

  const legFront = new Graphics();
  legFront.roundRect(-5.5, 0, 11, 34, 5.5).fill(SILHOUETTE);
  legFront.ellipse(3, 32, 8, 4.2).fill(SILHOUETTE);
  legFront.position.set(7, -36);
  body.addChild(legFront);

  const torso = new Graphics();
  torso.roundRect(-19, -78, 38, 44, 14).fill(SILHOUETTE);
  body.addChild(torso);

  const armBack = new Graphics();
  armBack.roundRect(-5, 0, 10, 28, 5).fill(SILHOUETTE);
  armBack.circle(0, 28, 5.6).fill(SILHOUETTE);
  armBack.position.set(-21, -72);
  body.addChild(armBack);

  const armFront = new Graphics();
  armFront.roundRect(-5, 0, 10, 28, 5).fill(SILHOUETTE);
  armFront.circle(0, 28, 5.6).fill(SILHOUETTE);
  armFront.position.set(21, -72);
  body.addChild(armFront);

  const collar = new Graphics();
  collar.roundRect(-19, -80, 38, 15, 7).fill(cosplay.collar);
  collar.roundRect(-19, -80, 38, 4, 2).fill({ color: 0xffffff, alpha: 0.24 });
  body.addChild(collar);

  const headwrap = new Container();
  headwrap.position.set(0, -76);
  headwrap.scale.set(0.94);
  const { wrap: headWrap, ears: walkEars } = buildAnimalHead(cosplay);
  headwrap.addChild(headWrap);
  body.addChild(headwrap);

  const shadow = new Graphics();
  softShadow(shadow, 0, 0, 30, 8, 0.16);
  container.addChild(shadow, body);

  return {
    container,
    body,
    legBack,
    legFront,
    armBack,
    armFront,
    headwrap,
    ears: walkEars,
    t: 0,
    from: { ...ground },
    to: { ...ground },
    clock: Math.random() * Math.PI * 2,
  };
}

/* ── 逐帧动画（ticker 驱动）─────────────────────────────────────────────── */

function animateScene(scene: SceneRefs, delta: number) {
  const d2r = Math.PI / 180;
  scene.clock += delta * 0.06;

  // 设施动画（饮水机水泡 / 打印机吐纸 / 挂钟走针 / 隔间灯 / 咖啡蒸汽）
  scene.props.forEach((p) => p.update(scene.clock));
  // ⛔ 屏幕动画单独一组（工位重建时整批换掉）—— 只挂不驱动的 ticker 是"看起来接好了"的假象
  scene.screens.forEach((p) => p.update(scene.clock));

  scene.seats.forEach((view) => {
    if (!view.parts) return;
    view.clock += delta * 0.06;
    const p = view.parts;
    const t = view.clock;

    p.headwrap.rotation = 0;
    p.body.rotation = 0;
    p.body.scale.y = 1;
    // 耳朵（单边抽动）：sin 的 24 次方让抽动只出现在一个很窄的窗口里（偶尔抽一下）；
    // 打盹时整体耷拉（向外转 0.55 rad）。⛔ pivot 在耳根，转的是耳朵本身、不产生位移。
    const flick = (i: number) => Math.pow(Math.max(0, Math.sin(t * 0.5 + i * 2.4)), 24);
    const droop = p.pose.kind === "doze" ? 0.55 : 0;
    p.ears.forEach((ear, i) => {
      ear.rotation = (i === 0 ? -1 : 1) * (droop + flick(i) * 0.3);
    });
    // 爪子姿势都是**相对基准张角**的增量（ARM_SPREAD 是"外张抱着桌沿"的静止姿态）
    const arms = (back: number, front: number) => {
      p.armBack.rotation = -ARM_SPREAD + back;
      p.armFront.rotation = ARM_SPREAD + front;
    };
    if (p.doze.visible) {
      p.doze.y = -Math.abs(Math.sin(t * 0.9)) * 3;
      p.doze.alpha = 0.55 + 0.45 * Math.abs(Math.sin(t * 0.9));
    }

    if (p.pose.kind === "doze") {
      // 打盹：头歪下去 + 整个人往下沉一点（配合头顶浮起的 z）。
      // ⛔ 歪角别超过 12°：背对观众的剪影一歪过头就只剩一坨黑，连耳朵都看不出来（实测）。
      p.headwrap.rotation = 10 * d2r;
      p.headwrap.y = 3;
      arms(7 * d2r, -7 * d2r);
      p.body.scale.y = 0.97 + Math.sin(t * 1.1) * 0.02;
      return;
    }
    p.headwrap.y = 0;
    if (p.pose.kind === "stretch") {
      // 伸懒腰：两只爪子往外举高
      const cyc = (Math.sin(t * 2.2) + 1) / 2;
      arms(-cyc * 62 * d2r, cyc * 62 * d2r);
      p.body.rotation = -2.4 * d2r * cyc;
      return;
    }
    if (p.pose.kind === "coffee") {
      // 喝咖啡：右爪抬到嘴边 + 小幅上下
      const cyc = (Math.sin(t * 1.6) + 1) / 2;
      arms(-6 * d2r, -(18 + cyc * 14) * d2r);
      p.headwrap.rotation = 3 * d2r * cyc;
      return;
    }
    if (p.pose.kind === "phone") {
      const cyc = (Math.sin(t * 1.4) + 1) / 2;
      arms(-8 * d2r, -(24 + cyc * 8) * d2r);
      p.headwrap.rotation = 3.4 * d2r * cyc;
      return;
    }
    if (p.pose.kind === "note") {
      const cyc = (Math.sin(t * 3.4) + 1) / 2;
      arms(-10 * d2r, -(12 + cyc * 4) * d2r);
      return;
    }
    // 敲键盘（默认）：两只爪子交替小幅起落 + 躯干随呼吸起伏
    const typing = (Math.sin(t * 6) + 1) / 2;
    arms(-(4 + typing * 9) * d2r, (4 + typing * 9) * d2r);
    p.body.scale.y = 1 + Math.sin(t * 2.4) * 0.018;
  });

  scene.walkers.forEach((w) => {
    const away = w.to.x !== w.from.x || w.to.y !== w.from.y;
    const dir = away ? 1 : -1;
    const speed = delta * 0.02;
    const before = w.t;
    w.t = clamp01(w.t + dir * speed);
    const walking = (away && w.t < 1 && before < 1) || (!away && w.t > 0);
    w.clock += delta * 0.06;

    const e = easeInOut(w.t);
    const x = lerp(w.from.x, w.to.x, e);
    const y = lerp(w.from.y, w.to.y, e);
    const s = lerp(w.from.scale, w.to.scale, e);
    w.container.position.set(x, y);
    w.container.scale.set(s);
    w.container.zIndex = y;

    const swing = walking ? Math.sin(w.clock * 7) : 0;
    w.legBack.rotation = swing * 0.45;
    w.legFront.rotation = -swing * 0.45;
    // 走动小人也带一点外张的基准张角（与坐姿同一套姿态语言）
    w.armBack.rotation = ARM_SPREAD * 0.5 - swing * 0.3;
    w.armFront.rotation = -ARM_SPREAD * 0.5 + swing * 0.3;
    w.body.y = walking ? -Math.abs(Math.sin(w.clock * 7)) * 2.6 : 0;
    w.headwrap.rotation = walking ? Math.sin(w.clock * 7) * 0.04 : 0;
    // 走路时耳朵随步伐上下颠（左右反相，像真的在跑）
    const bounce = walking ? Math.abs(Math.sin(w.clock * 7)) : 0;
    w.ears.forEach((ear, i) => {
      ear.rotation = (i === 0 ? -1 : 1) * bounce * 0.14;
    });
  });

  scene.handoffs.forEach((h) => {
    h.clock += delta * 0.06;
    h.t = Math.min(1, h.t + delta * 0.014);
    const e = easeInOut(h.t);
    const x = lerp(h.from.x, h.to.x, e);
    const y = lerp(h.from.y, h.to.y, e) - Math.sin(Math.PI * e) * 46;
    h.card.position.set(x, y);
    h.card.visible = h.t < 1;
    h.card.rotation = Math.sin(h.clock * 3) * 0.06;
    h.pulse.alpha = h.t >= 1 ? 0.35 + 0.35 * Math.sin(h.clock * 5) : 0;
  });
}
