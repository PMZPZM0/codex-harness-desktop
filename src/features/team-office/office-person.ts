/**
 * 程序化职场小人（team-office 域，09-30 v16「真渲染的小人物」）。
 *
 * ⛔ 为什么推翻 v15 的生图切片：切片是**死的截图** —— 走路只有两帧、姿势固定、图里还自带
 *    椅子与场景背景（叠进场景就"乱糟糟"）。用户 09-30 原话：「都是截图在动，你不会渲染一个
 *    3D 小人物吗」。这里改成**分层部件实时绘制**：头 / 发 / 躯干 / 双臂 / 双腿各自是
 *    独立 Graphics，由动画时钟驱动 rotation —— 任意姿势都能摆、走路是真摆动。
 *
 * ⛔ 与动物剪影（office-render 的 FUR 系列）的分工：这里是**人物**（有发色 / 肤色 / 衣服色，
 *    有五官朝向感），用于 person 预设；动物剪影是 plush 预设的回退，两套互不干扰。
 *
 * ⛔ 只画不动的部件（躯干 / 头 / 发）建一次；逐帧只改可动部件的 transform（DESIGN.md 铁律）。
 *    站高统一 PERSON_H = 118（与 SPRITE_LOCAL_H 对齐，坐姿另行压低）。
 */
import { Container, Graphics } from "pixi.js";

/** 角色外观（⛔ 按槽位序号**稳定派生**：同一个人每次进来都长一样）。 */
export type PersonLook = {
  hair: number;    // 发色
  skin: number;    // 肤色
  shirt: number;   // 上衣
  pants: number;   // 裤子
  /** 发型：0 短发 / 1 长发（带鬓角）/ 2 丸子头 */
  hairStyle: 0 | 1 | 2;
};

const HAIRS = [0x2b2b33, 0x4a3527, 0x1f1f24, 0x6b4a2f, 0x8c6239, 0x33302c, 0x553c2e, 0x2f3a4a];
const SKINS = [0xf3d3b5, 0xecc39e, 0xf7ddc4, 0xe0ab84, 0xf1cba8, 0xd9a06f, 0xf6e0cb, 0xe8b894];
const SHIRTS = [0xf2f5f9, 0x8fb8e0, 0xd9c7a8, 0x9fc4a6, 0xc9b6e0, 0xe8c46a, 0x9fb8c4, 0xd8d8dc];
const PANTS = [0x3f4652, 0x2f3742, 0x4a4038, 0x38424a, 0x463a4a, 0x3a3f46, 0x42474f, 0x2f3a40];

/** CEO 固定一套（深蓝马甲 + 胡子的观感靠发型/发色给）。 */
export function personLookOf(index: number, isCeo: boolean): PersonLook {
  const i = Math.abs(index) % 8;
  return {
    hair: isCeo ? 0x3b3b42 : HAIRS[i],
    skin: SKINS[i],
    shirt: isCeo ? 0x2f4a6b : SHIRTS[i],
    pants: isCeo ? 0x2b3240 : PANTS[i],
    hairStyle: isCeo ? 0 : (i % 3) as 0 | 1 | 2,
  };
}

/** 从槽位键（person0..7 / ceo）稳定派生外观 —— 同一个人每次进来长一样。 */
export function personLookOfKey(key: string): PersonLook {
  if (key === "ceo") return personLookOf(0, true);
  const m = /^person(\d+)$/.exec(key);
  return personLookOf(m ? Number(m[1]) : 0, false);
}

/** 姿势（⛔ 渲染层只认这几种；新增姿势 = 加一档 + 补坐姿/站姿分支）。 */
export type PersonPoseKind =
  | "sit"      // 坐姿（办公 / 打字 / 打盹都坐这儿，靠微动区分）
  | "stand"    // 站立
  | "drink"    // 站姿举杯
  | "operate"  // 站姿操作机器（单臂前伸）
  | "chat"     // 站姿聊天（单臂抬起 + 头微点）
  | "run";     // 站姿跑步（大幅摆臂摆腿）

/** 站高（本地单位）：与 SPRITE_LOCAL_H 对齐，改这里要同步 OfficeCanvas 的构图。 */
export const PERSON_H = 118;

