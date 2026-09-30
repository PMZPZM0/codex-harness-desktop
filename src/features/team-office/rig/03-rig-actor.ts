/**
 * 骨骼装配器 + AnimationState（team-office 域 rig，09-30 v17）。
 *
 * 装配（buildRig）：部件（Graphics/Sprite）按**骨骼树**挂进 Container —— 绘制顺序 =
 *   root → hip → legBack → torso → head → armBack → legFront → armFront
 *   ⛔ 顺序错了会"手长在身体前面"或者头被躯干盖住（两版都实测过）。
 *   每根骨头的 pivot 在**关节**上（肩 / 髋 / 颈）—— clip 的 rotation 才是"绕关节转"。
 *
 * AnimationState（Spine 的 TrackEntry 模型等价物）：
 *   · track0 = 基础循环（idle / typing / walk / interact 互斥，mix=0.18s 平滑过渡）
 *   · track1+ = 附加动作（handup / blink，add 模式：叠加在基础循环之上，播完自动卸载）
 *   · 同一根骨头被多轨命中：add 轨的增量**叠加**在 replace 轨的结果上（主循环不被覆盖）
 *   · 全部只写 transform（DESIGN.md：动画不重画）
 */
import { Container } from "pixi.js";
import type { BoneName, BoneTransform, RigClip, RigLook, RigState, TrackEntry } from "./01-rig-types";
import { LOOK_EASE, LOOK_MAX_RAD, LOOK_TILT_RAD, STATE_CLIP, TRACK_ADD, TRACK_MAIN } from "./01-rig-types";
import { RIG_CLIPS } from "./02-rig-clips";

/** 每根骨头的初始姿态（相对其父骨骼的装配位）—— ⛔ 与 drawPart 的绘制几何强耦合。 */
export type BoneDef = {
  name: BoneName;
  parent: BoneName | null;
  /** 装配位置（相对父骨骼原点，本地单位；脚底 = (0,0)） */
  x: number;
  y: number;
};

/** 骨架定义：坐姿（开工）与站姿（走动/交互）两套 —— 腿的几何不同。 */
export const SKELETON_SEATED: BoneDef[] = [
  { name: "root", parent: null, x: 0, y: 0 },
  { name: "hip", parent: "root", x: 0, y: -44 },
  { name: "legBack", parent: "hip", x: -6, y: 0 },
  { name: "legFront", parent: "hip", x: 6, y: 0 },
  { name: "torso", parent: "hip", x: 0, y: -32 },
  { name: "head", parent: "torso", x: 0, y: -30 },
  { name: "armBack", parent: "torso", x: -11, y: -2 },
  { name: "armFront", parent: "torso", x: 11, y: -2 },
];

export const SKELETON_STANDING: BoneDef[] = [
  { name: "root", parent: null, x: 0, y: 0 },
  { name: "hip", parent: "root", x: 0, y: -62 },
  { name: "legBack", parent: "hip", x: -6, y: 0 },
  { name: "legFront", parent: "hip", x: 6, y: 0 },
  { name: "torso", parent: "hip", x: 0, y: -38 },
  { name: "head", parent: "torso", x: 0, y: -34 },
  { name: "armBack", parent: "torso", x: -11, y: -4 },
  { name: "armFront", parent: "torso", x: 11, y: -4 },
];

/** 装配后的角色（container 直接 addChild 进场景）。 */
export type RigActor = {
  container: Container;
  bones: Map<BoneName, Container>;
  /** 当前主循环状态（切状态时做 0.18s 淡入混合） */
  state: RigState;
  tracks: TrackEntry[];
  /** 注视目标（相对自身的角度，rad；超 LOOK_MAX_RAD 的部分自动截断） */
  lookTarget: number;
  /** 当前已应用的头转角（lerp 向 lookTarget 靠拢） */
  lookApplied: number;
  /** 随机源（每角色独立 —— 眨眼间隔 / 相位都从这派生，别用全局 Math.random） */
  seed: number;
  /** 眨眼倒计时（秒） */
  blinkIn: number;
  /** 装配姿态（seated/standing）—— 切换时整组重建 */
  posed: "seated" | "standing";
};

const EASE = 0.16;          // 主循环切换的混合速度（每帧 alpha 步进）
const DEG = Math.PI / 180;  // clip 里的数值按度数语义写起来直观，装配时换算

