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
import { Application, Container, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";
import {
  OFC, SILHOUETTE, FUR, FUR_LIT, FUR_SHADE, FACE,
  animalOf, collarColor, collarDark, type AnimalKind,
} from "./office-palette";
import { animalArtOf, artTexture, preloadArt, propArtOf, personPresetOn, sceneBgArt } from "./office-art";
import { personArtOf } from "./office-art-person";
import { poseArtOf, walkArtOf } from "./office-art-pose";
import { deskSlots, floorPoint, SCENE_W, SCENE_H, type FloorSpot } from "./office-iso";
// 走动人寻路（09-27）：BFS 网格路径，⛔ 别再退回"直线插值"（那会让人穿过别人的桌子）。
// ⚠️ 它是 .mjs 而不是 .ts：纯函数才能被预检守卫**直接 import 跑真值表**（`.ts` 守卫只能读文本）。
import { buildWalkGrid, findPath } from "./office-nav.mjs";
import type { DirectorSnapshot, OfficePose, OfficeHandoff, ErrandSpot } from "./office-director";
import type { OfficeMember } from "./OfficeScene";

import {
  drawRoom as paintRoom, drawBackWall, drawSideProps, drawDeskStation, drawChair,
  drawAmenities, drawAmenityProps, screenKindOf, softShadow, CHAIR_DV, DESK_DV, DESK_HALF_U, DESK_H, MONITOR_DV, MONITOR_LIFT, type PropTicker,
  drawScreenOnly,
} from "./office-render";

/**
 * 人物整体缩放。⛔ 与工位几何是一组：把人放大会让耳朵顶到显示器上、
 *    椅子盖不住下半身（两侧都实测过），改这里必须同时看 SEAT_LIFT。
 *    ⛔ 09-30 从 0.76 收到 **0.60**（用户：「渲染整体可以小一点，人物桌子凳子，
 *       这样有限的场景可以多放一些配套设施」）—— 同步缩小的还有桌深/桌宽/桌高/椅距
 *       （office-render.ts 的 DESK_DV / DESK_HALF_U / DESK_H / MONITOR_LIFT / CHAIR_DV）。
 */
const PERSON_K = 0.6;
/** 人物容器相对座位地面点的抬升（屏幕像素，再乘纵深缩放）。人物缩小后同步收到 45。 */
const SEAT_LIFT = 45;
/**
 * 头顶标签的抬升（屏幕像素，再乘纵深缩放）。⛔ 这个值被两件事同时夹住（改前先算）：
 *   **下限** = 角色耳朵顶（最高的狐狸约在座面点上方 129k）；**上限** = 显示器下沿（154.8k）。
 *   标签高 19 ⇒ 抬 145 刚好落在中间：下缘 135.5k（离耳尖 6k）、上缘 154.5k（离屏沿 0.3k）。
 *   调低会被耳朵戳穿（v10 第二版实测），调高会压住屏幕。
 */
const TAG_LIFT = 115;
/** 交接锚点：卡片在两人**头侧**飞。⛔ 别取头顶正中 —— 起点标记会正好盖在脑袋上，
 *  放大看像头顶长了个包（v10 实测）。锚点高度取头位（在耳顶与头顶之间）。 */
const HANDOFF_LIFT = 76;
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
  /* 09-30 新增（人物/桌凳缩小后腾出的边缘空地）：⛔ 与 office-render.drawAmenities 的
     AMEN_SPRITES 坐标**逐字同源**（守卫【176】）——「去跑步机」的人要真的站在跑步机旁。 */
  treadmill: { u: 0.94, v: 0.84 }, // 跑步机（右下空地）
  vending: { u: 0.76, v: 0.115 },  // 贩卖机（上墙右）
  tea: { u: 0.655, v: 0.115 },     // 茶水台（上墙中，杯特写）
};

/** 小人**站**的位置：设施锚点往观众侧挪一点（站进设施里穿帮，站在设施前才对）。 */
const ERRAND_STAND_UV: Record<ErrandSpot, { u: number; v: number }> = {
  water: { u: 0.90, v: 0.68 },
  printer: { u: 0.82, v: 0.20 },
  shelf: { u: 0.08, v: 0.30 },
  restroom: { u: 0.10, v: 0.96 },
  treadmill: { u: 0.885, v: 0.90 },
  vending: { u: 0.72, v: 0.175 },
  tea: { u: 0.625, v: 0.175 },
};

/** 角色身份：物种（外形）+ 项圈色（颜色）+ 转头方向（09-30 五官朝向）。
 *  ⛔ 三者都由序号稳定派生，不是每拍随机 —— 否则同一人每次进办公室都换脸。 */
type Cosplay = { animal: AnimalKind; collar: string; face: -1 | 1 };

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
  /** 人物化槽位（09-30）：CEO = "ceo"，成员 = person0..7（素材表 PERSON_ART 的键）。 */
  person: string;
};

/** 落座人物的可动画部件（重建只在姿势/朝向变化时发生）。
 *  ⛔ 素材路线（生图精灵）没有可动四肢 / 耳朵 ⇒ 这几个字段为 null，动画层必须逐个判空
 *     （否则"加了贴图就白屏/报错"）。 */
