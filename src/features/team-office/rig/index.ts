/** rig 子域 barrel（⛔ 对外只从这里 import，别深链内部文件 —— 架构规则 §分层依赖）。 */
export type {
  BoneName, BoneTransform, Keyframe, BoneTrack, RigClip, MixMode, TrackEntry,
  RigLook, RigState,
} from "./01-rig-types";
export type { RigEvent } from "./04-rig-bus";
export { STATE_CLIP, TRACK_MAIN, TRACK_ADD, LOOK_MAX_RAD, LOOK_EASE, LOOK_TILT_RAD } from "./01-rig-types";
export { RIG_CLIPS } from "./02-rig-clips";
export {
  buildRig, setState, playOnce, updateRig, poseOf, lookOfKey, type RigActor, type PartPainter,
} from "./03-rig-actor";
export { onRigEvent, emitRigEvent } from "./04-rig-bus";
export { paintPart } from "./05-rig-parts";
