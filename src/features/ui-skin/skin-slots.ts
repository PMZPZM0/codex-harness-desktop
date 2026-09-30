/**
 * 控件皮肤 · 原型（slot）定义 —— 单一真相源
 *
 * 把应用控件归纳成有限个「原型」，每个原型可绑定一个 Uiverse 元素（MIT，见 library/）。
 * ⛔ 只列**真实接线**的原型：binding 存了但没人消费 = 用户应用了没效果（骗人）。
 *   未接线的原型（按钮/复选框/单选/输入框/通知）等铺开接线后再进这张表。
 */

export type SkinSlotId = "toggle-switch" | "loader";

export type SkinSlotDef = {
  id: SkinSlotId;
  label: string;
  /** 哪些类目的元素适合这个原型（工坊里默认过滤） */
  cats: string[];
  /** 接线点说明（工坊里展示给用户：改了哪里会变） */
  wired: string;
};

export const SKIN_SLOTS: SkinSlotDef[] = [
  {
    id: "toggle-switch",
    label: "开关",
    cats: ["Toggle-switches"],
    wired: "设置页与各处启停开关（共享组件 ToggleSwitch，7+ 处）",
  },
  {
    id: "loader",
    label: "加载器",
    cats: ["loaders"],
    wired: "卡片执行中 / 页面加载指示（共享组件 Spinner，36 处）",
  },
];

/** 全库类目（浏览用，不止可绑定的）——由 catalog.gen.ts 提供，这里只给展示顺序。 */
export const SKIN_LIB_LABELS: Record<string, string> = {
  Buttons: "按钮",
  Cards: "卡片",
  Checkboxes: "复选框",
  Forms: "表单",
  Inputs: "输入框",
  Notifications: "通知",
  Patterns: "图案",
  "Radio-buttons": "单选",
  "Toggle-switches": "开关",
  Tooltips: "工具提示",
  loaders: "加载器",
};
