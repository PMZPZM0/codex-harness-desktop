/**
 * 骨骼部件绘制（team-office 域 rig，09-30 v17）。
 *
 * ⛔ 每个部件的** pivot 在关节**（部件本体从 (0,0) 向远端延伸）：
 *   · head   原点 = 颈根，头画在 y:-26..0（注视 rotation 绕颈根转）
 *   · torso  原点 = 髋上方（肩位），身体画在 y:0..(+len) 向下到髋
 *   · arm    原点 = 肩，手臂 y:0..27 向下 + 手
 *   · leg    原点 = 髋；站立 y:0..36 向下 + 鞋；坐姿 大腿水平前伸 24 + 小腿下垂 + 鞋
 * ⛔ 09-30 用户批评「手都没有、坐那里发呆」—— 坐姿的**手臂必须画成前伸到键盘**（水平段），
 *    打字微动才有"在干活"的观感；垂在身侧 = 发呆。
 */
import { Container, Graphics } from "pixi.js";
import type { BoneName, RigLook } from "./01-rig-types";

function shade(color: number, delta: number): number {
  const r = Math.max(0, Math.min(255, ((color >> 16) & 255) + delta));
  const g = Math.max(0, Math.min(255, ((color >> 8) & 255) + delta));
  const b = Math.max(0, Math.min(255, (color & 255) + delta));
  return (r << 16) | (g << 8) | b;
}

/** 坐姿腿：大腿水平向前 24 + 小腿垂下 24 + 鞋（⛔ 画在 +x 方向 = 面朝显示器的方向）。 */
function drawLegSeated(g: Graphics, look: RigLook, dark: boolean): void {
  const col = dark ? shade(look.pants, -18) : look.pants;
  g.roundRect(0, -4, 24, 8, 4).fill(col);
  g.roundRect(20, -4, 7.5, 26, 3.6).fill(col);
  g.roundRect(18, 20, 13, 5.5, 2.5).fill(0x2c2f36);
}
/** 站姿腿：从髋向下 36 + 鞋。 */
function drawLegStanding(g: Graphics, look: RigLook, dark: boolean): void {
  const col = dark ? shade(look.pants, -18) : look.pants;
  g.roundRect(-4, 0, 8, 36, 4).fill(col);
  g.roundRect(-5, 32, 13, 6, 2.8).fill(0x2c2f36);
}
/** 坐姿手臂：上臂水平前伸 20（到键盘）+ 手 —— 打字微动就是这段的 rotation。 */
function drawArmSeated(g: Graphics, look: RigLook, dark: boolean): void {
  const col = dark ? shade(look.shirt, -18) : look.shirt;
  g.roundRect(0, -3.5, 20, 7, 3.5).fill(col);
  g.circle(21, 0, 4).fill(look.skin);
}
/** 站姿手臂：从肩垂下 27 + 手。 */
function drawArmStanding(g: Graphics, look: RigLook, dark: boolean): void {
  const col = dark ? shade(look.shirt, -18) : look.shirt;
  g.roundRect(-3.5, 0, 7, 26, 3.5).fill(col);
  g.circle(0, 27, 4).fill(look.skin);
}

/** 装配部件。⛔ seated 决定四肢几何（坐姿前伸 / 站姿垂下），别传错。 */
export function paintPart(bone: BoneName, look: RigLook, seated: boolean): Container {
  const c = new Container();
  const g = new Graphics();
  c.addChild(g);
  switch (bone) {
    case "head": {
      /* 头画在 y:-26..0（颈根在 0），注视绕 (0,0) 转 */
      g.roundRect(-10, -24, 20, 24, 9).fill(look.skin);
      g.circle(-10, -12, 2.6).fill(shade(look.skin, -10));
      g.circle(10, -12, 2.6).fill(shade(look.skin, -10));
      g.circle(-3, -14, 1.5).fill(0x2c2f36);
      g.circle(4, -14, 1.5).fill(0x2c2f36);
      if (look.hairStyle === 0) {
        g.roundRect(-11, -26, 22, 12, 7).fill(look.hair);
        g.roundRect(-11, -20, 22, 3, 2).fill(shade(look.hair, 14));
      } else if (look.hairStyle === 1) {
        g.roundRect(-11, -26, 22, 13, 7).fill(look.hair);
        g.roundRect(-12, -24, 4.5, 18, 2.4).fill(look.hair);
        g.roundRect(7.5, -24, 4.5, 18, 2.4).fill(look.hair);
      } else {
        g.circle(0, -27, 7).fill(look.hair);
        g.roundRect(-11, -25, 22, 10, 6).fill(look.hair);
      }
      break;
    }
    case "torso": {
      const len = seated ? 34 : 38;
      g.roundRect(-13, 0, 26, len, 12).fill(look.shirt);
      g.roundRect(-13, 0, 26, 8, 6).fill({ color: 0xffffff, alpha: 0.18 });
      g.roundRect(-13, len - 12, 26, 12, 6).fill(shade(look.shirt, -12));
      break;
    }
    case "armBack": seated ? drawArmSeated(g, look, true) : drawArmStanding(g, look, true); break;
    case "armFront": seated ? drawArmSeated(g, look, false) : drawArmStanding(g, look, false); break;
    case "legBack": seated ? drawLegSeated(g, look, true) : drawLegStanding(g, look, true); break;
    case "legFront": seated ? drawLegSeated(g, look, false) : drawLegStanding(g, look, false); break;
    case "hip": {
      g.roundRect(-11, -6, 22, 12, 6).fill(shade(look.pants, -6));
      break;
    }
    case "root":
    default:
      break;
  }
  return c;
}
