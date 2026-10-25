/**
 * 语音悬浮球角色外观目录（10-25 用户：「我是让你里面的样式，gorkbot 那种样式」）。
 *
 * 风格基线 = Grok Bot 图标式：**大圆脸 + 胶囊形眼睛（无瞳孔/眼白/睫毛）+ 腮红，
 * 不画鼻子和嘴**；每套只换脸/眼/腮红配色与一个小配件，角色仍是同一个。
 *
 * ⛔ 单一真相源：设置页预览、悬浮球皮肤类名、主进程 settings 校验都从这里取 id；
 *    ⛔ 别在别处再写一份 id/名称表（守卫 11z 会比对）。
 * ⛔ 纯数据 + 纯函数，不 import electron / 不碰 DOM ⇒ 守卫可直接 import 跑真值表。
 */
export const VOICE_BALL_STYLES = [
  { id: "ink", name: "墨黑", desc: "Grok Bot 经典：黑脸 + 白胶囊眼 + 腮红" },
  { id: "cream", name: "奶油", desc: "奶油色圆脸，黑眼睛，暖腮红" },
  { id: "mint", name: "薄荷", desc: "薄荷绿脸，头顶冒一瓣小芽" },
  { id: "peach", name: "蜜桃", desc: "蜜桃粉脸，别一颗小星星" },
  { id: "sky", name: "天蓝", desc: "天蓝脸，头顶一根小天线" },
  { id: "moon", name: "月白", desc: "月白脸，戴一圈细光环" },
];

export const DEFAULT_VOICE_BALL_STYLE = "ink";

/** 未知/旧值统一回落默认（⛔ 不要抛错：设置文件可能被手改/来自旧版本）。 */
export function normalizeVoiceBallStyle(value) {
  const id = String(value ?? "").trim();
  return VOICE_BALL_STYLES.some((style) => style.id === id) ? id : DEFAULT_VOICE_BALL_STYLE;
}
