/**
 * PixiJS 渲染层（team-office 域 09-27 v8「PixiJS 替换 SVG」）。
 *
 * ⛔ 为什么换：用户看了 workbzw/ai-office-react（PixiJS + Spine）后要求「复刻过来」，
 *     SVG 手绘人物与 Kenney 3D 渲染家具放一起违和。现在：
 *     · 家具 = Kenney CC0 等距渲染件（Sprite，素材 URL 走**静态 import**）
 *     · 人物 = Graphics API 程序绘制（粗描边 + 大头 + 极简五官，与家具风格一致）
 *     · 动画 = ticker 逐帧驱动（坐姿 / 走动 / 交接卡片）
 *
 * ⛔ 深度用 zIndex，不靠「图层先后」：世界层 sortableChildren = true，每个对象按
 *     **地面基线 y** 排序 ⇒ 桌子遮得住坐在后面那个人的下半身、走动的人穿过房间时
 *     前后关系自动正确（SVG 时代靠手写「显示器 → 人 → 桌子」三段顺序，搬一层就错）。
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
import { OFC, INK_W, INK_W_THIN, ISO, workerLook, type WorkerLook } from "./office-palette";
import { deskSlots, floorPoint, SCENE_W, SCENE_H, type FloorSpot } from "./office-iso";
import type { DirectorSnapshot, OfficePose, OfficeHandoff, ErrandSpot } from "./office-director";
import type { OfficeMember } from "./OfficeScene";

import { drawRoom as paintRoom, drawBackWall, drawSideProps, drawDeskStation } from "./office-render";

/** 人物整体缩放：v5 的人物（头径 41px）相对工位桌椅过大，压过桌子 ⇒ 缩到 0.64。 */
const PERSON_K = 0.54;
const SEAT_LIFT = 118;
const TAG_LIFT = 166;
const HANDOFF_LIFT = 150;



/** 世界层里房间永远垫底、吊扇永远在最上（都与地面物件不重叠）。 */
const Z_ROOM = -1e6;
const Z_FAN = 1e5;

const HANDOFF_TINT: Record<OfficeHandoff["kind"], number> = {
  task: 0xdbeafe,
  report: 0xd9f3e3,
  doc: 0xfff0d0,
  chat: 0xeee0fb,
};

/** 跑腿目的地（地面归一化坐标）：接水 / 书架 / 打印，都落在工位区之外的空地。 */
const ERRAND_SPOT_UV: Record<ErrandSpot, { u: number; v: number }> = {
  water: { u: 0.84, v: 0.62 },
  shelf: { u: 0.18, v: 0.14 },
  printer: { u: 0.8, v: 0.16 },
};

type Slot = FloorSpot & { u: number; v: number } & {
  key: string;
  name: string;
  profession: string;
  running: boolean;
  hasThread: boolean;
  pose: OfficePose | null;
  isCeo: boolean;
  memberId: string | null;
};

