/**
 * 动画片段定义（team-office 域 rig，09-30 v17）。
 *
 * 六个 clip（⛔ 约束 1 的多轨道模型靠这里喂）：
 *   · idle    —— track0 循环：呼吸起伏 + 身体轻摆（头/躯干 rotation 微幅正弦）
 *   · typing  —— track0 循环：双臂交替小幅下压（敲键盘）+ 躯干前倾 2°
 *   · walk    —— track0 循环：双腿反相摆动 + 双臂反相摆动 + 整体上下颠
 *   · standup —— track0 一次性：臀部上移 + 腿从水平转竖直（起身）
 *   · handup  —— track1 附加：前臂抬起举过肩 + 头微仰（任务完成的庆祝）
 *   · interact —— track0 循环：单臂前伸（接水 / 操作机器）
 *
 * ⛔ 只写**相对量**：rotation 增量与位移增量（相对装配姿态），同一套 clip 在坐/站两套
 *    装配上都能播。⛔ 时长单位秒；打字/呼吸的频率对齐 OFFICE_TICK_MS 的节拍观感。
 */
import type { RigClip } from "./01-rig-types";

/** 呼吸：躯干 scaleY 1±0.012，周期 ≈ 3.9s（与 OFFICE_TICK_MS=1200ms 的 3.25 倍，观感自然）。 */
export const CLIP_IDLE: RigClip = {
  name: "idle",
  duration: 3.9,
  loop: true,
  tracks: [
    { bone: "torso", loop: true, keys: [
      { t: 0, v: { rotation: 0, scaleY: 1 } },
      { t: 0.5, v: { rotation: 0.012, scaleY: 1.012 } },
      { t: 1, v: { rotation: 0, scaleY: 1 } },
    ] },
    { bone: "head", loop: true, keys: [
      { t: 0, v: { rotation: 0 } },
      { t: 0.5, v: { rotation: -0.02 } },
      { t: 1, v: { rotation: 0 } },
    ] },
    { bone: "armBack", loop: true, keys: [
      { t: 0, v: { rotation: 0 } },
      { t: 0.5, v: { rotation: 0.05 } },
      { t: 1, v: { rotation: 0 } },
    ] },
  ],
};

/** 打字：双臂交替下压（前臂在键盘上），躯干前倾一点。周期 0.9s（≈ 每拍敲两下）。 */
export const CLIP_TYPING: RigClip = {
  name: "typing",
  duration: 0.9,
  loop: true,
  tracks: [
    { bone: "armBack", loop: true, keys: [
      { t: 0, v: { rotation: 0 } },
      { t: 0.25, v: { rotation: 0.09 } },
      { t: 0.5, v: { rotation: 0 } },
      { t: 1, v: { rotation: 0 } },
    ] },
    { bone: "armFront", loop: true, keys: [
      { t: 0, v: { rotation: 0 } },
      { t: 0.75, v: { rotation: 0.09 } },
      { t: 1, v: { rotation: 0 } },
    ] },
    { bone: "torso", loop: true, keys: [
      { t: 0, v: { rotation: 0.03 } },
      { t: 0.5, v: { rotation: 0.045 } },
      { t: 1, v: { rotation: 0.03 } },
    ] },
  ],
};

