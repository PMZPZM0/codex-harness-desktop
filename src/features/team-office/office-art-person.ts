/**
 * 人物姿势素材表（09-30 人物化改造：宠物 → 人物，9 角色 × 12 姿势）。
 *
 * ⛔ 由 .workbuddy/tmp/gen-art-person.mjs 生成，手改会在下次生成时被覆盖。
 *    格位契约 = gen-person-batch.sh 的 ROW1/ROW2/ROW3 与 slice-sheet.py 的 PERSON_POSES：
 *    stand-front / stand-side / stand-back / walk-a / walk-b / sit-back / sit-side /
 *    drink（站侧举杯）/ operate（站侧操作机器）/ chat（正面手势）/ walk-cup（端杯走）/ run（侧跑）。
 * ⛔ 素材取不到（未出图 / 被删）→ 调用方逐处回落动物绒毛素材，绝不画白方块。
 */
import person0_standfront from "./assets/persons/person0-stand-front.webp";
import person0_standside from "./assets/persons/person0-stand-side.webp";
import person0_standback from "./assets/persons/person0-stand-back.webp";
import person0_walka from "./assets/persons/person0-walk-a.webp";
import person0_walkb from "./assets/persons/person0-walk-b.webp";
import person0_sitback from "./assets/persons/person0-sit-back.webp";
import person0_sitside from "./assets/persons/person0-sit-side.webp";
import person0_drink from "./assets/persons/person0-drink.webp";
import person0_operate from "./assets/persons/person0-operate.webp";
import person0_chat from "./assets/persons/person0-chat.webp";
import person0_walkcup from "./assets/persons/person0-walk-cup.webp";
import person0_run from "./assets/persons/person0-run.webp";
import person1_standfront from "./assets/persons/person1-stand-front.webp";
import person1_standside from "./assets/persons/person1-stand-side.webp";
import person1_standback from "./assets/persons/person1-stand-back.webp";
import person1_walka from "./assets/persons/person1-walk-a.webp";
import person1_walkb from "./assets/persons/person1-walk-b.webp";
import person1_sitback from "./assets/persons/person1-sit-back.webp";
import person1_sitside from "./assets/persons/person1-sit-side.webp";
import person1_drink from "./assets/persons/person1-drink.webp";
import person1_operate from "./assets/persons/person1-operate.webp";
import person1_chat from "./assets/persons/person1-chat.webp";
import person1_walkcup from "./assets/persons/person1-walk-cup.webp";
import person1_run from "./assets/persons/person1-run.webp";
import person2_standfront from "./assets/persons/person2-stand-front.webp";
import person2_standside from "./assets/persons/person2-stand-side.webp";
import person2_standback from "./assets/persons/person2-stand-back.webp";
import person2_walka from "./assets/persons/person2-walk-a.webp";
import person2_walkb from "./assets/persons/person2-walk-b.webp";
import person2_sitback from "./assets/persons/person2-sit-back.webp";
import person2_sitside from "./assets/persons/person2-sit-side.webp";
import person2_drink from "./assets/persons/person2-drink.webp";
import person2_operate from "./assets/persons/person2-operate.webp";
import person2_chat from "./assets/persons/person2-chat.webp";
import person2_walkcup from "./assets/persons/person2-walk-cup.webp";
import person2_run from "./assets/persons/person2-run.webp";
import person3_standfront from "./assets/persons/person3-stand-front.webp";
import person3_standside from "./assets/persons/person3-stand-side.webp";
import person3_standback from "./assets/persons/person3-stand-back.webp";
import person3_walka from "./assets/persons/person3-walk-a.webp";
import person3_walkb from "./assets/persons/person3-walk-b.webp";
import person3_sitback from "./assets/persons/person3-sit-back.webp";
import person3_sitside from "./assets/persons/person3-sit-side.webp";
import person3_drink from "./assets/persons/person3-drink.webp";
import person3_operate from "./assets/persons/person3-operate.webp";
import person3_chat from "./assets/persons/person3-chat.webp";
import person3_walkcup from "./assets/persons/person3-walk-cup.webp";
import person3_run from "./assets/persons/person3-run.webp";
import person4_standfront from "./assets/persons/person4-stand-front.webp";
import person4_standside from "./assets/persons/person4-stand-side.webp";
import person4_standback from "./assets/persons/person4-stand-back.webp";
import person4_walka from "./assets/persons/person4-walk-a.webp";
import person4_walkb from "./assets/persons/person4-walk-b.webp";
import person4_sitback from "./assets/persons/person4-sit-back.webp";
import person4_sitside from "./assets/persons/person4-sit-side.webp";
import person4_drink from "./assets/persons/person4-drink.webp";
import person4_operate from "./assets/persons/person4-operate.webp";
import person4_chat from "./assets/persons/person4-chat.webp";
import person4_walkcup from "./assets/persons/person4-walk-cup.webp";
import person4_run from "./assets/persons/person4-run.webp";
import person5_standfront from "./assets/persons/person5-stand-front.webp";
import person5_standside from "./assets/persons/person5-stand-side.webp";
import person5_standback from "./assets/persons/person5-stand-back.webp";
import person5_walka from "./assets/persons/person5-walk-a.webp";
import person5_walkb from "./assets/persons/person5-walk-b.webp";
import person5_sitback from "./assets/persons/person5-sit-back.webp";
import person5_sitside from "./assets/persons/person5-sit-side.webp";
import person5_drink from "./assets/persons/person5-drink.webp";
import person5_operate from "./assets/persons/person5-operate.webp";
import person5_chat from "./assets/persons/person5-chat.webp";
import person5_walkcup from "./assets/persons/person5-walk-cup.webp";
import person5_run from "./assets/persons/person5-run.webp";
import person6_standfront from "./assets/persons/person6-stand-front.webp";
import person6_standside from "./assets/persons/person6-stand-side.webp";
import person6_standback from "./assets/persons/person6-stand-back.webp";
import person6_walka from "./assets/persons/person6-walk-a.webp";
import person6_walkb from "./assets/persons/person6-walk-b.webp";
import person6_sitback from "./assets/persons/person6-sit-back.webp";
import person6_sitside from "./assets/persons/person6-sit-side.webp";
import person6_drink from "./assets/persons/person6-drink.webp";
import person6_operate from "./assets/persons/person6-operate.webp";
import person6_chat from "./assets/persons/person6-chat.webp";
import person6_walkcup from "./assets/persons/person6-walk-cup.webp";
import person6_run from "./assets/persons/person6-run.webp";
import person7_standfront from "./assets/persons/person7-stand-front.webp";
import person7_standside from "./assets/persons/person7-stand-side.webp";
import person7_standback from "./assets/persons/person7-stand-back.webp";
import person7_walka from "./assets/persons/person7-walk-a.webp";
import person7_walkb from "./assets/persons/person7-walk-b.webp";
import person7_sitback from "./assets/persons/person7-sit-back.webp";
import person7_sitside from "./assets/persons/person7-sit-side.webp";
import person7_drink from "./assets/persons/person7-drink.webp";
import person7_operate from "./assets/persons/person7-operate.webp";
import person7_chat from "./assets/persons/person7-chat.webp";
import person7_walkcup from "./assets/persons/person7-walk-cup.webp";
import person7_run from "./assets/persons/person7-run.webp";
import ceo_standfront from "./assets/persons/ceo-stand-front.webp";
import ceo_standside from "./assets/persons/ceo-stand-side.webp";
import ceo_standback from "./assets/persons/ceo-stand-back.webp";
import ceo_walka from "./assets/persons/ceo-walk-a.webp";
import ceo_walkb from "./assets/persons/ceo-walk-b.webp";
import ceo_sitback from "./assets/persons/ceo-sit-back.webp";
import ceo_sitside from "./assets/persons/ceo-sit-side.webp";
import ceo_drink from "./assets/persons/ceo-drink.webp";
import ceo_operate from "./assets/persons/ceo-operate.webp";
import ceo_chat from "./assets/persons/ceo-chat.webp";
import ceo_walkcup from "./assets/persons/ceo-walk-cup.webp";
import ceo_run from "./assets/persons/ceo-run.webp";