/** 落座人物的可动画部件（重建只在姿势/朝向变化时发生）。 */
interface SeatedParts {
  body: Container;
  armBack: Graphics;
  armFront: Graphics;
  headwrap: Container;
  pose: OfficePose;
  back: boolean;
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

interface SwayPart {
  obj: Graphics;
  amp: number;
  speed: number;
  phase: number;
}

interface SceneRefs {
  statics: Map<string, Container[]>;
  staticsKey: string;
  seats: Map<string, SeatView>;
  walkers: Map<string, WalkerParts>;
  tags: Map<string, TagView>;
  handoffs: Map<string, HandoffView>;
  swayers: SwayPart[];
  clock: number;
}

function emptyScene(): SceneRefs {
  return { statics: new Map(), staticsKey: "", seats: new Map(), walkers: new Map(), tags: new Map(), handoffs: new Map(), swayers: [], clock: 0 };
}

export type OfficeCanvasProps = {
  ceoName: string;
  ceoProfession: string;
  members: OfficeMember[];
  snapshot: DirectorSnapshot;
  onOpenThread?: (memberId: string) => void;
};

function hexToNumber(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
}

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
        background: 0xeef1f5,
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
    syncPeople(layers.world, slots, members, sceneRef.current, openThreadRef);
    syncTags(layers.tags, slots, sceneRef.current);
    syncHandoffs(layers.handoffs, slots, snapshot, sceneRef.current);
  }, [ready, ceoName, ceoProfession, members, snapshot]);

  return <div ref={hostRef} className="office-scene" style={{ "--office-rows": 1 } as React.CSSProperties} />;
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
    name: ceoName || "CEO",
    profession: ceoProfession || "统筹",
    running: members.some((m) => m.running),
    hasThread: true,
    pose: snapshot.ceo,
    isCeo: true,
    memberId: null,
  });
  members.forEach((member, i) => {
    const g = geo[i + 1];
    if (!g) return;
    out.push({
      ...g,
      key: member.id,
      name: member.name || "员工",
      profession: member.profession || "通用",
      running: member.running,
      hasThread: member.hasThread,
      pose: member.hasThread ? snapshot.poses[i] ?? null : null,
      isCeo: false,
      memberId: member.id,
    });
  });
  return out;
}

/**
 * 桌面三件组（显示器 → 椅子 → 桌子）+ 纵深排序里的落点。
 * ⛔ 只在工位布局变化时重建：桌椅是静态的，每拍重画纯属浪费。
 */
function syncStatics(world: Container, slots: Slot[], scene: SceneRefs) {
  const key = slots.map((s) => `${s.key}@${s.x.toFixed(1)},${s.y.toFixed(1)}`).join("|");
  if (key === scene.staticsKey) return;
  scene.staticsKey = key;
  for (const groups of scene.statics.values()) {
    for (const g of groups) {
      world.removeChild(g);
      g.destroy({ children: true });
    }
  }
  scene.statics.clear();

  for (const slot of slots) {
    // 整套工位家具（阴影 + 桌子 + 显示器 + 键盘 + 椅子）一次画在一个 Graphics 里。
    // ⛔ zIndex = slot.y - 0.4：比人物容器（slot.y - 0.2）更靠后 —— 参考画面里桌子在
    //    人的**远侧**（人背对观众、面向桌子），所以家具必须先于人物绘制。
    const furniture = new Graphics();
    drawDeskStation(furniture, slot.u, slot.v);
    const box = new Container();
    box.zIndex = slot.y - 0.4;
    box.addChild(furniture);
    world.addChild(box);
    scene.statics.set(slot.key, [box]);
  }
}

/**
 * 人物（落座 / 空工位 / 走动）按快照同步。
 * ⛔ 姿势没变就不重建 —— 重建会把 animation clock 打回随机相位，动画会"跳一下"。
 */
