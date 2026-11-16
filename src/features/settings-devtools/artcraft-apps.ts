/**
 * Craft 全家桶的应用目录（11-16）—— 层级 2 弹窗里的 App 清单与层级 3 弹窗的详情文案。
 *
 * ⛔ 数据来源：launcher 仓库 README 的 Craft App Suite 表 + 11-16 实测 GitHub release 资产
 *   （Windows x64 portable zip 体积）。体积随版本变化 ⇒ 界面统一写「约 N MB」。
 * ⛔ 单一真相源：层级 2 列表与层级 3 详情都读这一份，别在组件里另写一份清单。
 * ⛔ 社区 App（SolidCraft / MailCraft）没有核实过功能描述 ⇒ 只写「社区维护」，不编造用途。
 */
export type CraftAppInfo = {
  /** 稳定 key（同时用于详情弹窗的选中状态）。 */
  key: string;
  name: string;
  /** 中文定位，一行。 */
  zh: string;
  /** 两行以内说明。 */
  desc: string;
  /** Windows x64 便携包体积（MB，11-16 实测）；0 = 未核实（界面显示「体积随版本」）。 */
  sizeMb: number;
  repo: string;
  /** 官网详情页（社区 App / Craft Anything 可能没有）。 */
  site?: string;
  /** 宿主已有直连 Codex 工具（目前只有 PhotoCraft）。 */
  integrated?: boolean;
  community?: boolean;
};

export const CRAFT_APPS: CraftAppInfo[] = [
  { key: "photocraft", name: "PhotoCraft", zh: "图像编辑", desc: "图层 / 蒙版 / 调整层 / 文字 / 真实 PSD 读写；已接入 Codex 的 photocraft 工具与原生窗口编辑。", sizeMb: 137, repo: "https://github.com/storytold/photocraft", site: "https://getartcraft.com/apps/photocraft", integrated: true },
  { key: "lightcraft", name: "LightCraft", zh: "照片库与 RAW 冲图", desc: "照片库 + RAW 显影，非破坏式调整。", sizeMb: 117, repo: "https://github.com/storytold/lightcraft", site: "https://getartcraft.com/apps/lightcraft" },
  { key: "filmcraft", name: "FilmCraft", zh: "视频剪辑", desc: "非线性剪辑，带调色与声音处理。", sizeMb: 108, repo: "https://github.com/storytold/filmcraft", site: "https://getartcraft.com/apps/filmcraft" },
  { key: "effectcraft", name: "EffectCraft", zh: "动效与合成", desc: "运动图形与视觉特效合成。", sizeMb: 81, repo: "https://github.com/storytold/effectcraft", site: "https://getartcraft.com/apps/effectcraft" },
  { key: "anicraft", name: "AniCraft", zh: "2D 动画", desc: "逐帧动画；导入 .fla / .xfl 与 SVG，导出 GIF / Lottie / 视频。", sizeMb: 18, repo: "https://github.com/storytold/anicraft" },
  { key: "vectorcraft", name: "VectorCraft", zh: "矢量插画", desc: "矢量图形绘制与编辑。", sizeMb: 155, repo: "https://github.com/storytold/vectorcraft", site: "https://getartcraft.com/apps/vectorcraft" },
  { key: "figcraft", name: "FigCraft", zh: "界面设计与原型", desc: "协作式界面设计与原型工具。", sizeMb: 97, repo: "https://github.com/storytold/figcraft" },
  { key: "designcraft", name: "DesignCraft", zh: "页面与版式", desc: "页面与版式设计编辑器。", sizeMb: 120, repo: "https://github.com/storytold/designcraft" },
  { key: "deckcraft", name: "DeckCraft", zh: "演示文稿", desc: "幻灯片与演示制作。", sizeMb: 100, repo: "https://github.com/storytold/deckcraft" },
  { key: "wordcraft", name: "WordCraft", zh: "文字处理", desc: "文档编辑：ribbon、快捷键、段落排版与 PDF 输出。", sizeMb: 113, repo: "https://github.com/storytold/wordcraft" },
  { key: "gridcraft", name: "GridCraft", zh: "电子表格", desc: "电子表格（clean-room 实现）。", sizeMb: 50, repo: "https://github.com/storytold/gridcraft" },
  { key: "pdfcraft", name: "PdfCraft", zh: "PDF 阅读与编辑", desc: "PDF 阅读、整理与保护。", sizeMb: 117, repo: "https://github.com/storytold/pdfcraft", site: "https://getartcraft.com/apps/pdfcraft" },
  { key: "cadcraft", name: "CADCraft", zh: "CAD 制图", desc: "计算机辅助设计与制图。", sizeMb: 71, repo: "https://github.com/storytold/cadcraft" },
  { key: "soundcraft", name: "SoundCraft", zh: "数字音频工作站", desc: "多轨音频录制与编辑（DAW）。", sizeMb: 19, repo: "https://github.com/storytold/soundcraft" },
  { key: "materialcraft", name: "MaterialCraft", zh: "节点材质", desc: "节点式材质设计。", sizeMb: 21, repo: "https://github.com/storytold/materialcraft" },
  { key: "texturecraft", name: "TextureCraft", zh: "3D 贴图绘制", desc: "面向 3D 的贴图绘制流程。", sizeMb: 41, repo: "https://github.com/storytold/texturecraft" },
  { key: "craft-anything", name: "Craft Anything", zh: "理解任意软件并自造", desc: "分析任意软件怎么运作，并据此做出自己的工具。", sizeMb: 0, repo: "https://github.com/storytold/craft-anything" },
  { key: "solidcraft", name: "SolidCraft", zh: "社区 App", desc: "由 ArtCraft 社区维护的 App，在 Launcher 里可安装。", sizeMb: 0, repo: "https://github.com/storytold/craft-launcher", community: true },
  { key: "mailcraft", name: "MailCraft", zh: "社区 App", desc: "由 ArtCraft 社区维护的 App，在 Launcher 里可安装。", sizeMb: 0, repo: "https://github.com/storytold/craft-launcher", community: true },
];

/** 按 key 取 App（层级 3 弹窗用；找不到返回 undefined）。 */
export function craftAppByKey(key: string | null): CraftAppInfo | undefined {
  return key ? CRAFT_APPS.find((app) => app.key === key) : undefined;
}
