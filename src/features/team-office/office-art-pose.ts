/**
 * 走路 / 姿势素材表（09-30「办公室预览动画改造」第二批生图，84 张切片）。
 *
 * ⛔ 由 .workbuddy/tmp/gen-art-pose.mjs 生成（物种清单 = office-palette 的 AnimalKind），
 *    手改会在下次生成时被覆盖 —— 要加姿势就出新图集 + 切片 + 改生成脚本里的 POSES。
 *
 * 命名：assets/animals/walk-{a,b}-<物种>.webp（行走两帧，交替即成步态循环）、
 *       assets/animals/pose-<姿势>-<物种>.webp（坐姿背影：work 打字 / coffee 举杯 /
 *       doze 趴桌 / phone 看手机 / note 俯身看资料）。
 * ⛔ 这批图全部是**背影绒毛**画风（与 plush-back 同一次风格系）⇒ 只在 preset === "plush-back"
 *    时生效；front/flat 预设没有对应姿势图，调用方回落主图。
 * ⛔ gaming 姿势复用 work 图（打字姿势 + 屏幕切游戏）、slack 复用 phone 图（看手机 + 屏幕切
 *    短视频流）—— 映射在 poseArtOf 里，不单独出图。
 */
import walkAcat from "./assets/animals/walk-a-cat.webp";
import walkBcat from "./assets/animals/walk-b-cat.webp";
import walkAfox from "./assets/animals/walk-a-fox.webp";
import walkBfox from "./assets/animals/walk-b-fox.webp";
import walkAdog from "./assets/animals/walk-a-dog.webp";
import walkBdog from "./assets/animals/walk-b-dog.webp";
import walkArabbit from "./assets/animals/walk-a-rabbit.webp";
import walkBrabbit from "./assets/animals/walk-b-rabbit.webp";
import walkAbear from "./assets/animals/walk-a-bear.webp";
import walkBbear from "./assets/animals/walk-b-bear.webp";
import walkAsheep from "./assets/animals/walk-a-sheep.webp";
import walkBsheep from "./assets/animals/walk-b-sheep.webp";
import walkAkoala from "./assets/animals/walk-a-koala.webp";
import walkBkoala from "./assets/animals/walk-b-koala.webp";
import walkAmouse from "./assets/animals/walk-a-mouse.webp";
import walkBmouse from "./assets/animals/walk-b-mouse.webp";
import walkAdeer from "./assets/animals/walk-a-deer.webp";
import walkBdeer from "./assets/animals/walk-b-deer.webp";
import walkAhedgehog from "./assets/animals/walk-a-hedgehog.webp";
import walkBhedgehog from "./assets/animals/walk-b-hedgehog.webp";
import walkApig from "./assets/animals/walk-a-pig.webp";
import walkBpig from "./assets/animals/walk-b-pig.webp";
import walkAlion from "./assets/animals/walk-a-lion.webp";
import walkBlion from "./assets/animals/walk-b-lion.webp";
import poseworkCat from "./assets/animals/pose-work-cat.webp";
import poseworkFox from "./assets/animals/pose-work-fox.webp";
import poseworkDog from "./assets/animals/pose-work-dog.webp";
import poseworkRabbit from "./assets/animals/pose-work-rabbit.webp";
import poseworkBear from "./assets/animals/pose-work-bear.webp";
import poseworkSheep from "./assets/animals/pose-work-sheep.webp";
import poseworkKoala from "./assets/animals/pose-work-koala.webp";
import poseworkMouse from "./assets/animals/pose-work-mouse.webp";
import poseworkDeer from "./assets/animals/pose-work-deer.webp";
import poseworkHedgehog from "./assets/animals/pose-work-hedgehog.webp";
import poseworkPig from "./assets/animals/pose-work-pig.webp";
import poseworkLion from "./assets/animals/pose-work-lion.webp";
import posecoffeeCat from "./assets/animals/pose-coffee-cat.webp";
import posecoffeeFox from "./assets/animals/pose-coffee-fox.webp";
import posecoffeeDog from "./assets/animals/pose-coffee-dog.webp";
import posecoffeeRabbit from "./assets/animals/pose-coffee-rabbit.webp";
import posecoffeeBear from "./assets/animals/pose-coffee-bear.webp";
import posecoffeeSheep from "./assets/animals/pose-coffee-sheep.webp";
import posecoffeeKoala from "./assets/animals/pose-coffee-koala.webp";
import posecoffeeMouse from "./assets/animals/pose-coffee-mouse.webp";
import posecoffeeDeer from "./assets/animals/pose-coffee-deer.webp";
import posecoffeeHedgehog from "./assets/animals/pose-coffee-hedgehog.webp";
import posecoffeePig from "./assets/animals/pose-coffee-pig.webp";
import posecoffeeLion from "./assets/animals/pose-coffee-lion.webp";
import posedozeCat from "./assets/animals/pose-doze-cat.webp";
import posedozeFox from "./assets/animals/pose-doze-fox.webp";
import posedozeDog from "./assets/animals/pose-doze-dog.webp";
import posedozeRabbit from "./assets/animals/pose-doze-rabbit.webp";
import posedozeBear from "./assets/animals/pose-doze-bear.webp";
import posedozeSheep from "./assets/animals/pose-doze-sheep.webp";
import posedozeKoala from "./assets/animals/pose-doze-koala.webp";
import posedozeMouse from "./assets/animals/pose-doze-mouse.webp";
import posedozeDeer from "./assets/animals/pose-doze-deer.webp";
import posedozeHedgehog from "./assets/animals/pose-doze-hedgehog.webp";
import posedozePig from "./assets/animals/pose-doze-pig.webp";
import posedozeLion from "./assets/animals/pose-doze-lion.webp";
import posephoneCat from "./assets/animals/pose-phone-cat.webp";
import posephoneFox from "./assets/animals/pose-phone-fox.webp";
import posephoneDog from "./assets/animals/pose-phone-dog.webp";
import posephoneRabbit from "./assets/animals/pose-phone-rabbit.webp";
import posephoneBear from "./assets/animals/pose-phone-bear.webp";
import posephoneSheep from "./assets/animals/pose-phone-sheep.webp";
import posephoneKoala from "./assets/animals/pose-phone-koala.webp";
import posephoneMouse from "./assets/animals/pose-phone-mouse.webp";
import posephoneDeer from "./assets/animals/pose-phone-deer.webp";
import posephoneHedgehog from "./assets/animals/pose-phone-hedgehog.webp";
import posephonePig from "./assets/animals/pose-phone-pig.webp";
import posephoneLion from "./assets/animals/pose-phone-lion.webp";
import posenoteCat from "./assets/animals/pose-note-cat.webp";
import posenoteFox from "./assets/animals/pose-note-fox.webp";
import posenoteDog from "./assets/animals/pose-note-dog.webp";
import posenoteRabbit from "./assets/animals/pose-note-rabbit.webp";
import posenoteBear from "./assets/animals/pose-note-bear.webp";
import posenoteSheep from "./assets/animals/pose-note-sheep.webp";
import posenoteKoala from "./assets/animals/pose-note-koala.webp";
import posenoteMouse from "./assets/animals/pose-note-mouse.webp";
import posenoteDeer from "./assets/animals/pose-note-deer.webp";
import posenoteHedgehog from "./assets/animals/pose-note-hedgehog.webp";
import posenotePig from "./assets/animals/pose-note-pig.webp";
import posenoteLion from "./assets/animals/pose-note-lion.webp";

