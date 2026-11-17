/**
 * Craft 全家桶的应用目录（11-16）—— 层级 2 弹窗里的 App 清单与层级 3 弹窗的详情文案。
 *
 * ⛔ 数据来源：Launcher 自带目录（`ArtCraftLauncherData/cache/launcher-catalog.json`）里的
 *   id / repo / website / color / 功能点，11-16 逐条对照后翻成中文；体积是当日 Windows x64
 *   portable zip 实测值（会随版本变化 ⇒ 界面写「约」）。
 * ⛔ 单一真相源：层级 2 列表与层级 3 详情都读这一份，别在组件里另写一份清单。
 * ⛔ 已安装状态**不在这里**：由主进程扫描 Launcher 的安装目录后随 status 下发（装完自动联动）。
 */
export type CraftAppInfo = {
  /** 稳定 key（与 Launcher 目录 id 一致；同时用于详情弹窗选中状态）。 */
  key: string;
  name: string;
  /** 中文定位，一行。 */
  zh: string;
  /** 两行以内说明。 */
  desc: string;
  /** 详情页「能做什么」的中文要点（来自上游目录的功能点）。 */
  features: string[];
  /** Windows x64 便携包体积（MB，11-16 实测）；0 = 未核实。 */
  sizeMb: number;
  repo: string;
  site?: string;
  /** Launcher 目录给的主题色（徽标用）。 */
  color: string;
  /** 宿主已有直连 Codex 工具（目前只有 PhotoCraft）。 */
  community?: boolean;
};

