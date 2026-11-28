/**
 * 精选技能包清单（10-30 立，11-19 扩编）—— **单一真相源**：主进程安装器与预检守卫都读这里。
 * ⛔ 渲染层不再抄一份（它拿到的是 `skill-packs:list` 下发的整行）。
 * ⛔ 仓库 / 许可 / 体积都是**核实过的事实**（GitHub API 与 Releases 实测），改之前先重新核。
 * ⛔ 文案按「一行放得下」写：卡片里 description 一行省略，companion 一行小字；
 *   星号等 Markdown 记号**不许出现**（设置页是纯文本渲染，会把 `**` 原样显示出来 —— 10-30 用户实测「乱糟糟」）。
 *
 * 11-19 用户令：「把 taste / gsap / playwright / happy 做成精选技能包，原来精选技能和 cheat on 也放进来；
 * 像 Craft 全家桶一样按分类拆开展示、配套给已有专家，并且都要支持后续更新。」
 * ⇒ 新增 `category`（分组 / 归口）、`skills`（包内技能名 = 「拆开」后能看到的东西）、`experts`（配套专家）。
 * ⛔ playwright / happy 上游尚未核实（用户没给仓库）⇒ **不编造**，等确认来源再入册。
 */
export type SkillPackDef = {
  id: string;
  name: string;
  repo: string;
  license: string;
  licenseUrl: string;
  size: string;
  description: string;
  /** 装完能干什么、和本应用哪些功能配套（用户点名要写） */
  companion: string;
  /** 分类：界面按它分组（像「Craft 全家桶」那样）；也是「浏览器自动化」这类功能归口 */
  category: "工程流程" | "图表与可视化" | "网页设计" | "前端动效" | "生活指南" | "浏览器自动化" | "视频与内容" | "电商视觉";
  /** 包内技能名（= 仓库里的目录名）：装完逐个可见，便于「按需停用」而不是整包关 */
  skills?: string[];
  /** 配套专家 / 专家团：装了包之后，这些专家做对应任务会自动用上 */
  experts?: string[];
  /** 使用声明 / 风险边界（第三方内容专用）：卡片与预览弹窗原样展示，⛔ 不许在界面里另写一份 */
  notice?: string;
  /** 上游版本：有 release 用标签（v2.5.1），没有就用最近推送日期（2026-11-19）；内置包写「随包」 */
  version?: string;
  /** 随包内置（resources/expert-skills/<dir>）：随应用分发，界面只展示不下载。
   *  market=true 表示该目录已由 config.toml 的 [marketplaces.expert-skills] **原位注册**
   *  ⇒ ⛔ 不要再拷进 skills 目录（否则同一技能会被市场与目录各发现一次）。 */
  bundled?: { dir: string; market?: boolean };
};

