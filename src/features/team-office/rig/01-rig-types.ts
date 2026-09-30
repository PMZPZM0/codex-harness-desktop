/**
 * 角色骨骼系统 · 类型与常量（team-office 域，09-30 v17「Spine 式骨骼动画」）。
 *
 * ⛔ 为什么不用真 Spine：Spine/DragonBones 的骨架（.skel）必须在它们的 **GUI 编辑器里人工
 *    绑骨**，生图模型只能出位图、出不了骨骼数据，而自动化流程无法操作 GUI。这里照搬
 *    Spine 的 **AnimationState 多轨道混合模型**，用「程序化骨架数据 + 图集部件」实现等价能力：
 *      · 骨骼树（bone）+ 插槽（slot）+ 关键帧曲线（clip）
 *      · 多轨道叠加（主循环 track0 / 附加动作 track1+）
 *      · 状态机驱动、业务与渲染通过事件总线通信
 *    授权成本为零（Spine Runtime 集成需 $69 起的 Editor 许可，见 esotericsoftware.com 许可 §2.4）。
 */

/** 骨骼名（装配顺序 = 绘制顺序，⛔ 改顺序会改变遮挡关系）。 */
export type BoneName = "root" | "hip" | "torso" | "head" | "armBack" | "armFront" | "legBack" | "legFront";

/** 可动画属性：只支持 transform（DESIGN.md 铁律 —— 动画不重画，只改变换）。 */
export type BoneTransform = { x: number; y: number; rotation: number; scaleX: number; scaleY: number };

/** 关键帧：t 是 clip 内的归一化时间（0~1），值与相邻帧线性插值。 */
export type Keyframe = { t: number; v: Partial<BoneTransform> };

/** 一条骨骼轨道（某根骨头在一个 clip 里的整段曲线）。 */
export type BoneTrack = { bone: BoneName; loop: boolean; keys: Keyframe[] };

/**
 * 动画片段（clip）。duration 单位 = 秒；loop = 是否循环。
 * ⛔ clip 只描述**相对量**（rotation 增量 / 位移增量），不写绝对坐标 —— 同一套 clip 才能
 *    复用在坐姿与站姿两套骨架上。
 */
export type RigClip = {
  name: string;
  duration: number;
  loop: boolean;
  tracks: BoneTrack[];
};

/** 混合模式：replace = 独占该骨骼（高轨道覆盖低轨道）；add = 叠加（低轨道结果 + 增量）。 */
export type MixMode = "replace" | "add";

/** 轨道状态（Spine 的 TrackEntry 等价物）。 */
export type TrackEntry = {
  clip: RigClip;
  /** 轨道号：0 = 基础循环，1+ = 附加动作 */
  track: number;
  mode: MixMode;
  /** 播放进度（秒） */
  time: number;
  /** 轨道权重（淡入淡出用，0~1） */
  alpha: number;
  /** 循环次数上限（附加动作播完即卸载：null = 无限循环） */
  repeat: number | null;
  /** 已播次数 */
  played: number;
};

/** 角色的外观描述（用于装配时取部件）。 */
export type RigLook = {
  hair: number;
  skin: number;
  shirt: number;
  pants: number;
  hairStyle: 0 | 1 | 2;
};

/** 角色状态（业务侧唯一输入 —— 渲染层只认这几种，不认识业务语义）。 */
export type RigState =
  | "idle"       // 待机（呼吸 + 偶尔眨眼）
  | "typing"     // 打字（坐姿双手敲键盘）
  | "standup"    // 起身（一次性，播完回落 idle/typing）
  | "handup"     // 举手（一次性：任务完成）
  | "walk"       // 行走
  | "interact";  // 与设施交互（接水 / 操作机器）

/** 状态 → clip 名（⛔ 单一真相源：改这里别改渲染层）。 */
export const STATE_CLIP: Record<RigState, string> = {
  idle: "idle",
  typing: "typing",
  standup: "standup",
  handup: "handup",
  walk: "walk",
  interact: "interact",
};

/** 轨道号约定（⛔ 附加动作必须 ≥1，主循环恒为 0）。 */
export const TRACK_MAIN = 0;
export const TRACK_ADD = 1;

/** 注视跟随的角度上限（弧度，±22°）—— 约束 4：禁止无限转头。 */
export const LOOK_MAX_RAD = 0.38;
/** 注视缓动系数（每帧向目标靠拢的比例）—— 越大越"急"，太小会显得迟钝。 */
export const LOOK_EASE = 0.08;
/** 头部骨骼上下点动的幅度上限（配合左右转头，像"抬头看"）。 */
export const LOOK_TILT_RAD = 0.12;

/** 眼睛闭合动画（眨眼）时长（秒）—— 附加动作，走 track1。 */
export const BLINK_DURATION = 0.18;
/** 眨眼间隔区间（秒）—— 每个角色独立随机（约束 5）。 */
export const BLINK_GAP_MIN = 3;
export const BLINK_GAP_MAX = 7;