/** 从 01 模块的 PersonLook 键派生外观（person0..7 / ceo）。 */
export function lookOfKey(key: string): RigLook {
  // ⛔ 别在这里 import office-person —— rig 必须独立于它的绘制实现（保持可替换）
  const HAIRS = [0x2b2b33, 0x4a3527, 0x1f1f24, 0x6b4a2f, 0x8c6239, 0x33302c, 0x553c2e, 0x2f3a4a];
  const SKINS = [0xf3d3b5, 0xecc39e, 0xf7ddc4, 0xe0ab84, 0xf1cba8, 0xd9a06f, 0xf6e0cb, 0xe8b894];
  const SHIRTS = [0xf2f5f9, 0x8fb8e0, 0xd9c7a8, 0x9fc4a6, 0xc9b6e0, 0xe8c46a, 0x9fb8c4, 0xd8d8dc];
  const PANTS = [0x3f4652, 0x2f3742, 0x4a4038, 0x38424a, 0x463a4a, 0x3a3f46, 0x42474f, 0x2f3a40];
  const isCeo = key === "ceo";
  const m = /^person(\d+)$/.exec(key);
  const i = m ? Number(m[1]) % 8 : 0;
  return {
    hair: isCeo ? 0x3b3b42 : HAIRS[i],
    skin: SKINS[i],
    shirt: isCeo ? 0x2f4a6b : SHIRTS[i],
    pants: isCeo ? 0x2b3240 : PANTS[i],
    hairStyle: isCeo ? 0 : ((i % 3) as 0 | 1 | 2),
  };
}

/** 部件绘制（⛔ 由 rig-actor 外部注入 —— 部件实现可替换：Graphics / 图集 Sprite）。 */
export type PartPainter = (bone: BoneName, look: RigLook) => Container;

/** seed → [0,1) 的确定性伪随机（同 seed 同序列，禁 Math.random）。 */
function rand01(seed: number): number {
  let s = (seed * 9301 + 49297) % 233280;
  s = (s * 9301 + 49297) % 233280;
  return s / 233280;
}

/**
 * 装配一个角色。
 * @param painter 部件绘制器（返回一个挂进该骨头的 Container；pivot 必须画在 (0,0)）
 * @param seated  坐姿骨架 or 站姿骨架
 * @param key     角色槽位键（person0..7 / ceo）—— 外观与随机种子都从它派生
 */
export function buildRig(painter: PartPainter, seated: boolean, key: string): RigActor {
  const container = new Container();
  const bones = new Map<BoneName, Container>();
  const look = lookOfKey(key);
  const defs = seated ? SKELETON_SEATED : SKELETON_STANDING;
  /* 装配顺序按 defs 声明序（⛔ 头与躯干必须先于 armFront 挂，遮挡才对） */
  for (const def of defs) {
    const bone = new Container();
    bone.position.set(def.x, def.y);
    bone.addChild(painter(def.name, look));
    bones.set(def.name, bone);
    const parent = def.parent ? bones.get(def.parent) : container;
    (parent ?? container).addChild(bone);
  }
  const seed = [...key].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 100000, 7);
  return {
    container,
    bones,
    state: "idle",
    tracks: [{ clip: RIG_CLIPS.idle, track: TRACK_MAIN, mode: "replace", time: seed % 1000 / 500, alpha: 1, repeat: null, played: 0 }],
    lookTarget: 0,
    lookApplied: 0,
    seed,
    blinkIn: 2 + rand01(seed) * 4,
    posed: seated ? "seated" : "standing",
  };
}

/** 切主循环状态（track0；0.18s 淡入混合 —— 硬切会"啪"一下跳变）。 */
export function setState(actor: RigActor, state: RigState): void {
  if (actor.state === state) return;
  actor.state = state;
  const clip = RIG_CLIPS[STATE_CLIP[state]];
  /* 附加轨（handup）是 add 模式挂在 track1 —— 主循环替换不影响它 */
  actor.tracks = actor.tracks.filter((t) => t.track !== TRACK_MAIN || t.mode !== "replace");
  actor.tracks.unshift({ clip, track: TRACK_MAIN, mode: "replace", time: 0, alpha: 0, repeat: null, played: 0 });
}

/** 触发一次性附加动作（handup / blink；播完自动卸载）。 */
export function playOnce(actor: RigActor, clipName: string): void {
  const clip = RIG_CLIPS[clipName];
  if (!clip) return;
  actor.tracks = actor.tracks.filter((t) => !(t.track === TRACK_ADD && t.clip.name === clipName));
  actor.tracks.push({ clip, track: TRACK_ADD, mode: "add", time: 0, alpha: 1, repeat: 1, played: 0 });
}

