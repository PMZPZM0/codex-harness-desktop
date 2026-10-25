/**
 * 语音悬浮球外观目录（10-25 用户：「配套一套好看的，在设置语音通话界面可以改样式，
 * 多内置一些好看的」）。
 *
 * ⛔ 单一真相源：渲染层设置页、悬浮球皮肤类名、主进程 settings 校验都从这里取 id；
 *    ⛔ 别在别处再写一份 id/名称表（守卫 11z 会比对）。
 * ⛔ 纯数据 + 纯函数，不 import electron / 不碰 DOM ⇒ 守卫可直接 import 跑真值表。
 */
export const VOICE_BALL_STYLES = [
  { id: "glass", name: "琉璃", desc: "默认透明玻璃球，暖橙光晕" },
  { id: "aurora", name: "极光", desc: "青绿到紫的极光底色" },
  { id: "sunset", name: "落日", desc: "橙粉晚霞一样的暖光" },
  { id: "neon", name: "霓虹", desc: "蓝紫霓虹，外圈更亮" },
  { id: "moon", name: "月白", desc: "冷白月光，安静克制" },
  { id: "ember", name: "余烬", desc: "暗金火星，光晕偏暖" },
];

export const DEFAULT_VOICE_BALL_STYLE = "glass";

/** 未知/旧值统一回落默认（⛔ 不要抛错：设置文件可能被手改/来自旧版本）。 */
export function normalizeVoiceBallStyle(value) {
  const id = String(value ?? "").trim();
  return VOICE_BALL_STYLES.some((style) => style.id === id) ? id : DEFAULT_VOICE_BALL_STYLE;
}
