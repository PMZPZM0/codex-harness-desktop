/**
 * 办公室插画色板（team-office 域 09-27 v10「照参考：黑色剪影 + 彩色项圈」）。
 *
 * ⛔ v10 为什么又换：用户 09-27 贴了参考画面（Marvis 的办公室）并要求「照这个效果来」。
 *    参考里的角色**不是有色人形**，而是：
 *      · 一只**纯黑动物剪影**（圆头 + 两只尖耳 + 两侧伸出的爪子），背对观众、**没有五官**；
 *      · 脖子上一圈**饱和彩色项圈**（绿/红/紫/蓝/黄/青…），这是全身唯一的颜色；
 *      · 通体**没有描边**（是 3D 渲染观感，靠明暗分层，不是卡通线稿）。
 *    ⇒ 之前那套「肤色 + 发色 + 上衣色」的人形色板（v4~v9）整体废弃：
 *      认人改成**靠项圈色**，每个成员稳定派生一个（同一人每次进办公室都是同一个色）。
 *
 * ⛔ 场景是**固定浅色插画**（不跟随深色主题）—— 插画自带光感与阴影，跟主题反色会发脏
 *    （DESIGN.md 的 Theming 节也钉了这条）。
 */

/** 剪影墨色：参考里是接近纯黑而非 #000（纯黑在小尺寸下会"糊成洞"，略抬一档更像渲染）。
 *  ⛔ 角色剪影是**平的纯黑**：不给它加高光/渐变 —— 40px 尺寸下那道高光会像一块污渍（实测过）。 */
export const SILHOUETTE = "#111116";

/**
 * 项圈色板（照参考：高饱和、彼此拉得开、在白底上一眼能分辨）。
 * ⛔ 项圈是角色身上**唯一**的颜色 ⇒ 色相必须分得开（不要出现两个"都偏蓝"）。
 */
export const COLLARS = [
  "#3fbf62", // 绿
  "#e0453c", // 红
  "#8b5cf6", // 紫
  "#2f7fe0", // 蓝
  "#f0c23c", // 黄
  "#22c6c0", // 青
  "#ef7d4e", // 橙
  "#d94f9e", // 品红
] as const;

/** CEO 专属项圈色（金色，与员工色板不撞）。 */
export const CEO_COLLAR = "#d8a02c";

/** 项圈色：按成员序号稳定派生 —— ⛔ 不是每拍随机，否则同一人一会儿绿一会儿红。 */
export function collarColor(index: number, isCeo = false): string {
  if (isCeo) return CEO_COLLAR;
  const n = ((index % COLLARS.length) + COLLARS.length) % COLLARS.length;
  return COLLARS[n];
}

/** 项圈背面（略暗一档，给项圈一条厚度边）。 */
export function collarDark(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = Math.round(((n >> 16) & 255) * 0.74);
  const g = Math.round(((n >> 8) & 255) * 0.74);
  const b = Math.round((n & 255) * 0.74);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * 角色物种（09-27 v10，用户：「换一个动物，每个角色都是不同的动物」）。
 * ⛔ 剪影**全是黑的、没有五官** ⇒ 物种只能靠**头部与耳朵的外形**区分，
 *    所以每种动物的耳朵必须在小尺寸下也一眼分得开（尖三角 / 垂耳 / 长立耳 / 圆耳 /
 *    大外扩圆耳 / 鬃毛 / 尖刺 / 分叉角 …）。⛔ 想加新物种先自问：缩到 30px 还认得出来吗？
 * ⛔ 顺序即分配顺序（稳定）：同一成员每次进办公室都是同一种动物 + 同一个项圈色。
 */
export type AnimalKind =
  | "cat" | "fox" | "dog" | "rabbit" | "bear" | "sheep"
  | "koala" | "mouse" | "deer" | "hedgehog" | "pig" | "lion";

/** 员工物种池（CEO 之外按序号轮转）。 */
export const ANIMALS: AnimalKind[] = [
  "cat", "fox", "dog", "rabbit", "bear", "sheep",
  "koala", "mouse", "deer", "hedgehog", "pig",
];

/** CEO 物种（狮子 —— 鬃毛是全场最好认的一个剪影）。 */
export const CEO_ANIMAL: AnimalKind = "lion";

export function animalOf(index: number, isCeo = false): AnimalKind {
  if (isCeo) return CEO_ANIMAL;
  const n = ((index % ANIMALS.length) + ANIMALS.length) % ANIMALS.length;
  return ANIMALS[n];
}


/**
 * 覆层语义色（交接卡片 / 落点特效）。
 * ⛔ 只留实际用到的两个键 —— 房间 / 家具 / 角色的颜色全在 office-render 的 SKIN 与上面的
 *    剪影色板里，别再往这里加插画色（会分叉出第二套真相源）。
 */
export const OFC = {
  ink: "#22303f",
  ok: "#4aa96c",
} as const;
