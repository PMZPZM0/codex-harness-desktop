/**
 * 办公室画布（team-office 域，09-30 v18「Kenney CC0 资产版」）。
 *
 * 渲染栈：PixiJS v8 + Kenney 等距资产（全部 CC0，见 office-assets.ts 头注释）。
 * ⛔ 三条硬规矩（前几版实测换来的）：
 *   ① **等距资产不做纵深缩放**（尺寸按格定死，缩放会让桌腿与地板格子错位）；
 *   ② **zIndex = 屏幕 y**（等距房间的遮挡关系完全由 y 决定，桌椅人地毯同一条排序）；
 *   ③ **只动 transform 不重画**（呼吸/走路/屏幕动画都改 transform 或换 texture）。
 *
 * 角色与桌椅的关系：Kenney Toon Characters 的 45 个姿势**全是站姿**（无坐姿），
 *   所以工位上的人用 `back`（背对观众）站在桌子**远端**，下半身被桌面挡住 ——
 *   观感即"坐在桌前"，这也是 v9~v17 验证过的构图。
 */
import { Application, Assets, Container, Graphics, Sprite, Texture } from "pixi.js";
import { useEffect, useRef, useState } from "react";
import { FURNITURE, PERSON_POSES, furnitureOf, poseOf } from "./office-assets";
import {
  DESKS, PROPS, ROOM_D, ROOM_W, SCENE_H, SCENE_W, floorDiamond, isoPoint, type Placement, type ScreenKind,
} from "./office-scene";

export type OfficeMember = { id: string; name: string; profession: string; running: boolean; hasThread: boolean };
export type OfficeCanvasProps = {
  ceoName: string;
  ceoProfession: string;
  members: OfficeMember[];
  /** 点某个成员（打开它的会话） */
  onOpenMember?: (memberId: string) => void;
};

/** 成员外观池（Kenney Toon Characters 1 的三套角色，按序号稳定派生）。 */
const LOOKS = ["malePerson", "femalePerson", "robot"] as const;

/* ── 贴图缓存 ──
   ⛔⛔ Pixi **v8 的 Texture.from(url) 对未加载的 URL 返回空纹理**（1×1 白点）——
      第一版就是这么白忙一场：家具角色全是小白点。必须先用 Assets.load 预加载，
      再 from（v8 里 Assets 才是 URL → Texture 的入口）。 */
const texCache = new Map<string, Texture | null>();
let artLoaded = false;

async function preloadOfficeArt(): Promise<void> {
  if (artLoaded) return;
  const urls = [...Object.values(FURNITURE), ...Object.values(PERSON_POSES)];
  await Assets.load(urls);
  artLoaded = true;
}

function tex(url: string | null): Texture | null {
  if (!url) return null;
  if (texCache.has(url)) return texCache.get(url)!;
  const t = Texture.from(url);
  texCache.set(url, t);
  return t;
}

type Actor = {
  key: string;
  who: string;
  container: Container;
  sprite: Sprite;
  /** 工位格坐标 */
  u: number;
  v: number;
  /** 当前状态 */
  state: "idle" | "work";
  clock: number;
  memberId: string | null;
};

type Scene = {
  actors: Actor[];
  tickers: Array<(t: number) => void>;
  screens: Array<(t: number) => void>;
};

function emptyScene(): Scene {
  return { actors: [], tickers: [], screens: [] };
}

