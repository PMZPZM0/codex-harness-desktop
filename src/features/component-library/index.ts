/**
 * 组件库域 · 公开面（barrel）。别的域只许从这里 import（架构规则 §1）。
 * 独立于「控件皮肤」：皮肤管换肤（接线到应用控件），这里管**浏览与取码**（给用户/引擎
 * 开发别的软件用）。数据同源：src/lib/ui-skin/{catalog.gen,load}（基座，单一真相源）。
 */
export { ComponentLibraryPage } from "./ComponentLibrary";
