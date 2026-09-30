/**
 * 设置页「控件皮肤」：把应用控件换上 Uiverse 社区效果（MIT）。
 * 结构 = 左原型清单 + 右库浏览器（见 ui-skin 域的 UiSkinWorkshop）。
 */
import { UiSkinWorkshop } from "../ui-skin";

export function UiSkinSettingsSection() {
  return (
    <div className="ui-skin-page">
      <div className="ui-skin-page-head">
        <h3>控件皮肤</h3>
        <p>
          给应用里的控件换上社区效果——选中原型，再挑一个喜欢的样式，全局生效、随时恢复默认。
          库来自 Uiverse.io Galaxy（3802 个元素，MIT 许可）。
        </p>
      </div>
      <UiSkinWorkshop />
    </div>
  );
}
