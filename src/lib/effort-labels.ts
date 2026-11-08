/** effortLabels（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */

export const effortLabels: Record<string, string> = {
  none: "关闭",
  minimal: "极简",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  ultra: "最高",
  /* 11-08 审查：模型规格表（model-specs）里有 "max" 档（DeepSeek / GPT-6.1 等），
     缺这条标签会让思考菜单直接显示英文「max」。⛔ 与 EFFORT_ORDER 必须一一对应（守卫钉住）。 */
  max: "最大",
};