function syncPeople(
  world: Container,
  slots: Slot[],
  members: OfficeMember[],
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
    const back = slot.running && pose?.kind === "work";
    const lookIdx = slot.isCeo ? members.length + 3 : Math.max(0, members.findIndex((m) => m.id === slot.memberId));
    const look = workerLook(lookIdx, slot.isCeo ? 1 : 0);

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
      view = { container, sig: "", parts: null, clock: 0 };
      scene.seats.set(slot.key, view);
    }
    view.container.position.set(slot.x, slot.y - SEAT_LIFT * slot.scale);
    view.container.scale.set(slot.scale * PERSON_K);
    // ⛔ 人物在**家具之前**绘制（zIndex 更小 = 更靠后）：参考画面里人只露出肩以上，
    //    桌面 / 显示器 / 椅子都挡在人前面。反过来设（-0.2）会让人糊住整个桌面。
    view.container.zIndex = slot.y - 0.5;

    const sig = state === "never" ? "never" : away ? "away" : `${pose?.kind}:${back ? 1 : 0}:${lookIdx}`;
    if (view.sig !== sig) {
      view.container.removeChildren().forEach((c) => c.destroy({ children: true }));
      view.parts = null;
      view.sig = sig;
      if (state === "never") {
        view.container.addChild(buildVacant(slot.scale));
        view.container.eventMode = "none";
      } else if (!away && pose) {
        const { container: person, parts } = createWorkerGraphics(pose, look, back);
        view.container.addChild(person);
        view.parts = parts;
        view.container.eventMode = slot.memberId ? "static" : "none";
      }
    }

    /* 走动：visit/errand 时把人换成走动小人，位置由 ticker 插值 */
    const ground = { x: slot.x, y: slot.y - 14, scale: slot.scale };
    let walker = scene.walkers.get(slot.key);
    if (away && pose) {
      if (!walker) {
        walker = createWalker(look, ground);
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
  g.roundRect(-42, -96 * scale - 15, 84, 30, 15).fill({ color: 0xffffff, alpha: 0.9 }).stroke({ color: 0xb9c6d6, width: 2.2 });
  const text = new Text({ text: "空工位", style: new TextStyle({ fill: 0x7e8c9e, fontSize: 11.5 }) });
  text.anchor.set(0.5);
  text.position.set(0, -96 * scale);
  c.addChild(g, text);
  return c;
}

function walkTarget(pose: OfficePose, slots: Slot[]): { x: number; y: number; scale: number } {
  if (pose.kind === "visit" && pose.visitIndex !== undefined) {
    const host = slots[pose.visitIndex + 1];
    if (host) {
      const p = floorPoint(clamp01(host.u + 0.16), clamp01(host.v + 0.08));
      return { x: p.x, y: p.y, scale: p.scale };
    }
  }
  const spot: ErrandSpot = pose.kind === "errand" ? pose.spot ?? "water" : "water";
  const uv = ERRAND_SPOT_UV[spot];
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

    const g = new Graphics();
    g.roundRect(-62, -8, 124, 36, 11).fill({ color: 0xffffff, alpha: 0.97 }).stroke({ color: hexToNumber(ISO.ink), width: 2.4 });
    g.circle(-34, 20, 3.6).fill(slot.running ? OFC.ok : 0xb4b7ba);
    view.container.addChild(g);

    const taskText = new Text({ text: task, style: new TextStyle({ fill: 0x6b7280, fontSize: 11, fontWeight: "600" }) });
    taskText.anchor.set(0.5, 0);
    taskText.position.set(0, -6);
    view.container.addChild(taskText);

    const nameText = new Text({ text: slot.name, style: new TextStyle({ fill: 0x22303f, fontSize: 12.5, fontWeight: "700" }) });
    nameText.anchor.set(0, 0);
    nameText.position.set(-26, 2);
    view.container.addChild(nameText);
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
    const from = headOf(handoff.from, slots);
    const to = headOf(handoff.to, slots);
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
      g.circle(from.x, from.y, 6).fill(tint).stroke({ color: OFC.ink, width: 2.4 });
      g.circle(to.x, to.y, 10).stroke({ color: OFC.ok, width: 2.8 });
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
      label.anchor.set(0.5, 1);
      label.position.set(to.x, to.y - 34);
      view.container.addChild(label);
    } else {
      view.from = from;
      view.to = to;
    }
  });
}

function headOf(index: number, slots: Slot[]): { x: number; y: number } {
  const slot = index < 0 ? slots[0] : slots[index + 1];
  if (!slot) return { x: SCENE_W / 2, y: 200 };
  return { x: slot.x, y: slot.y - HANDOFF_LIFT * slot.scale };
}

/* ── 房间与家具 ─────────────────────────────────────────────────────────
   ⛔ v9 起全部走 office-render 的**程序化绘制**（白系等距、无贴图、无描边）。
      这里不再有 drawRoom / drawFurniture / createSprite：贴图路线已整体废弃。 */

/* ── 人物绘制 ───────────────────────────────────────────────────────────── */

/**
 * 头（脸 + 发型 + 眼睛），坐标系与旧 SVG 一致：头心 (0,-7)、脖颈枢轴 (0,12)。
 * 落座与走动共用同一份画法 ⇒ 同一个成员两张画风一致。
 */