/** 房间外壳：地板菱形网格 + 两面内墙（等距平行四边形）。 */
function paintRoom(root: Container): void {
  const g = new Graphics();
  g.zIndex = -1e6;
  const [top, right, bottom, left] = floorDiamond();

  /* 地板：整块底色 + 逐格浅线（Kenney 家具是按 128×64 菱形格设计的，网格必须对齐） */
  g.poly([top.x, top.y, right.x, right.y, bottom.x, bottom.y, left.x, left.y]).fill(0xeceae4);
  for (let u = 0; u <= ROOM_W; u++) {
    const a = isoPoint(u, 0);
    const b = isoPoint(u, ROOM_D);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: 0xdedbd3, width: 1 });
  }
  for (let v = 0; v <= ROOM_D; v++) {
    const a = isoPoint(0, v);
    const b = isoPoint(ROOM_W, v);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: 0xdedbd3, width: 1 });
  }

  /* 两面墙：后墙沿 u 轴（左上边）、左墙沿 v 轴 —— 等距房间里这两面朝向观众 */
  const WALL = 150;
  const na = isoPoint(0, 0);
  const nb = isoPoint(ROOM_W, 0);
  g.poly([na.x, na.y, nb.x, nb.y, nb.x, nb.y - WALL, na.x, na.y - WALL]).fill(0xf4f2ec);
  const la = isoPoint(0, ROOM_D);
  g.poly([na.x, na.y, la.x, la.y, la.x, la.y - WALL, na.x, na.y - WALL]).fill(0xe7e4dc);
  /* 墙脚踢脚线（一条深线就让房间"立"起来） */
  g.moveTo(na.x, na.y).lineTo(nb.x, nb.y).stroke({ color: 0xd6d2c8, width: 2 });
  g.moveTo(na.x, na.y).lineTo(la.x, la.y).stroke({ color: 0xd6d2c8, width: 2 });
  root.addChild(g);
}

/** 摆一件家具（anchor 底边中心 = 它的落脚点）。 */
function placeProp(root: Container, p: Placement): void {
  const t = tex(furnitureOf(p.key));
  if (!t) return;
  const sp = new Sprite(t);
  sp.anchor.set(0.5, 1);
  const pt = isoPoint(p.u, p.v);
  sp.position.set(pt.x + (p.dx ?? 0), pt.y + (p.dy ?? 0));
  if (p.scale) sp.scale.set(p.scale);
  sp.zIndex = sp.position.y + (p.dy ?? 0);
  root.addChild(sp);
}

/** 显示器屏幕内容（程序化小动画：代码行逐条出现 / 图表柱缓慢生长）。 */
function paintScreen(root: Container, u: number, v: number, kind: ScreenKind): (t: number) => void {
  const pt = isoPoint(u, v);
  const w = 30;
  const h = 19;
  // 屏幕贴在显示器面板上（显示器图 47×59，屏幕约占中上部）
  const x = pt.x - w / 2 + 1;
  const y = pt.y - 30 - 26;
  const box = new Container();
  box.zIndex = pt.y - 20;
  const g = new Graphics();
  g.roundRect(x, y, w, h, 1.5).fill(kind === "off" ? 0x2b3038 : 0xf7fbff);
  if (kind !== "off") {
    const accent = kind === "chart" ? 0x4a90d9 : kind === "sheet" ? 0x63b06a : 0xd96a4a;
    g.rect(x + 3, y + 3, w - 6, 1.4).fill(0xc9d3dd);
    for (let i = 0; i < 3; i++) {
      const bar = new Graphics();
      bar.rect(x + 4 + i * 7, y + 14, 4, 1);
      bar.fill(accent);
      box.addChild(bar);
    }
  }
  box.addChild(g);
  root.addChild(box);
  return (t: number) => {
    if (kind === "off") return;
    // 光标行缓慢上下扫（"屏幕活着"的最小信号，只改 transform）
    box.y = Math.sin(t * 1.4) * 0.6;
  };
}