export type PersonParts = {
  container: Container;
  /** 可动部件（逐个判空：坐姿没有腿摆动） */
  armBack: Graphics | null;
  armFront: Graphics | null;
  legBack: Graphics | null;
  legFront: Graphics | null;
  head: Container | null;
  /** 手上的小道具（杯 / 纸） */
  prop: Graphics | null;
  /** 坐姿标记 —— animate 据此决定"打字微动"还是"走路摆动" */
  pose: PersonPoseKind;
};

/**
 * 画一个小人。锚点 = **脚底**（0,0），朝向左（-1）或右（+1）。
 * ⛔ 部件 pivot 在关节上（肩 / 髋），rotation 才是"绕关节转"而不是绕自己中心打转。
 */
export function buildPerson(
  look: PersonLook,
  pose: PersonPoseKind,
  face: number = 1,
): PersonParts {
  const c = new Container();
  const seated = pose === "sit";
  // 坐姿：头顶 ≈ -106（下沉 30 后 ≈ -76，正好露出显示器顶与椅背 —— 全挡住=只剩一坨色块，实测过）
  const hipY = seated ? -44 : -62;
  const shoulderY = seated ? -76 : -100;
  const headCY = seated ? -94 : -120;

  const armBack = new Graphics();
  const armFront = new Graphics();
  const legBack = new Graphics();
  const legFront = new Graphics();

  const drawArm = (g: Graphics, dark: boolean) => {
    const col = dark ? shade(look.shirt, -18) : look.shirt;
    g.roundRect(-3.5, 0, 7, 26, 3.5).fill(col);
    g.circle(0, 27, 4).fill(look.skin);           // 手
  };
  const drawLeg = (g: Graphics, dark: boolean) => {
    const col = dark ? shade(look.pants, -18) : look.pants;
    if (seated) {
      // 坐姿：大腿水平向前 + 小腿向下（膝盖在 +22 处）
      g.roundRect(0, -4, 24, 8, 4).fill(col);
      g.roundRect(20, -4, 7.5, 24, 3.6).fill(col);
      g.roundRect(18, 18, 12, 5.5, 2.5).fill(0x2c2f36); // 鞋
    } else {
      g.roundRect(-4, 0, 8, 36, 4).fill(col);
      g.roundRect(-5, 32, 13, 6, 2.8).fill(0x2c2f36);   // 鞋
    }
  };

  drawArm(armBack, true);
  drawArm(armFront, false);
  drawLeg(legBack, true);
  drawLeg(legFront, false);

  /* 分层顺序（⛔ 远侧肢体 → 躯干 → 头 → 近侧肢体）：反了会"手长在身体前面"或者头被躯干盖住 */
  armBack.position.set(face * -11, shoulderY + 4);
  legBack.position.set(face * -6, hipY);
  c.addChild(armBack, legBack);

  const torso = new Graphics();
  if (seated) {
    torso.roundRect(-13, shoulderY - 6, 26, 44, 12).fill(look.shirt);
    torso.roundRect(-13, shoulderY - 6, 26, 8, 6).fill({ color: 0xffffff, alpha: 0.18 }); // 肩上受光
    torso.roundRect(-13, hipY - 4, 26, 12, 6).fill(shade(look.shirt, -12));               // 下摆压暗
  } else {
    torso.roundRect(-13, shoulderY - 6, 26, 46, 12).fill(look.shirt);
    torso.roundRect(-13, shoulderY - 6, 26, 8, 6).fill({ color: 0xffffff, alpha: 0.18 });
    torso.roundRect(-13, hipY + 2, 26, 14, 7).fill(look.pants);                            // 腰/裤腰
  }
  c.addChild(torso);

  /* 头 + 发（⛔ 头是独立 Container：点头动画只改 rotation，不重画） */
  const head = new Container();
  head.position.set(0, headCY);
  const hg = new Graphics();
  hg.roundRect(-10, -12, 20, 24, 9).fill(look.skin);
  // 耳朵
  hg.circle(-10, 0, 2.6).fill(shade(look.skin, -10));
  hg.circle(10, 0, 2.6).fill(shade(look.skin, -10));
  // 眼睛（朝行进方向偏置 —— 一眼看出面朝哪）
  hg.circle(face * 4, -2, 1.5).fill(0x2c2f36);
  hg.circle(face * -3, -2, 1.5).fill(0x2c2f36);
  // 头发：三种发型
  if (look.hairStyle === 0) {
    hg.roundRect(-11, -14, 22, 12, 7).fill(look.hair);
    hg.roundRect(-11, -8, 22, 3, 2).fill(shade(look.hair, 14));
  } else if (look.hairStyle === 1) {
    hg.roundRect(-11, -14, 22, 13, 7).fill(look.hair);
    hg.roundRect(-12, -12, 4.5, 18, 2.4).fill(look.hair);   // 鬓角
    hg.roundRect(7.5, -12, 4.5, 18, 2.4).fill(look.hair);
  } else {
    hg.circle(0, -15, 7).fill(look.hair);                    // 丸子
    hg.roundRect(-11, -13, 22, 10, 6).fill(look.hair);
  }
  head.addChild(hg);
  c.addChild(head);

  /* 手上的小道具：drink = 杯子；operate/chat 不需要（chat 靠抬手） */
  let prop: Graphics | null = null;
  if (pose === "drink") {
    prop = new Graphics();
    prop.roundRect(-4, 0, 8, 9, 2).fill(0xf7fafc);
    prop.roundRect(-4, 0, 8, 2.4, 1.2).fill(0x9aa4b0);
    armFront.addChild(prop);
    prop.position.set(0, 30);
  }

  armFront.position.set(face * 11, shoulderY + 4);
  legFront.position.set(face * 6, hipY);
  c.addChild(armFront, legFront);

  /* 初始姿态：坐姿双臂前伸（打字）/ 站的姿势按类型给 */
  if (seated) { armBack.rotation = face * 0.55; armFront.rotation = face * 0.55; }
  else if (pose === "drink") { armFront.rotation = face * -1.1; armBack.rotation = face * 0.2; }
  else if (pose === "operate") { armFront.rotation = face * -0.95; armBack.rotation = face * 0.15; }
  else if (pose === "chat") { armFront.rotation = face * -0.7; armBack.rotation = face * 0.25; }
  else if (pose === "run") { armBack.rotation = face * 0.5; armFront.rotation = face * -0.5; }

  return { container: c, armBack, armFront, legBack, legFront, head, prop, pose };
}