function buildHead(look: WorkerLook, back: boolean, sleeping: boolean): Graphics {
  const head = new Graphics();
  if (back) {
    head.ellipse(0, 10, 9.5, 6).fill(look.skin).stroke({ color: OFC.ink, width: 2.4 });
    head.circle(0, -7, 20.5).fill(look.hair).stroke({ color: OFC.ink, width: INK_W });
    head.moveTo(-11, -14).quadraticCurveTo(0, -23, 11, -14).stroke({ color: 0xffffff, width: 2.8, alpha: 0.22 });
    if (look.hairStyle === 2) head.circle(-2, -32, 11).fill(look.hair).stroke({ color: OFC.ink, width: INK_W });
    return head;
  }

  head.circle(0, -7, 20.5).fill(look.skin).stroke({ color: OFC.ink, width: INK_W });
  head.circle(-20, -4, 4.2).fill(look.skin).stroke({ color: OFC.ink, width: 2.6 });

  if (look.hairStyle === 0) {
    head.moveTo(-20.5, -12).quadraticCurveTo(0, -38, 20.5, -12).quadraticCurveTo(9, -20, 0, -18.5).quadraticCurveTo(-9, -20, -20.5, -12).fill(look.hair).stroke({ color: OFC.ink, width: INK_W });
  } else if (look.hairStyle === 1) {
    head.moveTo(-21, -9).quadraticCurveTo(-8, -41, 21, -10).quadraticCurveTo(16, -22, 7, -22).quadraticCurveTo(0, -13, -7, -22).quadraticCurveTo(-16, -22, -21, -9).fill(look.hair).stroke({ color: OFC.ink, width: INK_W });
  } else {
    head.moveTo(-20, -13).quadraticCurveTo(0, -34, 20, -13).quadraticCurveTo(7, -20, 0, -20).quadraticCurveTo(-7, -20, -20, -13).fill(look.hair).stroke({ color: OFC.ink, width: INK_W });
    head.circle(-2, -34, 12).fill(look.hair).stroke({ color: OFC.ink, width: INK_W });
  }

  if (sleeping) {
    head.moveTo(-12, -6).quadraticCurveTo(-8, -2, -4, -6).stroke({ color: OFC.ink, width: INK_W_THIN });
    head.moveTo(4, -6).quadraticCurveTo(8, -2, 12, -6).stroke({ color: OFC.ink, width: INK_W_THIN });
  } else {
    head.moveTo(-12.5, -15.5).quadraticCurveTo(-8, -18.5, -3.6, -16.4).stroke({ color: OFC.ink, width: INK_W_THIN });
    head.moveTo(3.6, -16.4).quadraticCurveTo(8, -18.5, 12.5, -15.5).stroke({ color: OFC.ink, width: INK_W_THIN });
    head.circle(-7, -6, 3.1).fill(OFC.ink);
    head.circle(7, -6, 3.1).fill(OFC.ink);
    head.circle(-6, -7.3, 1.05).fill(0xffffff);
    head.circle(8, -7.3, 1.05).fill(0xffffff);
  }

  if (look.glasses) {
    head.roundRect(-15, -12, 13.6, 11, 4.6).stroke({ color: OFC.ink, width: 2.4 });
    head.roundRect(1.4, -12, 13.6, 11, 4.6).stroke({ color: OFC.ink, width: 2.4 });
    head.moveTo(-1.4, -7).lineTo(1.4, -7).stroke({ color: OFC.ink, width: 2.4 });
  }
  return head;
}