export function OfficeCanvas({ ceoName, ceoProfession, members, onOpenMember }: OfficeCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const appRef = useRef<Application | null>(null);
  const sceneRef = useRef<Scene>(emptyScene());
  const memberRef = useRef(onOpenMember);
  memberRef.current = onOpenMember;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cleaned = false;
    let inited = false;
    /* 场景时钟（秒）：⛔ 在 setup 之前声明 —— setup 是 async，同步段会先跑，
       声明晚了就是 ReferenceError（第一次跑就踩过） */
    let epoch = 0;
    const app = new Application();
    appRef.current = app;

    const setup = async () => {
      await app.init({ width: SCENE_W, height: SCENE_H, background: 0xf7f8fa, antialias: true, resolution: window.devicePixelRatio || 1, autoDensity: true });
      if (cleaned) { try { app.destroy(true, { children: true, texture: true }); } catch { /* 已卸载 */ } return; }
      inited = true;
      host.appendChild(app.canvas);
      app.canvas.style.width = "100%";
      app.canvas.style.height = "auto";
      app.canvas.style.display = "block";

      const world = new Container();
      world.sortableChildren = true;
      app.stage.addChild(world);

      /* ⛔ 先把 193 张 CC0 资产全部加载完再建场景 —— 边加载边画会出现"一部分是白点"的中间态 */
      await preloadOfficeArt();
      if (cleaned) { try { app.destroy(true, { children: true, texture: true }); } catch { /* 已卸载 */ } return; }

      paintRoom(world);
      for (const p of PROPS) placeProp(world, p);

      /* 工位：桌子 + 椅子 + 电脑（⛔ 逐件 zIndex = 屏幕 y，等距遮挡全靠它） */
      const scene = sceneRef.current;
      const list: OfficeMember[] = [
        { id: "ceo", name: ceoName || "CEO", profession: ceoProfession || "统筹", running: members.some((m) => m.running), hasThread: true },
        ...members,
      ];
      DESKS.forEach((d, i) => {
        /* 工位摆件（⛔ 顺序 = 由远到近，zIndex 由各自的屏幕 y 决定，写着只是可读性）：
           地毯 → 桌 → 椅子（人身后）→ 显示器（正面朝观众）→ 键盘/鼠标
           ⛔ 显示器用 **NW/NW 面**：SW/SE 朝向看到的是机身背面（实测是一片黑），
              观众的视线是从南往北，只有 NW/NE 面才露出屏幕。 */
        placeProp(world, { key: `rugRectangle_SE`, u: d.u, v: d.v, dy: -2, scale: 0.42 });
        placeProp(world, { key: `desk_${d.side}`, u: d.u, v: d.v });
        placeProp(world, { key: `chairDesk_${d.side}`, u: d.u + 0.12, v: d.v + 0.78, dy: -6 });
        placeProp(world, { key: `computerScreen_SE`, u: d.u - 0.06, v: d.v - 0.30, dy: -62 });
        placeProp(world, { key: `computerKeyboard_SE`, u: d.u - 0.2, v: d.v + 0.02, dy: -64 });
        placeProp(world, { key: `computerMouse_SE`, u: d.u + 0.3, v: d.v + 0.06, dy: -64 });
        const kinds: ScreenKind[] = ["code", "chart", "sheet", "mail", "code", "chart"];
        scene.screens.push(paintScreen(world, d.u - 0.06, d.v - 0.30, kinds[i % kinds.length]));

        /* 角色：**坐在桌前的椅子上**（v + 0.62，比桌子大 ⇒ zIndex 更大 ⇒ 画在桌子之上），
           back 姿势背对观众 —— 等距里这就是"人在桌前办公"的标准构图。
           ⛔ 别放到桌子远端（v - x）：那时 zIndex 更小，整个人会被桌+显示器盖掉（实测全看不见）。 */
        const who = i === 0 ? "malePerson" : LOOKS[i % LOOKS.length];
        const t = tex(poseOf(who, "back"));
        if (!t) return;
        const sp = new Sprite(t);
        sp.anchor.set(0.5, 1);
        const pt = isoPoint(d.u + 0.12, d.v + 0.62);
        sp.position.set(pt.x, pt.y + 2);
        sp.zIndex = sp.position.y;
        sp.eventMode = i > 0 ? "static" : "none";
        if (i > 0) { sp.cursor = "pointer"; sp.on("pointertap", () => memberRef.current?.(list[i].id)); }
        world.addChild(sp);

        /* 名字标签（小字，跟着人物走；⛔ 只改 transform） */
        scene.actors.push({ key: list[i]?.id ?? `m${i}`, who, container: world, sprite: sp, u: d.u, v: d.v, state: "work", clock: i * 0.7, memberId: i > 0 ? list[i].id : null });
      });

      /* 一名走动的人（演示 8 帧走路循环：沿房间对角来回） */
      const walkTex = (f: number) => tex(poseOf("femalePerson", `walk${f}`));
      if (walkTex(0)) {
        const w = new Sprite(walkTex(0)!);
        w.anchor.set(0.5, 1);
        world.addChild(w);
        let wt = 0;
        const path: Array<[number, number]> = [[9.4, 5.6], [2.6, 6.2], [2.6, 5.2], [9.4, 4.6]];
        let seg = 0;
        scene.tickers.push((dt: number) => {
          wt += dt;
          const SPEED = 0.22;  // 秒/格
          const [au, av] = path[seg];
          const [bu, bv] = path[(seg + 1) % path.length];
          const len = Math.hypot(bu - au, bv - av);
          const prog = wt / (len * SPEED);
          if (prog >= 1) { wt = 0; seg = (seg + 1) % path.length; return; }
          const u = au + (bu - au) * prog;
          const v = av + (bv - av) * prog;
          const pt = isoPoint(u, v);
          w.position.set(pt.x, pt.y);
          w.zIndex = pt.y;
          const frame = Math.floor(prog * len * 6) % 8;
          const t2 = walkTex(frame);
          if (t2) w.texture = t2;
          // 朝向：向右移动时水平翻转（Kenney 角色原图朝左）
          w.scale.x = bu > au ? -1 : 1;
        });
      }

      app.ticker.add((tk) => {
        const dt = tk.deltaMS / 1000;
        epoch += dt;
        for (const a of scene.actors) {
          a.clock += dt;
          // 呼吸：只改 scale.y（等距下"活着"的最小信号）
          a.sprite.scale.y = 1 + Math.sin(a.clock * 1.6) * 0.012;
        }
        for (const t of scene.tickers) t(dt * 60);
        for (const s of scene.screens) s(epoch);
      });
      setReady(true);
    };
    void setup();

    return () => {
      cleaned = true;
      if (inited) { try { app.destroy(true, { children: true, texture: true }); } catch { /* 已销毁 */ } }
      appRef.current = null;
      sceneRef.current = emptyScene();
    };
    // ⛔ 只在挂载时建一次（成员变化由下面的 effect 走 transform，不重建画布）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 成员名签（DOM 覆盖层，避免 Pixi 文字纹理的字体问题） */
  return (
    <div className="office-scene" ref={hostRef} data-ready={ready ? "1" : "0"}>
      {ready && (
        <div className="office-tags">
          {[{ id: "ceo", name: ceoName || "CEO", profession: ceoProfession || "统筹", running: false, hasThread: true } as OfficeMember, ...members].slice(0, DESKS.length).map((m, i) => (
            <span key={m.id} className="office-tag" style={{ left: `${tagPos(i).x}%`, top: `${tagPos(i).y}%` }}>
              {m.name}<i>{m.running ? "工作中" : m.hasThread ? "空闲" : "未开工"}</i>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** 名签位置（百分比，与 DESKS 的格坐标同源换算 —— ⛔ 改布局要一起改）。 */
function tagPos(i: number): { x: number; y: number } {
  const d = DESKS[i] ?? DESKS[0];
  const pt = isoPoint(d.u + 0.12, d.v + 0.62);
  return { x: (pt.x / SCENE_W) * 100, y: ((pt.y - 96) / SCENE_H) * 100 };
}