export const CRAFT_APPS: CraftAppInfo[] = [
  { key: "photocraft", name: "PhotoCraft", zh: "图像编辑", desc: "图层 / 蒙版 / 调整层 / 文字 / 真实 PSD 读写；装好后可接 Codex 的 photocraft 工具与原生窗口编辑。", features: ["原生 GPU 画布，非 Electron / 网页套壳", "分层 PSD / PSB 读写", "调整层 / 智能对象 / 图层样式", "本地主体与物体选择、蒙版细化"], sizeMb: 137, repo: "https://github.com/storytold/photocraft", site: "https://getartcraft.com/apps/photocraft", color: "#2f7bf5" },
  { key: "lightcraft", name: "LightCraft", zh: "照片库与 RAW 冲图", desc: "照片库 + RAW 显影，非破坏式调整。", features: ["非破坏式 32 位宽色域管线，不碰原片", "光 / 颜色 / 效果 / 曲线 / 混色 / 调色轮与预设", "画笔 / 渐变 / 范围蒙版，天空 / 主体 / 背景蒙版", "原生 RAW：DNG / CR2 / ARW / NEF / RAF / RW2 / PEF / ORF"], sizeMb: 117, repo: "https://github.com/storytold/lightcraft", site: "https://getartcraft.com/apps/lightcraft", color: "#f2a516" },
  { key: "vectorcraft", name: "VectorCraft", zh: "矢量插画", desc: "矢量图形绘制与编辑。", features: ["钢笔 / 直接选择 / 布尔 / 吸附等熟悉工作流", "数千图形仍保持流畅", "混合、封套、网格、发光、阴影保持可编辑", "位图转矢量描摹；SVG / PDF 进出"], sizeMb: 155, repo: "https://github.com/storytold/vectorcraft", site: "https://getartcraft.com/apps/vectorcraft", color: "#e8573f" },
  { key: "filmcraft", name: "FilmCraft", zh: "视频剪辑", desc: "非线性剪辑，带调色与声音处理。", features: ["时间线三点编辑与 J/K/L 修剪", "整数时基，23.976 / 29.97 精确不漂移", "原生 H.264 / HEVC / ProRes / VP9 编解码", "调色（曲线 / 色轮 / HSL / LUT / HDR）与关键帧"], sizeMb: 108, repo: "https://github.com/storytold/filmcraft", site: "https://getartcraft.com/apps/filmcraft", color: "#8b5cf6" },
  { key: "effectcraft", name: "EffectCraft", zh: "动效与合成", desc: "运动图形与视觉特效合成。", features: ["熟悉的面板与关键帧 / 曲线编辑器", "各类图层：形状 / 文字 / 素材 / 预合成 / 调整层", "模糊、调色、扭曲、粒子、抠像等特效库", "真实 3D 图层 / 相机 / 景深 / 软阴影"], sizeMb: 81, repo: "https://github.com/storytold/effectcraft", site: "https://getartcraft.com/apps/effectcraft", color: "#e0368f" },
  { key: "anicraft", name: "AniCraft", zh: "2D 动画", desc: "逐帧动画；导入 .fla / .xfl 与 SVG，导出 GIF / Lottie / 视频。", features: ["舞台 / 时间线 / 图层 / 洋葱皮", "经典补间与形状补间（含缓动曲线）", "图形符号 / 影片剪辑 / 嵌套时间线 / 遮罩", "导出 PNG 序列 / GIF / Lottie / WebM / MP4"], sizeMb: 18, repo: "https://github.com/storytold/anicraft", color: "#dac604" },
  { key: "figcraft", name: "FigCraft", zh: "界面设计与原型", desc: "协作式界面设计与原型工具。", features: ["自动布局（行 / 列 / 换行 / 网格）", "组件实例 / 变体 / 属性 / 样式 / 变量", "矢量网络 / 形状生成 / 布尔 / 变宽描边", "原型连接 / 触发器 / 动画过渡 / 演示视图"], sizeMb: 97, repo: "https://github.com/storytold/figcraft", site: "https://getartcraft.com/apps/figcraft", color: "#02da96" },
  { key: "designcraft", name: "DesignCraft", zh: "页面与版式", desc: "页面与版式设计编辑器。", features: ["跨页 / 主页 / 框架 / 串接文本与样式", "Knuth–Plass 排版、断字与基线网格", "印刷级 PDF（可选文本 / 嵌入字体 / CMYK / 出血）", "多线程渲染与即时撤销"], sizeMb: 120, repo: "https://github.com/storytold/designcraft", site: "https://getartcraft.com/apps/designcraft", color: "#7bb51c" },
  { key: "deckcraft", name: "DeckCraft", zh: "演示文稿", desc: "幻灯片与演示制作。", features: ["母版 / 版式 / 主题 / 备注 / 批注", "形状、连接线、渐变、阴影与发光", "图片 / 表格 / 图表 / 音视频", "打开保存 .pptx；切换含 Morph、演讲者视图"], sizeMb: 100, repo: "https://github.com/storytold/deckcraft", site: "https://getartcraft.com/apps/deckcraft", color: "#f07a1e" },
  { key: "wordcraft", name: "WordCraft", zh: "文字处理", desc: "文档编辑：ribbon、快捷键、段落排版与 PDF 输出。", features: ["Ribbon、样式库与熟悉的编辑行为", "打开保存 .docx（也支持 .odt / .rtf / .md / .tex）", "段落排版缓存，长文档输入流畅", "导出可选文本 PDF；拼写语法离线"], sizeMb: 113, repo: "https://github.com/storytold/wordcraft", site: "https://getartcraft.com/apps/wordcraft", color: "#3f5fe0" },
  { key: "gridcraft", name: "GridCraft", zh: "电子表格", desc: "电子表格（clean-room 实现）。", features: ["Ribbon / 公式栏 / 填充柄 / 条件格式 / 图表", "XLSX 原生：公式、表格、透视表往返", "依赖图计算引擎、动态数组、LET / LAMBDA", "桌面与网页同一套体验"], sizeMb: 50, repo: "https://github.com/storytold/gridcraft", site: "https://getartcraft.com/apps/gridcraft", color: "#1f9d55" },
  { key: "pdfcraft", name: "PdfCraft", zh: "PDF 阅读与编辑", desc: "PDF 阅读、整理与保护。", features: ["多语言 / 竖排 / emoji / 透明度的忠实渲染", "即输即搜，按真实阅读顺序选中文本", "页面旋转 / 删除 / 插入 / 重排（深撤销）", "合并 / 提取 / 拆分，保留链接与表单"], sizeMb: 117, repo: "https://github.com/storytold/pdfcraft", site: "https://getartcraft.com/apps/pdfcraft", color: "#e8204f" },
  { key: "cadcraft", name: "CADCraft", zh: "CAD 制图", desc: "计算机辅助设计与制图。", features: ["熟悉的命令行与对象捕捉（@5<45 直接输入）", "原生读写 DXF（R12–2018）与 DWG（R13–2018）", "绘图 / 标注 / 填充 / 块 / 图层 / 图纸空间", "PDF 打印；每个菜单与提示都是命令"], sizeMb: 71, repo: "https://github.com/storytold/cadcraft", site: "https://getartcraft.com/apps/cadcraft", color: "#3ea6e8" },
  { key: "soundcraft", name: "SoundCraft", zh: "数字音频工作站", desc: "多轨音频录制与编辑（DAW）。", features: ["Shuffle / Slip / Spot 编辑、淡入淡出与 comping", "推子 / 声像 / 发送 / 总线 / VCA / 延迟补偿", "四种自动化模式，从推子实时录入", "内置 EQ / 动态 / 混响 / 合成器，支持 CLAP 插件"], sizeMb: 19, repo: "https://github.com/storytold/soundcraft", site: "https://getartcraft.com/apps/soundcraft", color: "#1fa5c9" },
  { key: "materialcraft", name: "MaterialCraft", zh: "节点材质", desc: "节点式材质设计。", features: ["节点图组合噪声 / 图案 / 滤镜", "2D 与 3D 模型实时预览"], sizeMb: 21, repo: "https://github.com/storytold/materialcraft", color: "#178a9c" },
  { key: "texturecraft", name: "TextureCraft", zh: "3D 贴图绘制", desc: "面向 3D 的贴图绘制流程。", features: ["在 3D 模型上绘制材质并导出贴图", "烘焙网格贴图、使用智能材质"], sizeMb: 41, repo: "https://github.com/storytold/texturecraft", site: "https://getartcraft.com/apps/texturecraft", color: "#c2672b" },
  { key: "craft-anything", name: "Craft Anything", zh: "理解任意软件并自造", desc: "分析任意软件怎么运作，并据此做出自己的工具。", features: ["研究网站 / 桌面 / 手机应用 / 游戏与文件，给出证据", "按你的描述让编码代理在新项目里实现", "生成结果与原版逐项比对并迭代修正", "每个工具都是 CLI 与 MCP；仅检查不需要 AI"], sizeMb: 0, repo: "https://github.com/storytold/craft-anything", site: "https://getartcraft.com/apps/craft-anything", color: "#4e7bfb" },
  { key: "solidcraft", name: "SolidCraft", zh: "参数化 3D CAD", desc: "社区维护的参数化三维 CAD。", features: ["草图与约束求解，参数驱动尺寸", "拉伸 / 旋转 / 扫掠 / 放样 / 圆角 / 抽壳 / 阵列", "STEP / IGES / 3MF / STL / OBJ / glTF 进出", "桌面 / 浏览器 / CLI / MCP 同一套命令"], sizeMb: 0, repo: "https://github.com/tangency-labs/solidcraft", site: "https://solidcraft.io", color: "#46a1fb", community: true },
  { key: "mailcraft", name: "MailCraft", zh: "邮件 / 日历 / 联系人", desc: "社区维护的邮件与日程客户端。", features: ["会话 / 旗标 / 分类 / 规则 / 查询式搜索", "日 / 周 / 月视图、重复会议与提醒（对接 Microsoft 365）", ".eml / .mbox / .ics / .vcf 进出，可导入 Outlook .pst", "桌面 / 浏览器 / CLI / MCP 同一套命令"], sizeMb: 0, repo: "https://github.com/UCS-Care-Group/mailcraft", site: "https://mailcraft.work", color: "#0f68f0", community: true },
];

/** 按 key 取 App（层级 3 弹窗用；找不到返回 undefined）。 */
export function craftAppByKey(key: string | null): CraftAppInfo | undefined {
  return key ? CRAFT_APPS.find((app) => app.key === key) : undefined;
}

/** Launcher 目录 id 与本目录 key 的归一化（"Craft Anything" ↔ "craft-anything"）。 */
export function normalizeCraftKey(value: string): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