function createWorkerGraphics(pose: OfficePose, look: WorkerLook, back: boolean): { container: Container; parts: SeatedParts } {
  const c = new Container();

  const shadow = new Graphics();
  shadow.ellipse(0, 82, 38, 8.5).fill({ color: 0x63707f, alpha: 0.16 });
  c.addChild(shadow);

  const legs = new Graphics();
  legs.roundRect(-8, 58, 34, 14, 7).fill(0x4d5d72).stroke({ color: OFC.ink, width: INK_W });
  legs.roundRect(16, 66, 14, 27, 7).fill(0x4d5d72).stroke({ color: OFC.ink, width: INK_W });
  legs.ellipse(28, 94, 14, 7).fill(0x39424f).stroke({ color: OFC.ink, width: INK_W });
  c.addChild(legs);

  const body = new Container();
  body.pivot.set(0, 52);

  const torso = new Graphics();
  torso.roundRect(-21, 12, 42, 50, 16).fill(look.cloth).stroke({ color: OFC.ink, width: INK_W });
  if (look.collar) torso.moveTo(-10, 13).lineTo(0, 23).lineTo(10, 13).stroke({ color: OFC.ink, width: 2.4 });
  body.addChild(torso);

  const armBack = new Graphics();
  armBack.roundRect(-30, 15, 11, 31, 5.5).fill(look.cloth).stroke({ color: OFC.ink, width: INK_W });
  armBack.circle(-24.5, 48, 6.2).fill(look.skin).stroke({ color: OFC.ink, width: INK_W });
  armBack.pivot.set(-24.5, 15);
  body.addChild(armBack);

  const armFront = new Graphics();
  armFront.roundRect(19, 15, 11, 31, 5.5).fill(look.cloth).stroke({ color: OFC.ink, width: INK_W });
  armFront.circle(24.5, 48, 6.2).fill(look.skin).stroke({ color: OFC.ink, width: INK_W });
  armFront.pivot.set(24.5, 15);
  body.addChild(armFront);

  c.addChild(body);

  const headwrap = new Container();
  headwrap.pivot.set(0, 12);
  headwrap.addChild(buildHead(look, back, pose.kind === "doze"));
  c.addChild(headwrap);

  if (pose.kind === "coffee" && !back) {
    const mug = new Graphics();
    mug.roundRect(-7.5, -9.5, 15, 15, 3.4).fill(0xffffff).stroke({ color: OFC.ink, width: 2.6 });
    mug.moveTo(7.5, -6.5).quadraticCurveTo(14, -2, 7.5, 3.5).stroke({ color: OFC.ink, width: 2.4 });
    mug.position.set(24, 28);
    c.addChild(mug);
  }

  if (pose.kind === "phone" && !back) {
    const phone = new Graphics();
    phone.roundRect(-7.5, -12, 15, 24, 3.8).fill(0x39424f).stroke({ color: OFC.ink, width: 2.4 });
    phone.roundRect(-4.8, -8.6, 9.6, 17.2, 2.2).fill({ color: 0xbfe0ff, alpha: 0.92 });
    phone.position.set(21, 32);
    c.addChild(phone);
  }

  return {
    container: c,
    parts: { body, armBack, armFront, headwrap, pose, back },
  };
}