/** 单轨采样：把 clip 在 time 时刻的姿态写进 out（只写 clip 里声明了的属性）。 */
function sampleTrack(track: TrackEntry, out: Map<BoneName, Partial<BoneTransform>>): void {
  const { clip } = track;
  const tt = clip.loop ? (track.time % clip.duration) / clip.duration : Math.min(1, track.time / clip.duration);
  for (const bt of clip.tracks) {
    const keys = bt.keys;
    let a = keys[0];
    let b = keys[keys.length - 1];
    for (let i = 0; i < keys.length - 1; i++) {
      if (tt >= keys[i].t && tt <= keys[i + 1].t) { a = keys[i]; b = keys[i + 1]; break; }
    }
    const span = b.t - a.t || 1;
    const k = (tt - a.t) / span;
    const cur = out.get(bt.bone) ?? {};
    const lerp = (p: number | undefined, q: number | undefined) =>
      p === undefined || q === undefined ? (p ?? q ?? 0) : p + (q - p) * k;
    cur.rotation = lerp(a.v.rotation, b.v.rotation);
    if (a.v.y !== undefined || b.v.y !== undefined) cur.y = lerp(a.v.y, b.v.y);
    if (a.v.scaleY !== undefined || b.v.scaleY !== undefined) cur.scaleY = lerp(a.v.scaleY, b.v.scaleY);
    out.set(bt.bone, cur);
  }
}

/**
 * 逐帧驱动（⛔ 唯一的写入口 —— 别处不许碰 bones 的 transform）。
 * @param delta 帧间隔（秒）
 */
export function updateRig(actor: RigActor, delta: number): void {
  /* ① 轨道推进 + 附加轨到期卸载 */
  for (const t of actor.tracks) t.time += delta;
  actor.tracks = actor.tracks.filter((t) => t.repeat === null || t.played < t.repeat);
  for (const t of actor.tracks) {
    if (t.repeat !== null && t.time >= t.clip.duration * t.repeat) { t.played = t.repeat; }
  }
  /* ② 主轨 alpha 淡入到 1 */
  for (const t of actor.tracks) {
    if (t.track === 0) t.alpha = Math.min(1, t.alpha + EASE * delta * 60);
  }
  /* ③ 多轨采样叠加：低轨先写，add 轨把增量累加上去 */
  const pose = new Map<BoneName, Partial<BoneTransform>>();
  const sorted = [...actor.tracks].sort((a, b) => a.track - b.track);
  for (const t of sorted) {
    if (t.alpha < 0.01) continue;
    const partial = new Map<BoneName, Partial<BoneTransform>>();
    sampleTrack(t, partial);
    for (const [bone, v] of partial) {
      const acc = pose.get(bone) ?? {};
      if (t.mode === "add") {
        acc.rotation = (acc.rotation ?? 0) + (v.rotation ?? 0) * t.alpha;
        acc.y = (acc.y ?? 0) + (v.y ?? 0) * t.alpha;
        acc.scaleY = (acc.scaleY ?? 1) * (1 + ((v.scaleY ?? 1) - 1) * t.alpha);
      } else {
        acc.rotation = v.rotation ?? acc.rotation ?? 0;
        acc.y = v.y ?? acc.y ?? 0;
        acc.scaleY = v.scaleY ?? acc.scaleY ?? 1;
      }
      pose.set(bone, acc);
    }
  }
  /* ④ 注视跟随（约束 4）：头转角向目标 lerp，限幅 ±22°，超范围自动回落 0 */
  const target = Math.max(-LOOK_MAX_RAD, Math.min(LOOK_MAX_RAD, actor.lookTarget));
  actor.lookApplied += (target - actor.lookApplied) * LOOK_EASE;
  const head = pose.get("head") ?? {};
  head.rotation = (head.rotation ?? 0) + actor.lookApplied;
  /* 头微仰/低（跟注视方向纵向联动，幅度上限 LOOK_TILT_RAD） */
  head.rotation += Math.max(-LOOK_TILT_RAD, Math.min(LOOK_TILT_RAD, actor.lookApplied * 0.4));
  pose.set("head", head);
  /* ⑤ 写 transform（只写 clip/注视声明了的属性，未声明的保持装配值） */
  for (const [bone, v] of pose) {
    const b = actor.bones.get(bone);
    if (!b) continue;
    if (v.rotation !== undefined) b.rotation = v.rotation * DEG * 0 + v.rotation; // clip 已是弧度
    if (v.y !== undefined) b.position.y = (actor.posed === "seated"
      ? (SKELETON_SEATED.find((d) => d.name === bone)?.y ?? 0) + v.y
      : (SKELETON_STANDING.find((d) => d.name === bone)?.y ?? 0) + v.y);
    if (v.scaleY !== undefined) b.scale.y = v.scaleY;
  }
  /* ⑥ 眨眼调度（约束 5）：倒计时到 0 → track1 播 blink → 重掷间隔（确定性随机） */
  actor.blinkIn -= delta;
  if (actor.blinkIn <= 0) {
    playOnce(actor, "blink");
    actor.blinkIn = 3 + rand01(actor.seed + Math.floor(actor.blinkIn * -1000)) * 4;
  }
}

/** 查询当前装配（供外层判断"要不要切骨架"）。 */
export function poseOf(actor: RigActor): "seated" | "standing" {
  return actor.posed;
}