interface SeatedParts {
  body: Container;
  armBack: Graphics | null;
  armFront: Graphics | null;
  headwrap: Container | null;
  /** 左右耳各一支（pivot 在耳根）—— 动画层做"单边抽动"的抓手 */
  ears: Graphics[] | null;
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

/** 走动小人：位置由 ticker **沿 BFS 路径**插值（09-27 v12 起不再是直线），⛔ 不是瞬移。 */
interface WalkerParts {
  container: Container;
  body: Container;
  legBack: Graphics | null;
  legFront: Graphics | null;
  armBack: Graphics | null;
  armFront: Graphics | null;
  headwrap: Container | null;
  /** 左右耳（pivot 在耳根）—— 走路时耳朵跟着颠 */
  ears: Graphics[] | null;
  /* ── 09-30 走路两帧动画（生图侧面行走图集）── */
  /** 行走精灵：walkArtOf 命中时非 null，animateScene 里按步频交替换 texture（⛔ 不重建 Sprite） */
  walkSprite: Sprite | null;
  /** [触地帧, 过渡帧] 的 **URL**（换帧 = artTexture(url) 查表，不走 Assets.load） */
  walkFrames: [string, string] | null;
  /** 到达设施后的**使用姿势**（drink / operate / run / chat / stand）—— t≥1 时切换 texture */
  usingTex: Texture | null;
  /** 回程端杯走（tea/coffee/vending 返程专用姿势图）—— away=false 时切换 */
  cupTex: Texture | null;
  /** 跑步机原地跑（到达后继续颠，不停下） */
  runInPlace: boolean;
  /** 0 = 还在工位，1 = 已走到目标（回程就是让它递减 —— 路径天然可逆，不用另存一条） */
  t: number;
  /** 行进路径（屏幕坐标点列，含起点与终点）：由 office-nav 的 BFS 算出来，绕开桌椅 */
  path: Array<{ x: number; y: number; scale: number }>;
  /** 各段长度与总长（按屏幕距离）—— 把 t 均匀映射到路径上，避免长段走得飞快、短段磨蹭 */
  segLen: number[];
  totalLen: number;
  /** 目标签名（kind|visitIndex|spot）：**变了才重算路径** —— 否则每帧重跑 BFS */
  pathKey: string;
  /** 当前是否在**去目标**的路上：true ⇒ t 递增；false ⇒ t 递减（沿同一条路径走回工位，
   *  路径天然可逆，不用另存一条 —— 这也是保留这个布尔的原因） */
  away: boolean;
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
  /** fly = 飞行卡片（任务/成果/资料）；bubble = 两人中点上方的聊天气泡（09-30） */
  mode: "fly" | "bubble";
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
  /** 走动人用的可行走网格（按工位布局缓存：布局没变就不重建 —— 每次寻路重算是白烧 CPU） */
  navGrid: ReturnType<typeof buildWalkGrid> | null;
  /** 网格对应的工位签名（布局变了才重建） */
  navKey: string;
  /** 独立椅子精灵（09-30「离开要挪椅子」：按工位缓存，away 时转开 + 挪位） */
  chairs: Map<string, { sp: Sprite; baseX: number; away: boolean }>;
  /** 正在被使用的跑腿点（人物 errand 到达 ⇒ 设施动画加速 —— 物体↔人物互动） */
  amenBusy: Set<ErrandSpot>;
  /** 底稿模式（出背景图用）：跳过椅子 / 设施 / 空位牌，只烙房间壳+桌+显示器+挂钟蒸汽 */
  draft: boolean;
  clock: number;
}

function emptyScene(): SceneRefs {
  return { statics: new Map(), staticsKey: "", seats: new Map(), walkers: new Map(), tags: new Map(), handoffs: new Map(), props: [], screens: [], navGrid: null, navKey: "", chairs: new Map(), amenBusy: new Set(), draft: false, clock: 0 };
}

export type OfficeCanvasProps = {
  ceoName: string;
  ceoProfession: string;
  members: OfficeMember[];
  snapshot: DirectorSnapshot;
  onOpenThread?: (memberId: string) => void;
  /** 点设施派人过去（09-30「交互很重要」：点饮水机 → 有人去接水）。 */
  onFacilityClick?: (spot: ErrandSpot) => void;
  /** 底稿模式（预览页出背景图用）：跳过椅子/设施/空位牌。 */
  draftMode?: boolean;
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** 起步慢、中段快、落位慢（线性平移看着像滑轨，不像走路）。 */
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function OfficeCanvas({ ceoName, ceoProfession, members, snapshot, onOpenThread, onFacilityClick, draftMode }: OfficeCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const sceneRef = useRef<SceneRefs>(emptyScene());
  const layersRef = useRef<{ world: Container; tags: Container; handoffs: Container } | null>(null);
  const openThreadRef = useRef(onOpenThread);
  openThreadRef.current = onOpenThread;
  const onFacilityRef = useRef(onFacilityClick);
  onFacilityRef.current = onFacilityClick;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = sceneRef.current;
    scene.draft = Boolean(draftMode);
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

      // 素材预加载（生图预设）：⛔ 必须在 setReady 之前 await —— 晚一步，第一批角色会
      // 因为贴图还没进缓存而回落到程序化绘制，画面里两种画风混着出现（难看且难查）。
      await preloadArt();
      if (cleaned) {
        try { app.destroy(true, { children: true, texture: true }); } catch { /* 已卸载 */ }
        return;
      }

      /* ── 场景背景（09-30「场景/桌椅/设施一次完成」）：edits 按白模重绘的真实办公室 ——
         房间/桌椅/大件设施都在图里（桌位 = deskSlots 坐标，机位由底稿锁死）。
         背景命中 ⇒ 跳过程序化房间绘制（paintRoom/backWall/sideProps），
         syncStatics 里也只叠屏幕动画；挂钟/蒸汽继续程序化（位置与白模同源，白面盖住背景钟无重影）。
         开关：localStorage "office-art-scene" = "0" 回全程序化。 */
      const bgUrl = sceneBgArt();
      if (bgUrl) {
        const bgTex = artTexture(bgUrl);
        if (bgTex) {
          const bg = new Sprite(bgTex);
          bg.zIndex = -1e6;
          /* 铺满整个场景画布：底图 3:2、场景 1000×740（≈1.35:1），轻微拉伸在等距观感下不可辨；
             图外围的浅灰留白与画布底色一致。 */
          bg.position.set(-8, -6);
          bg.width = SCENE_W + 16;
          bg.height = SCENE_H + 12;
          world.addChild(bg);
        }
      }
      if (!bgUrl) {
        paintRoom(world);
        drawBackWall(world);
      }
      drawSideProps(world);
      if (bgUrl) {
        /* 场景背景正式模式（09-30「物体都独立化」）：背景图只烙房间壳+桌子+显示器，
           全部设施走 drawAmenityProps **独立精灵**（可动画 / 可点选 / 有人使用时加速）；
           drawAmenities 只保留挂钟 / 咖啡蒸汽这些程序化动画件（facilities:false 跳过设施段）。
           底稿模式（draftMode）不叠设施精灵 —— 底稿烙进背景的就是"没有设施"的房间。 */
        scene.props = [...drawAmenities(world, { facilities: false })];
        if (!draftMode) {
          scene.props.push(...drawAmenityProps(world, {
            onPick: (spot) => onFacilityRef.current?.(spot),
            busySpots: () => scene.amenBusy,
          }));
        }
      } else {
        scene.props = drawAmenities(world, { facilities: !draftMode });
      }
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
    const scene = sceneRef.current;
    /* 物体↔人物互动：正在跑腿的成员 = 对应设施「使用中」（动画加速由 amenTickers 读） */
    scene.amenBusy = new Set(
      snapshot.poses.filter((p) => p && p.kind === "errand" && p.spot).map((p) => p.spot as ErrandSpot),
    );
    syncStatics(layers.world, slots, scene);
    syncPeople(layers.world, slots, scene, openThreadRef);
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
    cosplay: { animal: animalOf(0, true), collar: collarColor(0, true), face: 1 },
    person: "ceo",
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
      cosplay: { animal: animalOf(i), collar: collarColor(i), face: i % 2 ? 1 : -1 },
      // 人物化槽位：第 i 个成员用第 i 套外观（发色/服装不同），超出 8 人取模复用
      person: `person${i % 8}`,
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
  //    09-30 加 profession（屏幕内容按职业映射 —— 漏了会出现「换了人屏幕没换」）。
  //    漏掉 running 的后果实测过：成员从「空闲」变成「工作中」，显示器还停在空闲时的画面
  //    （syncStatics 提前 return，永不重画）。
  const key = slots
    .map((s) => `${s.key}@${s.x.toFixed(1)},${s.y.toFixed(1)}:${s.idx}:${s.running ? 1 : 0}:${s.pose?.kind === "doze" ? 1 : 0}:${s.profession}`)
    .join("|");
  if (key === scene.staticsKey) return;
  scene.staticsKey = key;
  for (const groups of scene.statics.values()) {
    for (const g of groups) {
      world.removeChild(g);
      g.destroy({ children: true });
    }
  }
  /* 独立椅子精灵随工位重建一起换（old sprite 已挂 world，必须手动摘） */
  for (const [, ch] of scene.chairs) {
    world.removeChild(ch.sp);
    ch.sp.destroy({ children: true });
  }
  scene.chairs.clear();
  scene.statics.clear();
  scene.screens = [];

  for (const slot of slots) {
    /* 底稿模式：显示器一律**熄屏**（edits 渲染成关着的屏幕；亮屏界面烙进背景会假） */
    const screen = scene.draft ? "sleep" : screenKindOf(slot.idx, slot.running, slot.pose?.kind === "doze", slot.profession);

    /* ── 场景背景模式：房间/桌子/显示器烙在背景图里 ⇒ 叠屏幕动画 + **独立椅子精灵**。
       椅子独立出来才能做「离开挪椅」（09-30 用户点名）；底稿模式跳过（背景里不要椅子）。── */
    const sceneBg = sceneBgArt();
    if (sceneBg) {
      const box = new Container();
      box.zIndex = floorPoint(slot.u, slot.v - MONITOR_DV).y - 1;
      world.addChild(box);
      const screenAnim = drawScreenOnly(slot.u, slot.v, screen, box);
      if (screenAnim) scene.screens.push(screenAnim);
      scene.statics.set(slot.key, [box]);
      if (!scene.draft) {
        /* 独立空椅（away 时亮出）：素材椅命中用精灵；缺图（生图失败等）降级程序化椅子
           —— ⛔ 人物坐姿图自带椅子，人在位时隐藏（双椅穿帮），只有人离开才显示空椅。 */
        const cp = floorPoint(slot.u, slot.v + CHAIR_DV);
        const art = propArtOf("chair");
        const tex = art ? artTexture(art.url) : null;
        if (art && tex) {
          const sp = new Sprite(tex);
          sp.anchor.set(0.5, 1);
          sp.width = art.w * cp.scale;
          sp.height = (tex.height / tex.width) * sp.width;
          sp.position.set(cp.x, cp.y);
          sp.zIndex = cp.y;
          sp.visible = false;
          world.addChild(sp);
          scene.chairs.set(slot.key, { sp, baseX: cp.x, away: false });
        } else {
          /* 程序化降级：host 定位在椅子落点（rotation 绕它 = 转椅效果），g 反向偏移
             抵消 drawChair 内部的绝对坐标（它按 floorPoint 绝对定位画）。 */
          const chairG = new Graphics();
          const chairHost = new Container();
          chairHost.zIndex = cp.y;
          chairHost.position.set(cp.x, cp.y);
          chairG.position.set(-cp.x, -cp.y);
          drawChair(chairG, slot.u, slot.v);
          chairHost.addChild(chairG);
          chairHost.visible = false;
          world.addChild(chairHost);
          scene.chairs.set(slot.key, { sp: chairHost as unknown as Sprite, baseX: cp.x, away: false });
        }
      }
      continue;
    }

    const desk = new Graphics();
    const deskBox = new Container();
    // 桌面占地的**中心**地面 y —— 比人物容器更小 = 更靠后
    deskBox.zIndex = floorPoint(slot.u, slot.v - DESK_DV / 2).y;
    // ⛔ 桌子先挂进 box，再让 drawDeskStation 把"会动的屏幕"挂上去 —— 顺序反了屏幕会被外壳盖住
    deskBox.addChild(desk);
    const screenAnim = drawDeskStation(desk, slot.u, slot.v, screen, deskBox, slot.idx);
    if (screenAnim) scene.screens.push(screenAnim);

    const chair = new Graphics();
    // 椅子的地面 y 比座位点更靠观众 ⇒ 自动排在人物之后
    const chairBox = new Container();
    chairBox.zIndex = floorPoint(slot.u, slot.v + CHAIR_DV).y;
    // ⛔ chairBox 必须先建出来再交给 drawChair：素材路线要把椅子精灵挂在这个 Container 上
    drawChair(chair, slot.u, slot.v, chairBox);
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
  // 可行走网格：按工位布局**缓存**（布局没变就不重建 —— 每帧重建 768 格纯属浪费）
  const navKey = slots.map((s) => `${s.u.toFixed(3)},${s.v.toFixed(3)}`).join(";");
  if (!scene.navGrid || scene.navKey !== navKey) {
    scene.navGrid = buildWalkGrid(slots.map((s) => ({ u: s.u, v: s.v })));
    scene.navKey = navKey;
  }
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
    /* ⛔ pose.kind === "absent" 与无会话同等处理：absent 的人不能画成"坐着的动物"（底稿/空快照路径） */
    const state: "running" | "idle" | "never" = !slot.hasThread || !slot.pose || slot.pose.kind === "absent"
      ? "never"
      : slot.running ? "running" : "idle";
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
        if (!scene.draft) view.container.addChild(buildVacant(slot.scale));
        view.container.eventMode = "none";
      } else if (!away && pose) {
        const { container: person, parts } = createWorkerGraphics(pose, slot.cosplay, back, slot.person);
        view.container.addChild(person);
        view.parts = parts;
        view.container.eventMode = slot.memberId ? "static" : "none";
      }
    }

    /* 走动：visit/errand 时把人换成走动小人，位置由 ticker **沿 BFS 路径**推进（09-27 v12） */
    const ground = { x: slot.x, y: slot.y - 12, scale: slot.scale };
    /* 独立椅子跟随：人离开 ⇒ 空椅亮出 + 转开挪位（animateScene lerp）；回位 ⇒ 椅子隐藏 */
    const chairRef = scene.chairs.get(slot.key);
    if (chairRef) { chairRef.away = away; chairRef.sp.visible = away; }
    let walker = scene.walkers.get(slot.key);
    if (away && pose) {
      if (!walker) {
        walker = createWalker(slot.cosplay, ground, slot.person, pose.kind === "errand" ? pose.spot : undefined);
        world.addChild(walker.container);
        scene.walkers.set(slot.key, walker);
      }
      walker.away = true;
      // ⛔ 目标没变就别重算：本函数每帧都跑，无条件重算 = 每帧一次 BFS
      const key = walkKeyOf(pose);
      if (walker.pathKey !== key) {
        const target = walkTarget(pose, slots);
        walker.path = buildWalkerPath(scene, ground, { u: slot.u, v: slot.v }, target);
        const measured = measurePath(walker.path);
        walker.segLen = measured.segLen;
        walker.totalLen = measured.totalLen;
        walker.pathKey = key;
      }
    } else if (walker) {
      // 回程：沿**同一条路径反向**走回（t 递减到 0 即卸载），不重算路径
      walker.away = false;
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

/** 跑腿 / 串门的目标点：同时给出**地面归一化坐标**（给 BFS 找路）与**屏幕点**（给插值）。
 *  ⛔ 两套坐标必须从同一处算出来 —— 早先只返回屏幕点，寻路就没法在 (u,v) 网格上跑。 */
function walkTarget(pose: OfficePose, slots: Slot[]): { uv: { u: number; v: number }; point: { x: number; y: number; scale: number } } {
  if (pose.kind === "visit" && pose.visitIndex !== undefined) {
    const host = slots[pose.visitIndex + 1];
    if (host) {
      const uv = { u: clamp01(host.u + 0.19), v: clamp01(host.v + 0.02) };
      return { uv, point: floorPoint(uv.u, uv.v) };
    }
  }
  const spot: ErrandSpot = pose.kind === "errand" ? pose.spot ?? "water" : "water";
  const uv = ERRAND_STAND_UV[spot];
  return { uv, point: floorPoint(uv.u, uv.v) };
}

/** 目标签名：只有它变了才需要重算路径（工位固定 ⇒ 起点不用进签名）。 */
function walkKeyOf(pose: OfficePose): string {
  return `${pose.kind}|${pose.visitIndex ?? -1}|${pose.spot ?? ""}`;
}

/**
 * 用 BFS 网格路径把「工位 → 目标」串起来。
 * ⛔ 找不到通路就退回**两点直线**：宁可偶尔穿一次家具，也不能让人站着不动（那更像 bug）。
 * ⛔ 首尾用**真实坐标**（BFS 给的是格心，直接用会停在离目标半步远的地方）。
 */
function buildWalkerPath(
  scene: SceneRefs,
  from: { x: number; y: number; scale: number },
  fromUV: { u: number; v: number },
  target: { uv: { u: number; v: number }; point: { x: number; y: number; scale: number } },
): WalkerParts["path"] {
  const straight = [from, target.point];
  if (!scene.navGrid) return straight;
  const uvPath = findPath(fromUV, target.uv, scene.navGrid);
  if (!uvPath || uvPath.length < 2) return straight;
  const pts = uvPath.map((p) => floorPoint(p.u, p.v));
  pts[0] = from;
  pts[pts.length - 1] = target.point;
  return pts;
}

/** 路径弧长表 —— t 按**弧长**映射（等比映射会让长段走得飞快、短段磨蹭）。 */
function measurePath(path: WalkerParts["path"]): { segLen: number[]; totalLen: number } {
  const segLen: number[] = [];
  let totalLen = 0;
  for (let i = 1; i < path.length; i++) {
    const d = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    segLen.push(d);
    totalLen += d;
  }
  return { segLen, totalLen };
}

/** 沿路径按弧长比例取点（e ∈ [0,1]）。 */
function pointOnPath(w: WalkerParts, e: number): { x: number; y: number; scale: number } {
  if (w.path.length === 0) return { x: 0, y: 0, scale: 1 };
  if (w.path.length === 1 || w.totalLen <= 0) return w.path[0];
  let want = e * w.totalLen;
  for (let i = 0; i < w.segLen.length; i++) {
    if (want <= w.segLen[i] || i === w.segLen.length - 1) {
      const k = Math.max(0, Math.min(1, w.segLen[i] > 0 ? want / w.segLen[i] : 1));
      const a = w.path[i];
      const b = w.path[i + 1];
      return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), scale: lerp(a.scale, b.scale, k) };
    }
    want -= w.segLen[i];
  }
  return w.path[w.path.length - 1];
}

/* ── 标签与交接 ─────────────────────────────────────────────────────────── */

function syncTags(layer: Container, slots: Slot[], scene: SceneRefs) {
  /* 底稿模式不画名牌（烙进背景图 = 假名牌）；同时清掉已有标签 */
  if (scene.draft) {
    for (const [, view] of scene.tags) { layer.removeChild(view.container); view.container.destroy({ children: true }); }
    scene.tags.clear();
    return;
  }
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
    const nameText = new Text({ text: slot.name, style: new TextStyle({ fill: 0x1f2733, fontSize: 9.5, fontWeight: "700" }) });
    const taskText = new Text({ text: task, style: new TextStyle({ fill: 0x8a94a0, fontSize: 8.5, fontWeight: "600" }) });
    const dotR = 2.3;
    const padX = 7.5;
    const gap = 5;
    const leadW = dotR * 2 + 5;                       // 圆点 + 与名字的间距
    const w = padX * 2 + leadW + nameText.width + gap + taskText.width;
    const h = 15.5;
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
      view = { container, card: new Container(), pulse: new Graphics(), sig: "", mode: "fly", from, to, t: 0, clock: 0 };
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

      if (handoff.kind === "chat") {
        /* ── 09-30 聊天气泡：串门纯聊天（非递资料）⇒ 两人中点上方的白底气泡 + 文案。
           ⛔ 不走飞行动画（聊天是持续的，不是从 A 飞到 B）—— animateScene 里只做轻微浮动。 */
        view.mode = "bubble";
        const midX = (from.x + to.x) / 2;
        const midY = Math.min(from.y, to.y) - 40;
        const bw = Math.max(58, handoff.label.length * 12.5 + 20);
        const bubble = new Graphics();
        bubble.roundRect(-bw / 2, -15, bw, 30, 10).fill({ color: 0xffffff, alpha: 0.97 }).stroke({ color: 0xc9d2de, width: 1.6 });
        bubble.poly([-8, 13, 8, 13, 0, 24]).fill({ color: 0xffffff, alpha: 0.97 });
        bubble.poly([-8, 13, 8, 13, 0, 24]).stroke({ color: 0xc9d2de, width: 1.6 });
        const label = new Text({ text: handoff.label, style: new TextStyle({ fill: 0x4a5568, fontSize: 11, fontWeight: "600" }) });
        label.anchor.set(0.5, 0.5);
        label.position.set(0, 0);
        const chatCard = new Container();
        chatCard.addChild(bubble, label);
        chatCard.position.set(midX, midY);
        view.card = chatCard;
        view.container.addChild(chatCard);
        return; // 气泡不需要起点/终点落点标记（pulse 永不显示）
      }

      const card = new Container();
      view.mode = "fly";
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

/** 局部坐标：脖子在 (0, 0)，头心 (0, HEAD_CY)，身体往下铺。
 *  ⛔ 头底（HEAD_CY + ry）必须**扎进项圈**（−22）里 2~6 单位：抬高头就会在脖子上留出
 *     一段白缝（v11 把头抬到 −44，狐/猫这种小 ry 物种脖子和项圈之间空了 3~7 单位，
 *     两侧还有楔形缺口 —— 用户截图点名）。往下降比往上升安全：头顶离显示器只会更远。 */
const HEAD_CY = -36;
/** 项圈矩形（脖子那一圈）：上缘 −22 要**接住**所有物种的头底（−36+ry = −16~−12）。
 *  ⛔ 宽度明显窄于肩宽（参考里项圈 ≈ 肩宽 × 0.57），但**不能窄过头**——比头窄太多
 *     会在项圈两上角留出楔形白缝（v11 的 w50 配 26 的头实测）。 */
const COLLAR = { x: -27, y: -22, w: 54, h: 26, r: 11 };
/** 脖子填充：垫在头与项圈之间的黑块，兜住"圆头下缘收窄 + 项圈偏窄"留下的楔形白缝。
 *  上端藏进头椭圆（中心列头底 ≥ −16），下端扎进项圈（−22）。 */
const NECK_FILL = { x: -17, y: -30, w: 34, h: 18 };
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
    // 狮子：鬃毛 = 一圈**三角尖**（⛔ 不能用圆球堆：远看是一头"爆炸头"，09-30 实测）+ 底盘
    const n = 18;
    const ri = rx * 0.96;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const b = ((i + 0.5) / n) * Math.PI * 2;
      const c = ((i + 1) / n) * Math.PI * 2;
      const ro = rx + 12 + (i % 2) * 3;
      tri(
        g,
        Math.cos(a) * ri, HEAD_CY + Math.sin(a) * (ry + 1),
        Math.cos(c) * ri, HEAD_CY + Math.sin(c) * (ry + 1),
        Math.cos(b) * ro, HEAD_CY + Math.sin(b) * (ry + 15),
      );
    }
    g.ellipse(0, HEAD_CY, rx + 5, ry + 5).fill(FUR_SHADE);
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

/**
 * 五官（09-30 v14 改正面）：**两只眼睛对称 + 居中口鼻**。
 *
 * ⛔ 为什么从"侧面一只眼"改成正面：平面化的 2D 剪影上，单只眼贴在头的一侧读起来就是
 *    "脸长歪了/多了个点"（用户原话：「侧边一个眼睛干什么，太丑了」）。参考画面之所以能
 *    侧面只露一只眼，是因为人家有 3D 体积与透视；平面图形必须靠**对称**才读得成一张脸。
 * ⛔ 三层眼睛（眼白 + 瞳孔 + 高光）缺一不可；口鼻必须比毛色亮一档。
 */
function drawFace(g: Graphics, animal: AnimalKind, rx: number, ry: number): void {
  const bigSnout = animal === "bear" || animal === "dog" || animal === "pig";
  const cy = HEAD_CY + ry * 0.34;
  const mw = rx * (bigSnout ? 0.62 : 0.48);
  const mh = ry * (bigSnout ? 0.48 : 0.4);

  // 口鼻（居中，亮一档）+ 下缘压暗
  g.ellipse(0, cy, mw / 2, mh / 2).fill(FACE.muzzle);
  g.ellipse(0, cy + mh * 0.22, mw * 0.38, mh * 0.26).fill(FACE.muzzleDark);

  const ny = cy - mh * 0.14;
  if (animal === "pig") {
    g.ellipse(0, ny + mh * 0.12, mw * 0.26, mh * 0.19).fill(FACE.muzzle);
    g.ellipse(0, ny + mh * 0.12, mw * 0.26, mh * 0.19).stroke({ color: FACE.muzzleDark, width: 1 });
    g.circle(-mw * 0.07, ny + mh * 0.12, mw * 0.04).fill(FACE.nose);
    g.circle(mw * 0.07, ny + mh * 0.12, mw * 0.04).fill(FACE.nose);
  } else {
    g.poly([-mw * 0.1, ny, mw * 0.1, ny, 0, ny + mh * 0.16]).fill(FACE.nose);
  }
  // 嘴：左右各一小段弧（连起来是个 w，比一条直线像嘴）
  for (const s of [-1, 1] as const) {
    g.moveTo(s * mw * 0.22, ny + mh * 0.3)
      .quadraticCurveTo(s * mw * 0.1, ny + mh * 0.52, 0, ny + mh * 0.34)
      .stroke({ color: FACE.mouth, width: 1.2 });
  }

  // 两只眼睛（对称 —— 正面脸的判据全在这）
  for (const s of [-1, 1] as const) {
    const ex = s * rx * 0.4;
    const ey = HEAD_CY - ry * 0.22;
    const er = rx * 0.23;
    g.ellipse(ex, ey, er * 0.92, er).fill(FACE.eyeWhite);
    g.ellipse(ex + s * er * 0.08, ey + er * 0.06, er * 0.56, er * 0.74).fill(FACE.pupil);
    g.circle(ex + s * er * 0.08 - er * 0.14, ey - er * 0.26, er * 0.19).fill(FACE.shine);
    // 上眼睑：压住眼白上缘，眼神才不"呆"
    g.moveTo(ex - er, ey - er * 1.0)
      .quadraticCurveTo(ex, ey - er * 1.6, ex + er, ey - er * 0.95)
      .stroke({ color: FUR_SHADE, width: 1.4 });
  }

  // 胡须（两侧对称各三根）
  if (animal === "cat" || animal === "mouse" || animal === "fox" || animal === "rabbit" || animal === "dog") {
    for (const s of [-1, 1] as const) {
      for (let i = -1; i <= 1; i++) {
        g.moveTo(s * mw * 0.3, cy + i * mh * 0.14)
          .lineTo(s * mw * 0.98, cy + i * mh * 0.32 - mh * 0.12)
          .stroke({ color: FACE.whisker, width: 0.8, alpha: 0.75 });
      }
    }
  }
  // 内耳：两侧耳根各一小块浅色
  for (const s of [-1, 1] as const) {
    g.ellipse(s * rx * 0.5, HEAD_CY - ry * 0.62, rx * 0.1, ry * 0.16).fill(FACE.innerEar);
  }
}

/** 尾巴（09-30 新增）：从躯干右下/左下伸出来，绕过椅背露在画面里。 */
function drawTail(g: Graphics, animal: AnimalKind, face: -1 | 1): void {
  const dir = -face;                     // 尾巴甩在脸的反侧，避免压住五官
  const x0 = dir * 15;
  const y0 = 32;
  if (animal === "rabbit") {
    g.circle(x0 + dir * 5, y0 + 3, 7).fill(FUR_LIT);
    return;
  }
  if (animal === "pig" || animal === "bear" || animal === "sheep" || animal === "koala") {
    return;                              // 短尾/无尾：不必画（画了反而像"多出来一根")
  }
  const bushy = animal === "fox";
  const thin = animal === "mouse";
  const w = bushy ? 9.5 : thin ? 3.2 : 5.2;
  const cx1 = dir * 33, cy1 = 18;
  const cx2 = dir * (thin ? 46 : 40), cy2 = -4;
  g.moveTo(x0, y0)
    .quadraticCurveTo(cx1, cy1, cx2, cy2)
    .stroke({ color: bushy ? FUR : FUR_SHADE, width: w, cap: "round" });
  if (bushy) g.circle(cx2, cy2, 5.5).fill(FACE.whisker);   // 狐狸的白尾尖
}

/** 脖子以上：对称特征 → 左右耳 → 头 → 五官（每层压住上一层）。
 *  ⛔ 三档毛色只用来**分面**（受光/主体/背光），不是渐变 —— 差值很小，远看仍是一只深色动物。 */
function buildAnimalHead(cosplay: Cosplay): HeadParts {
  const wrap = new Container();
  const [rx, ry] = HEAD_SIZE[cosplay.animal];
  const s = cosplay.face;

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

  // 头：主体 + 顶部受光弧 + 后脑下缘压暗（都在头形内部，不会溢出成"贴片"）
  const head = new Graphics();
  head.ellipse(0, HEAD_CY, rx, ry).fill(FUR);
  head.ellipse(-s * rx * 0.1, HEAD_CY - ry * 0.3, rx * 0.66, ry * 0.4).fill({ color: FUR_LIT, alpha: 0.85 });
  head.ellipse(0, HEAD_CY + ry * 0.52, rx * 0.8, ry * 0.36).fill({ color: FUR_SHADE, alpha: 0.75 });
  // 亮面高光：参考里的黑绒毛是**亮面**材质（头顶一小片柔光）—— 没有它就是一坨死黑
  head.ellipse(-s * rx * 0.22, HEAD_CY - ry * 0.52, rx * 0.34, ry * 0.2).fill({ color: 0xffffff, alpha: 0.13 });
  wrap.addChild(head);

  const face = new Graphics();
  drawFace(face, cosplay.animal, rx, ry);
  wrap.addChild(face);

  return { wrap, ears };
}

/**
 * 素材路线的角色身体：一张**生图精灵**（锚点 = 底边中心）。
 * ⛔ 取不到贴图返回 null —— 调用方必须回落到手画（贴图缺失时画白方块是最糟的结果）。
 * ⛔ 高度统一成 SPRITE_LOCAL_H：不同物种的出图尺寸不一，不归一化就会出现"有的人大有的人小"。
 */
const SPRITE_LOCAL_H = 118;
/** 坐姿姿势 → 人物姿势图的映射（09-30 人物化）：全部坐姿用 sit-back（背影办公），
 *  姿势差异靠屏幕内容与看板文案表达 —— 站姿类（drink/operate/chat）只在走动到达后用。 */
const PERSON_SIT_ALIAS: Record<string, string> = {
  work: "sit-back", gaming: "sit-back", coffee: "sit-back", doze: "sit-back",
  phone: "sit-back", note: "sit-back", slack: "sit-back", stretch: "sit-back",
};
function buildSpriteBody(cosplay: Cosplay, pose?: OfficePose, person?: string): Container | null {
  /* ⛔ 09-30 人物化优先：person 预设 + 该角色姿势图命中 → 用职场小人（Marvis 式）。
     缺图（未出/被删）→ 回落动物绒毛 → 再回落手画。⛔ 绝不画白方块。 */
  let url: string | null = null;
  if (person && personPresetOn()) {
    const alias = pose ? PERSON_SIT_ALIAS[pose.kind] ?? null : null;
    if (alias) url = personArtOf(person, alias);
  }
  if (!url) {
    const poseUrl = pose ? poseArtOf(pose.kind, cosplay.animal) : null;
    url = poseUrl ?? animalArtOf(cosplay.animal);
  }
  const tex = url ? artTexture(url) : null;
  if (!tex) return null;
  const sp = new Sprite(tex);
  sp.anchor.set(0.5, 1);
  sp.scale.set(SPRITE_LOCAL_H / tex.height);
  /* ⛔ 下沉 38：坐姿人物图是**含椅子全高**的立绘（头顶到椅脚），锚底在座位点会把整个人
     浮在桌面上方（09-30 实测「一眼假」）—— 下沉后臀部正好落进桌沿，上半身露出桌面。 */
  sp.position.set(0, 38);
  const box = new Container();
  box.addChild(sp);
  return box;
}

/**
 * 坐姿角色：素材路线 = 生图精灵 + 项圈；保底路线 = 手画（身体 + 两只爪子 + 头 + 项圈）。
 * ⛔ 顺序固定：身体 → 头 → 项圈（项圈压在头 / 身交界上，脖子才不会"断"）。
 */
function createWorkerGraphics(pose: OfficePose, cosplay: Cosplay, back: boolean, person?: string): { container: Container; parts: SeatedParts } {
  const c = new Container();

  const shadow = new Graphics();
  softShadow(shadow, 0, 76, 42, 10, 0.16);
  c.addChild(shadow);

  const body = new Container();
  let armBack: Graphics | null = null;
  let armFront: Graphics | null = null;
  let headwrap: Container | null = null;
  let ears: Graphics[] | null = null;

  const spriteBody = buildSpriteBody(cosplay, pose, person);
  if (spriteBody) {
    // 素材路线：躯干 / 四肢 / 头 / 耳都在图里，⛔ 不再叠手画的部件（会"双头"）
    body.addChild(spriteBody);
  } else {
    // 躯干（黑一坨，下缘会被椅子挡住）。⛔ 比头**窄**：头必须比肩宽，剪影才有"大头动物"的比例。
    //    ⛔ 长度也有上限：躯干画到 +78 时下缘会从**椅座下面漏出来**，看着像"人挂在椅子下面"
    //       （放大实测）。+58 刚好落在椅座范围内，被座面盖住。
    const torso = new Graphics();
    torso.roundRect(-23, -8, 46, 58, 20).fill(FUR);
    torso.roundRect(-23, -8, 46, 18, 15).fill({ color: FUR_LIT, alpha: 0.45 });    // 肩上受光
    torso.roundRect(-23, 32, 46, 18, 13).fill({ color: FUR_SHADE, alpha: 0.65 });  // 下缘压暗
    body.addChild(torso);

    // 尾巴：从躯干侧后伸出去，绕过椅背露在画面里（⛔ 椅背 zIndex 更大，内侧自然被挡住）
    const tail = new Graphics();
    drawTail(tail, cosplay.animal, cosplay.face);
    body.addChild(tail);

    // 脖子填充（垫在头后面）：圆头下缘往中间收，头两侧与项圈上缘之间会露楔形白缝，
    // 这块黑兜住它 —— 上端藏进头椭圆、下端扎进项圈，只在该露的缝里露出来。
    const neck = new Graphics();
    neck.roundRect(NECK_FILL.x, NECK_FILL.y, NECK_FILL.w, NECK_FILL.h, 6).fill(SILHOUETTE);
    body.addChild(neck);

    // 两只爪子：局部原点 = **肩**，爪在肩的上方 ARM_REACH 处；基准张角让爪子往外上方伸
    // （像"抱在桌前"）。⛔ 别画成两根竖直柱子；⛔ 也别用"一个大圆"当手（远看是黑球）。
    const buildArm = (tone: string): Graphics => {
      const a = new Graphics();
      a.roundRect(-8, -ARM_REACH + 3, 16, ARM_REACH + 5, 7).fill(tone);
      a.ellipse(0, -ARM_REACH, 10.5, 9.5).fill(tone);
      for (let i = -1; i <= 1; i++) {
        a.moveTo(i * 4.2, -ARM_REACH - 7)
          .lineTo(i * 4.9, -ARM_REACH + 2)
          .stroke({ color: FUR_SHADE, width: 1.1, alpha: 0.85 });
      }
      return a;
    };
    armBack = buildArm(FUR_SHADE);
    armBack.pivot.set(0, 0);
    armBack.position.set(-ARM_SHOULDER.x, ARM_SHOULDER.y);
    armBack.rotation = -ARM_SPREAD;
    body.addChild(armBack);

    armFront = buildArm(FUR);
    armFront.pivot.set(0, 0);
    armFront.position.set(ARM_SHOULDER.x, ARM_SHOULDER.y);
    armFront.rotation = ARM_SPREAD;
    body.addChild(armFront);
  }

  c.addChild(body);

  if (!spriteBody) {
    // 头（含耳朵）—— ears 拿出来给动画层抽动（素材路线没有独立耳朵可动）
    headwrap = new Container();
    const hw = buildAnimalHead(cosplay);
    ears = hw.ears;
    headwrap.addChild(hw.wrap);
    c.addChild(headwrap);
  }

  // 项圈（脖子那一圈 —— 全身唯一的颜色）
  const collar = new Graphics();
  collar.roundRect(COLLAR.x, COLLAR.y, COLLAR.w, COLLAR.h, COLLAR.r).fill(cosplay.collar);
  collar.roundRect(COLLAR.x, COLLAR.y, COLLAR.w, 6, COLLAR.r * 0.6).fill({ color: 0xffffff, alpha: 0.24 });
  collar.roundRect(COLLAR.x + 6, COLLAR.y + COLLAR.h - 5, COLLAR.w - 12, 5, 3).fill(collarDark(cosplay.collar));
  // 围巾垂下来的一角（照参考：项圈之外还有一截垂布 —— 一眼读成"围巾"，不是"项圈"）
  collar.poly([
    COLLAR.x + 5, COLLAR.y + COLLAR.h - 2,
    COLLAR.x + 17, COLLAR.y + COLLAR.h - 2,
    COLLAR.x + 15, COLLAR.y + COLLAR.h + 13,
    COLLAR.x + 6, COLLAR.y + COLLAR.h + 10,
  ]).fill(collarDark(cosplay.collar));
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

/** 走动小人：站立姿势，脚底在 (0,0) —— zIndex 取脚底 y 才能跟地面纵深对齐。
 *  09-30 人物化：person 命中 → 走路帧/使用姿势/端杯回程全用职场小人图；
 *  spot 决定「到达后做什么」：接水/贩卖机/茶水 → 举杯喝，打印/资料架 → 操作机器，
 *  洗手间 → 站立侧身，跑步机 → **原地跑**（到达后继续颠）。 */
function createWalker(cosplay: Cosplay, ground: { x: number; y: number; scale: number }, person?: string, spot?: ErrandSpot): WalkerParts {  const container = new Container();
  container.position.set(ground.x, ground.y);
  container.scale.set(ground.scale * PERSON_K);
  container.zIndex = ground.y;

  const body = new Container();
  let legBack: Graphics | null = null;
  let legFront: Graphics | null = null;
  let armBack: Graphics | null = null;
  let armFront: Graphics | null = null;
  let headwrap: Container | null = null;
  let walkEars: Graphics[] | null = null;

  // 素材路线：走动也用同一只精灵（脚下带阴影 + 上下颠）—— 与坐姿同一套画风，
  // ⛔ 只是没有可动的腿/手/耳（图里是整体的）。
  // ⛔ 09-30 升级：走路帧命中 → 用**侧面行走两帧**（交替换 texture 即成步态循环）；
  //    帧图是侧面视角，走路时按行进方向水平翻转（body.scale.x = ±1）。
  let walkFrames: [string, string] | null = walkArtOf(cosplay.animal);
  let usingTex: Texture | null = null;
  let cupTex: Texture | null = null;
  let runInPlace = false;
  if (person && personPresetOn()) {
    const wa = personArtOf(person, "walk-a");
    const wb = personArtOf(person, "walk-b");
    if (wa && wb) walkFrames = [wa, wb];
    /* 到达后的使用姿势（spot → 姿势图映射；缺图 → null = 保持走路帧站立） */
    const USING_POSE: Record<ErrandSpot, string> = {
      water: "drink", vending: "drink", tea: "drink",
      printer: "operate", shelf: "operate",
      restroom: "stand-side", treadmill: "run",
    };
    if (spot) {
      usingTex = artTexture(personArtOf(person, USING_POSE[spot]) ?? "");
      runInPlace = spot === "treadmill";
      if (spot === "tea" || spot === "vending" || spot === "water") cupTex = artTexture(personArtOf(person, "walk-cup") ?? "");
    }
  }
  const walkSprite = walkFrames ? new Sprite(artTexture(walkFrames[0])!) : buildSpriteBody(cosplay);
  if (walkSprite) {
    // ⛔ 与坐姿同一套归一化（SPRITE_LOCAL_H）：切片是 ~312px 的原始出图，
    //    不归一就是「原始纹理尺寸直接贴上去」（09-30 用户截图：狐狸占半个办公室）。
    const rawTex = walkFrames ? artTexture(walkFrames[0]) : null;
    if (rawTex && walkSprite instanceof Sprite) walkSprite.scale.set((SPRITE_LOCAL_H * 0.96) / rawTex.height);
    walkSprite.position.set(0, 2);
    body.addChild(walkSprite);
  } else {
    legBack = new Graphics();
    legBack.roundRect(-5.5, 0, 11, 34, 5.5).fill(FUR_SHADE);
    legBack.ellipse(3, 32, 8, 4.2).fill(FUR_SHADE);
    legBack.position.set(-7, -36);
    body.addChild(legBack);

    legFront = new Graphics();
    legFront.roundRect(-5.5, 0, 11, 34, 5.5).fill(FUR);
    legFront.ellipse(3, 32, 8, 4.2).fill(FUR);
    legFront.position.set(7, -36);
    body.addChild(legFront);

    const torso = new Graphics();
    torso.roundRect(-19, -78, 38, 44, 14).fill(FUR);
    torso.roundRect(-19, -78, 38, 15, 12).fill({ color: FUR_LIT, alpha: 0.4 });
    torso.roundRect(-19, -48, 38, 14, 11).fill({ color: FUR_SHADE, alpha: 0.6 });
    body.addChild(torso);

    // 走动时也带尾巴（站立姿态：尾巴从臀侧翘起）
    const tailDir = -cosplay.face;
    const tail = new Graphics();
    if (cosplay.animal === "rabbit") {
      tail.circle(tailDir * 18, -40, 6.5).fill(FUR_LIT);
    } else if (!["pig", "bear", "sheep", "koala"].includes(cosplay.animal)) {
      tail.moveTo(tailDir * 15, -40)
        .quadraticCurveTo(tailDir * 30, -33, tailDir * 40, -54)
        .stroke({ color: cosplay.animal === "fox" ? FUR : FUR_SHADE, width: cosplay.animal === "fox" ? 8 : 4.6, cap: "round" });
    }
    body.addChild(tail);

    armBack = new Graphics();
    armBack.roundRect(-5, 0, 10, 28, 5).fill(FUR_SHADE);
    armBack.circle(0, 28, 5.6).fill(FUR_SHADE);
    armBack.position.set(-21, -72);
    body.addChild(armBack);

    armFront = new Graphics();
    armFront.roundRect(-5, 0, 10, 28, 5).fill(FUR);
    armFront.circle(0, 28, 5.6).fill(FUR);
    armFront.position.set(21, -72);
    body.addChild(armFront);

    // 项圈要落在**头底之下**（头底 ≈ −76 + ry×0.94 ≈ −57~−53）：−59 起头、与头叠 2~6，
    // 露出 8~12 的色带。放在 −80（躯干顶）会被头部重构后的头整个盖住（熊/考拉直接看不到项圈）。
    const collar = new Graphics();
    collar.roundRect(-19, -59, 38, 14, 7).fill(cosplay.collar);
    collar.roundRect(-19, -57, 38, 4, 2).fill({ color: 0xffffff, alpha: 0.24 });
    body.addChild(collar);

    headwrap = new Container();
    // ⛔ buildAnimalHead 把头画在 wrap 内部 (0, HEAD_CY) 处 —— 这里必须**减掉 HEAD_CY** 补偿，
    //    否则头被双重抬高 36+ 单位，脖子上留出一段"白色空洞"（09-27 用户截图实测：走动的人
    //    头和躯干断开，背后的墙 / 饮水机从洞里透出来）。头心目标 = 躯干顶 (0, −76)。
    headwrap.position.set(0, -76 - HEAD_CY);
    headwrap.scale.set(0.94);
    const hw = buildAnimalHead(cosplay);
    walkEars = hw.ears;
    headwrap.addChild(hw.wrap);
    body.addChild(headwrap);
  }

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
    walkSprite: walkSprite instanceof Sprite ? walkSprite : null,
    walkFrames,
    usingTex,
    cupTex,
    runInPlace,
    t: 0,
    // 路径先只放"站在原地"两点（真实路径由 syncSeats 按目标算出来填；见 buildWalkerPath）
    path: [{ ...ground }, { ...ground }],
    segLen: [0],
    totalLen: 0,
    pathKey: "",
    away: false,
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

    // ⛔ 素材路线（生图精灵）没有独立头/耳/手 ⇒ 这些部件为 null：
    //    统一走"整体微动"（呼吸起伏 + 轻微左右摆），别让判空散落成一堆 if（漏一处就崩）。
    const spriteMode = !p.headwrap;
    p.body.rotation = 0;
    p.body.scale.y = 1;
    if (p.headwrap) p.headwrap.rotation = 0;
    // 耳朵（单边抽动）：sin 的 24 次方让抽动只出现在一个很窄的窗口里（偶尔抽一下）；
    // 打盹时整体耷拉（向外转 0.55 rad）。⛔ pivot 在耳根，转的是耳朵本身、不产生位移。
    const flick = (i: number) => Math.pow(Math.max(0, Math.sin(t * 0.5 + i * 2.4)), 24);
    const droop = p.pose.kind === "doze" ? 0.55 : 0;
    if (p.ears) p.ears.forEach((ear, i) => { ear.rotation = (i === 0 ? -1 : 1) * (droop + flick(i) * 0.3); });
    // 爪子姿势都是**相对基准张角**的增量（ARM_SPREAD 是"外张抱着桌沿"的静止姿态）
    const arms = (back: number, front: number) => {
      if (p.armBack) p.armBack.rotation = -ARM_SPREAD + back;
      if (p.armFront) p.armFront.rotation = ARM_SPREAD + front;
    };
    if (p.doze.visible) {
      p.doze.y = -Math.abs(Math.sin(t * 0.9)) * 3;
      p.doze.alpha = 0.55 + 0.45 * Math.abs(Math.sin(t * 0.9));
    }
    /** 素材路线的姿势表现：整体前倾/后仰 + 呼吸（精灵是整张图，只能动整体）。 */
    const lean = (deg: number, breathe = 0.02) => {
      p.body.rotation = deg * d2r;
      p.body.scale.y = 1 + Math.sin(t * 2.4) * breathe;
    };

    if (p.pose.kind === "doze") {
      // 打盹：头歪下去 + 整个人往下沉一点（配合头顶浮起的 z）。
      // ⛔ 歪角别超过 12°：一歪过头就只剩一坨黑，连耳朵都看不出来（实测）。
      if (p.headwrap) { p.headwrap.rotation = 10 * d2r; p.headwrap.y = 3; }
      else lean(8, 0.01);
      arms(7 * d2r, -7 * d2r);
      p.body.scale.y = spriteMode ? 0.97 + Math.sin(t * 1.1) * 0.02 : p.body.scale.y;
      return;
    }
    if (p.headwrap) p.headwrap.y = 0;
    if (p.pose.kind === "stretch") {
      // 伸懒腰：两只爪子往外举高
      const cyc = (Math.sin(t * 2.2) + 1) / 2;
      arms(-cyc * 62 * d2r, cyc * 62 * d2r);
      if (spriteMode) lean(-3 * cyc, 0.05); else p.body.rotation = -2.4 * d2r * cyc;
      return;
    }
    if (p.pose.kind === "coffee") {
      // 喝咖啡：右爪抬到嘴边 + 小幅上下
      const cyc = (Math.sin(t * 1.6) + 1) / 2;
      arms(-6 * d2r, -(18 + cyc * 14) * d2r);
      if (spriteMode) lean(2 + cyc * 2, 0.03);
      else if (p.headwrap) p.headwrap.rotation = 3 * d2r * cyc;
      return;
    }
    if (p.pose.kind === "phone") {
      const cyc = (Math.sin(t * 1.4) + 1) / 2;
      arms(-8 * d2r, -(24 + cyc * 8) * d2r);
      if (spriteMode) lean(2.5 + cyc * 2, 0.03);
      else if (p.headwrap) p.headwrap.rotation = 3.4 * d2r * cyc;
      return;
    }
    if (p.pose.kind === "note") {
      const cyc = (Math.sin(t * 3.4) + 1) / 2;
      arms(-10 * d2r, -(12 + cyc * 4) * d2r);
      if (spriteMode) lean(1.5 + cyc * 1.5, 0.02);
      return;
    }
    // 敲键盘（默认）：两只爪子交替小幅起落 + 躯干随呼吸起伏
    const typing = (Math.sin(t * 6) + 1) / 2;
    arms(-(4 + typing * 9) * d2r, (4 + typing * 9) * d2r);
    p.body.scale.y = 1 + Math.sin(t * 2.4) * (spriteMode ? 0.024 : 0.018);
  });