/** 走动小人：站立姿势，脚底在 (0,0) —— zIndex 取脚底 y 才能跟地面纵深对齐。 */
function createWalker(look: WorkerLook, ground: { x: number; y: number; scale: number }): WalkerParts {
  const container = new Container();
  container.position.set(ground.x, ground.y);
  container.scale.set(ground.scale * PERSON_K);
  container.zIndex = ground.y;

  const body = new Container();

  const legBack = new Graphics();
  legBack.roundRect(-5.5, 0, 11, 36, 5.5).fill(0x4d5d72).stroke({ color: OFC.ink, width: INK_W });
  legBack.ellipse(4, 33, 8.5, 4.5).fill(0x39424f).stroke({ color: OFC.ink, width: 2.4 });
  legBack.position.set(-7, -38);
  body.addChild(legBack);

  const legFront = new Graphics();
  legFront.roundRect(-5.5, 0, 11, 36, 5.5).fill(0x4d5d72).stroke({ color: OFC.ink, width: INK_W });
  legFront.ellipse(4, 33, 8.5, 4.5).fill(0x39424f).stroke({ color: OFC.ink, width: 2.4 });
  legFront.position.set(7, -38);
  body.addChild(legFront);

  const torso = new Graphics();
  torso.roundRect(-19, -80, 38, 44, 13).fill(look.cloth).stroke({ color: OFC.ink, width: INK_W });
  if (look.collar) torso.moveTo(-9, -79).lineTo(0, -70).lineTo(9, -79).stroke({ color: OFC.ink, width: 2.4 });
  body.addChild(torso);

  const armBack = new Graphics();
  armBack.roundRect(-5, 0, 10, 30, 5).fill(look.cloth).stroke({ color: OFC.ink, width: INK_W });
  armBack.circle(0, 30, 6).fill(look.skin).stroke({ color: OFC.ink, width: INK_W });
  armBack.position.set(-22, -74);
  body.addChild(armBack);

  const armFront = new Graphics();
  armFront.roundRect(-5, 0, 10, 30, 5).fill(look.cloth).stroke({ color: OFC.ink, width: INK_W });
  armFront.circle(0, 30, 6).fill(look.skin).stroke({ color: OFC.ink, width: INK_W });
  armFront.position.set(22, -74);
  body.addChild(armFront);

  const headwrap = new Container();
  headwrap.pivot.set(0, 12);
  headwrap.position.set(0, -77);
  headwrap.addChild(buildHead(look, false, false));
  body.addChild(headwrap);

  const shadow = new Graphics();
  shadow.ellipse(0, 0, 30, 8).fill({ color: 0x63707f, alpha: 0.16 });
  container.addChild(shadow, body);

  return {
    container,
    body,
    legBack,
    legFront,
    armBack,
    armFront,
    headwrap,
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

  scene.swayers.forEach((s) => {
    s.obj.rotation = Math.sin(scene.clock * s.speed + s.phase) * s.amp;
  });

  scene.seats.forEach((view) => {
    if (!view.parts) return;
    view.clock += delta * 0.06;
    const p = view.parts;
    const t = view.clock;

    p.headwrap.rotation = 0;
    p.body.rotation = 0;
    p.body.scale.y = 1;

    if (p.pose.kind === "doze") {
      p.headwrap.rotation = 7 * d2r;
      p.armBack.rotation = 2 * d2r;
      p.armFront.rotation = 2 * d2r;
      return;
    }
    if (p.pose.kind === "stretch") {
      const cyc = (Math.sin(t * 2.2) + 1) / 2;
      p.armBack.rotation = cyc * 148 * d2r;
      p.armFront.rotation = -cyc * 148 * d2r;
      p.body.rotation = -3.5 * d2r * cyc;
      return;
    }
    if (p.pose.kind === "coffee") {
      const cyc = (Math.sin(t * 1.6) + 1) / 2;
      p.armFront.rotation = (-48 - cyc * 16) * d2r;
      p.armBack.rotation = -16 * d2r;
      return;
    }
    if (p.pose.kind === "phone") {
      const cyc = (Math.sin(t * 1.4) + 1) / 2;
      p.armFront.rotation = (-62 - cyc * 8) * d2r;
      p.armBack.rotation = -20 * d2r;
      p.headwrap.rotation = 2.6 * d2r * cyc;
      return;
    }
    if (p.pose.kind === "note") {
      const cyc = (Math.sin(t * 3.4) + 1) / 2;
      p.armFront.rotation = (-34 + cyc * 7) * d2r;
      p.armBack.rotation = -22 * d2r;
      return;
    }
    const typing = (Math.sin(t * 6) + 1) / 2;
    p.armBack.rotation = (-8 - typing * 18) * d2r;
    p.armFront.rotation = (8 + typing * 18) * d2r;
    p.body.scale.y = 1 + Math.sin(t * 2.4) * 0.024;
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
    w.armBack.rotation = -swing * 0.3;
    w.armFront.rotation = swing * 0.3;
    w.body.y = walking ? -Math.abs(Math.sin(w.clock * 7)) * 2.6 : 0;
    w.headwrap.rotation = walking ? Math.sin(w.clock * 7) * 0.04 : 0;
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
