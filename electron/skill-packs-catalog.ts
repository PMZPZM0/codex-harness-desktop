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
  category: "工程流程" | "图表与可视化" | "网页设计" | "前端动效" | "生活指南" | "浏览器自动化" | "视频与内容";
  /** 包内技能名（= 仓库里的目录名）：装完逐个可见，便于「按需停用」而不是整包关 */
  skills?: string[];
  /** 配套专家 / 专家团：装了包之后，这些专家做对应任务会自动用上 */
  experts?: string[];
  /** 上游版本：有 release 用标签（v2.5.1），没有就用最近推送日期（2026-11-19）；内置包写「随包」 */
  version?: string;
  /** 随包内置（resources/expert-skills/<dir>）：随应用分发，界面只展示不下载 */
  bundled?: { dir: string };
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
    bundled: { dir: "cheat-on-content" },
  },
];