/** 走路两帧：[触地帧, 过渡帧]。缺该物种 → null（走动回落主图精灵 + 上下颠）。 */
export const WALK_ART: Partial<Record<string, [string, string]>> = {
  cat: [walkAcat, walkBcat],
  fox: [walkAfox, walkBfox],
  dog: [walkAdog, walkBdog],
  rabbit: [walkArabbit, walkBrabbit],
  bear: [walkAbear, walkBbear],
  sheep: [walkAsheep, walkBsheep],
  koala: [walkAkoala, walkBkoala],
  mouse: [walkAmouse, walkBmouse],
  deer: [walkAdeer, walkBdeer],
  hedgehog: [walkAhedgehog, walkBhedgehog],
  pig: [walkApig, walkBpig],
  lion: [walkAlion, walkBlion],
};

/** 坐姿姿势图（按姿势 → 物种）。缺该姿势/物种 → null（回落主图精灵 + 程序化微动）。 */
export const POSE_ART: Partial<Record<string, Partial<Record<string, string>>>> = {
  work: {
    cat: poseworkCat,
    fox: poseworkFox,
    dog: poseworkDog,
    rabbit: poseworkRabbit,
    bear: poseworkBear,
    sheep: poseworkSheep,
    koala: poseworkKoala,
    mouse: poseworkMouse,
    deer: poseworkDeer,
    hedgehog: poseworkHedgehog,
    pig: poseworkPig,
    lion: poseworkLion,
  },
  coffee: {
    cat: posecoffeeCat,
    fox: posecoffeeFox,
    dog: posecoffeeDog,
    rabbit: posecoffeeRabbit,
    bear: posecoffeeBear,
    sheep: posecoffeeSheep,
    koala: posecoffeeKoala,
    mouse: posecoffeeMouse,
    deer: posecoffeeDeer,
    hedgehog: posecoffeeHedgehog,
    pig: posecoffeePig,
    lion: posecoffeeLion,
  },
  doze: {
    cat: posedozeCat,
    fox: posedozeFox,
    dog: posedozeDog,
    rabbit: posedozeRabbit,
    bear: posedozeBear,
    sheep: posedozeSheep,
    koala: posedozeKoala,
    mouse: posedozeMouse,
    deer: posedozeDeer,
    hedgehog: posedozeHedgehog,
    pig: posedozePig,
    lion: posedozeLion,
  },
  phone: {
    cat: posephoneCat,
    fox: posephoneFox,
    dog: posephoneDog,
    rabbit: posephoneRabbit,
    bear: posephoneBear,
    sheep: posephoneSheep,
    koala: posephoneKoala,
    mouse: posephoneMouse,
    deer: posephoneDeer,
    hedgehog: posephoneHedgehog,
    pig: posephonePig,
    lion: posephoneLion,
  },
  note: {
    cat: posenoteCat,
    fox: posenoteFox,
    dog: posenoteDog,
    rabbit: posenoteRabbit,
    bear: posenoteBear,
    sheep: posenoteSheep,
    koala: posenoteKoala,
    mouse: posenoteMouse,
    deer: posenoteDeer,
    hedgehog: posenoteHedgehog,
    pig: posenotePig,
    lion: posenoteLion,
  },
};

/** 走路两帧；preset 非 plush-back 或该物种没出 → null。 */
export function walkArtOf(animal: string): [string, string] | null {
  try { if ((localStorage.getItem("office-art-preset") || "plush-back") !== "plush-back") return null; } catch { /* 默认放行 */ }
  return WALK_ART[animal] ?? null;
}

/** 坐姿姿势图；gaming→work、slack→phone（同图不同屏幕内容与文案）。 */
export function poseArtOf(pose: string, animal: string): string | null {
  try { if ((localStorage.getItem("office-art-preset") || "plush-back") !== "plush-back") return null; } catch { /* 默认放行 */ }
  const alias: Record<string, string> = { gaming: "work", slack: "phone" };
  const kind = alias[pose] ?? pose;
  return POSE_ART[kind]?.[animal] ?? null;
}