/** 人物姿势表：[角色][姿势] → url。 */
export const PERSON_ART: Partial<Record<string, Partial<Record<string, string>>>> = {
  "person0": {
    "stand-front": person0_standfront,
    "stand-side": person0_standside,
    "stand-back": person0_standback,
    "walk-a": person0_walka,
    "walk-b": person0_walkb,
    "sit-back": person0_sitback,
    "sit-side": person0_sitside,
    "drink": person0_drink,
    "operate": person0_operate,
    "chat": person0_chat,
    "walk-cup": person0_walkcup,
    "run": person0_run,
  },
  "person1": {
    "stand-front": person1_standfront,
    "stand-side": person1_standside,
    "stand-back": person1_standback,
    "walk-a": person1_walka,
    "walk-b": person1_walkb,
    "sit-back": person1_sitback,
    "sit-side": person1_sitside,
    "drink": person1_drink,
    "operate": person1_operate,
    "chat": person1_chat,
    "walk-cup": person1_walkcup,
    "run": person1_run,
  },
  "person2": {
    "stand-front": person2_standfront,
    "stand-side": person2_standside,
    "stand-back": person2_standback,
    "walk-a": person2_walka,
    "walk-b": person2_walkb,
    "sit-back": person2_sitback,
    "sit-side": person2_sitside,
    "drink": person2_drink,
    "operate": person2_operate,
    "chat": person2_chat,
    "walk-cup": person2_walkcup,
    "run": person2_run,
  },
  "person3": {
    "stand-front": person3_standfront,
    "stand-side": person3_standside,
    "stand-back": person3_standback,
    "walk-a": person3_walka,
    "walk-b": person3_walkb,
    "sit-back": person3_sitback,
    "sit-side": person3_sitside,
    "drink": person3_drink,
    "operate": person3_operate,
    "chat": person3_chat,
    "walk-cup": person3_walkcup,
    "run": person3_run,
  },
  "person4": {
    "stand-front": person4_standfront,
    "stand-side": person4_standside,
    "stand-back": person4_standback,
    "walk-a": person4_walka,
    "walk-b": person4_walkb,
    "sit-back": person4_sitback,
    "sit-side": person4_sitside,
    "drink": person4_drink,
    "operate": person4_operate,
    "chat": person4_chat,
    "walk-cup": person4_walkcup,
    "run": person4_run,
  },
  "person5": {
    "stand-front": person5_standfront,
    "stand-side": person5_standside,
    "stand-back": person5_standback,
    "walk-a": person5_walka,
    "walk-b": person5_walkb,
    "sit-back": person5_sitback,
    "sit-side": person5_sitside,
    "drink": person5_drink,
    "operate": person5_operate,
    "chat": person5_chat,
    "walk-cup": person5_walkcup,
    "run": person5_run,
  },
  "person6": {
    "stand-front": person6_standfront,
    "stand-side": person6_standside,
    "stand-back": person6_standback,
    "walk-a": person6_walka,
    "walk-b": person6_walkb,
    "sit-back": person6_sitback,
    "sit-side": person6_sitside,
    "drink": person6_drink,
    "operate": person6_operate,
    "chat": person6_chat,
    "walk-cup": person6_walkcup,
    "run": person6_run,
  },
  "person7": {
    "stand-front": person7_standfront,
    "stand-side": person7_standside,
    "stand-back": person7_standback,
    "walk-a": person7_walka,
    "walk-b": person7_walkb,
    "sit-back": person7_sitback,
    "sit-side": person7_sitside,
    "drink": person7_drink,
    "operate": person7_operate,
    "chat": person7_chat,
    "walk-cup": person7_walkcup,
    "run": person7_run,
  },
  "ceo": {
    "stand-front": ceo_standfront,
    "stand-side": ceo_standside,
    "stand-back": ceo_standback,
    "walk-a": ceo_walka,
    "walk-b": ceo_walkb,
    "sit-back": ceo_sitback,
    "sit-side": ceo_sitside,
    "drink": ceo_drink,
    "operate": ceo_operate,
    "chat": ceo_chat,
    "walk-cup": ceo_walkcup,
    "run": ceo_run,
  },
};

/** 人物默认预设键：person（09-30 起）。回退 preset=plush-back 走动物绒毛。 */
export function personPresetOn(): boolean {
  try { return (localStorage.getItem("office-art-preset") || "person") === "person"; } catch { return true; }
}

/** 取某角色的姿势图；缺 → null（调用方回落）。 */
export function personArtOf(who: string, pose: string): string | null {
  if (!personPresetOn()) return null;
  return PERSON_ART[who]?.[pose] ?? null;
}
