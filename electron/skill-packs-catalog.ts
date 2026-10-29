/**
 * 精选技能包清单（10-30）—— **单一真相源**：主进程安装器与预检守卫都读这里。
 * ⛔ 渲染层不再抄一份（它拿到的是 `skill-packs:list` 下发的整行）。
 * ⛔ 仓库 / 许可 / 体积都是**核实过的事实**（GitHub API 与 Releases 实测），改之前先重新核。
 * ⛔ 文案按「一行放得下」写：卡片里 description 一行省略，companion 一行小字；
 *   星号等 Markdown 记号**不许出现**（设置页是纯文本渲染，会把 `**` 原样显示出来 —— 10-30 用户实测「乱糟糟」）。
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
};

export const SKILL_PACKS: SkillPackDef[] = [
  {
    id: "matt-pocock-skills",
    name: "Matt Pocock 工程技能包",
    repo: "mattpocock/skills",
    license: "MIT",
    licenseUrl: "https://github.com/mattpocock/skills/blob/main/LICENSE",
    size: "约 2 MB",
    description: "真实工程流程技能：拆 issue、写测试、复盘、发版",
    companion: "配套：任务清单 + ponytail 写代码模式",
  },
  {
    id: "diagram-design",
    name: "Diagram Design 图表设计",
    repo: "cathrynlavery/diagram-design",
    license: "MIT",
    licenseUrl: "https://github.com/cathrynlavery/diagram-design/blob/main/LICENSE",
    size: "约 37 MB",
    description: "45 种编辑级图表，输出单文件 HTML + 内联 SVG",
    companion: "配套：HTML 实时预览 + 前端开发画布",
  },
  {
    id: "how-to-live-better",
    name: "高性价比人生指南",
    repo: "eternity4719/HowToLiveBetter",
    license: "内容 CC BY 4.0",
    licenseUrl: "https://github.com/eternity4719/HowToLiveBetter/blob/main/LICENSE",
    size: "约 19 MB",
    description: "循证生活手册：省钱、防病、法律红线、医保社保",
    companion: "配套：知识库 + 长期记忆",
  },
];