export const SKILL_PACKS: SkillPackDef[] = [
  {
    id: "matt-pocock-skills",
    version: "v1.3.2",
    name: "Matt Pocock 工程技能包",
    repo: "mattpocock/skills",
    license: "MIT",
    licenseUrl: "https://github.com/mattpocock/skills/blob/main/LICENSE",
    size: "约 2 MB",
    description: "真实工程流程技能：拆 issue、写测试、复盘、发版",
    companion: "配套：任务清单 + ponytail 写代码模式",
    category: "工程流程",
    experts: ["极简工程师", "软件开发专家团"],
  },
  {
    id: "diagram-design",
    version: "2026-11-19",
    name: "Diagram Design 图表设计",
    repo: "cathrynlavery/diagram-design",
    license: "MIT",
    licenseUrl: "https://github.com/cathrynlavery/diagram-design/blob/main/LICENSE",
    size: "约 37 MB",
    description: "45 种编辑级图表，输出单文件 HTML + 内联 SVG",
    companion: "配套：HTML 实时预览 + 前端开发画布",
    category: "图表与可视化",
    experts: ["产品设计专家团"],
  },
  {
    id: "how-to-live-better",
    version: "epub-latest",
    name: "高性价比人生指南",
    repo: "eternity4719/HowToLiveBetter",
    license: "内容 CC BY 4.0",
    licenseUrl: "https://github.com/eternity4719/HowToLiveBetter/blob/main/LICENSE",
    size: "约 19 MB",
    description: "循证生活手册：省钱、防病、法律红线、医保社保",
    companion: "配套：知识库 + 长期记忆",
    category: "生活指南",
  },
  {
    /* 上游核实：GitHub Leonxlnx/taste-skill（MIT），主打单技能 design-taste-frontend；
       技能目录在仓库根/一层子目录（不在 skills/ 下）⇒ 安装器走「仓库内扫描 SKILL.md」分支。 */
    id: "taste-skill",
    version: "v2.5.1",
    name: "Taste 反模板设计",
    repo: "Leonxlnx/taste-skill",
    license: "MIT",
    licenseUrl: "https://github.com/Leonxlnx/taste-skill/blob/main/LICENSE",
    size: "约 6 MB",
    description: "20 套设计方向随机发牌、真素材、浏览器三档自检",
    companion: "配套：AI 画布 + 组件库 + 前端开发画布",
    category: "网页设计",
    /* 实测仓库结构（GitHub tree）：skills/taste-skill/SKILL.md —— 就一个技能，别写成三个。 */
    skills: ["taste-skill"],
    experts: ["产品设计专家团", "前端开发专家"],
  },
  {
    /* 上游核实：GitHub greensock/gsap-skills（GSAP 官方，MIT），skills/ 下 8 个技能。 */
    id: "gsap-skills",
    version: "2026-07-29",
    name: "GSAP 官方动效",
    repo: "greensock/gsap-skills",
    license: "MIT",
    licenseUrl: "https://github.com/greensock/gsap-skills/blob/main/LICENSE",
    size: "约 3 MB",
    description: "时间线 / ScrollTrigger / React 清理，插件现已全部免费商用",
    companion: "配套：前端开发画布 + 组件库预览",
    category: "前端动效",
    skills: [
      "gsap-core",
      "gsap-timeline",
      "gsap-scrolltrigger",
      "gsap-plugins",
      "gsap-utils",
      "gsap-react",
      "gsap-performance",
      "gsap-frameworks",
    ],
    experts: ["前端开发专家", "产品设计专家团"],
  },
  {
    /* 11-19：Playwright（微软开源）归「浏览器自动化」；上游是库、没有 skills/ ⇒ 用随包技能。 */
    id: "playwright-browser-automation",
    version: "随包",
    name: "Playwright 浏览器自动化",
    repo: "microsoft/playwright",
    license: "Apache-2.0",
    licenseUrl: "https://github.com/microsoft/playwright/blob/main/LICENSE",
    size: "随包内置",
    description: "批量抓取 / 填表 / 多宽度截图 / 导出 PDF，脚本化跑回归",
    companion: "配套：内置浏览器（登录态复用）+ 工具清单的浏览器自动化分类",
    category: "浏览器自动化",
    skills: ["playwright-browser-automation"],
    experts: ["产品设计专家团", "前端开发专家"],
    bundled: { dir: "playwright-browser-automation" },
  },
  {
    /* 11-20 用户指定收录（GitHub txga01Lwz/shendeng）：单技能仓库，SKILL.md 在仓库根，
       安装器走「仓库内扫描 SKILL.md」→ 目录名取 frontmatter name（shendeng）。
       ⛔ 许可 CC BY-NC 4.0：**署名 + 非商业**。界面必须展示许可徽标与原文链接；
         若将来本应用做商业收费集成，必须先取得作者授权（罗伟泽 · 国作登字-2026-A-00196396）。 */
    id: "shendeng",
    version: "v1.6.0",
    name: "神灯 · 东方心理学",
    repo: "txga01Lwz/shendeng",
    license: "CC BY-NC 4.0（署名 · 非商业）",
    licenseUrl: "https://github.com/txga01Lwz/shendeng/blob/main/LICENSE",
    size: "约 20 KB",
    description: "东方心理学解题法：看见情绪、关系、商业背后的真实需求",
    companion: "配套：知识库 + 长期记忆（沉淀个案与 22 条公式）",
    category: "生活指南",
    skills: ["shendeng"],
    notice: "声明：心理引导不替代医疗诊断；自伤 / 严重抑郁等急性危机请寻求专业帮助。内容来自第三方（作者：罗伟泽 · 听心格爱），CC BY-NC 4.0 —— 须保留署名，不得用于商业销售。",
  },
  {
    /* 11-19：cheat on 早在随包 resources/expert-skills/cheat-on-content ⇒ 只做展示。 */
    id: "cheat-on-content",
    version: "随包",
    name: "Cheat On 内容评分",
    repo: "",
    license: "随包分发",
    licenseUrl: "",
    size: "随包内置",
    description: "按 rubric 给内容打分、预测表现、按反馈重校公式",
    companion: "配套：自媒体工作台 + 知识库（历史数据做校准池）",
    category: "视频与内容",
    skills: ["cheat-bump", "cheat-init", "cheat-predict", "cheat-persona", "cheat-learn-from"],
    experts: ["创意搭档", "自媒体工作台"],
    bundled: { dir: "cheat-on-content", market: true },
  },
  {
    /* 上游核实（11-28，GitHub API 实测）：feichanggege/ecommerce-visual-copywriting-skill
       —— MIT、19071 KB（约 19 MB）、最近推送 2026-10-30、最新发布 v3.0.0。
       仓库结构：根目录 SKILL.md（单技能仓库，另有 references/ examples/ scripts/）
       ⇒ 安装器走「仓库内扫描 SKILL.md」分支（与 taste-skill 同款），不假设 skills/ 目录。
       能力边界：输出是**可执行的 brief**（场景 / 画面文案 / 设计说明 / 出图提示词）+ 五维合规自检，
       ⛔ 不直接出图 —— 所以配套指向「生图专家」，由它接画布出图。 */
    id: "ecommerce-visual-copywriting",
    version: "v3.0.0",
    name: "电商视觉文案 SOP",
    repo: "feichanggege/ecommerce-visual-copywriting-skill",
    license: "MIT",
    licenseUrl: "https://github.com/feichanggege/ecommerce-visual-copywriting-skill/blob/main/LICENSE",
    size: "约 19 MB",
    description: "主图 / 详情页 / A+ 的视觉文案 SOP：先立证据，再写文案",
    companion: "配套：生图专家（出完 brief 直接接画布出图）",
    category: "电商视觉",
    skills: ["ecommerce-visual-copywriting"],
    experts: ["生图专家"],
    notice: "第三方技能（MIT，作者 feichanggege）：输出是交给设计师 / 出图工具执行的 brief，不含成品图；平台规则与广告法以官方最新口径为准，发布前必须人工复核。",
  },
];