/** 行走：双腿反相摆 ±0.5 rad，双臂反摆 ±0.35，整体上下颠（root y）。 */
export const CLIP_WALK: RigClip = {
  name: "walk",
  duration: 0.72,
  loop: true,
  tracks: [
    { bone: "legBack", loop: true, keys: [
      { t: 0, v: { rotation: 0 } },
      { t: 0.25, v: { rotation: 0.5 } },
      { t: 0.5, v: { rotation: 0 } },
      { t: 0.75, v: { rotation: -0.5 } },
      { t: 1, v: { rotation: 0 } },
    ] },
    { bone: "legFront", loop: true, keys: [
      { t: 0, v: { rotation: 0 } },
      { t: 0.25, v: { rotation: -0.5 } },
      { t: 0.5, v: { rotation: 0 } },
      { t: 0.75, v: { rotation: 0.5 } },
      { t: 1, v: { rotation: 0 } },
    ] },
    { bone: "armBack", loop: true, keys: [
      { t: 0, v: { rotation: 0 } },
      { t: 0.25, v: { rotation: -0.35 } },
      { t: 0.5, v: { rotation: 0 } },
      { t: 0.75, v: { rotation: 0.35 } },
      { t: 1, v: { rotation: 0 } },
    ] },
    { bone: "armFront", loop: true, keys: [
      { t: 0, v: { rotation: 0 } },
      { t: 0.25, v: { rotation: 0.35 } },
      { t: 0.5, v: { rotation: 0 } },
      { t: 0.75, v: { rotation: -0.35 } },
      { t: 1, v: { rotation: 0 } },
    ] },
    { bone: "root", loop: true, keys: [
      { t: 0, v: { y: 0 } },
      { t: 0.25, v: { y: -3.2 } },
      { t: 0.5, v: { y: 0 } },
      { t: 0.75, v: { y: -3.2 } },
      { t: 1, v: { y: 0 } },
    ] },
  ],
};

/** 起身（一次性，0.9s）：臀部上移 30（坐→站的高度差）+ 双腿从水平转回竖直。 */
export const CLIP_STANDUP: RigClip = {
  name: "standup",
  duration: 0.9,
  loop: false,
  tracks: [
    { bone: "root", loop: false, keys: [
      { t: 0, v: { y: 0 } },
      { t: 0.6, v: { y: -30 } },
      { t: 1, v: { y: -30 } },
    ] },
    { bone: "legBack", loop: false, keys: [
      { t: 0, v: { rotation: 0 } },
      { t: 0.6, v: { rotation: 0 } },
      { t: 1, v: { rotation: 0 } },
    ] },
  ],
};

/** 举手（track1 附加，一次性 1.2s）：前臂举过肩 + 头微仰 + 落回。 */
export const CLIP_HANDUP: RigClip = {
  name: "handup",
  duration: 1.2,
  loop: false,
  tracks: [
    { bone: "armFront", loop: false, keys: [
      { t: 0, v: { rotation: 0 } },
      { t: 0.3, v: { rotation: -2.1 } },
      { t: 0.6, v: { rotation: -2.1 } },
      { t: 1, v: { rotation: 0 } },
    ] },
    { bone: "head", loop: false, keys: [
      { t: 0, v: { rotation: 0 } },
      { t: 0.3, v: { rotation: -0.1 } },
      { t: 1, v: { rotation: 0 } },
    ] },
  ],
};

/** 交互（循环 1.6s）：前臂前伸 + 小幅起落（接水 / 按按钮）。 */
export const CLIP_INTERACT: RigClip = {
  name: "interact",
  duration: 1.6,
  loop: true,
  tracks: [
    { bone: "armFront", loop: true, keys: [
      { t: 0, v: { rotation: -0.9 } },
      { t: 0.5, v: { rotation: -1.05 } },
      { t: 1, v: { rotation: -0.9 } },
    ] },
    { bone: "torso", loop: true, keys: [
      { t: 0, v: { rotation: 0.04 } },
      { t: 0.5, v: { rotation: 0.055 } },
      { t: 1, v: { rotation: 0.04 } },
    ] },
  ],
};

/** 眨眼（track1 附加，0.18s）：头部 scaleY 快速压一下 —— 程序化部件没有独立眼睑，
 *  远看等效「眨了下眼」；部件换成图集后可换真眼睑贴图切换。 */
export const CLIP_BLINK: RigClip = {
  name: "blink",
  duration: 0.18,
  loop: false,
  tracks: [
    { bone: "head", loop: false, keys: [
      { t: 0, v: { scaleY: 1 } },
      { t: 0.5, v: { scaleY: 0.94 } },
      { t: 1, v: { scaleY: 1 } },
    ] },
  ],
};

/** 全部 clip（⛔ 按 name 取用，别散落字符串）。 */
export const RIG_CLIPS: Record<string, RigClip> = {
  idle: CLIP_IDLE,
  typing: CLIP_TYPING,
  walk: CLIP_WALK,
  standup: CLIP_STANDUP,
  handup: CLIP_HANDUP,
  interact: CLIP_INTERACT,
  blink: CLIP_BLINK,
};
