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

/**
 * 角色毛色（09-30 v12「写实化 + 加五官」）。
 *
 * ⛔ 为什么不再用"平的纯黑"：v10 的纯黑剪影在 40px 下**形体全糊**（用户 09-30：「动物的
 *    也真实化一点，现在一看丑」）。现在改成**三档极近的深色**堆出体积：
 *    受光面（FUR_LIT）> 主体（FUR）> 背光面（FUR_SHADE）—— 色差很小（同一族），
 *    远看仍是一只"深色动物"，近看有转折面，不是一坨黑。
 * ⛔ 别把差值拉大：拉开就变成"打了灯的塑料玩偶"，与办公室插画的柔和光感违和。
 */
export const FUR = "#1b1b23";        // 主体（近黑：参考里的角色就是黑的，靠白眼睛"活"起来）
export const FUR_LIT = "#2a2a34";    // 受光面（头顶、肩、外耳）
export const FUR_SHADE = "#101016";  // 背光面（后脑、身后那条手臂、躯干下缘）
/** 兼容旧名（耳朵 / 躯干的老调用点）：等价主体色。 */
export const SILHOUETTE = FUR;

/** 五官（09-30 新增）：眼睛 / 口鼻 / 胡须。
 *  ⛔ 眼睛必须有**眼白 + 瞳孔 + 高光**三层才有神；只点一个黑点远看像"墨点"（实测）。 */
export const FACE = {
  muzzle: "#d9d9de",   // 吻部：参考里是**浅色**（白眼 + 白吻部 = 脸才亮得起来）
  muzzleDark: "#c2c2c9",
  nose: "#1b1b22",     // 鼻头（最深的一小块）
  eyeWhite: "#fbfbfd",
  pupil: "#15151c",
  shine: "#ffffff",
  mouth: "#2a2a33",
  whisker: "#9a9aa4",
  innerEar: "#545060",
  tongue: "#e58f95",
} as const;

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