  scene.walkers.forEach((w) => {
    const dir = w.away ? 1 : -1;
    // ⛔ 速度按**距离**给（原来 t 恒速，走完一条固定时长的直线；改成路径后路程变长，
    //   若还按 t 恒速就会"绕远路反而走得飞快"）。180 px/s ≈ 真人步速在这个尺度下的观感。
    const pxPerFrame = 180 / 60;
    const speed = w.totalLen > 0 ? (pxPerFrame / w.totalLen) * delta : 0.02;
    const before = w.t;
    w.t = clamp01(w.t + dir * speed);
    const walking = (w.away && w.t < 1 && before < 1) || (!w.away && w.t > 0);
    w.clock += delta * 0.06;

    // 沿路径按**弧长**取点 —— 不再是 from→to 直线（直线会让人穿过别人的桌子）
    const at = pointOnPath(w, easeInOut(w.t));
    w.container.position.set(at.x, at.y);
    w.container.scale.set(at.scale);
    w.container.zIndex = at.y;

    const swing = walking ? Math.sin(w.clock * 7) : 0;
    // ⛔ 素材路线（整张精灵）没有可动腿/手/耳 ⇒ 逐个判空；整体靠上下颠表现"在走"
    if (w.legBack) w.legBack.rotation = swing * 0.45;
    if (w.legFront) w.legFront.rotation = -swing * 0.45;
    if (w.armBack) w.armBack.rotation = ARM_SPREAD * 0.5 - swing * 0.3;
    if (w.armFront) w.armFront.rotation = -ARM_SPREAD * 0.5 + swing * 0.3;
    /* 09-30 人物化：到达设施后**原地使用**（跑步机原地跑 = 继续颠），回程端杯走 */
    const arrived = w.t >= 1;
    const inPlace = (arrived && w.away) || (arrived && w.runInPlace);
    w.body.y = (walking || (inPlace && w.runInPlace)) ? -Math.abs(Math.sin(w.clock * 7)) * (w.legBack ? 2.6 : 3.6) : 0;
    if (w.headwrap) w.headwrap.rotation = walking ? Math.sin(w.clock * 7) * 0.04 : 0;
    const bounce = walking ? Math.abs(Math.sin(w.clock * 7)) : 0;
    if (w.ears) w.ears.forEach((ear, i) => { ear.rotation = (i === 0 ? -1 : 1) * bounce * 0.14; });

    /* ── 09-30 走路两帧 + 朝向翻转（侧面行走图集）──
       帧频 = 步频（clock * 7 / π，与上下颠同拍）：交替换 texture，⛔ 不重建 Sprite（重建会把相位打回起点）。
       朝向 = 路径在当前进度处的行进方向：取"当前点 vs 往前一点"的 x 差，向左走时水平翻转。
       09-30 人物化扩展：到达 → 使用姿势（举杯/操作/原地跑）；回程 → 端杯走。 */
    if (w.walkSprite) {
      if (arrived && w.away && w.usingTex) {
        // 使用中：固定姿势（scale 按各姿势图高度重算 —— 不同姿势的出图高度不一）
        if (w.walkSprite.texture !== w.usingTex) {
          w.walkSprite.texture = w.usingTex;
          w.walkSprite.scale.set((SPRITE_LOCAL_H * 0.96) / w.usingTex.height);
        }
      } else if (!w.away && w.t > 0 && w.cupTex) {
        // 回程端杯：固定端杯行走帧 + 步频上下颠
        if (w.walkSprite.texture !== w.cupTex) {
          w.walkSprite.texture = w.cupTex;
          w.walkSprite.scale.set((SPRITE_LOCAL_H * 0.96) / w.cupTex.height);
        }
      } else if (w.walkFrames) {
        const frame = Math.floor((w.clock * 7) / Math.PI) % 2;
        const tex = artTexture(w.walkFrames[frame]);
        if (tex) {
          if (w.walkSprite.texture !== tex) {
            w.walkSprite.texture = tex;
            w.walkSprite.scale.set((SPRITE_LOCAL_H * 0.96) / tex.height);
          }
          if (walking && w.path.length > 1) {
            const ahead = pointOnPath(w, easeInOut(Math.min(1, w.t + 0.02 * dir)));
            const dx = ahead.x - at.x;
            if (Math.abs(dx) > 0.5) w.body.scale.x = dx < 0 ? -1 : 1;
          }
        }
      }
    }
  });

  /* ── 独立椅子（09-30「离开要挪椅子」）：人走 ⇒ 椅子转开 + 往侧后挪；回来 ⇒ 归位。
     lerp 过渡（transform-only），转轴 = 精灵底部中心（转椅效果）。 ── */
  scene.chairs.forEach((ch) => {
    const targetRot = ch.away ? 0.38 : 0;
    const targetX = ch.baseX + (ch.away ? 14 : 0);
    ch.sp.rotation = lerp(ch.sp.rotation, targetRot, 0.07);
    ch.sp.position.x = lerp(ch.sp.position.x, targetX, 0.07);
  });

  scene.handoffs.forEach((h) => {
    if (h.mode === "bubble") {
      // 聊天气泡：就位后只做轻微上下浮动（⛔ 不走飞行插值 —— 聊天是持续的，不是从 A 飞到 B）
      h.clock += delta * 0.06;
      h.card.y = Math.min(h.from.y, h.to.y) - 40 + Math.sin(h.clock * 2) * 2.2;
      h.card.visible = true;
      return;
    }
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