/**
 * 逐帧动画（⛔ 只改 transform）。
 *   · 坐姿：双臂小幅上下（打字）+ 呼吸起伏 + 偶尔点头
 *   · 走动：双臂双腿反相摆动（摆幅随速度）
 *   · 跑步：摆幅加大 + 整体上下颠
 */
export function animatePerson(p: PersonParts, clock: number, walking: boolean): void {
  if (p.pose === "sit") {
    const t = clock * 2.6;
    const type = Math.sin(t) * 0.06;          // 打字：手腕小幅起落
    if (p.armBack) p.armBack.rotation = (p.armBack.rotation || 0) * 0 + (Math.sign(p.armBack.position.x) || 1) * (0.55 + type);
    if (p.armFront) p.armFront.rotation = (Math.sign(p.armFront.position.x) || 1) * (0.55 - type);
    if (p.head) p.head.rotation = Math.sin(t * 0.4) * 0.03;
    p.container.scale.y = 1 + Math.sin(clock * 1.6) * 0.012;   // 呼吸
    return;
  }
  const amp = p.pose === "run" ? 0.85 : walking ? 0.5 : 0;
  const swing = Math.sin(clock * 7);
  if (p.legBack) p.legBack.rotation = swing * amp;
  if (p.legFront) p.legFront.rotation = -swing * amp;
  if (p.armBack) p.armBack.rotation = (Math.sign(p.armBack.position.x) || 1) * (0.2 + swing * amp * 0.8);
  if (p.armFront) p.armFront.rotation = (Math.sign(p.armFront.position.x) || 1) * (p.pose === "drink" ? -1.1 : -0.2 - swing * amp * 0.8);
  // 跑步/走动的整体上下颠
  if (p.pose === "run" || walking) p.container.y = -Math.abs(Math.sin(clock * 7)) * (p.pose === "run" ? 5 : 3);
  else p.container.y = 0;
}

function shade(color: number, delta: number): number {
  const r = Math.max(0, Math.min(255, ((color >> 16) & 255) + delta));
  const g = Math.max(0, Math.min(255, ((color >> 8) & 255) + delta));
  const b = Math.max(0, Math.min(255, (color & 255) + delta));
  return (r << 16) | (g << 8) | b;
}
